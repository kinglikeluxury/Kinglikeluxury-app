'use strict';
/**
 * Petra Group — One-time backfill script (batch version)
 *
 * Creates prepared developer_registration_records for every CRM lead
 * that does not already have a Petra Group record.
 *
 * Safety guarantees:
 *   - Petra company_id resolved dynamically (WHERE name='Petra Group').
 *   - Uses INSERT … WHERE NOT EXISTS — fully idempotent.
 *   - Only touches Petra records (developer_company_id = petraCompanyId).
 *   - Silk and Ambassadori rows are never read or written.
 *   - All inserts in one transaction — atomic rollback on any error.
 */

const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });

// ── Inline payload builder (mirrors developerRegistrationService.ts exactly) ──

function buildContactName(lead) {
  if (lead.fullName?.trim()) return { name: lead.fullName.trim(), needsReview: false };
  const combined = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim();
  if (combined) return { name: combined, needsReview: false };
  if (lead.phone?.trim()) return { name: lead.phone.trim(), needsReview: true };
  return { name: '', needsReview: true };
}

function prepareRegistrationPayload(lead, configJson) {
  const mappings = configJson.field_mappings  ?? {};
  const rules    = configJson.payload_rules   ?? {};
  const required = configJson.required_fields ?? [];
  const defaults = configJson.default_values  ?? {};

  const payload = { ...mappings };

  if (rules.use_lead_full_name_as_contact_name) {
    const { name, needsReview } = buildContactName(lead);
    payload.contactName = name;
    if (needsReview) {
      return { payload, needsReview: true,
        reviewReason: 'Contact name could not be determined from lead data' };
    }
  }

  if (rules.use_lead_phone_as_contact_phone) {
    payload.contactPhone = lead.phone ?? '';
  }

  if (rules.generate_stable_contact_id) {
    payload.contactId = String(1000000000 + lead.id);
  }

  if (rules.contact_email_override) {
    payload.contactEmail = rules.contact_email_override;
  }

  if (lead.projectInterest) {
    payload.apartmentType = lead.projectInterest;
  } else if (defaults.apartmentType !== undefined) {
    payload.apartmentType = defaults.apartmentType || '';
    if (!defaults.apartmentType && required.includes('apartmentType')) {
      return { payload, needsReview: true,
        reviewReason: 'Apartment type required but not available' };
    }
  }

  for (const field of required) {
    if (!payload[field]) {
      return { payload, needsReview: true,
        reviewReason: `Required field missing: ${field}` };
    }
  }

  return { payload, needsReview: false, reviewReason: '' };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  try {
    // ── 1. Resolve Petra company ─────────────────────────────────────────────
    const coRes = await client.query(
      `SELECT dc.id, dfc.config_json
         FROM developer_companies dc
         JOIN developer_form_configs dfc
           ON dfc.developer_company_id = dc.id AND dfc.is_active = true
        WHERE dc.name = 'Petra Group' AND dc.is_active = true
        LIMIT 1`
    );
    if (coRes.rows.length === 0) {
      console.error('ERROR: Petra Group not found or has no active config. Aborting.');
      return;
    }
    const petraId    = coRes.rows[0].id;
    const configJson = typeof coRes.rows[0].config_json === 'string'
      ? JSON.parse(coRes.rows[0].config_json)
      : coRes.rows[0].config_json;

    console.log(`Petra Group resolved — company_id=${petraId}`);

    // ── 2. Baseline counts (read-only) ───────────────────────────────────────
    const [totalRes, existRes, silkRes, ambRes] = await Promise.all([
      client.query('SELECT COUNT(*) AS n FROM crm_leads'),
      client.query(
        'SELECT COUNT(*) AS n FROM developer_registration_records WHERE developer_company_id=$1',
        [petraId]
      ),
      client.query('SELECT COUNT(*) AS n FROM developer_registration_records WHERE developer_company_id=1'),
      client.query('SELECT COUNT(*) AS n FROM developer_registration_records WHERE developer_company_id=2'),
    ]);

    const totalLeads    = parseInt(totalRes.rows[0].n, 10);
    const existingPetra = parseInt(existRes.rows[0].n, 10);
    const missingPetra  = totalLeads - existingPetra;
    const silkBefore    = parseInt(silkRes.rows[0].n, 10);
    const ambBefore     = parseInt(ambRes.rows[0].n, 10);

    console.log('\n── PRE-BACKFILL COUNTS ─────────────────────────────────────');
    console.log(`  Total CRM leads                 : ${totalLeads}`);
    console.log(`  Leads already with Petra record : ${existingPetra}`);
    console.log(`  Missing Petra records to create : ${missingPetra}`);
    console.log(`  Silk records (baseline)         : ${silkBefore}`);
    console.log(`  Ambassadori records (baseline)  : ${ambBefore}`);
    console.log('────────────────────────────────────────────────────────────\n');

    if (missingPetra === 0) {
      console.log('Nothing to do — all leads already have a Petra record. ✓');
      return;
    }

    // ── 3. Fetch leads missing a Petra record ────────────────────────────────
    const leadsRes = await client.query(
      `SELECT cl.id,
              cl.full_name        AS "fullName",
              cl.first_name       AS "firstName",
              cl.last_name        AS "lastName",
              cl.phone,
              cl.country,
              cl.city,
              cl.budget,
              cl.project_interest AS "projectInterest"
         FROM crm_leads cl
        WHERE NOT EXISTS (
          SELECT 1 FROM developer_registration_records drr
           WHERE drr.crm_lead_id = cl.id
             AND drr.developer_company_id = $1
        )
        ORDER BY cl.id`,
      [petraId]
    );

    const leads = leadsRes.rows;
    console.log(`Leads fetched for backfill: ${leads.length}`);

    // ── 4. Build all payloads in memory ──────────────────────────────────────
    const rows = leads.map(lead => {
      const { payload, needsReview, reviewReason } =
        prepareRegistrationPayload(lead, configJson);
      return {
        leadId:   lead.id,
        status:   needsReview ? 'needs_review' : 'prepared',
        payload,
        lastError: reviewReason || null,
        message:  needsReview
          ? `Backfill: auto-prepared with review needed: ${reviewReason}`
          : 'Backfill: registration payload prepared for existing lead',
      };
    });

    // ── 5. Single-transaction batch insert ───────────────────────────────────
    await client.query('BEGIN');

    const leadIds    = rows.map(r => r.leadId);
    const statuses   = rows.map(r => r.status);
    const payloads   = rows.map(r => JSON.stringify(r.payload));
    const lastErrors = rows.map(r => r.lastError);

    // 5a. Bulk insert records using unnest — WHERE NOT EXISTS guards idempotency
    const recInsert = await client.query(
      `INSERT INTO developer_registration_records
         (crm_lead_id, developer_company_id, status, registration_payload_json,
          last_error, protection_status, created_at, updated_at)
       SELECT u.lead_id, $1, u.status, u.payload::jsonb, u.last_error, 'protected', NOW(), NOW()
         FROM unnest($2::int[], $3::text[], $4::text[], $5::text[])
           AS u(lead_id, status, payload, last_error)
        WHERE NOT EXISTS (
          SELECT 1 FROM developer_registration_records x
           WHERE x.crm_lead_id = u.lead_id AND x.developer_company_id = $1
        )
       RETURNING id, crm_lead_id`,
      [petraId, leadIds, statuses, payloads, lastErrors]
    );

    const inserted = recInsert.rows;
    console.log(`developer_registration_records inserted: ${inserted.length}`);

    // 5b. Audit attempt rows for every newly created record
    const leadToRecordId = new Map(inserted.map(r => [r.crm_lead_id, r.id]));

    const auditRows = rows
      .filter(r => leadToRecordId.has(r.leadId))
      .map(r => ({
        recordId: leadToRecordId.get(r.leadId),
        leadId:   r.leadId,
        status:   r.status,
        payload:  JSON.stringify(r.payload),
        message:  r.message,
      }));

    if (auditRows.length > 0) {
      await client.query(
        `INSERT INTO developer_registration_attempts
           (registration_record_id, crm_lead_id, developer_company_id, attempt_type,
            status, payload_json, result_message, created_by, created_at)
         SELECT u.record_id, u.lead_id, $1, 'initial', u.status, u.payload::jsonb, u.msg, NULL, NOW()
           FROM unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::text[])
             AS u(record_id, lead_id, status, payload, msg)`,
        [
          petraId,
          auditRows.map(r => r.recordId),
          auditRows.map(r => r.leadId),
          auditRows.map(r => r.status),
          auditRows.map(r => r.payload),
          auditRows.map(r => r.message),
        ]
      );
      console.log(`developer_registration_attempts inserted: ${auditRows.length}`);
    }

    await client.query('COMMIT');
    console.log('Transaction committed. ✓');

    // ── 6. Post-backfill verification counts ─────────────────────────────────
    const [afterPetraRes, afterSilkRes, afterAmbRes] = await Promise.all([
      client.query(
        'SELECT COUNT(*) AS n FROM developer_registration_records WHERE developer_company_id=$1',
        [petraId]
      ),
      client.query('SELECT COUNT(*) AS n FROM developer_registration_records WHERE developer_company_id=1'),
      client.query('SELECT COUNT(*) AS n FROM developer_registration_records WHERE developer_company_id=2'),
    ]);

    const afterPetra = parseInt(afterPetraRes.rows[0].n, 10);
    const afterSilk  = parseInt(afterSilkRes.rows[0].n, 10);
    const afterAmb   = parseInt(afterAmbRes.rows[0].n, 10);

    const skipped = leads.length - inserted.length;

    console.log('\n── POST-BACKFILL RESULTS ────────────────────────────────────');
    console.log(`  Petra records created                : ${inserted.length}`);
    console.log(`  Petra records skipped (already exist): ${skipped}`);
    console.log(`  Petra records total now              : ${afterPetra}`);
    console.log(`  Silk records (unchanged)             : ${afterSilk}  (was ${silkBefore}) ${afterSilk === silkBefore ? '✓' : '⚠ CHANGED'}`);
    console.log(`  Ambassadori records (unchanged)      : ${afterAmb}  (was ${ambBefore}) ${afterAmb === ambBefore ? '✓' : '⚠ CHANGED'}`);
    console.log('────────────────────────────────────────────────────────────');

    if (afterSilk !== silkBefore || afterAmb !== ambBefore) {
      console.error('\n⚠  WARNING: Silk or Ambassadori counts changed — investigate!');
      process.exit(2);
    } else {
      console.log('\nSilk and Ambassadori rows confirmed untouched. ✓');
    }

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nERROR — transaction rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  pool.end();
  process.exit(1);
});
