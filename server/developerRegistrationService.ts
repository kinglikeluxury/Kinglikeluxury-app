/**
 * Developer Registration Center — Service Layer
 * Auto-registers all new CRM leads with active developer companies.
 * Scheduler auto-re-submits pending_re_registration records to Silk daily.
 */

import { pool } from "./db";

// ── Stop / Continue status sets ───────────────────────────────────────────────

export const STOP_STATUSES = new Set([
  "purchased",
  "second_hand",
  "junk_lead",
  "no_answer_converted",
  "lost_competition",
  "not_interested",
  "invalid_number",
  "duplicate",
  "sold_by_kinglike_luxury",
]);

const SOLD_STATUSES = new Set(["purchased", "sold_by_kinglike_luxury"]);

// ── Payload builder ───────────────────────────────────────────────────────────

interface LeadData {
  id: number;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  country?: string | null;
  city?: string | null;
  budget?: string | null;
  projectInterest?: string | null;
}

function buildContactName(lead: LeadData): { name: string; needsReview: boolean } {
  if (lead.fullName?.trim()) return { name: lead.fullName.trim(), needsReview: false };
  const combined = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  if (combined) return { name: combined, needsReview: false };
  if (lead.phone?.trim()) return { name: lead.phone.trim(), needsReview: true };
  return { name: "", needsReview: true };
}

function stableContactId(leadId: number): string {
  return String(1000000000 + leadId);
}

export function prepareRegistrationPayload(
  lead: LeadData,
  configJson: Record<string, any>
): { payload: Record<string, any>; needsReview: boolean; reviewReason: string } {
  const mappings: Record<string, string> = configJson.field_mappings ?? {};
  const rules: Record<string, any>       = configJson.payload_rules   ?? {};
  const required: string[]               = configJson.required_fields  ?? [];
  const defaults: Record<string, any>    = configJson.default_values   ?? {};

  const payload: Record<string, any> = { ...mappings };

  // Dynamic fields from lead data
  if (rules.use_lead_full_name_as_contact_name) {
    const { name, needsReview } = buildContactName(lead);
    payload.contactName = name;
    if (needsReview) {
      return {
        payload,
        needsReview: true,
        reviewReason: "Contact name could not be determined from lead data",
      };
    }
  }

  if (rules.use_lead_phone_as_contact_phone) {
    payload.contactPhone = lead.phone ?? "";
  }

  if (rules.generate_stable_contact_id) {
    payload.contactId = stableContactId(lead.id);
  }

  if (rules.contact_email_override) {
    payload.contactEmail = rules.contact_email_override;
  }

  // Apartment type: from projectInterest, or default
  if (lead.projectInterest) {
    payload.apartmentType = lead.projectInterest;
  } else if (defaults.apartmentType !== undefined) {
    payload.apartmentType = defaults.apartmentType || "";
    if (!defaults.apartmentType && required.includes("apartmentType")) {
      return {
        payload,
        needsReview: true,
        reviewReason: "Apartment type required but not available",
      };
    }
  }

  // Check all required fields are non-empty
  for (const field of required) {
    if (!payload[field]) {
      return {
        payload,
        needsReview: true,
        reviewReason: `Required field missing: ${field}`,
      };
    }
  }

  return { payload, needsReview: false, reviewReason: "" };
}

// ── Initialize registrations for a new lead ───────────────────────────────────

export async function initDeveloperRegistrationsForLead(
  leadId: number,
  leadData: LeadData
): Promise<void> {
  const client = await pool.connect();
  try {
    // Get all active developer companies that have auto_register_enabled
    const companiesResult = await client.query(`
      SELECT dc.id, dc.name, dc.form_url, dc.registration_interval_days, dc.registration_mode,
             COALESCE(dc.auto_register_enabled, true) AS auto_register_enabled,
             dfc.config_json
        FROM developer_companies dc
        JOIN developer_form_configs dfc ON dfc.developer_company_id = dc.id AND dfc.is_active = true
       WHERE dc.is_active = true
         AND COALESCE(dc.auto_register_enabled, true) = true
    `);

    if (companiesResult.rows.length === 0) return;

    console.log(
      `[DeveloperRegistration] Creating records for active developers leadId=${leadId} count=${companiesResult.rows.length}`
    );

    for (const company of companiesResult.rows) {
      try {
        // Skip if record already exists for this lead+company
        const existing = await client.query(
          `SELECT id FROM developer_registration_records WHERE crm_lead_id=$1 AND developer_company_id=$2 LIMIT 1`,
          [leadId, company.id]
        );
        if (existing.rows.length > 0) continue;

        const configJson: Record<string, any> =
          typeof company.config_json === "string"
            ? JSON.parse(company.config_json)
            : company.config_json ?? {};

        const { payload, needsReview, reviewReason } = prepareRegistrationPayload(
          { ...leadData, id: leadId },
          configJson
        );

        const status = needsReview ? "needs_review" : "prepared";

        await client.query(`
          INSERT INTO developer_registration_records
            (crm_lead_id, developer_company_id, status, registration_payload_json, last_error, protection_status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, 'protected', NOW(), NOW())
        `, [
          leadId,
          company.id,
          status,
          JSON.stringify(payload),
          reviewReason || null,
        ]);

        // Audit log — initial preparation
        await client.query(`
          INSERT INTO developer_registration_attempts
            (registration_record_id, crm_lead_id, developer_company_id, attempt_type, status,
             payload_json, result_message, created_by, created_at)
          SELECT drr.id, $1, $2, 'initial', $3, $4, $5, 0, NOW()
            FROM developer_registration_records drr
           WHERE drr.crm_lead_id=$1 AND drr.developer_company_id=$2
           ORDER BY drr.created_at DESC LIMIT 1
        `, [
          leadId,
          company.id,
          status,
          JSON.stringify(payload),
          status === "prepared"
            ? "Registration payload prepared automatically on lead creation"
            : `Auto-prepared with review needed: ${reviewReason}`,
        ]);

        console.log(
          `[DeveloperRegistration] Prepared registration leadId=${leadId} developer="${company.name}" status=${status}`
        );
      } catch (err: any) {
        console.error(
          `[DeveloperRegistration] Failed to prepare for developer ${company.name} leadId=${leadId}: ${err.message}`
        );
      }
    }
  } finally {
    client.release();
  }
}

// ── Handle CRM lead status change ─────────────────────────────────────────────

export async function handleDevRegLeadStatusChange(
  leadId: number,
  newStatus: string
): Promise<void> {
  if (!STOP_STATUSES.has(newStatus)) return;

  const protectionStatus = SOLD_STATUSES.has(newStatus) ? "sold" : "stopped";

  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE developer_registration_records
         SET status            = 'stopped',
             protection_status = $1,
             next_registration_at = NULL,
             updated_at        = NOW()
       WHERE crm_lead_id = $2
         AND status NOT IN ('stopped')
      RETURNING id
    `, [protectionStatus, leadId]);

    if (result.rows.length > 0) {
      console.log(
        `[DeveloperRegistration] Stopped due to lead status="${newStatus}" leadId=${leadId} records=${result.rows.length} protectionStatus=${protectionStatus}`
      );
    }
  } finally {
    client.release();
  }
}

// ── Re-registration payload refresh ──────────────────────────────────────────

export async function refreshPayloadForRecord(
  recordId: number,
  leadData: LeadData
): Promise<void> {
  const client = await pool.connect();
  try {
    const cfgResult = await client.query(`
      SELECT dfc.config_json
        FROM developer_registration_records drr
        JOIN developer_form_configs dfc ON dfc.developer_company_id = drr.developer_company_id AND dfc.is_active = true
       WHERE drr.id = $1
    `, [recordId]);

    if (cfgResult.rows.length === 0) return;

    const configJson = typeof cfgResult.rows[0].config_json === "string"
      ? JSON.parse(cfgResult.rows[0].config_json)
      : cfgResult.rows[0].config_json ?? {};

    const { payload } = prepareRegistrationPayload(leadData, configJson);

    await client.query(`
      UPDATE developer_registration_records
         SET registration_payload_json = $1, updated_at = NOW()
       WHERE id = $2
    `, [JSON.stringify(payload), recordId]);
  } finally {
    client.release();
  }
}

// ── Due re-registration runner ────────────────────────────────────────────────

export interface ReRegistrationResult {
  marked: number;
  submitted: number;
  failed: number;
  skipped: number;
}

export async function runDueReRegistrations(): Promise<ReRegistrationResult> {
  const client = await pool.connect();
  const result: ReRegistrationResult = { marked: 0, submitted: 0, failed: 0, skipped: 0 };

  try {
    // Step 1 — Mark overdue success/submitted records as pending_re_registration
    const markResult = await client.query(`
      UPDATE developer_registration_records
         SET status     = 'pending_re_registration',
             updated_at = NOW()
       WHERE status IN ('success', 'submitted')
         AND protection_status = 'protected'
         AND next_registration_at IS NOT NULL
         AND next_registration_at <= NOW()
      RETURNING id, developer_company_id
    `);

    result.marked = markResult.rows.length;
    if (result.marked > 0) {
      console.log(`[DeveloperRegistration] Marked pending_re_registration count=${result.marked}`);
    }

    // Step 2 — Find all pending_re_registration records for Silk (auto-submit capable)
    const dueResult = await client.query(`
      SELECT drr.id, drr.crm_lead_id, drr.developer_company_id
        FROM developer_registration_records drr
        JOIN developer_companies dc ON dc.id = drr.developer_company_id
        JOIN crm_leads cl ON cl.id = drr.crm_lead_id
       WHERE drr.status = 'pending_re_registration'
         AND drr.protection_status = 'protected'
         AND dc.is_active = true
         AND COALESCE(dc.auto_register_enabled, true) = true
         AND cl.status NOT IN ('purchased','sold_by_kinglike_luxury','junk_lead','not_interested','invalid_number','duplicate','blacklisted')
       ORDER BY drr.updated_at ASC
       LIMIT 50
    `);

    if (dueResult.rows.length === 0) {
      client.release();
      return result;
    }

    // Lazy-import the silk adapter to avoid circular deps
    const { submitRecordToSilk, SILK_COMPANY_ID } = await import("./silkSubmissionAdapter");

    for (const rec of dueResult.rows) {
      try {
        if (rec.developer_company_id === SILK_COMPANY_ID) {
          // Auto-submit to Silk with attempt_type = 're_registration'
          const submitResult = await submitRecordToSilk(rec.id, 0, "re_registration");
          if (submitResult.success) {
            result.submitted++;
            console.log(`[DeveloperRegistration] Auto re-registered to Silk recordId=${rec.id} leadId=${rec.crm_lead_id}`);
          } else {
            result.failed++;
            console.warn(`[DeveloperRegistration] Silk re-registration failed recordId=${rec.id}: ${submitResult.errorMessage}`);
          }
        } else {
          // Non-Silk developer — keep as pending_re_registration for manual processing
          result.skipped++;
        }
      } catch (err: any) {
        result.failed++;
        console.error(`[DeveloperRegistration] Auto re-reg error recordId=${rec.id}: ${err.message}`);
      }
    }

    console.log(
      `[DeveloperRegistration] Re-registration run complete — marked=${result.marked} submitted=${result.submitted} failed=${result.failed} skipped=${result.skipped}`
    );
  } catch (err: any) {
    console.error("[DeveloperRegistration] runDueReRegistrations failed:", err.message);
  } finally {
    // client already released inside submitRecordToSilk calls; release here only if still held
    try { client.release(); } catch { /* already released */ }
  }

  return result;
}

// ── Schema migration (also called by routes at startup) ───────────────────────

export async function ensureAutoRegColumn(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE developer_companies
        ADD COLUMN IF NOT EXISTS auto_register_enabled BOOLEAN NOT NULL DEFAULT true
    `);
  } catch { /* column may already exist */ } finally { client.release(); }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _schedulerRunning = false;

export function startDeveloperRegistrationScheduler(): void {
  // Ensure the column exists before the first run, then proceed
  ensureAutoRegColumn()
    .catch(() => {})
    .then(() => runDueReRegistrations())
    .catch(() => {});

  setInterval(() => {
    if (_schedulerRunning) {
      console.log("[DeveloperRegistration] Scheduler already running — skipping");
      return;
    }
    _schedulerRunning = true;
    runDueReRegistrations()
      .catch(e => console.error("[DeveloperRegistration] Scheduler error:", e.message))
      .finally(() => { _schedulerRunning = false; });
  }, 24 * 60 * 60 * 1000);

  console.log("[DeveloperRegistration] Daily scheduler started");
}
