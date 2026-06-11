/**
 * Silk Development — Submission Adapter (Phase 2)
 * Only applies to developer_company_id = 1 (Silk Development).
 * Never used for any other developer company.
 *
 * Endpoint: POST https://system.silkdevelopment.ge/rest/local/api/deal/broker/addDeal.php
 * Success:  HTTP 2xx AND response JSON body contains { status: "success" }
 */

import { pool } from "./db";

export const SILK_COMPANY_ID = 1;
const SILK_API_URL =
  "https://system.silkdevelopment.ge/rest/local/api/deal/broker/addDeal.php";

// ── Silk representative ID map ────────────────────────────────────────────────
// Fetched from GET /rest/local/api/deal/broker/getResponsibles.php
const SILK_REP_BY_NAME: Record<string, string> = {
  "ana nagervadze":     "1879",
  "ana nemsadze":       "1881",
  "anastasia dzumik":   "1125",
  "ani saralidze":      "120",
  "aslan glonti":       "709",
  "elina jaiani":       "1181",
  "eric tan":           "1220",
  "inga tarverdiani":   "912",
  "ketevan akhvlediani":"790",
  "luka beroshvili":    "911",
  "marika turmanidze":  "5331",
  "mzia zoidze":        "119",
  "natuka modebadze":   "366",
  "nino mshvidobadze":  "118",
  "nino okropiridze":   "5051",
  "rachel wen":         "1880",
  "raja khatib":        "2384",
  "salome goguadze":    "1670",
  "tina tvaradze":      "1753",
  "zeinab diasamidze":  "2901",
  "zinaida akopova":    "5403",
  "zviad iobashvili":   "2125",
};

// ── Map internal payload → Silk form fields ───────────────────────────────────

function mapToSilkPayload(p: Record<string, any>): Record<string, any> {
  const repName  = (p.representative ?? "").toLowerCase().trim();
  const repId    = SILK_REP_BY_NAME[repName];
  const clientType = p.clientType ?? "Company";

  const out: Record<string, any> = {
    clientType,
    contactNameSurname: p.contactName    ?? "",
    contactPhone:       p.contactPhone   ?? "",
    contactEmail:       p.contactEmail   ?? "",
    projectName:        p.projectName    ?? "",
    apartmentType:      p.apartmentType  ?? "",
    totalBudget:        p.totalBudget    ?? "",
    comment:            p.comment        ?? "",
    companyRep:         repId ?? p.representative ?? "",
  };

  if (clientType === "Company") {
    out.companyName = p.companyName  ?? "";
    out.companyId   = p.companyId    ?? "";
    out.phone       = p.companyPhone ?? "";
    out.email       = p.companyEmail ?? "";
    out.nameSurname = p.representative ?? p.contactName ?? "";
  }

  if (repId) {
    out.companyRepresentative = { id: repId, name: p.representative ?? "" };
  }

  return out;
}

// ── Ensure attempt table has all required columns ─────────────────────────────

export async function ensureSilkAttemptColumns(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE developer_registration_attempts
        ADD COLUMN IF NOT EXISTS destination_url  TEXT,
        ADD COLUMN IF NOT EXISTS response_status  INTEGER,
        ADD COLUMN IF NOT EXISTS response_body    TEXT,
        ADD COLUMN IF NOT EXISTS error_message    TEXT
    `);
    console.log("[Silk] Attempt table columns ensured");
  } catch (err: any) {
    console.error("[Silk] Failed to ensure attempt columns:", err.message);
  } finally {
    client.release();
  }
}

// ── Submit result type ────────────────────────────────────────────────────────

export interface SilkSubmitResult {
  success:        boolean;
  responseStatus: number | null;
  responseBody:   string | null;
  errorMessage:   string | null;
  attemptId:      number;
  silkPayload:    Record<string, any>;
}

// ── Main submission function ──────────────────────────────────────────────────

export async function submitRecordToSilk(
  recordId:    number,
  adminId:     number,
  attemptType: "initial" | "re_registration" | "manual_retry" | "silk_auto" | "manual" = "manual_retry"
): Promise<SilkSubmitResult> {
  const client = await pool.connect();
  try {
    // ── 1. Load record ──────────────────────────────────────────────────────
    const recResult = await client.query(
      `SELECT drr.id, drr.crm_lead_id, drr.developer_company_id,
              drr.registration_payload_json, drr.status,
              dc.registration_interval_days
         FROM developer_registration_records drr
         JOIN developer_companies dc ON dc.id = drr.developer_company_id
        WHERE drr.id = $1`,
      [recordId]
    );
    if (recResult.rows.length === 0) throw new Error(`Record ${recordId} not found`);
    const rec = recResult.rows[0];

    if (rec.developer_company_id !== SILK_COMPANY_ID) {
      throw new Error(
        `submitRecordToSilk is only valid for Silk Development (id=1). ` +
        `Record ${recordId} belongs to developer_company_id=${rec.developer_company_id}`
      );
    }
    if (rec.status === "stopped") {
      throw new Error("Cannot submit a stopped registration record");
    }

    // ── 2. Build Silk payload ───────────────────────────────────────────────
    const internalPayload: Record<string, any> =
      typeof rec.registration_payload_json === "string"
        ? JSON.parse(rec.registration_payload_json)
        : rec.registration_payload_json ?? {};

    const silkPayload = mapToSilkPayload(internalPayload);

    console.log(
      `[Silk][Submit] recordId=${recordId} leadId=${rec.crm_lead_id} ` +
      `→ POST ${SILK_API_URL}`
    );

    // ── 3. Mark as "submitting" to prevent duplicate submissions ────────────
    await client.query(
      `UPDATE developer_registration_records
          SET status = 'submitting', updated_at = NOW()
        WHERE id = $1`,
      [recordId]
    );

    // ── 4. Send HTTP request ────────────────────────────────────────────────
    let responseStatus: number | null = null;
    let responseBody:   string | null = null;
    let errorMessage:   string | null = null;
    let success = false;

    try {
      const httpRes = await fetch(SILK_API_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(silkPayload),
        signal:  AbortSignal.timeout(30_000),
      });

      responseStatus = httpRes.status;
      responseBody   = await httpRes.text();

      console.log(
        `[Silk][Submit] response status=${responseStatus} ` +
        `body=${responseBody.slice(0, 200)}`
      );

      let parsed: any = null;
      try { parsed = JSON.parse(responseBody); } catch { /* not JSON */ }

      if (httpRes.ok && parsed?.status === "success") {
        success = true;
      } else {
        errorMessage =
          parsed?.error ??
          (httpRes.ok
            ? `Silk returned HTTP ${responseStatus} without success confirmation`
            : `HTTP ${responseStatus}`);
      }
    } catch (fetchErr: any) {
      errorMessage = fetchErr.message ?? "Network error during submission";
      console.error(`[Silk][Submit] fetch failed:`, fetchErr.message);
    }

    // ── 5. Update record status ─────────────────────────────────────────────
    const newStatus = success ? "success" : "failed";
    const now       = new Date();
    const nextReg   = success
      ? new Date(now.getTime() + (rec.registration_interval_days ?? 40) * 86_400_000)
      : null;

    await client.query(
      `UPDATE developer_registration_records
          SET status               = $1,
              last_error           = $2,
              last_registered_at   = CASE WHEN $3 THEN $4::timestamptz ELSE last_registered_at END,
              next_registration_at = CASE WHEN $3 THEN $5::timestamptz ELSE next_registration_at END,
              attempt_count        = COALESCE(attempt_count, 0) + 1,
              updated_at           = NOW()
        WHERE id = $6`,
      [newStatus, errorMessage, success, now, nextReg, recordId]
    );

    // ── 6. Write attempt record ─────────────────────────────────────────────
    const attemptResult = await client.query(
      `INSERT INTO developer_registration_attempts
         (registration_record_id, crm_lead_id, developer_company_id,
          attempt_type, status, payload_json, result_message, created_by, created_at,
          destination_url, response_status, response_body, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,$12)
       RETURNING id`,
      [
        recordId,
        rec.crm_lead_id,
        rec.developer_company_id,
        attemptType,
        success ? "success" : "failed",
        JSON.stringify(silkPayload),
        success ? "Silk confirmed acceptance" : (errorMessage ?? "Unknown error"),
        adminId,
        SILK_API_URL,
        responseStatus,
        responseBody,
        errorMessage,
      ]
    );

    const attemptId: number = attemptResult.rows[0].id;
    console.log(
      `[Silk][Submit] done recordId=${recordId} success=${success} ` +
      `attemptId=${attemptId}`
    );

    return { success, responseStatus, responseBody, errorMessage, attemptId, silkPayload };
  } finally {
    client.release();
  }
}
