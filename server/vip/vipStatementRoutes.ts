import type { Express, Request, Response, RequestHandler } from "express";
import { pool } from "../db";

// The request is tracked for Kinglike staff to contact the developer;
// this module never emails developers or attaches an unofficial statement.
export function registerVipStatementRoutes(
  app: Express,
  enabled: RequestHandler,
  authenticated: RequestHandler,
  adminOnly: RequestHandler,
) {
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

  app.get("/api/vip/statement-requests", enabled, authenticated, async (_req: Request, res: Response) => {
    const userId = res.locals.vipUser.id;
    try {
      const { rows } = await pool.query(
        `SELECT s.id::text AS id, s.unit_id::text AS unit_id, s.month_start, s.status, s.created_at
         FROM vip_statement_requests s
         JOIN vip_unit_access a ON a.unit_id = s.unit_id
           AND a.user_id = $1 AND a.access_role='owner' AND a.revoked_at IS NULL
         WHERE s.requested_by=$1
         ORDER BY s.created_at DESC LIMIT 100`,
        [userId],
      );
      res.json({ requests: rows });
    } catch {
      res.status(503).json({ error: "Statement requests unavailable" });
    }
  });

  app.post("/api/vip/statement-requests", enabled, authenticated, sameOriginJson, async (req: Request, res: Response) => {
    const raw = req.body?.unitId;
    const unitId = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
    if (!Number.isSafeInteger(unitId) || unitId <= 0) {
      return res.status(400).json({ error: "Invalid unit" });
    }
    const userId = res.locals.vipUser.id;
    try {
      const ownership = await pool.query(
        `SELECT 1 FROM vip_unit_access
           WHERE unit_id=$1 AND user_id=$2 AND access_role='owner' AND revoked_at IS NULL
           LIMIT 1`,
        [unitId,userId]
      );
      if (ownership.rowCount !== 1) return res.status(404).json({ error: "Unit not found" });
      const created = await pool.query(
        `INSERT INTO vip_statement_requests (unit_id,requested_by,month_start,status)
           VALUES ($1,$2,date_trunc('month', now() AT TIME ZONE 'Asia/Tbilisi')::date,'new')
           ON CONFLICT (unit_id,requested_by,month_start) DO NOTHING
           RETURNING id::text AS id, month_start, status`,
        [unitId,userId]
      );
      if (!created.rows.length) return res.status(409).json({ error: "Already requested this month" });
      return res.status(201).json({ request: created.rows[0] });
    } catch {
      return res.status(503).json({ error: "Statement request could not be saved" });
    }
  });

  app.get("/api/admin/vip/statement-requests", enabled, authenticated, adminOnly, async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT s.id::text AS id, s.unit_id::text AS unit_id, s.month_start, s.status,
                s.created_at, u.username AS client_name, u.email AS client_email,
                n.unit_number, p.name AS project_name
         FROM vip_statement_requests s
         JOIN users u ON u.id=s.requested_by
         JOIN vip_units n ON n.id=s.unit_id
         JOIN vip_projects p ON p.id=n.project_id
         ORDER BY s.created_at DESC LIMIT 100`
      );
      return res.json({ requests: rows });
    } catch {
      return res.status(503).json({ error: "Statement requests unavailable" });
    }
  });

  app.patch("/api/admin/vip/statement-requests/:id", enabled, authenticated, adminOnly, sameOriginJson, async (req: Request, res: Response) => {
    // Until the private-document workflow exists, staff may only mark a request
    // as being followed up with the developer. No false 'delivered' status.
    const rawId = Number(req.params.id);
    if (!Number.isSafeInteger(rawId) || rawId <= 0 || req.body?.status !== "following_up") {
      return res.status(400).json({ error: "Invalid request status" });
    }
    try {
      const { rows } = await pool.query(
        `UPDATE vip_statement_requests SET status='following_up',handled_by=$2
         WHERE id=$1 AND status='new' RETURNING id::text AS id, status`,
        [rawId,res.locals.vipUser.id]
      );
      if (rows.length === 0) return res.status(409).json({ error: "Request no longer new" });
      return res.json({ request: rows[0] });
    } catch {
      return res.status(503).json({ error: "Statement request could not be updated" });
    }
  });
}
