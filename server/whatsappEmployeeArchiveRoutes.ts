import type { Express } from "express";
import pg from "pg";
import {
  recordWhatsappEmployeeArchiveAccess,
  type ArchiveAccessAction,
  type ArchiveAccessReason,
  type ArchiveAccessOutcome,
} from "./whatsappEmployeeAccessAudit";

const enabled = () => process.env.NODE_ENV === "test" &&
  process.env.APP_DEPLOYMENT_MODE === "test" &&
  process.env.WHATSAPP_EMPLOYEE_ARCHIVE_ENABLED === "true";
const localReviewEnabled = () => enabled() &&
  process.env.WHATSAPP_EMPLOYEE_LOCAL_REVIEW_MODE === "true";

export function canReadEmployeeScope(
  actorId: number,
  employeeId: number,
  consentActive: boolean,
  grant?: { active: boolean; canRead: boolean; employeeId: number } | null,
): boolean {
  if (!consentActive) return false;
  if (actorId === employeeId) return true;
  return !!grant?.active && !!grant.canRead && grant.employeeId === employeeId;
}

export function isApprovedEmployeeWaba(wabaId: string, configuredIds: string): boolean {
  const allowed = configuredIds.split(",").map((value) => value.trim()).filter(Boolean);
  return /^\d{5,80}$/.test(wabaId) && allowed.includes(wabaId);
}

let testPool: pg.Pool | undefined;
let auditTestPool: pg.Pool | undefined;
export async function closeWhatsappEmployeeArchiveTestPool(): Promise<void> {
  const pools = [testPool, auditTestPool].filter(Boolean) as pg.Pool[];
  testPool = undefined;
  auditTestPool = undefined;
  await Promise.all(pools.map(pool => pool.end()));
}

function getTestPool(): pg.Pool {
  if (process.env.NODE_ENV !== "test") throw new Error("Employee archive is restricted to isolated test processes.");
  const connectionString = process.env.WHATSAPP_EMPLOYEE_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Dedicated employee archive test database is not configured.");
  const parsed = new URL(connectionString);
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) ||
      !/(^|[_-])(test|testing)([_-]|$)/.test(dbName)) {
    throw new Error("Employee archive requires a loopback database with a test-only name.");
  }
  return testPool ??= new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 1500 });
}

async function safeConnect(): Promise<pg.PoolClient | null> {
  try { return await getTestPool().connect(); } catch { return null; }
}

function getTestAuditPool(): pg.Pool {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Employee archive audit is restricted to isolated test processes.");
  }
  const connectionString = process.env.WHATSAPP_EMPLOYEE_AUDIT_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Dedicated insert-only employee audit test connection is not configured.");
  const parsed = new URL(connectionString);
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) ||
      !/(^|[_-])(test|testing)([_-]|$)/.test(dbName)) {
    throw new Error("Employee archive audit requires a loopback test database.");
  }
  return auditTestPool ??= new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 1200 });
}

class ArchiveAuditUnavailable extends Error {}

async function persistArchiveAccess(input: {
  actorId: number;
  employeeId: number;
  action: ArchiveAccessAction;
  outcome: ArchiveAccessOutcome;
  reason: ArchiveAccessReason;
  resultCount?: number;
}): Promise<void> {
  try {
    await recordWhatsappEmployeeArchiveAccess(getTestAuditPool(), input);
  } catch {
    throw new ArchiveAuditUnavailable();
  }
}

function auditFailureResponse(res: any): void {
  res.status(503).json({ message: "Archive access is temporarily unavailable" });
}

function authenticated(req: any, res: any): number | null {
  const id = Number(req.session?.userId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  return id;
}

async function hasReadGrant(client: pg.PoolClient, actorId: number, employeeId: number): Promise<boolean> {
  const row = await client.query(
    `SELECT 1 FROM whatsapp_employee_supervisor_grants
      WHERE supervisor_id=$1 AND employee_id=$2 AND can_read=true AND revoked_at IS NULL
      LIMIT 1 FOR SHARE`,
    [actorId, employeeId],
  );
  return row.rowCount === 1;
}

async function employeeHasActiveConsent(client: pg.PoolClient, employeeId: number, phoneNumberId?: string): Promise<boolean> {
  const row = await client.query(
    `SELECT 1 FROM whatsapp_employee_numbers n
       JOIN whatsapp_employee_consents c
         ON c.phone_number_id=n.phone_number_id AND c.employee_id=n.employee_id
      WHERE n.employee_id=$1 AND n.is_active=true
        AND n.registration_kind='company'
        AND c.status='consented' AND c.revoked_at IS NULL
        AND ($2::text IS NULL OR n.phone_number_id=$2)
      LIMIT 1 FOR SHARE OF n,c`,
    [employeeId, phoneNumberId ?? null],
  );
  return row.rowCount === 1;
}

async function activeActor(client: pg.PoolClient, actorId: number): Promise<{ isAdmin: boolean } | null> {
  const result = await client.query(
    `SELECT is_admin FROM users WHERE id=$1 AND is_active=true LIMIT 1`,
    [actorId],
  );
  return result.rows[0] ? { isAdmin: result.rows[0].is_admin === true } : null;
}

export function registerWhatsappEmployeeArchiveRoutes(app: Express): void {
  app.get("/api/admin/whatsapp-employee/local-review/archive", async (req: any, res: any) => {
    const actorId = authenticated(req, res);
    if (!actorId) return;
    if (!localReviewEnabled()) return res.sendStatus(404);
    const client = await safeConnect();
    if (!client) return res.sendStatus(503);
    try {
      await client.query("BEGIN");
      const actor = await activeActor(client, actorId);
      if (!actor?.isAdmin) {
        await client.query("ROLLBACK");
        await persistArchiveAccess({
          actorId, employeeId: 101, action: "archive.read", outcome: "denied", reason: "policy_blocked",
        });
        return res.sendStatus(403);
      }
      const result = await client.query(
        `SELECT c.id,e.id AS event_id,e.event_kind,e.direction,e.message_text,e.received_at
           FROM whatsapp_employee_conversations c
           JOIN whatsapp_employee_numbers n
             ON n.phone_number_id=c.phone_number_id AND n.employee_id=c.employee_id
           JOIN whatsapp_employee_consents consent
             ON consent.phone_number_id=n.phone_number_id AND consent.employee_id=n.employee_id
           JOIN whatsapp_employee_events e ON e.conversation_id=c.id AND e.employee_id=c.employee_id
          WHERE c.employee_id=101 AND n.registration_kind='test' AND n.is_active=true
            AND consent.status='consented' AND consent.revoked_at IS NULL
            AND e.meta_event_key LIKE 'synthetic-review:%'
          ORDER BY c.id,e.received_at,e.id LIMIT 200
          FOR SHARE OF n,consent`,
      );
      const byConversation = new Map<number, any>();
      for (const row of result.rows) {
        const id = Number(row.id);
        const conversation = byConversation.get(id) ?? {
          id: String(id),
          label: `Synthetic conversation ${byConversation.size + 1}`,
          messages: [],
        };
        conversation.messages.push({
          id: String(row.event_id),
          kind: row.event_kind === "revoke" ? "deleted" : "text",
          direction: row.direction,
          text: row.event_kind === "revoke" ? "Synthetic message removed" : String(row.message_text ?? ""),
          receivedAt: new Date(row.received_at).toISOString(),
        });
        byConversation.set(id, conversation);
      }
      if (byConversation.size === 0) {
        await client.query("ROLLBACK");
        await persistArchiveAccess({
          actorId, employeeId: 101, action: "archive.read", outcome: "denied",
          reason: "consent_inactive",
        });
        return res.sendStatus(403);
      }
      await persistArchiveAccess({
        actorId, employeeId: 101, action: "archive.read", outcome: "allowed",
        reason: "admin_explicit_grant", resultCount: byConversation.size,
      });
      await client.query("COMMIT");
      return res.json({
        mode: "synthetic_local_review",
        employee: { id: "synthetic-101", label: "Synthetic employee 101" },
        conversations: Array.from(byConversation.values()),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof ArchiveAuditUnavailable) return auditFailureResponse(res);
      return res.sendStatus(500);
    } finally { client.release(); }
  });

  app.post("/api/admin/whatsapp-employees/number-assignments", async (req: any, res: any) => {
    const actorId = authenticated(req, res);
    if (!actorId) return;
    if (!enabled()) return res.sendStatus(404);
    const { phoneNumberId, wabaId, employeeId, authorizationReference } = req.body ?? {};
    if (![phoneNumberId, wabaId].every((v) => typeof v === "string" && /^\d{5,80}$/.test(v)) ||
        typeof authorizationReference !== "string" || authorizationReference.trim().length < 3 ||
        !Number.isSafeInteger(Number(employeeId)) || String(authorizationReference).length > 200) {
      return res.status(400).json({ message: "Invalid company-number assignment" });
    }
    if (!isApprovedEmployeeWaba(wabaId, process.env.WHATSAPP_EMPLOYEE_APPROVED_WABA_IDS ?? "")) {
      return res.status(403).json({ message: "Business account is not approved for employee monitoring" });
    }
    const client = await safeConnect();
    if (!client) return res.sendStatus(503);
    try {
      await client.query("BEGIN");
      if (!(await activeActor(client, actorId))?.isAdmin) {
        await client.query("ROLLBACK"); return res.sendStatus(403);
      }
      const target = await client.query("SELECT id FROM users WHERE id=$1 AND is_active=true AND is_admin=false AND role='sub_agent'", [Number(employeeId)]);
      if (!target.rowCount) { await client.query("ROLLBACK"); return res.sendStatus(404); }
      await client.query(
        `INSERT INTO whatsapp_employee_numbers
          (phone_number_id,waba_id,employee_id,registration_kind,is_active,authorization_reference,authorized_by,business_authorized_at)
         VALUES ($1,$2,$3,'company',false,$4,$5,NOW())`,
        [phoneNumberId.trim(), wabaId.trim(), Number(employeeId), authorizationReference.trim(), actorId],
      );
      await client.query(
        `INSERT INTO whatsapp_employee_audit (actor_id,employee_id,action,phone_number_id,waba_id,details)
         VALUES ($1,$2,'company_number_assigned',$3,$4,jsonb_build_object('authorization_reference',$5))`,
        [actorId, Number(employeeId), phoneNumberId.trim(), wabaId.trim(), authorizationReference.trim()],
      );
      await client.query("COMMIT");
      return res.status(201).json({ pending: "employee_consent_and_second_admin_activation" });
    } catch {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Assignment could not be created" });
    } finally { client.release(); }
  });

  app.post("/api/admin/whatsapp-employees/numbers/:phoneNumberId/activate", async (req: any, res: any) => {
    const actorId = authenticated(req, res);
    if (!actorId) return;
    if (!enabled()) return res.sendStatus(404);
    const client = await safeConnect();
    if (!client) return res.sendStatus(503);
    try {
      await client.query("BEGIN");
      if (!(await activeActor(client, actorId))?.isAdmin) {
        await client.query("ROLLBACK"); return res.sendStatus(403);
      }
      const result = await client.query(
        `UPDATE whatsapp_employee_numbers n SET is_active=true, activated_by=$2, activated_at=NOW()
          WHERE n.phone_number_id=$1 AND n.is_active=false AND n.authorized_by<>$2
            AND EXISTS (SELECT 1 FROM whatsapp_employee_consents c
                         WHERE c.phone_number_id=n.phone_number_id AND c.employee_id=n.employee_id
                           AND c.status='consented' AND c.revoked_at IS NULL)
          RETURNING employee_id,waba_id`,
        [req.params.phoneNumberId, actorId],
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); return res.sendStatus(409); }
      await client.query(
        `INSERT INTO whatsapp_employee_audit (actor_id,employee_id,action,phone_number_id,waba_id)
         VALUES ($1,$2,'number_activated',$3,$4)`,
        [actorId, result.rows[0].employee_id, req.params.phoneNumberId, result.rows[0].waba_id],
      );
      await client.query("COMMIT");
      return res.sendStatus(204);
    } catch {
      await client.query("ROLLBACK");
      return res.sendStatus(500);
    } finally { client.release(); }
  });

  app.post("/api/admin/whatsapp-employees/supervisor-grants", async (req: any, res: any) => {
    const actorId = authenticated(req, res);
    if (!actorId) return;
    if (!enabled()) return res.sendStatus(404);
    const employeeId = Number(req.body?.employeeId);
    const supervisorId = Number(req.body?.supervisorId);
    const client = await safeConnect();
    if (!client) return res.sendStatus(503);
    try {
      await client.query("BEGIN");
      if (!(await activeActor(client, actorId))?.isAdmin) {
        await client.query("ROLLBACK"); return res.sendStatus(403);
      }
      if (!Number.isSafeInteger(employeeId) || !Number.isSafeInteger(supervisorId) || employeeId === supervisorId) {
        await client.query("ROLLBACK"); return res.sendStatus(400);
      }
      const people = await client.query(
        `SELECT id FROM users WHERE id=ANY($1::int[]) AND is_active=true`,
        [[employeeId, supervisorId]],
      );
      if (people.rowCount !== 2) { await client.query("ROLLBACK"); return res.sendStatus(404); }
      await client.query(
        `INSERT INTO whatsapp_employee_supervisor_grants (supervisor_id,employee_id,can_read,granted_by)
         VALUES ($1,$2,true,$3)
         ON CONFLICT (supervisor_id,employee_id) DO UPDATE
           SET can_read=true,granted_by=EXCLUDED.granted_by,revoked_at=NULL,revoked_by=NULL`,
        [supervisorId, employeeId, actorId],
      );
      await client.query(
        `INSERT INTO whatsapp_employee_audit (actor_id,employee_id,action,details)
         VALUES ($1,$2,'supervisor_grant_created',jsonb_build_object('supervisor_id',$3))`,
        [actorId, employeeId, supervisorId],
      );
      await client.query("COMMIT");
      return res.sendStatus(204);
    } catch { await client.query("ROLLBACK"); return res.sendStatus(500); }
    finally { client.release(); }
  });

  app.delete("/api/admin/whatsapp-employees/supervisor-grants/:supervisorId/:employeeId", async (req: any, res: any) => {
    const actorId = authenticated(req, res);
    if (!actorId) return;
    if (!enabled()) return res.sendStatus(404);
    const client = await safeConnect();
    if (!client) return res.sendStatus(503);
    try {
      await client.query("BEGIN");
      if (!(await activeActor(client, actorId))?.isAdmin) {
        await client.query("ROLLBACK"); return res.sendStatus(403);
      }
      const supervisorId = Number(req.params.supervisorId);
      const employeeId = Number(req.params.employeeId);
      const revoked = await client.query(
        `UPDATE whatsapp_employee_supervisor_grants
            SET can_read=false,revoked_at=NOW(),revoked_by=$3
          WHERE supervisor_id=$1 AND employee_id=$2 AND revoked_at IS NULL`,
        [supervisorId, employeeId, actorId],
      );
      if (!revoked.rowCount) { await client.query("ROLLBACK"); return res.sendStatus(404); }
      await client.query(
        `INSERT INTO whatsapp_employee_audit (actor_id,employee_id,action,details)
         VALUES ($1,$2,'supervisor_grant_revoked',jsonb_build_object('supervisor_id',$3))`,
        [actorId, employeeId, supervisorId],
      );
      await client.query("COMMIT");
      return res.sendStatus(204);
    } catch { await client.query("ROLLBACK"); return res.sendStatus(500); }
    finally { client.release(); }
  });

  app.get("/api/employee/whatsapp-consents", async (req: any, res: any) => {
    const actorId = authenticated(req, res);
    if (!actorId) return;
    if (!enabled()) return res.sendStatus(404);
    const client = await safeConnect();
    if (!client) return res.sendStatus(503);
    try {
      if (!(await activeActor(client, actorId))) return res.sendStatus(403);
      const rows = await client.query(
        `SELECT n.phone_number_id,n.waba_id,c.status,c.consented_at,c.revoked_at
           FROM whatsapp_employee_numbers n LEFT JOIN whatsapp_employee_consents c
             ON c.phone_number_id=n.phone_number_id AND c.employee_id=n.employee_id
          WHERE n.employee_id=$1 ORDER BY n.phone_number_id`,
        [actorId],
      );
      return res.json({ consents: rows.rows });
    } catch { return res.sendStatus(500); }
    finally { client.release(); }
  });

  app.post("/api/employee/whatsapp-consents/:phoneNumberId", async (req: any, res: any) => {
    const actorId = authenticated(req, res);
    if (!actorId) return;
    if (!enabled()) return res.sendStatus(404);
    if (!["consented", "revoked"].includes(req.body?.decision)) return res.sendStatus(400);
    const client = await safeConnect();
    if (!client) return res.sendStatus(503);
    try {
      await client.query("BEGIN");
      const actor = await activeActor(client, actorId);
      if (!actor) {
        await client.query("ROLLBACK"); return res.sendStatus(403);
      }
      const number = await client.query(
        `SELECT waba_id FROM whatsapp_employee_numbers
          WHERE phone_number_id=$1 AND employee_id=$2 FOR UPDATE`,
        [req.params.phoneNumberId, actorId],
      );
      if (!number.rowCount) { await client.query("ROLLBACK"); return res.sendStatus(404); }
      const decision = req.body.decision as "consented" | "revoked";
      if (decision === "revoked") {
        await client.query(
          `UPDATE whatsapp_employee_numbers SET is_active=false WHERE phone_number_id=$1 AND employee_id=$2`,
          [req.params.phoneNumberId, actorId],
        );
      }
      await client.query(
        `INSERT INTO whatsapp_employee_consents
          (phone_number_id,employee_id,status,consented_at,revoked_at,last_actor_id)
         VALUES ($1,$2,$3,CASE WHEN $3='consented' THEN NOW() END,CASE WHEN $3='revoked' THEN NOW() END,$2)
         ON CONFLICT (phone_number_id,employee_id) DO UPDATE SET
           status=EXCLUDED.status,
           consented_at=CASE WHEN EXCLUDED.status='consented' THEN NOW() ELSE whatsapp_employee_consents.consented_at END,
           revoked_at=CASE WHEN EXCLUDED.status='revoked' THEN NOW() ELSE NULL END,
           last_actor_id=EXCLUDED.last_actor_id`,
        [req.params.phoneNumberId, actorId, decision],
      );
      await client.query(
        `INSERT INTO whatsapp_employee_audit (actor_id,employee_id,action,phone_number_id,waba_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [actorId, actorId, decision === "consented" ? "consent_granted" : "consent_revoked",
          req.params.phoneNumberId, number.rows[0].waba_id],
      );
      await client.query("COMMIT");
      return res.sendStatus(204);
    } catch { await client.query("ROLLBACK"); return res.sendStatus(500); }
    finally { client.release(); }
  });

  // List only scopes actually accessible to this actor after live consent/grant checks.
  // Admin status alone does NOT bypass the explicit per-employee grant.
  app.get("/api/whatsapp-employee/archive/scopes", async (req: any, res: any) => {
    const actorId = authenticated(req,res);
    if (!actorId) return;
    if (!enabled()) return res.sendStatus(404);
    const client = await safeConnect();
    if (!client) return res.sendStatus(503);
    try {
      await client.query("BEGIN");
      const actor = await activeActor(client,actorId);
      if (!actor) {
        await client.query("ROLLBACK");
        await persistArchiveAccess({actorId,employeeId:actorId,action:"archive.search",outcome:"denied",reason:"policy_blocked"});
        return res.sendStatus(403);
      }
      const result = await client.query(
        `SELECT DISTINCT n.employee_id
          FROM whatsapp_employee_numbers n
          JOIN whatsapp_employee_consents c
            ON c.phone_number_id=n.phone_number_id AND c.employee_id=n.employee_id
         WHERE n.registration_kind='company' AND n.is_active=true
           AND c.status='consented' AND c.revoked_at IS NULL
           AND (n.employee_id=$1 OR EXISTS (
             SELECT 1 FROM whatsapp_employee_supervisor_grants g
              WHERE g.supervisor_id=$1 AND g.employee_id=n.employee_id
                AND g.can_read=true AND g.revoked_at IS NULL
           ))
         ORDER BY n.employee_id LIMIT 100`,
        [actorId],
      );
      for (const row of result.rows) {
        const employeeId=Number(row.employee_id);
        await persistArchiveAccess({actorId,employeeId,action:"archive.search",
          outcome:"allowed",
          reason:employeeId===actorId ? "employee_own_scope" :
            actor.isAdmin ? "admin_explicit_grant" : "supervisor_grant",
          resultCount:result.rowCount ?? 0});
      }
      if (!result.rowCount) {
        await persistArchiveAccess({actorId,employeeId:actorId,action:"archive.search",
          outcome:"denied",reason:"scope_denied",resultCount:0});
      }
      await client.query("COMMIT");
      return res.json({employeeIds:result.rows.map(x=>Number(x.employee_id))});
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof ArchiveAuditUnavailable) return auditFailureResponse(res);
      return res.sendStatus(500);
    } finally { client.release(); }
  });

  app.get("/api/whatsapp-employee/archive/employees/:employeeId/conversations", async (req: any, res: any) => {
    const actorId = authenticated(req, res);
    if (!actorId) return;
    if (!enabled()) return res.sendStatus(404);
    const employeeId = Number(req.params.employeeId);
    if (!Number.isSafeInteger(employeeId) || employeeId <= 0) return res.sendStatus(400);
    const client = await safeConnect();
    if (!client) return res.sendStatus(503);
    try {
      await client.query("BEGIN");
      const actor = await activeActor(client, actorId);
      if (!actor) {
        await client.query("ROLLBACK");
        await persistArchiveAccess({
          actorId, employeeId, action: "archive.read", outcome: "denied", reason: "policy_blocked",
        });
        return res.sendStatus(403);
      }
      const consentActive = await employeeHasActiveConsent(client, employeeId);
      const grant = actorId === employeeId ? null : await hasReadGrant(client, actorId, employeeId);
      if (!canReadEmployeeScope(actorId, employeeId, consentActive, grant ? {
        active: true, canRead: true, employeeId,
      } : null)) {
        await client.query("ROLLBACK");
        await persistArchiveAccess({
          actorId, employeeId, action: "archive.read", outcome: "denied",
          reason: consentActive ? "scope_denied" : "consent_inactive",
        });
        return res.sendStatus(403);
      }
      const rows = await client.query(
        `SELECT c.id,c.contact_wa_id,c.phone_number_id,c.updated_at,
                (SELECT e.message_text FROM whatsapp_employee_events e
                  WHERE e.conversation_id=c.id AND e.event_kind='message'
                  ORDER BY e.received_at DESC LIMIT 1) AS last_message_preview
           FROM whatsapp_employee_conversations c
          WHERE c.employee_id=$1 AND EXISTS (
            SELECT 1 FROM whatsapp_employee_numbers n JOIN whatsapp_employee_consents x
              ON x.phone_number_id=n.phone_number_id AND x.employee_id=n.employee_id
             WHERE n.phone_number_id=c.phone_number_id AND n.is_active=true
               AND n.registration_kind='company'
               AND x.status='consented' AND x.revoked_at IS NULL)
          ORDER BY c.updated_at DESC LIMIT 100`,
        [employeeId],
      );
      await persistArchiveAccess({
        actorId, employeeId, action: "archive.read", outcome: "allowed",
        reason: actorId === employeeId ? "employee_own_scope" :
          actor.isAdmin ? "admin_explicit_grant" : "supervisor_grant",
        resultCount: rows.rowCount ?? undefined,
      });
      await client.query("COMMIT");
      return res.json({ conversations: rows.rows });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof ArchiveAuditUnavailable) return auditFailureResponse(res);
      return res.sendStatus(500);
    }
    finally { client.release(); }
  });

  app.get("/api/whatsapp-employee/archive/conversations/:conversationId/messages", async (req: any, res: any) => {
    const actorId = authenticated(req, res);
    if (!actorId) return;
    if (!enabled()) return res.sendStatus(404);
    const conversationId = Number(req.params.conversationId);
    if (!Number.isSafeInteger(conversationId) || conversationId <= 0) return res.sendStatus(400);
    const client = await safeConnect();
    if (!client) return res.sendStatus(503);
    try {
      await client.query("BEGIN");
      const actor = await activeActor(client, actorId);
      if (!actor) {
        await client.query("ROLLBACK");
        await persistArchiveAccess({
          actorId, employeeId: actorId, action: "archive.read", outcome: "denied", reason: "policy_blocked",
        });
        return res.sendStatus(403);
      }
      const owner = await client.query(
        `SELECT employee_id,phone_number_id FROM whatsapp_employee_conversations WHERE id=$1`,
        [conversationId],
      );
      if (!owner.rowCount) { await client.query("ROLLBACK"); return res.sendStatus(404); }
      const employeeId = Number(owner.rows[0].employee_id);
      const consentActive = await employeeHasActiveConsent(client, employeeId, owner.rows[0].phone_number_id);
      const grant = actorId === employeeId ? null : await hasReadGrant(client, actorId, employeeId);
      if (!canReadEmployeeScope(actorId, employeeId, consentActive, grant ? {
        active: true, canRead: true, employeeId,
      } : null)) {
        await client.query("ROLLBACK");
        await persistArchiveAccess({
          actorId, employeeId, action: "archive.read", outcome: "denied",
          reason: consentActive ? "scope_denied" : "consent_inactive",
        });
        return res.sendStatus(403);
      }
      const rows = await client.query(
        `SELECT e.id,e.event_kind,e.direction,e.event_status,e.message_type,e.message_text,
                  e.related_message_id,e.occurred_at,e.received_at,
                  e.media_mime_type,e.media_size_bytes,e.media_sha256,
                  CASE WHEN e.event_kind='message' AND EXISTS (
                    SELECT 1 FROM whatsapp_employee_events r
                     WHERE r.conversation_id=e.conversation_id
                       AND r.event_kind='revoke'
                       AND r.direction=e.direction
                       AND r.related_message_id=e.meta_message_id
                  ) THEN 'meta_revoke_reported' ELSE 'not_reported' END AS deletion_status,
                  CASE WHEN e.event_kind='message' THEN (
                    SELECT MIN(r.received_at) FROM whatsapp_employee_events r
                     WHERE r.conversation_id=e.conversation_id
                       AND r.event_kind='revoke'
                       AND r.direction=e.direction
                       AND r.related_message_id=e.meta_message_id
                  ) ELSE NULL END AS deletion_observed_at
           FROM whatsapp_employee_events e
           WHERE e.conversation_id=$1 ORDER BY e.received_at ASC,e.id ASC LIMIT 500`,
        [conversationId],
      );
      await persistArchiveAccess({
        actorId, employeeId, action: "archive.read", outcome: "allowed",
        reason: actorId === employeeId ? "employee_own_scope" :
          actor.isAdmin ? "admin_explicit_grant" : "supervisor_grant",
        resultCount: rows.rowCount ?? undefined,
      });
      await client.query("COMMIT");
      return res.json({ messages: rows.rows });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof ArchiveAuditUnavailable) return auditFailureResponse(res);
      return res.sendStatus(500);
    }
    finally { client.release(); }
  });
}
