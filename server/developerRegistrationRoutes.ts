/**
 * Developer Registration Center — API Routes
 * All endpoints are admin-only (403 for unauthenticated or non-admin users).
 * Phase 2: Real HTTP submission for Silk Development only (company id=1).
 */

import { type Express, type Request, type Response } from "express";
import { pool } from "./db";
import { prepareRegistrationPayload, runDueReRegistrations, backfillPetraRecordsForExistingLeads } from "./developerRegistrationService";
import {
  submitRecordToSilk,
  ensureSilkAttemptColumns,
  SILK_COMPANY_ID,
} from "./silkSubmissionAdapter";
import {
  submitRecordToAmbassadori,
  ensureAmbassadoriAttemptColumns,
  ensureAmbassadoriCompany,
  validateAmbassadoriToken,
  AMBASSADORI_COMPANY_ID,
} from "./ambassadoriSubmissionAdapter";
import {
  submitLeadViaBrowser,
  fixAmbassadoriUnverifiedSuccesses,
} from "./ambassadoriBrowserService";
import { submitLeadToPetra } from "./petraSubmissionAdapter";
import {
  ensureAmbassadoriSessionTable,
  saveSessionData,
  getSessionStatus,
} from "./ambassadoriSessionStore";

// ── Schema migration — idempotent, runs once at startup ───────────────────────

async function ensureDevRegSchemaColumns(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE developer_companies
        ADD COLUMN IF NOT EXISTS auto_register_enabled BOOLEAN NOT NULL DEFAULT true
    `);
    console.log("[DeveloperRegistration] Schema columns ensured (auto_register_enabled)");
  } catch (err: any) {
    console.error("[DeveloperRegistration] Schema migration failed:", err.message);
  } finally {
    client.release();
  }
}

function adminOnly(req: Request, res: Response): boolean {
  if (!(req as any).session?.isAdmin) {
    res.status(403).json({ message: "Admin only" });
    return false;
  }
  return true;
}

/**
 * Ensures all Developer Registration schema/table prerequisites exist.
 * Runs each step sequentially (awaited, one at a time) rather than as
 * independent floating promises — this avoids piling concurrent
 * pool.connect() calls onto the shared Neon pool during startup, which is
 * a known trigger for an intermittent "double release" crash in the
 * @neondatabase/serverless driver. Called once from the main sequential
 * boot queue in server/index.ts; safe to call again (fully idempotent).
 */
export async function ensureDeveloperRegistrationRouteTables(): Promise<void> {
  await ensureDevRegSchemaColumns().catch(() => {});
  await ensureSilkAttemptColumns().catch(() => {});
  await ensureAmbassadoriAttemptColumns().catch(() => {});
  await ensureAmbassadoriCompany().catch(() => {});
  await ensureAmbassadoriSessionTable().catch(() => {});
  await fixAmbassadoriUnverifiedSuccesses().catch(() => {});
}

export function registerDeveloperRegistrationRoutes(app: Express): void {

  // ── Overview dashboard ────────────────────────────────────────────────────

  app.get("/api/admin/developer-registration/overview", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const client = await pool.connect();
      try {
        const [statsResult, protectedResult, stoppedResult, todayResult, perDevResult, nextDueResult] =
          await Promise.all([
            client.query(`SELECT status, COUNT(*) AS count FROM developer_registration_records GROUP BY status`),
            client.query(`SELECT COUNT(*) AS count FROM developer_registration_records WHERE protection_status='protected'`),
            client.query(`SELECT COUNT(*) AS count FROM developer_registration_records WHERE protection_status IN ('stopped','sold')`),
            client.query(`
              SELECT
                COUNT(*) FILTER (WHERE dra.created_at >= CURRENT_DATE) AS today_total,
                COUNT(*) FILTER (WHERE dra.created_at >= CURRENT_DATE AND dra.status = 'success') AS today_success,
                COUNT(*) FILTER (WHERE dra.created_at >= CURRENT_DATE AND dra.status = 'failed')  AS today_failed
              FROM developer_registration_attempts dra
            `),
            client.query(`
              SELECT dc.name AS developer_name, dc.id AS developer_id,
                     COUNT(drr.id) AS total,
                     COUNT(drr.id) FILTER (WHERE drr.status = 'success')   AS success,
                     COUNT(drr.id) FILTER (WHERE drr.status = 'failed')    AS failed,
                     COUNT(drr.id) FILTER (WHERE drr.status = 'stopped')   AS stopped,
                     COUNT(drr.id) FILTER (WHERE drr.status = 'pending_re_registration') AS pending_re_reg,
                     MAX(drr.last_registered_at)  AS last_registered_at,
                     MIN(drr.next_registration_at) FILTER (WHERE drr.next_registration_at IS NOT NULL AND drr.protection_status = 'protected') AS next_due_at
                FROM developer_companies dc
                LEFT JOIN developer_registration_records drr ON drr.developer_company_id = dc.id
               GROUP BY dc.id, dc.name
               ORDER BY dc.id
            `),
            client.query(`
              SELECT MIN(next_registration_at) AS next_due
                FROM developer_registration_records
               WHERE next_registration_at IS NOT NULL
                 AND protection_status = 'protected'
                 AND status NOT IN ('stopped')
            `),
          ]);

        const stats: Record<string, number> = {};
        for (const row of statsResult.rows) stats[row.status] = parseInt(row.count, 10);

        res.json({
          stats,
          protected:    parseInt(protectedResult.rows[0]?.count ?? "0", 10),
          stopped:      parseInt(stoppedResult.rows[0]?.count ?? "0", 10),
          today: {
            total:   parseInt(todayResult.rows[0]?.today_total   ?? "0", 10),
            success: parseInt(todayResult.rows[0]?.today_success ?? "0", 10),
            failed:  parseInt(todayResult.rows[0]?.today_failed  ?? "0", 10),
          },
          perDeveloper: perDevResult.rows.map(r => ({
            developerId:   r.developer_id,
            developerName: r.developer_name,
            total:         parseInt(r.total    ?? "0", 10),
            success:       parseInt(r.success  ?? "0", 10),
            failed:        parseInt(r.failed   ?? "0", 10),
            stopped:       parseInt(r.stopped  ?? "0", 10),
            pendingReReg:  parseInt(r.pending_re_reg ?? "0", 10),
            lastRegisteredAt: r.last_registered_at,
            nextDueAt:     r.next_due_at,
          })),
          nextDueAt: nextDueResult.rows[0]?.next_due ?? null,
        });
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Registration queue ────────────────────────────────────────────────────

  app.get("/api/admin/developer-registration/queue", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const {
        status, developer_id, page = "1", limit = "50",
        search, date_from, date_to, assigned_to, lead_source,
      } = req.query as Record<string, string>;
      const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const conditions: string[] = [];
      const params: any[] = [];

      if (status) {
        params.push(status);
        conditions.push(`drr.status = $${params.length}`);
      }
      if (developer_id) {
        params.push(parseInt(developer_id, 10));
        conditions.push(`drr.developer_company_id = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(cl.full_name ILIKE $${params.length} OR cl.first_name ILIKE $${params.length} OR cl.phone ILIKE $${params.length})`);
      }
      if (date_from) {
        params.push(date_from);
        conditions.push(`drr.created_at >= $${params.length}::date`);
      }
      if (date_to) {
        params.push(date_to);
        conditions.push(`drr.created_at < ($${params.length}::date + INTERVAL '1 day')`);
      }
      if (assigned_to) {
        params.push(assigned_to);
        conditions.push(`cl.assigned_to = $${params.length}`);
      }
      if (lead_source) {
        params.push(lead_source);
        conditions.push(`cl.lead_source = $${params.length}`);
      }

      const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

      const client = await pool.connect();
      try {
        const countResult = await client.query(
          `SELECT COUNT(*) AS total
             FROM developer_registration_records drr
             JOIN developer_companies dc ON dc.id = drr.developer_company_id
             JOIN crm_leads cl ON cl.id = drr.crm_lead_id
           ${where}`,
          params
        );
        const total = parseInt(countResult.rows[0].total, 10);

        params.push(parseInt(limit, 10));
        params.push(offset);

        const queueResult = await client.query(`
          SELECT
            drr.id,
            drr.crm_lead_id,
            drr.developer_company_id,
            drr.status,
            drr.protection_status,
            drr.last_registered_at,
            drr.next_registration_at,
            drr.attempt_count,
            drr.last_error,
            drr.created_at,
            drr.updated_at,
            dc.name    AS developer_name,
            dc.form_url,
            cl.full_name   AS lead_full_name,
            cl.first_name  AS lead_first_name,
            cl.phone       AS lead_phone,
            cl.status      AS lead_status,
            cl.lead_source AS lead_source,
            cl.assigned_to AS lead_assigned_to
          FROM developer_registration_records drr
          JOIN developer_companies dc ON dc.id = drr.developer_company_id
          JOIN crm_leads cl ON cl.id = drr.crm_lead_id
          ${where}
          ORDER BY drr.updated_at DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        res.json({ total, records: queueResult.rows });
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Registrations for a specific lead ─────────────────────────────────────

  app.get("/api/admin/developer-registration/lead/:leadId", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const leadId = parseInt(req.params.leadId, 10);
      const client = await pool.connect();
      try {
        const result = await client.query(`
          SELECT
            drr.*,
            dc.name AS developer_name,
            dc.form_url
          FROM developer_registration_records drr
          JOIN developer_companies dc ON dc.id = drr.developer_company_id
          WHERE drr.crm_lead_id = $1
          ORDER BY drr.created_at ASC
        `, [leadId]);
        res.json(result.rows);
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Get prepared payload for a record ─────────────────────────────────────

  app.get("/api/admin/developer-registration/:recordId/payload", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const client = await pool.connect();
      try {
        const result = await client.query(`
          SELECT drr.registration_payload_json, drr.status, drr.last_error,
                 dc.name AS developer_name, dc.form_url
            FROM developer_registration_records drr
            JOIN developer_companies dc ON dc.id = drr.developer_company_id
           WHERE drr.id = $1
        `, [recordId]);
        if (result.rows.length === 0) return res.status(404).json({ message: "Record not found" });
        res.json(result.rows[0]);
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Re-prepare payload for a record ───────────────────────────────────────

  app.post("/api/admin/developer-registration/lead/:leadId/prepare", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const leadId = parseInt(req.params.leadId, 10);
      const client = await pool.connect();
      try {
        // Get lead data
        const leadResult = await client.query(`
          SELECT id, full_name, first_name, last_name, phone, country, city, budget, project_interest
            FROM crm_leads WHERE id = $1
        `, [leadId]);
        if (leadResult.rows.length === 0) return res.status(404).json({ message: "Lead not found" });
        const lead = leadResult.rows[0];

        // Get all records for this lead and refresh each
        const recordsResult = await client.query(`
          SELECT drr.id, dfc.config_json
            FROM developer_registration_records drr
            JOIN developer_form_configs dfc ON dfc.developer_company_id = drr.developer_company_id AND dfc.is_active = true
           WHERE drr.crm_lead_id = $1
        `, [leadId]);

        for (const rec of recordsResult.rows) {
          const configJson = typeof rec.config_json === "string"
            ? JSON.parse(rec.config_json)
            : rec.config_json ?? {};

          const leadData = {
            id: lead.id,
            fullName: lead.full_name,
            firstName: lead.first_name,
            lastName: lead.last_name,
            phone: lead.phone,
            country: lead.country,
            city: lead.city,
            budget: lead.budget,
            projectInterest: lead.project_interest,
          };

          const { payload, needsReview, reviewReason } = prepareRegistrationPayload(leadData, configJson);

          await client.query(`
            UPDATE developer_registration_records
               SET registration_payload_json = $1,
                   status = CASE WHEN status = 'stopped' THEN status ELSE $2 END,
                   last_error = $3,
                   updated_at = NOW()
             WHERE id = $4
          `, [
            JSON.stringify(payload),
            needsReview ? "needs_review" : "prepared",
            reviewReason || null,
            rec.id,
          ]);
        }

        console.log(`[DeveloperRegistration] Prepared registration leadId=${leadId}`);
        res.json({ message: "Payload refreshed", count: recordsResult.rows.length });
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Mark submitted ─────────────────────────────────────────────────────────

  app.post("/api/admin/developer-registration/:recordId/mark-submitted", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const adminId  = (req as any).session.userId;
      const client = await pool.connect();
      try {
        // Get interval days
        const infoResult = await client.query(`
          SELECT drr.crm_lead_id, drr.developer_company_id, drr.registration_payload_json,
                 dc.registration_interval_days
            FROM developer_registration_records drr
            JOIN developer_companies dc ON dc.id = drr.developer_company_id
           WHERE drr.id = $1
        `, [recordId]);
        if (infoResult.rows.length === 0) return res.status(404).json({ message: "Record not found" });
        const info = infoResult.rows[0];

        const now     = new Date();
        const nextReg = new Date(now.getTime() + info.registration_interval_days * 24 * 60 * 60 * 1000);

        await client.query(`
          UPDATE developer_registration_records
             SET status               = 'submitted',
                 protection_status    = 'protected',
                 last_registered_at   = $1,
                 next_registration_at = $2,
                 attempt_count        = COALESCE(attempt_count, 0) + 1,
                 last_error           = NULL,
                 updated_at           = NOW()
           WHERE id = $3
        `, [now, nextReg, recordId]);

        // Audit log
        await client.query(`
          INSERT INTO developer_registration_attempts
            (registration_record_id, crm_lead_id, developer_company_id, attempt_type, status, payload_json, result_message, created_by, created_at)
          VALUES ($1, $2, $3, 'manual', 'success', $4, 'Manually marked as submitted by admin', $5, NOW())
        `, [
          recordId,
          info.crm_lead_id,
          info.developer_company_id,
          info.registration_payload_json,
          adminId,
        ]);

        console.log(`[DeveloperRegistration] Marked submitted recordId=${recordId}`);
        res.json({ message: "Marked as submitted", nextRegistrationAt: nextReg });
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Mark failed ────────────────────────────────────────────────────────────

  app.post("/api/admin/developer-registration/:recordId/mark-failed", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const { reason } = req.body;
      const client = await pool.connect();
      try {
        await client.query(`
          UPDATE developer_registration_records
             SET status = 'failed', last_error = $1, updated_at = NOW()
           WHERE id = $2
        `, [reason || "Marked failed by admin", recordId]);

        console.log(`[DeveloperRegistration] Marked failed recordId=${recordId}`);
        res.json({ message: "Marked as failed" });
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Mark needs review ──────────────────────────────────────────────────────

  app.post("/api/admin/developer-registration/:recordId/needs-review", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const { reason } = req.body;
      const client = await pool.connect();
      try {
        await client.query(`
          UPDATE developer_registration_records
             SET status = 'needs_review', last_error = $1, updated_at = NOW()
           WHERE id = $2
        `, [reason || "Flagged for review by admin", recordId]);
        res.json({ message: "Marked as needs review" });
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Stop protection ────────────────────────────────────────────────────────

  app.post("/api/admin/developer-registration/:recordId/stop", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const client = await pool.connect();
      try {
        await client.query(`
          UPDATE developer_registration_records
             SET status = 'stopped', protection_status = 'stopped',
                 next_registration_at = NULL, updated_at = NOW()
           WHERE id = $1
        `, [recordId]);
        console.log(`[DeveloperRegistration] Stopped due to lead status recordId=${recordId}`);
        res.json({ message: "Protection stopped" });
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Resume protection ──────────────────────────────────────────────────────

  app.post("/api/admin/developer-registration/:recordId/resume", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const client = await pool.connect();
      try {
        await client.query(`
          UPDATE developer_registration_records
             SET status = 'prepared', protection_status = 'protected', updated_at = NOW()
           WHERE id = $1
        `, [recordId]);
        res.json({ message: "Protection resumed" });
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Developer companies list ───────────────────────────────────────────────

  app.get("/api/admin/developer-registration/companies", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(`
          SELECT dc.*,
                 dfc.id          AS config_id,
                 dfc.config_json AS config_json,
                 dfc.is_active   AS config_active,
                 dfc.updated_at  AS config_updated_at
            FROM developer_companies dc
            LEFT JOIN developer_form_configs dfc
                   ON dfc.developer_company_id = dc.id AND dfc.is_active = true
           ORDER BY dc.created_at ASC
        `);
        res.json(result.rows);
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Add developer company ──────────────────────────────────────────────────

  app.post("/api/admin/developer-registration/companies", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const {
        name, form_url, registration_interval_days = 30,
        registration_mode = "manual", is_active = true,
        auto_register_enabled = true,
        config_json,
      } = req.body;

      if (!name?.trim()) return res.status(400).json({ message: "Company name is required" });

      const client = await pool.connect();
      try {
        const companyResult = await client.query(`
          INSERT INTO developer_companies
            (name, form_url, is_active, auto_register_enabled, registration_interval_days, registration_mode, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          RETURNING *
        `, [name.trim(), form_url || null, is_active, auto_register_enabled, registration_interval_days, registration_mode]);

        const company = companyResult.rows[0];

        // Create initial form config
        const defaultConfig = config_json ?? {
          field_mappings: {},
          required_fields: [],
          default_values: {},
          payload_rules: {},
          representative_settings: {},
          compatibility_checker_result: {
            can_auto_fill: false,
            captcha_detected: null,
            cloudflare_detected: null,
            submit_button_detected: null,
            required_fields_detected: null,
            success_message_detected: null,
            risk_level: "medium",
            last_checked_at: null,
            notes: "Phase 1 — manual workflow only",
          },
          risk_level: "medium",
          notes: "",
        };

        await client.query(`
          INSERT INTO developer_form_configs
            (developer_company_id, config_json, is_active, created_at, updated_at)
          VALUES ($1, $2, true, NOW(), NOW())
        `, [company.id, JSON.stringify(defaultConfig)]);

        console.log(`[DeveloperRegistration] Developer config updated developerId=${company.id}`);
        res.status(201).json(company);
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Update developer company ───────────────────────────────────────────────

  app.patch("/api/admin/developer-registration/companies/:id", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const companyId = parseInt(req.params.id, 10);
      const {
        name, form_url, is_active, auto_register_enabled,
        registration_interval_days, registration_mode,
        config_json,
      } = req.body;

      const client = await pool.connect();
      try {
        // Update company
        await client.query(`
          UPDATE developer_companies
             SET name                      = COALESCE($1, name),
                 form_url                  = COALESCE($2, form_url),
                 is_active                 = COALESCE($3, is_active),
                 auto_register_enabled     = COALESCE($4, auto_register_enabled),
                 registration_interval_days= COALESCE($5, registration_interval_days),
                 registration_mode         = COALESCE($6, registration_mode),
                 updated_at                = NOW()
           WHERE id = $7
        `, [name || null, form_url || null, is_active ?? null, auto_register_enabled ?? null, registration_interval_days || null, registration_mode || null, companyId]);

        // Update config if provided
        if (config_json !== undefined) {
          await client.query(`
            UPDATE developer_form_configs
               SET config_json = $1, updated_at = NOW()
             WHERE developer_company_id = $2 AND is_active = true
          `, [typeof config_json === "string" ? config_json : JSON.stringify(config_json), companyId]);
        }

        console.log(`[DeveloperRegistration] Developer config updated developerId=${companyId}`);
        res.json({ message: "Updated" });
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Manual trigger: run due re-registrations now ──────────────────────────

  app.post("/api/admin/developer-registration/run-due-registrations", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const result = await runDueReRegistrations();
      console.log(`[DeveloperRegistration] Manual run triggered by admin — result:`, result);
      res.json({ message: "Re-registration run complete", ...result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Submit to Ambassadori ─────────────────────────────────────────────────

  app.post("/api/admin/developer-registration/:recordId/submit-to-ambassadori", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const adminId  = (req as any).session?.userId ?? 0;
      if (!recordId) return res.status(400).json({ message: "Invalid record id" });

      const client = await pool.connect();
      let devCompanyId: number;
      try {
        const chk = await client.query(
          `SELECT developer_company_id, status FROM developer_registration_records WHERE id=$1`,
          [recordId]
        );
        if (chk.rows.length === 0) return res.status(404).json({ message: "Record not found" });
        devCompanyId = chk.rows[0].developer_company_id;
        if (devCompanyId !== AMBASSADORI_COMPANY_ID) {
          return res.status(400).json({
            message: `submit-to-ambassadori is only for Ambassadori (company id=${AMBASSADORI_COMPANY_ID}). This record belongs to company id=${devCompanyId}.`,
          });
        }
        if (chk.rows[0].status === "stopped")     return res.status(400).json({ message: "Cannot submit a stopped record" });
        if (chk.rows[0].status === "submitting")  return res.status(409).json({ message: "Submission already in progress" });
      } finally { client.release(); }

      const result = await submitRecordToAmbassadori(recordId, adminId, "manual_retry");
      console.log(`[Ambassadori] submit complete recordId=${recordId} outcome=${result.outcome}`);
      res.json(result);
    } catch (err: any) {
      console.error("[Ambassadori] submit error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Submit to Ambassadori via Browser (Phase 3 — Playwright headless) ────

  app.post("/api/admin/developer-registration/:recordId/submit-to-ambassadori-browser", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const adminId  = (req as any).session?.userId ?? null;
      if (!recordId) return res.status(400).json({ message: "Invalid record id" });

      const client = await pool.connect();
      try {
        const chk = await client.query(
          `SELECT developer_company_id, status FROM developer_registration_records WHERE id=$1`,
          [recordId]
        );
        if (chk.rows.length === 0) return res.status(404).json({ message: "Record not found" });
        const devCompanyId = chk.rows[0].developer_company_id;
        if (devCompanyId !== AMBASSADORI_COMPANY_ID) {
          return res.status(400).json({ message: "Record is not for Ambassadori" });
        }
        if (chk.rows[0].status === "stopped")    return res.status(400).json({ message: "Cannot submit a stopped record" });
        if (chk.rows[0].status === "submitting") return res.status(409).json({ message: "Submission already in progress" });
      } finally { client.release(); }

      console.log(`[Ambassadori][Browser] Starting browser submission recordId=${recordId}`);
      const result = await submitLeadViaBrowser(recordId, adminId);
      console.log(`[Ambassadori][Browser] Done recordId=${recordId} outcome=${result.outcome}`);
      res.json(result);
    } catch (err: any) {
      console.error("[Ambassadori][Browser] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Submit to Petra (Phase 2 — Petra Group automated form fill) ───────────

  app.post("/api/admin/developer-registration/:recordId/submit-to-petra", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const adminId  = (req as any).session?.userId ?? null;
      if (!recordId) return res.status(400).json({ message: "Invalid record id" });

      const client = await pool.connect();
      try {
        const chk = await client.query(
          `SELECT dc.name, drr.status
             FROM developer_registration_records drr
             JOIN developer_companies dc ON dc.id = drr.developer_company_id
            WHERE drr.id = $1`,
          [recordId]
        );
        if (chk.rows.length === 0) return res.status(404).json({ message: "Record not found" });
        if (!(chk.rows[0].name ?? "").toLowerCase().includes("petra")) {
          return res.status(400).json({ message: "Record is not for Petra Group" });
        }
        if (chk.rows[0].status === "stopped")    return res.status(400).json({ message: "Cannot submit a stopped record" });
        if (chk.rows[0].status === "submitting") return res.status(409).json({ message: "Submission already in progress" });
      } finally { client.release(); }

      console.log(`[Petra][Browser] Starting browser submission recordId=${recordId}`);
      const result = await submitLeadToPetra(recordId, adminId);
      console.log(`[Petra][Browser] Done recordId=${recordId} outcome=${result.outcome}`);
      res.json(result);
    } catch (err: any) {
      console.error("[Petra][Browser] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Mark Ambassadori record as manually confirmed ─────────────────────────

  app.post("/api/admin/developer-registration/:recordId/mark-manually-confirmed", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const adminId  = (req as any).session?.userId ?? null;
      const { dealId, notes } = req.body ?? {};
      if (!recordId) return res.status(400).json({ message: "Invalid record id" });

      const client = await pool.connect();
      try {
        const chk = await client.query(
          `SELECT developer_company_id, crm_lead_id FROM developer_registration_records WHERE id=$1`,
          [recordId]
        );
        if (chk.rows.length === 0) return res.status(404).json({ message: "Record not found" });
        if (chk.rows[0].developer_company_id !== AMBASSADORI_COMPANY_ID) {
          return res.status(400).json({ message: "Only Ambassadori records can be manually confirmed here" });
        }
        const crmLeadId = chk.rows[0].crm_lead_id;

        await client.query(`
          UPDATE developer_registration_records
             SET status               = 'success',
                 last_error           = NULL,
                 last_registered_at   = NOW(),
                 next_registration_at = NOW() + INTERVAL '30 days',
                 updated_at           = NOW()
           WHERE id = $1
        `, [recordId]);

        const payload = { dealId: dealId ?? null, notes: notes ?? "Manually confirmed by admin", confirmedBy: adminId };
        await client.query(`
          INSERT INTO developer_registration_attempts
            (registration_record_id, crm_lead_id, developer_company_id,
             attempt_type, status, payload_json, result_message, created_by, created_at)
          VALUES ($1, $2, $3, 'manual_confirm', 'success', $4, $5, $6, NOW())
        `, [
          recordId, crmLeadId, AMBASSADORI_COMPANY_ID,
          JSON.stringify(payload),
          `Manually confirmed by admin${dealId ? ` — deal ID: ${dealId}` : ""}`,
          adminId,
        ]);

      } finally { client.release(); }

      res.json({ success: true, message: "Record marked as manually confirmed — status set to success" });
    } catch (err: any) {
      console.error("[Ambassadori] mark-manually-confirmed error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Ambassadori session status ────────────────────────────────────────────

  app.get("/api/admin/developer-registration/ambassadori/session-status", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const status = await getSessionStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Ambassadori API token status (read-only live validation) ─────────────

  app.get("/api/admin/developer-registration/ambassadori/token-status", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const status = await validateAmbassadoriToken();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Save Ambassadori browser session cookies ──────────────────────────────
  // Admin pastes cookies (from DevTools → Application → Cookies) as JSON array.

  app.post("/api/admin/developer-registration/ambassadori/save-session", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const { cookies, localStorage: ls, userAgent } = req.body ?? {};
      if (!Array.isArray(cookies)) {
        return res.status(400).json({ message: "cookies must be a JSON array" });
      }
      await saveSessionData({
        cookies,
        localStorage: ls ?? {},
        userAgent:    userAgent ?? undefined,
        savedAt:      new Date().toISOString(),
      });
      res.json({ success: true, message: `Session saved — ${cookies.length} cookie(s) stored` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Submit to Silk (Phase 2 — Silk Development only) ─────────────────────

  app.post("/api/admin/developer-registration/:recordId/submit-to-silk", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      const adminId  = (req as any).session.userId ?? 0;
      if (!recordId) return res.status(400).json({ message: "Invalid record id" });

      // Confirm this record actually belongs to Silk before handing off
      const client = await pool.connect();
      let devCompanyId: number;
      try {
        const chk = await client.query(
          `SELECT developer_company_id, status FROM developer_registration_records WHERE id=$1`,
          [recordId]
        );
        if (chk.rows.length === 0) return res.status(404).json({ message: "Record not found" });
        devCompanyId = chk.rows[0].developer_company_id;
        if (devCompanyId !== SILK_COMPANY_ID) {
          return res.status(400).json({
            message: `submit-to-silk is only supported for Silk Development (company id=${SILK_COMPANY_ID}). This record belongs to company id=${devCompanyId}.`,
          });
        }
        if (chk.rows[0].status === "stopped") {
          return res.status(400).json({ message: "Cannot submit a stopped record" });
        }
        if (chk.rows[0].status === "submitting") {
          return res.status(409).json({ message: "Submission already in progress for this record" });
        }
      } finally { client.release(); }

      const result = await submitRecordToSilk(recordId, adminId, "manual_retry");
      console.log(`[DeveloperRegistration][Silk] submit complete recordId=${recordId} success=${result.success}`);
      res.json(result);
    } catch (err: any) {
      console.error("[DeveloperRegistration][Silk] submit error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Attempt audit log for a record ────────────────────────────────────────

  app.get("/api/admin/developer-registration/:recordId/attempts", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const recordId = parseInt(req.params.recordId, 10);
      if (!recordId) return res.status(400).json({ message: "Invalid record id" });
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT id, registration_record_id, crm_lead_id, developer_company_id,
                  attempt_type, status, payload_json, result_message,
                  destination_url, response_status, response_body, error_message,
                  created_by, created_at
             FROM developer_registration_attempts
            WHERE registration_record_id = $1
            ORDER BY created_at DESC`,
          [recordId]
        );
        res.json(result.rows);
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Manual per-lead registration with chosen developers ──────────────────
  // Creates a new registration record for each requested developer that does
  // NOT yet have one.  If a record already exists, it is returned as-is with
  // its current status so the admin knows what's there.

  app.post("/api/admin/developer-registration/lead/:leadId/register-with", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const leadId = parseInt(req.params.leadId, 10);
      const { developer_company_ids } = req.body;
      if (!Array.isArray(developer_company_ids) || developer_company_ids.length === 0) {
        return res.status(400).json({ message: "developer_company_ids must be a non-empty array" });
      }

      const adminId = (req as any).session?.userId ?? 0;
      const client  = await pool.connect();
      try {
        const leadResult = await client.query(`
          SELECT id, full_name, first_name, last_name, phone, country, city, budget, project_interest
            FROM crm_leads WHERE id = $1
        `, [leadId]);
        if (leadResult.rows.length === 0) return res.status(404).json({ message: "Lead not found" });
        const lead = leadResult.rows[0];

        const created: any[]  = [];
        const existing: any[] = [];
        const errors: any[]   = [];

        for (const rawId of developer_company_ids) {
          const devCompanyId = parseInt(String(rawId), 10);
          if (!devCompanyId) continue;

          try {
            // Check for existing record — no duplicate
            const existingRec = await client.query(
              `SELECT id, status, protection_status FROM developer_registration_records
                WHERE crm_lead_id=$1 AND developer_company_id=$2 LIMIT 1`,
              [leadId, devCompanyId]
            );
            if (existingRec.rows.length > 0) {
              existing.push({
                developer_company_id: devCompanyId,
                record_id:  existingRec.rows[0].id,
                status:     existingRec.rows[0].status,
                protection_status: existingRec.rows[0].protection_status,
              });
              continue;
            }

            // Fetch developer + config
            const companyResult = await client.query(`
              SELECT dc.id, dc.name, dc.form_url, dc.registration_interval_days, dc.registration_mode,
                     dc.is_active, dfc.config_json
                FROM developer_companies dc
                LEFT JOIN developer_form_configs dfc
                       ON dfc.developer_company_id = dc.id AND dfc.is_active = true
               WHERE dc.id = $1
            `, [devCompanyId]);
            if (companyResult.rows.length === 0) {
              errors.push({ developer_company_id: devCompanyId, error: "Developer not found" });
              continue;
            }

            const company = companyResult.rows[0];
            const configJson: Record<string, any> =
              typeof company.config_json === "string"
                ? JSON.parse(company.config_json)
                : company.config_json ?? {};

            const leadData = {
              id: lead.id,
              fullName: lead.full_name,
              firstName: lead.first_name,
              lastName: lead.last_name,
              phone: lead.phone,
              country: lead.country,
              city: lead.city,
              budget: lead.budget,
              projectInterest: lead.project_interest,
            };

            const { payload, needsReview, reviewReason } = prepareRegistrationPayload(leadData, configJson);
            const status = needsReview ? "needs_review" : "prepared";

            await client.query(`
              INSERT INTO developer_registration_records
                (crm_lead_id, developer_company_id, status, registration_payload_json,
                 last_error, protection_status, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, 'protected', NOW(), NOW())
            `, [leadId, devCompanyId, status, JSON.stringify(payload), reviewReason || null]);

            // Audit log
            await client.query(`
              INSERT INTO developer_registration_attempts
                (registration_record_id, crm_lead_id, developer_company_id, attempt_type, status,
                 payload_json, result_message, created_by, created_at)
              SELECT drr.id, $1, $2, 'manual', $3, $4, $5, $6, NOW()
                FROM developer_registration_records drr
               WHERE drr.crm_lead_id=$1 AND drr.developer_company_id=$2
               ORDER BY drr.created_at DESC LIMIT 1
            `, [
              leadId, devCompanyId, status, JSON.stringify(payload),
              `Manually registered with ${company.name} by admin` +
                (reviewReason ? `: ${reviewReason}` : ""),
              adminId || null,
            ]);

            created.push({ developer_company_id: devCompanyId, developer_name: company.name, status });
            console.log(`[DeveloperRegistration] Manual register leadId=${leadId} developer="${company.name}" status=${status}`);
          } catch (err: any) {
            errors.push({ developer_company_id: devCompanyId, error: err.message });
          }
        }

        res.json({ created, existing, errors });
      } finally { client.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Compatibility check placeholder ───────────────────────────────────────

  app.post("/api/admin/developer-registration/companies/:id/compatibility-check", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const companyId = parseInt(req.params.id, 10);
      // Phase 1: placeholder — no real browser automation
      const result = {
        can_auto_fill: false,
        captcha_detected: null,
        cloudflare_detected: null,
        submit_button_detected: null,
        required_fields_detected: null,
        success_message_detected: null,
        risk_level: "medium",
        last_checked_at: new Date().toISOString(),
        notes: "Phase 1 — automated compatibility check not yet implemented",
      };

      const client = await pool.connect();
      try {
        // Store result in config_json
        const cfgResult = await client.query(
          `SELECT config_json FROM developer_form_configs WHERE developer_company_id=$1 AND is_active=true`,
          [companyId]
        );
        if (cfgResult.rows.length > 0) {
          const existing = typeof cfgResult.rows[0].config_json === "string"
            ? JSON.parse(cfgResult.rows[0].config_json)
            : cfgResult.rows[0].config_json ?? {};
          existing.compatibility_checker_result = result;
          await client.query(
            `UPDATE developer_form_configs SET config_json=$1, updated_at=NOW() WHERE developer_company_id=$2 AND is_active=true`,
            [JSON.stringify(existing), companyId]
          );
        }
      } finally { client.release(); }

      res.json({ message: "Compatibility check placeholder complete (Phase 1)", result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Petra backfill — create missing Petra records for all existing leads ──
  app.post("/api/admin/developer-registration/petra-backfill", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const result = await backfillPetraRecordsForExistingLeads();
      return res.json({
        success: true,
        preRunCounts: {
          totalLeads:       result.totalLeads,
          alreadyHavePetra: result.alreadyHavePetra,
          missingPetra:     result.toCreate,
        },
        postRunCounts: {
          created: result.created,
          skipped: result.skipped,
          failed:  result.failed,
        },
        safetyConfirmation: {
          silkUntouched:         result.silkUntouched,
          ambassadoriUntouched:  result.ambassadoriUntouched,
          onlyPetraRowsInserted: true,
        },
      });
    } catch (err: any) {
      console.error("[PetraBackfill] Endpoint error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

}
