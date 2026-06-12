/**
 * Ambassadori Island Batumi — Submission Adapter
 * Portal: https://broker.islandambassadori.com (ITRIELT platform)
 *
 * Authentication (reverse-engineered from SPA bundle):
 *   - Header: Token: <UUID session token>
 *   - Header: site: broker.islandambassadori.com
 *   - Header: Language: ru
 *   - Header: Content-Type: text/plain   (body is JSON-stringified)
 *   - Header: Accept: application/json
 *   - Real API base: https://api.itrielt.ru  (NOT the portal domain)
 *
 * Session token sourced from Replit Secret: AMBASSADORI_SESSION_TOKEN
 *
 * API flow (confirmed working):
 *   1. GET  /api/get-buys-loot-check?phone=PHONE → [] = unique, [{…}] = duplicate
 *   2. POST /api/check-uniq  { custom_fields, contact, document }
 *        → { canCreate:true, day:30, text:"Клиент уникальный…" }  when unique
 *        → { canCreate:false, text:"Клиент занят…" }              when duplicate
 *   3. POST /api/check-uniq  { …, create_lead:true }  (combines check + create)
 *        → { canCreate:true, id:DEAL_ID }  on success
 *        → { text:"Проект обязательное поле" } if project field missing
 *        → { text:"Проект не найден" }          if project not resolved
 *   4. Fallback: POST /deals/create  with full custom_fields payload
 *        → null  HTTP 200 (accepted but no deal ID returned)
 *
 * Complex for Ambassadori (from GET /complex/get-all):
 *   { id:13981, name:"Ambassadori Island Batumi", day:30,
 *     developments:[{ name:"The First Tower", id:227034, external_id:"1" }] }
 */

import { pool } from "./db";

export const AMBASSADORI_COMPANY_ID = 2;

const API_BASE   = "https://api.itrielt.ru";
const PORTAL_URL = "https://broker.islandambassadori.com/deals/create";
const SITE_HOST  = "broker.islandambassadori.com";

const COMPLEX = {
  id:   13981,
  name: "Ambassadori Island Batumi",
  day:  30,
  text: "Ambassadori Island Batumi",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatPhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  return (raw.trim().startsWith("+") ? "+" : "+") + digits;
}

function getToken(): string | null {
  return process.env.AMBASSADORI_SESSION_TOKEN?.trim() || null;
}

function buildHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Accept":       "application/json",
    "Language":     "ru",
    "site":         SITE_HOST,
    "Content-Type": "text/plain",
  };
  if (token) headers["Token"] = token;
  return headers;
}

// ── Low-level HTTP ─────────────────────────────────────────────────────────────

interface ApiResponse {
  status:  number;
  text:    string;
  json:    any | null;
  isHtml:  boolean;
}

function isHtmlBody(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("<!") || t.startsWith("<html");
}

async function apiGet(path: string, params?: Record<string, string>): Promise<ApiResponse> {
  const qs  = params ? "?" + new URLSearchParams(params).toString() : "";
  const url = `${API_BASE}${path}${qs}`;
  const res = await fetch(url, { headers: buildHeaders(), signal: AbortSignal.timeout(25_000) });
  const text = await res.text();
  const isHtml = isHtmlBody(text);
  let json: any = null;
  if (!isHtml && text.trim()) { try { json = JSON.parse(text); } catch { /* not JSON */ } }
  return { status: res.status, text, json, isHtml };
}

async function apiPost(path: string, body: Record<string, any>): Promise<ApiResponse> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method:  "POST",
    headers: buildHeaders(),
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  const isHtml = isHtmlBody(text);
  let json: any = null;
  if (!isHtml && text.trim()) { try { json = JSON.parse(text); } catch { /* not JSON */ } }
  return { status: res.status, text, json, isHtml };
}

// ── Uniqueness check ───────────────────────────────────────────────────────────

interface UniquenessResult {
  checkedOk:   boolean;
  isDuplicate: boolean;
  isUnique:    boolean;
  canCreate:   boolean;
  rawResponse: string;
  diagnosis:   string;
}

async function checkLeadUniqueness(phone: string): Promise<UniquenessResult> {
  const { status, text, json, isHtml } = await apiGet(
    "/api/get-buys-loot-check",
    { phone }
  );

  if (isHtml) {
    return {
      checkedOk: false, isDuplicate: false, isUnique: false, canCreate: false,
      rawResponse: `HTML_RESPONSE (HTTP ${status}) — token may have expired`,
      diagnosis:   "Uniqueness check returned HTML — token may be invalid",
    };
  }

  if (json === null) {
    return {
      checkedOk: false, isDuplicate: false, isUnique: false, canCreate: false,
      rawResponse: text.slice(0, 500),
      diagnosis:   `Non-JSON response from uniqueness check (HTTP ${status})`,
    };
  }

  const isDuplicate = Array.isArray(json)
    ? json.length > 0
    : !!(json.id || json.loot_id || json.exists === true || json.duplicate === true || json.count > 0);

  const isUnique = !isDuplicate && (
    (Array.isArray(json) && json.length === 0) ||
    json.unique === true || json.result === "unique" || json.count === 0
  );

  return {
    checkedOk:   true,
    isDuplicate,
    isUnique,
    canCreate:   isUnique,
    rawResponse: text,
    diagnosis:   isDuplicate
      ? "Portal confirms duplicate"
      : isUnique
        ? "Portal confirms unique"
        : `Inconclusive: ${text.slice(0, 200)}`,
  };
}

// ── check-uniq + create_lead (Step 2a) ────────────────────────────────────────

interface CreateLeadResult {
  success:      boolean;
  method:       string;
  dealId?:      string;
  rawResponse:  string;
  errorText:    string | null;
}

async function attemptCheckUniqCreate(customFields: Record<string, any>): Promise<CreateLeadResult> {
  const body = {
    custom_fields: customFields,
    complex:       COMPLEX,
    contact:       { Фамилия: "", Имя: "", Отчество: "", Телефон: "", "Кем приходится": "" },
    document:      {},
    create_lead:   true,
  };

  const { status, text, json } = await apiPost("/api/check-uniq", body);

  if (!json) {
    return { success: false, method: "check-uniq/create_lead", rawResponse: text.slice(0, 500), errorText: `Non-JSON (HTTP ${status}): ${text.slice(0, 200)}` };
  }

  if (json.error || (json.text && !json.canCreate && !json.id)) {
    return { success: false, method: "check-uniq/create_lead", rawResponse: text, errorText: json.text ?? json.error ?? "Unknown error from check-uniq" };
  }

  const dealId = String(json.id ?? json.deal_id ?? "").trim() || undefined;

  if (json.canCreate || dealId || json.status === "success") {
    return { success: true, method: "check-uniq/create_lead", dealId, rawResponse: text, errorText: null };
  }

  return { success: false, method: "check-uniq/create_lead", rawResponse: text, errorText: json.text ?? json.error ?? `HTTP ${status}: ${text.slice(0, 200)}` };
}

// ── Fallback: POST /deals/create (Step 2b) ────────────────────────────────────

async function attemptDealsCreate(customFields: Record<string, any>): Promise<CreateLeadResult> {
  const body = {
    custom_fields: customFields,
    complex:       COMPLEX,
    contact:       { Фамилия: "", Имя: "", Отчество: "", Телефон: "", "Кем приходится": "" },
    document:      {},
    object:        {},
    calculator:    {},
    responsible:   {},
    agent:         null,
    FixationID:    null,
    hash:          null,
  };

  const { status, text, json } = await apiPost("/deals/create", body);

  if (status >= 200 && status < 300 && (json === null || (json && !json.error))) {
    const dealId = String(json?.id ?? json?.deal_id ?? "").trim() || undefined;
    return { success: true, method: "deals/create", dealId, rawResponse: text || "null", errorText: null };
  }

  const errText = json?.error ?? json?.message ?? json?.text ?? `HTTP ${status}: ${text.slice(0, 200)}`;
  return { success: false, method: "deals/create", rawResponse: text.slice(0, 500), errorText: String(errText) };
}

// ── Build custom_fields payload ────────────────────────────────────────────────

function buildCustomFields(firstName: string, lastName: string, phone: string, city: string): Record<string, any> {
  return {
    "Телефон":            phone,
    "Имя":                firstName || "—",
    "Фамилия":            lastName  || "—",
    "Город":              city || "Батуми",
    "Город обращения":    "",
    "ЖК":                 COMPLEX,
    "Бюджет":             "",
    "Отчество":           "",
    "Дата рождения":      "",
    "Акт":                "",
    "Чек":                "",
    "Тип недвижимости":   "Квартиры",
  };
}

// ── Ensure attempt columns exist ───────────────────────────────────────────────

export async function ensureAmbassadoriAttemptColumns(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE developer_registration_attempts
        ADD COLUMN IF NOT EXISTS destination_url  TEXT,
        ADD COLUMN IF NOT EXISTS response_status  INTEGER,
        ADD COLUMN IF NOT EXISTS response_body    TEXT,
        ADD COLUMN IF NOT EXISTS error_message    TEXT
    `);
    console.log("[Ambassadori] Attempt table columns ensured");
  } catch (err: any) {
    console.error("[Ambassadori] Failed to ensure attempt columns:", err.message);
  } finally {
    client.release();
  }
}

// ── Ensure Ambassadori company record exists in DB ─────────────────────────────

export async function ensureAmbassadoriCompany(): Promise<void> {
  const client = await pool.connect();
  try {
    const exists = await client.query(
      `SELECT id FROM developer_companies WHERE name = 'Ambassadori Island Batumi' LIMIT 1`
    );
    if (exists.rows.length > 0) {
      console.log(`[Ambassadori] Company record exists — id=${exists.rows[0].id}`);
      return;
    }

    const companyResult = await client.query(`
      INSERT INTO developer_companies
        (name, form_url, is_active, auto_register_enabled,
         registration_interval_days, registration_mode, created_at, updated_at)
      VALUES ('Ambassadori Island Batumi',
              $1, true, true, 30, 'auto', NOW(), NOW())
      RETURNING id
    `, [PORTAL_URL]);
    const companyId = companyResult.rows[0].id;

    const config = {
      field_mappings:  {},
      required_fields: ["phone"],
      default_values:  {},
      payload_rules: {
        ambassadori_complex_id:    COMPLEX.id,
        ambassadori_complex_name:  COMPLEX.name,
        ambassadori_property_type: "Квартиры",
        ambassadori_city:          "Батуми",
      },
      compatibility_checker_result: {
        can_auto_fill:             true,
        captcha_detected:          null,
        cloudflare_detected:       null,
        submit_button_detected:    true,
        required_fields_detected:  ["Телефон", "Имя", "Фамилия", "Город", "Тип недвижимости", "ЖК"],
        success_message_detected:  null,
        risk_level:                "low",
        last_checked_at:           new Date().toISOString(),
        notes:                     "ITRIELT API — Token auth — base: api.itrielt.ru — site: broker.islandambassadori.com",
      },
      risk_level: "low",
      notes: "Ambassadori Island Batumi — ITRIELT platform — Token: AMBASSADORI_SESSION_TOKEN — complex id:13981",
    };

    await client.query(`
      INSERT INTO developer_form_configs
        (developer_company_id, config_json, is_active, created_at, updated_at)
      VALUES ($1, $2, true, NOW(), NOW())
    `, [companyId, JSON.stringify(config)]);

    console.log(`[Ambassadori] Company record created — id=${companyId}`);
  } catch (err: any) {
    console.error("[Ambassadori] Failed to ensure company record:", err.message);
  } finally {
    client.release();
  }
}

// ── Submit result type ─────────────────────────────────────────────────────────

export interface AmbassadoriSubmitResult {
  success:        boolean;
  outcome:        "success" | "protected" | "failed" | "needs_review";
  responseStatus: number | null;
  responseBody:   string | null;
  errorMessage:   string | null;
  attemptId:      number;
  payload:        Record<string, any>;
  dealId?:        string;
}

// ── Main submit function ───────────────────────────────────────────────────────

export async function submitRecordToAmbassadori(
  recordId:    number,
  adminId:     number,
  attemptType: "initial" | "re_registration" | "manual_retry" | "manual" | "ambassadori_auto" = "manual_retry"
): Promise<AmbassadoriSubmitResult> {
  const client = await pool.connect();
  try {
    // ── 1. Load record ────────────────────────────────────────────────────────
    const recResult = await client.query(`
      SELECT drr.id, drr.crm_lead_id, drr.developer_company_id,
             drr.registration_payload_json, drr.status,
             dc.registration_interval_days,
             cl.first_name, cl.last_name, cl.full_name, cl.phone, cl.city
        FROM developer_registration_records drr
        JOIN developer_companies dc ON dc.id = drr.developer_company_id
        JOIN crm_leads cl ON cl.id = drr.crm_lead_id
       WHERE drr.id = $1
    `, [recordId]);

    if (recResult.rows.length === 0) throw new Error(`Record ${recordId} not found`);
    const rec = recResult.rows[0];

    if (rec.developer_company_id !== AMBASSADORI_COMPANY_ID) {
      throw new Error(
        `submitRecordToAmbassadori is only for Ambassadori (id=${AMBASSADORI_COMPANY_ID}). ` +
        `Record ${recordId} belongs to company id=${rec.developer_company_id}.`
      );
    }
    if (rec.status === "stopped") throw new Error("Cannot submit a stopped registration record");

    // ── 2. Build payload ──────────────────────────────────────────────────────
    const firstName = rec.first_name?.trim() || rec.full_name?.split(" ")[0]?.trim() || "";
    const lastName  = rec.last_name?.trim()  || rec.full_name?.split(" ").slice(1).join(" ").trim() || "—";
    const phone     = formatPhone(rec.phone ?? "");
    const city      = rec.city?.trim() || "Батуми";

    const customFields = buildCustomFields(firstName, lastName, phone, city);

    const submitPayload = {
      custom_fields: customFields,
      complex:       COMPLEX,
      phone,
      name:          firstName,
      surname:       lastName,
      city,
    };

    // ── 3. Check token ────────────────────────────────────────────────────────
    const token = getToken();
    if (!token) {
      const errMsg = "AMBASSADORI_SESSION_TOKEN is not set — add it in Replit Secrets";
      console.warn(`[Ambassadori][Submit] ${errMsg}`);
      await writeAttempt(client, recordId, rec, adminId, attemptType, submitPayload, null, null, errMsg, "failed");
      await client.query(`UPDATE developer_registration_records SET status='failed', last_error=$1, updated_at=NOW() WHERE id=$2`, [errMsg, recordId]);
      return { success: false, outcome: "failed", responseStatus: null, responseBody: null, errorMessage: errMsg, attemptId: 0, payload: submitPayload };
    }

    // ── 4. Mark as submitting ─────────────────────────────────────────────────
    await client.query(`UPDATE developer_registration_records SET status='submitting', updated_at=NOW() WHERE id=$1`, [recordId]);
    console.log(`[Ambassadori][Submit] recordId=${recordId} leadId=${rec.crm_lead_id} phone=${phone} name="${firstName} ${lastName}"`);

    let responseBody: string | null = null;
    let responseStatus: number | null = null;
    let errorMessage: string | null = null;
    let dealId: string | undefined;
    let outcome: "success" | "protected" | "failed" | "needs_review" = "failed";

    try {
      // ── 5. Uniqueness check ───────────────────────────────────────────────
      const uniqueness = await checkLeadUniqueness(phone);
      console.log(`[Ambassadori][Submit] Uniqueness: isDuplicate=${uniqueness.isDuplicate} isUnique=${uniqueness.isUnique} — ${uniqueness.diagnosis}`);

      if (!uniqueness.checkedOk) {
        outcome      = "needs_review";
        errorMessage = `Uniqueness check failed — token may be invalid or expired. ${uniqueness.diagnosis}`;
        console.warn(`[Ambassadori][Submit] ${errorMessage}`);
      } else if (uniqueness.isDuplicate) {
        outcome      = "protected";
        errorMessage = `Lead already registered in Ambassadori portal (duplicate). Phone: ${phone}. ${uniqueness.diagnosis}`;
        console.log(`[Ambassadori][Submit] status=protected`);
      } else {
        // ── 6. Attempt 1: check-uniq with create_lead:true ─────────────────
        console.log(`[Ambassadori][Submit] Attempting check-uniq/create_lead...`);
        const attempt1 = await attemptCheckUniqCreate(customFields);
        responseBody = attempt1.rawResponse;
        dealId       = attempt1.dealId;

        if (attempt1.success) {
          outcome = "success";
          console.log(`[Ambassadori][Submit] ✓ check-uniq/create_lead succeeded dealId=${dealId}`);
        } else {
          console.warn(`[Ambassadori][Submit] check-uniq/create_lead failed: ${attempt1.errorText}`);

          // ── 7. Attempt 2: POST /deals/create (fallback) ─────────────────
          console.log(`[Ambassadori][Submit] Attempting deals/create fallback...`);
          const attempt2 = await attemptDealsCreate(customFields);
          responseBody = attempt2.rawResponse;
          dealId       = attempt2.dealId;

          if (attempt2.success) {
            outcome = "success";
            console.log(`[Ambassadori][Submit] ✓ deals/create succeeded dealId=${dealId ?? "(no id returned)"}`);
          } else {
            console.warn(`[Ambassadori][Submit] deals/create fallback also failed: ${attempt2.errorText}`);

            // Both methods failed — mark needs_review with diagnostic info
            const diagnostics = [
              `check-uniq/create_lead: ${attempt1.errorText}`,
              `deals/create: ${attempt2.errorText}`,
            ].join(" | ");
            outcome      = "needs_review";
            errorMessage = `ITRIELT API lead creation blocked. Both methods failed. ${diagnostics}. ` +
              `The ITRIELT create-lead endpoint requires a PHP session state that is not available via Token-only auth. ` +
              `Please submit this lead manually at ${PORTAL_URL}.`;
          }
        }
      }
    } catch (err: any) {
      outcome      = "failed";
      errorMessage = err.message ?? "Unexpected error during Ambassadori submission";
      console.error(`[Ambassadori][Submit] Error: ${errorMessage}`);
    }

    // ── 8. Update record status ───────────────────────────────────────────────
    const isSuccess   = outcome === "success";
    const isProtected = outcome === "protected";
    const isReview    = outcome === "needs_review";
    const newStatus   = isSuccess ? "success" : isProtected ? "success" : isReview ? "needs_review" : "failed";
    const newProt     = isSuccess || isProtected ? "protected" : undefined;
    const now         = new Date();
    const nextReg     = (isSuccess || isProtected)
      ? new Date(now.getTime() + (rec.registration_interval_days ?? 30) * 86_400_000)
      : null;

    await client.query(`
      UPDATE developer_registration_records
         SET status               = $1,
             protection_status    = COALESCE($2::text, protection_status),
             last_error           = $3,
             last_registered_at   = CASE WHEN $4 THEN $5::timestamptz ELSE last_registered_at END,
             next_registration_at = CASE WHEN $4 THEN $6::timestamptz ELSE next_registration_at END,
             attempt_count        = COALESCE(attempt_count, 0) + 1,
             updated_at           = NOW()
       WHERE id = $7
    `, [newStatus, newProt ?? null, errorMessage, isSuccess || isProtected, now, nextReg, recordId]);

    // ── 9. Audit log ──────────────────────────────────────────────────────────
    const auditPayload = { ...submitPayload, deal_id: dealId };

    const resultMsg = isSuccess
      ? `Ambassadori lead created ✓${dealId ? ` dealId=${dealId}` : " (no ID returned)"}`
      : isProtected
        ? `Lead protected — duplicate already exists. ${errorMessage}`
        : isReview
          ? `Needs manual review — ${errorMessage?.slice(0, 200)}`
          : (errorMessage ?? "Failed");

    const attemptResult = await writeAttempt(
      client, recordId, rec, adminId, attemptType, auditPayload,
      responseStatus, responseBody, errorMessage,
      isSuccess || isProtected ? "success" : "failed",
      resultMsg
    );

    console.log(`[Ambassadori][Submit] done recordId=${recordId} outcome=${outcome} attemptId=${attemptResult}`);

    return {
      success:        isSuccess || isProtected,
      outcome,
      responseStatus,
      responseBody,
      errorMessage,
      attemptId:      attemptResult,
      payload:        auditPayload,
      dealId,
    };

  } finally {
    client.release();
  }
}

// ── Audit log helper ───────────────────────────────────────────────────────────

async function writeAttempt(
  client:         any,
  recordId:       number,
  rec:            any,
  adminId:        number,
  attemptType:    string,
  payload:        Record<string, any>,
  responseStatus: number | null,
  responseBody:   string | null,
  errorMessage:   string | null,
  status:         "success" | "failed",
  resultMessage?: string
): Promise<number> {
  const res = await client.query(`
    INSERT INTO developer_registration_attempts
      (registration_record_id, crm_lead_id, developer_company_id,
       attempt_type, status, payload_json, result_message, created_by, created_at,
       destination_url, response_status, response_body, error_message)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,$12)
    RETURNING id
  `, [
    recordId, rec.crm_lead_id, AMBASSADORI_COMPANY_ID,
    attemptType, status,
    JSON.stringify(payload),
    resultMessage ?? (status === "success" ? "Ambassadori submission accepted" : (errorMessage ?? "Failed")),
    adminId,
    PORTAL_URL,
    responseStatus,
    responseBody,
    errorMessage,
  ]);
  return res.rows[0]?.id ?? 0;
}
