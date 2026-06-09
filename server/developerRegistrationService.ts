/**
 * Developer Registration Center — Service Layer
 * Phase 1: Prepares registration payloads for all active developer companies.
 *          No external form submission in Phase 1 — manual-only workflow.
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
    // Get all active developer companies
    const companiesResult = await client.query(`
      SELECT dc.id, dc.name, dc.form_url, dc.registration_interval_days, dc.registration_mode,
             dfc.config_json
        FROM developer_companies dc
        JOIN developer_form_configs dfc ON dfc.developer_company_id = dc.id AND dfc.is_active = true
       WHERE dc.is_active = true
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

// ── Daily re-registration scheduler ──────────────────────────────────────────

async function runDailyReRegistrationCheck(): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE developer_registration_records
         SET status     = 'pending_re_registration',
             updated_at = NOW()
       WHERE status = 'submitted'
         AND protection_status = 'protected'
         AND next_registration_at IS NOT NULL
         AND next_registration_at <= NOW()
      RETURNING id
    `);

    if (result.rows.length > 0) {
      console.log(
        `[DeveloperRegistration] Marked pending_re_registration count=${result.rows.length}`
      );
      for (const row of result.rows) {
        console.log(`[DeveloperRegistration] Marked pending_re_registration recordId=${row.id}`);
      }
    }
  } catch (err: any) {
    console.error("[DeveloperRegistration] Daily re-registration check failed:", err.message);
  } finally {
    client.release();
  }
}

export function startDeveloperRegistrationScheduler(): void {
  // Run immediately on startup, then every 24 hours
  runDailyReRegistrationCheck().catch(() => {});
  setInterval(() => runDailyReRegistrationCheck().catch(() => {}), 24 * 60 * 60 * 1000);
  console.log("[DeveloperRegistration] Daily scheduler started");
}
