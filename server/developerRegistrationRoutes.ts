/**
 * Developer Registration Center — API Routes
 * All endpoints are admin-only (403 for unauthenticated or non-admin users).
 * Phase 1: No external form auto-submission.
 */

import { type Express, type Request, type Response } from "express";
import { pool } from "./db";
import { prepareRegistrationPayload } from "./developerRegistrationService";

function adminOnly(req: Request, res: Response): boolean {
  if (!(req as any).session?.isAdmin) {
    res.status(403).json({ message: "Admin only" });
    return false;
  }
  return true;
}

export function registerDeveloperRegistrationRoutes(app: Express): void {

  // ── Overview dashboard ────────────────────────────────────────────────────

  app.get("/api/admin/developer-registration/overview", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;
    try {
      const client = await pool.connect();
      try {
        const statsResult = await client.query(`
          SELECT status, COUNT(*) AS count
            FROM developer_registration_records
           GROUP BY status
        `);
        const protectedResult = await client.query(`
          SELECT COUNT(*) AS count FROM developer_registration_records WHERE protection_status='protected'
        `);
        const stoppedResult = await client.query(`
          SELECT COUNT(*) AS count FROM developer_registration_records WHERE protection_status='stopped' OR protection_status='sold'
        `);
        const stats: Record<string, number> = {};
        for (const row of statsResult.rows) stats[row.status] = parseInt(row.count, 10);
        res.json({
          stats,
          protected: parseInt(protectedResult.rows[0]?.count ?? "0", 10),
          stopped:   parseInt(stoppedResult.rows[0]?.count ?? "0", 10),
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
      const { status, developer_id, page = "1", limit = "50" } = req.query as Record<string, string>;
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

      const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

      const client = await pool.connect();
      try {
        const countResult = await client.query(
          `SELECT COUNT(*) AS total FROM developer_registration_records drr ${where}`,
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
            dc.name  AS developer_name,
            dc.form_url,
            cl.full_name   AS lead_full_name,
            cl.first_name  AS lead_first_name,
            cl.phone       AS lead_phone,
            cl.status      AS lead_status
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
        name, form_url, registration_interval_days = 40,
        registration_mode = "manual", is_active = true,
        config_json,
      } = req.body;

      if (!name?.trim()) return res.status(400).json({ message: "Company name is required" });

      const client = await pool.connect();
      try {
        const companyResult = await client.query(`
          INSERT INTO developer_companies
            (name, form_url, is_active, registration_interval_days, registration_mode, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
          RETURNING *
        `, [name.trim(), form_url || null, is_active, registration_interval_days, registration_mode]);

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
        name, form_url, is_active,
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
                 registration_interval_days= COALESCE($4, registration_interval_days),
                 registration_mode         = COALESCE($5, registration_mode),
                 updated_at                = NOW()
           WHERE id = $6
        `, [name || null, form_url || null, is_active ?? null, registration_interval_days || null, registration_mode || null, companyId]);

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

}
