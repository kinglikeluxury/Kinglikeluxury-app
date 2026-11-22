import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../db";

const projectInput = z.object({
  name: z.string().trim().min(2).max(140),
  developerName: z.string().trim().max(140).optional(),
}).strict();
const unitInput = z.object({
  unitNumber: z.string().trim().min(1).max(40),
  floorNumber: z.number().int().min(-5).max(250).nullable().optional(),
}).strict();
const progressInput = z.object({
  percent: z.number().int().min(0).max(100),
  stage: z.string().trim().min(2).max(100),
  note: z.string().trim().max(1000).optional(),
  publish: z.boolean(),
}).strict();

function positiveId(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

const sameOriginJson: RequestHandler = (req, res, next) => {
  if (!req.is("application/json")) return res.status(415).json({ error: "JSON required" });
  const origin = req.get("Origin");
  const host = req.get("Host");
  try {
    if (!origin || !host || new URL(origin).host !== host) {
      return res.status(403).json({ error: "Same-origin request required" });
    }
  } catch {
    return res.status(403).json({ error: "Invalid origin" });
  }
  next();
};

function errorStatus(error: unknown): number {
  if (typeof error === "object" && error !== null && "code" in error &&
      (error as {code?: string}).code === "23505") return 409;
  return 503;
}

/**
 * VIP admin scope; never serves arbitrary client documents.
 * Clients may read only project updates for a project where they own a unit.
 * Project and unit writes are always transacted with a matching audit event.
 */
export function registerVipProjectRoutes(
  app: Express,
  enabled: RequestHandler,
  authenticated: RequestHandler,
  adminOnly: RequestHandler,
): void {
  app.get("/api/admin/vip/projects", enabled, authenticated, adminOnly, async (_req: Request, res: Response) => {
    try {
      const [projectResult, unitResult] = await Promise.all([
        pool.query(
          "SELECT p.id::text AS id, p.name, p.developer_name, " +
          "(SELECT pr.percent_complete FROM vip_progress_updates pr " +
          "WHERE pr.project_id=p.id AND pr.is_published=TRUE ORDER BY pr.created_at DESC,pr.id DESC LIMIT 1) AS progress_percent " +
          "FROM vip_projects p ORDER BY p.name,p.id LIMIT 250"
        ),
        pool.query(
          "SELECT u.id::text AS id, u.project_id::text AS project_id, u.unit_number, u.floor_number, " +
          "a.user_id AS owner_id, usr.email AS owner_email " +
          "FROM vip_units u " +
          "LEFT JOIN vip_unit_access a ON a.unit_id=u.id AND a.access_role='owner' AND a.revoked_at IS NULL " +
          "LEFT JOIN users usr ON usr.id=a.user_id " +
          "ORDER BY u.project_id,u.unit_number LIMIT 2000"
        ),
      ]);
      res.json({ projects: projectResult.rows, units: unitResult.rows });
    } catch {
      res.status(503).json({ error: "VIP projects unavailable" });
    }
  });

  app.post("/api/admin/vip/projects", enabled, authenticated, adminOnly, sameOriginJson, async (req: Request, res: Response) => {
    const parsed = projectInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid project fields" });
    const db = await pool.connect().catch(() => null);
    if (!db) return res.status(503).json({ error: "Database unavailable" });
    try {
      await db.query("BEGIN");
      const result = await db.query(
        "INSERT INTO vip_projects(name,developer_name) VALUES($1,$2) RETURNING id::text AS id,name,developer_name",
        [parsed.data.name, parsed.data.developerName || null]
      );
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) VALUES($1,'project_created',$2::jsonb)",
        [res.locals.vipUser.id, JSON.stringify({projectId:result.rows[0].id})]
      );
      await db.query("COMMIT");
      return res.status(201).json({ project: result.rows[0] });
    } catch (e) {
      await db.query("ROLLBACK").catch(() => {});
      return res.status(errorStatus(e)).json({ error: "Project could not be created" });
    } finally {
      db.release();
    }
  });

  app.post("/api/admin/vip/projects/:projectId/units", enabled, authenticated, adminOnly, sameOriginJson, async (req: Request, res: Response) => {
    const projectId = positiveId(req.params.projectId);
    const parsed = unitInput.safeParse(req.body);
    if (!projectId || !parsed.success) return res.status(400).json({ error: "Invalid unit" });
    const db = await pool.connect().catch(() => null);
    if (!db) return res.status(503).json({ error: "Database unavailable" });
    try {
      await db.query("BEGIN");
      const found = await db.query("SELECT id FROM vip_projects WHERE id=$1 FOR UPDATE", [projectId]);
      if (found.rowCount !== 1) {
        await db.query("ROLLBACK"); return res.status(404).json({ error: "Project not found" });
      }
      const result = await db.query(
        "INSERT INTO vip_units(project_id,unit_number,floor_number) VALUES($1,$2,$3) " +
        "RETURNING id::text AS id,project_id::text AS project_id,unit_number,floor_number",
        [projectId,parsed.data.unitNumber,parsed.data.floorNumber ?? null]
      );
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,unit_id,metadata) " +
        "VALUES($1,'unit_created',$2,$3::jsonb)",
        [res.locals.vipUser.id,result.rows[0].id,JSON.stringify({projectId})]
      );
      await db.query("COMMIT");
      return res.status(201).json({ unit: result.rows[0] });
    } catch(e) {
      await db.query("ROLLBACK").catch(() => {});
      return res.status(errorStatus(e)).json({ error: "Unit could not be created" });
    } finally {
      db.release();
    }
  });

  app.post("/api/admin/vip/projects/:projectId/progress", enabled, authenticated, adminOnly, sameOriginJson, async (req: Request, res: Response) => {
    const projectId = positiveId(req.params.projectId);
    const parsed = progressInput.safeParse(req.body);
    if (!projectId || !parsed.success) return res.status(400).json({ error: "Invalid progress update" });
    const db = await pool.connect().catch(() => null);
    if (!db) return res.status(503).json({ error: "Database unavailable" });
    try {
      await db.query("BEGIN");
      const project = await db.query("SELECT id FROM vip_projects WHERE id=$1 FOR UPDATE",[projectId]);
      if (project.rowCount !== 1) {
        await db.query("ROLLBACK"); return res.status(404).json({ error: "Project not found" });
      }
      const result = await db.query(
        "INSERT INTO vip_progress_updates(project_id,percent_complete,stage,note,is_published,updated_by) " +
        "VALUES($1,$2,$3,$4,$5,$6) " +
        "RETURNING id::text AS id,percent_complete,stage,note,is_published,created_at",
        [projectId,parsed.data.percent,parsed.data.stage,parsed.data.note || null,parsed.data.publish,res.locals.vipUser.id]
      );
      await db.query(
        "INSERT INTO vip_audit_events(actor_user_id,event_type,metadata) VALUES($1,'progress_updated',$2::jsonb)",
        [res.locals.vipUser.id,JSON.stringify({projectId,updateId:result.rows[0].id,percent:parsed.data.percent,published:parsed.data.publish})]
      );
      await db.query("COMMIT");
      return res.status(201).json({ progress: result.rows[0] });
    } catch(e) {
      await db.query("ROLLBACK").catch(() => {});
      return res.status(errorStatus(e)).json({ error: "Progress update failed" });
    } finally {
      db.release();
    }
  });

  // Client's project identifier alone never conveys entitlement. Access is
  // checked against a current OWNER assignment to a unit in that project.
  app.get("/api/vip/projects/:projectId/progress", enabled, authenticated, async (req: Request, res: Response) => {
    const projectId = positiveId(req.params.projectId);
    if (!projectId) return res.status(404).json({ error: "Project not found" });
    const userId = res.locals.vipUser.id;
    try {
      const access = await pool.query(
        "SELECT 1 FROM vip_units u JOIN vip_unit_access a ON a.unit_id=u.id " +
        "WHERE u.project_id=$1 AND a.user_id=$2 AND a.access_role='owner' AND a.revoked_at IS NULL LIMIT 1",
        [projectId,userId]
      );
      if (access.rowCount !== 1) return res.status(404).json({ error: "Project not found" });
      const updates = await pool.query(
        "SELECT id::text AS id,percent_complete,stage,note,created_at " +
        "FROM vip_progress_updates WHERE project_id=$1 AND is_published=TRUE " +
        "ORDER BY created_at DESC,id DESC LIMIT 20",
        [projectId]
      );
      return res.json({ updates: updates.rows });
    } catch {
      return res.status(503).json({ error: "Progress unavailable" });
    }
  });
}
