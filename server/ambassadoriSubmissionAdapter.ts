/**
 * Ambassadori Island Batumi — Submission Adapter
 * Portal: https://broker.islandambassadori.com (ITRIELT system)
 *
 * Authentication: GET /api/get-hash?login=USER&password=MD5(PASS) → { hash: "..." }
 * All subsequent API calls include ?hash=TOKEN as query param.
 *
 * Credentials sourced from Replit Secrets:
 *   AMBASSADORI_BROKER_USERNAME
 *   AMBASSADORI_BROKER_PASSWORD
 *
 * If credentials are missing → status = failed, error = "Ambassadori credentials missing".
 * Never logs or exposes credentials in plaintext.
 */

import { createHash } from "crypto";
import { pool } from "./db";

export const AMBASSADORI_COMPANY_ID = 2;

const BASE_URL  = "https://broker.islandambassadori.com";
const PORTAL_URL = `${BASE_URL}/deals/create`;

const AJAX_HEADERS = {
  "Accept":           "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent":       "Mozilla/5.0 (compatible; KinglikeBot/1.0)",
  "Referer":          `${BASE_URL}/auth`,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function md5(s: string): string {
  return createHash("md5").update(s).digest("hex");
}

function formatPhone(raw: string): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  if (raw.trim().startsWith("+")) return "+" + digits;
  return "+" + digits;
}

function isHtml(text: string): boolean {
  return text.trim().startsWith("<!") || text.trim().startsWith("<html");
}

function getCredentials(): { username: string; password: string } | null {
  const u = process.env.AMBASSADORI_BROKER_USERNAME?.trim();
  const p = process.env.AMBASSADORI_BROKER_PASSWORD?.trim();
  if (!u || !p) return null;
  return { username: u, password: p };
}

// ── API calls ──────────────────────────────────────────────────────────────────

async function apiGet(path: string, params: Record<string, string>): Promise<{ status: number; text: string; json: any | null }> {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: AJAX_HEADERS, signal: AbortSignal.timeout(25_000) });
  const text = await res.text();
  let json: any = null;
  if (!isHtml(text)) { try { json = JSON.parse(text); } catch { /* not JSON */ } }
  return { status: res.status, text, json };
}

async function apiPost(path: string, body: Record<string, any>): Promise<{ status: number; text: string; json: any | null }> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...AJAX_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: any = null;
  if (!isHtml(text)) { try { json = JSON.parse(text); } catch { /* not JSON */ } }
  return { status: res.status, text, json };
}

// ── Authentication ─────────────────────────────────────────────────────────────

async function authenticate(username: string, password: string): Promise<string> {
  const passwordMd5 = md5(password);
  const { status, text, json } = await apiGet("/api/get-hash", {
    login:    username,
    password: passwordMd5,
  });

  if (isHtml(text)) {
    throw new Error(
      `Authentication failed — portal returned HTML (SPA) instead of JSON. ` +
      `Possible causes: wrong credentials, IP blocked, or ITRIELT API endpoint changed. ` +
      `HTTP ${status}. Please verify credentials and portal access.`
    );
  }

  if (json?.hash) return json.hash as string;
  if (json?.error) throw new Error(`Authentication error: ${json.error}`);
  if (json?.message) throw new Error(`Authentication error: ${json.message}`);

  throw new Error(`Unexpected auth response (HTTP ${status}): ${text.slice(0, 300)}`);
}

// ── Get dropdown options ───────────────────────────────────────────────────────

async function getListOptions(hash: string, listType: string): Promise<any[]> {
  const { json } = await apiGet("/api/get-list", { hash, type: listType });
  if (!json) return [];
  if (Array.isArray(json))         return json;
  if (Array.isArray(json.list))    return json.list;
  if (Array.isArray(json.items))   return json.items;
  if (Array.isArray(json.data))    return json.data;
  if (Array.isArray(json.results)) return json.results;
  return [];
}

// ── Uniqueness check ──────────────────────────────────────────────────────────

interface UniquenessResult {
  checkedOk:   boolean;
  isDuplicate: boolean;
  isUnique:    boolean;
  rawResponse: string;
  diagnosis:   string;
}

async function checkLeadUniqueness(hash: string, phone: string): Promise<UniquenessResult> {
  const { status, text, json } = await apiGet("/api/get-buys-loot-check", { hash, phone });

  if (isHtml(text)) {
    return {
      checkedOk:   false,
      isDuplicate: false,
      isUnique:    false,
      rawResponse: `HTML_RESPONSE (HTTP ${status}) — authentication may have failed`,
      diagnosis:   "Uniqueness check returned HTML — treating as inconclusive",
    };
  }

  if (json === null) {
    return {
      checkedOk: false, isDuplicate: false, isUnique: false,
      rawResponse: text.slice(0, 500),
      diagnosis: `Non-JSON response from uniqueness check (HTTP ${status})`,
    };
  }

  const isDuplicate = !!(
    json.id || json.loot_id || json.client_id || json.bank_id ||
    json.exists === true || json.duplicate === true ||
    json.result === "exists" || json.result === "duplicate" ||
    json.status === "exists" || json.count > 0
  );

  const isUnique = !isDuplicate && (
    json.unique === true || json.result === "unique" || json.result === "ok" ||
    json.status === "unique" || json.count === 0 ||
    (json.id === null && json.error === undefined)
  );

  return {
    checkedOk:   true,
    isDuplicate,
    isUnique,
    rawResponse: text,
    diagnosis:   isDuplicate ? "Portal confirms duplicate" : isUnique ? "Portal confirms unique" : `Inconclusive: ${text.slice(0, 200)}`,
  };
}

// ── Create deal ────────────────────────────────────────────────────────────────

interface DealResult {
  success:      boolean;
  dealId?:      string;
  rawResponse:  string;
  errorMessage: string | null;
}

async function createDeal(hash: string, payload: {
  name: string; surname: string; phone: string;
  projectName: string; propertyType: string; expertName: string;
}): Promise<DealResult> {
  const body = {
    hash,
    name:          payload.name,
    surname:       payload.surname,
    phone:         payload.phone,
    project:       payload.projectName,
    object_type:   payload.propertyType,
    expert:        payload.expertName,
    first_name:    payload.name,
    last_name:     payload.surname,
    contact_name:  `${payload.name} ${payload.surname}`.trim(),
    contact_phone: payload.phone,
    projectname:   payload.projectName,
    type:          payload.propertyType,
    responsible:   payload.expertName,
  };

  const { status, text, json } = await apiPost("/api/create-bank", body);

  if (isHtml(text)) {
    return { success: false, rawResponse: `HTML_RESPONSE (HTTP ${status})`, errorMessage: "Portal returned HTML — authentication may have expired during submission" };
  }

  if (!json) {
    return { success: false, rawResponse: text.slice(0, 500), errorMessage: `Non-JSON response (HTTP ${status}): ${text.slice(0, 200)}` };
  }

  const dealId = String(json.id ?? json.deal_id ?? json.bank_id ?? json.loot_id ?? "").trim() || undefined;

  if (
    (status >= 200 && status < 300) &&
    (dealId || json.success === true || json.status === "success" || json.result === "ok" || json.result === "created")
  ) {
    return { success: true, dealId, rawResponse: text, errorMessage: null };
  }

  const errMsg = json.error ?? json.message ?? json.msg ?? json.detail ?? `HTTP ${status}: ${text.slice(0, 200)}`;
  return { success: false, rawResponse: text, errorMessage: String(errMsg) };
}

// ── Ensure attempt columns exist ──────────────────────────────────────────────

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

// ── Ensure Ambassadori company record exists in DB ────────────────────────────

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
              'https://broker.islandambassadori.com/deals/create',
              true, true, 30, 'auto', NOW(), NOW())
      RETURNING id
    `);
    const companyId = companyResult.rows[0].id;

    const config = {
      field_mappings:  {},
      required_fields: ["phone"],
      default_values:  {},
      payload_rules: {
        use_lead_first_name:           true,
        use_lead_last_name:            true,
        use_lead_phone_as_contact_phone: true,
        ambassadori_expert:            "Aphina Martley",
        ambassadori_project:           "Ambassadori Island Batumi",
        ambassadori_property_type:     "Apartments",
      },
      representative_settings: {
        personal_expert: "Aphina Martley",
      },
      compatibility_checker_result: {
        can_auto_fill:             true,
        captcha_detected:          null,
        cloudflare_detected:       null,
        submit_button_detected:    true,
        required_fields_detected:  ["name","surname","phone","project","propertyType","personalExpert"],
        success_message_detected:  null,
        risk_level:                "medium",
        last_checked_at:           new Date().toISOString(),
        notes:                     "ITRIELT portal — HTTP API adapter — credentials required",
      },
      risk_level: "medium",
      notes:      "Ambassadori Island Batumi — ITRIELT broker portal — Personal Expert: Aphina Martley",
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

// ── Submit result type ────────────────────────────────────────────────────────

export interface AmbassadoriSubmitResult {
  success:        boolean;
  outcome:        "success" | "protected" | "failed";
  responseStatus: number | null;
  responseBody:   string | null;
  errorMessage:   string | null;
  attemptId:      number;
  payload:        Record<string, any>;
  dealId?:        string;
}

// ── Main submit function ──────────────────────────────────────────────────────

export async function submitRecordToAmbassadori(
  recordId:    number,
  adminId:     number,
  attemptType: "initial" | "re_registration" | "manual_retry" | "manual" | "ambassadori_auto" = "manual_retry"
): Promise<AmbassadoriSubmitResult> {
  const client = await pool.connect();
  try {
    // ── 1. Load record with lead data ────────────────────────────────────────
    const recResult = await client.query(`
      SELECT drr.id, drr.crm_lead_id, drr.developer_company_id,
             drr.registration_payload_json, drr.status,
             dc.registration_interval_days,
             cl.first_name, cl.last_name, cl.full_name, cl.phone
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

    // ── 2. Build payload ─────────────────────────────────────────────────────
    const firstName = rec.first_name?.trim() || rec.full_name?.split(" ")[0]?.trim() || "";
    const lastName  = rec.last_name?.trim()  || rec.full_name?.split(" ").slice(1).join(" ").trim() || "-";
    const phone     = formatPhone(rec.phone ?? "");

    const submitPayload = {
      name:         firstName || phone || "Unknown",
      surname:      lastName || "-",
      phone,
      projectName:  "Ambassadori Island Batumi",
      propertyType: "Apartments",
      expertName:   "Aphina Martley",
    };

    // ── 3. Check credentials ─────────────────────────────────────────────────
    const creds = getCredentials();
    if (!creds) {
      const errMsg = "Ambassadori credentials missing — set AMBASSADORI_BROKER_USERNAME and AMBASSADORI_BROKER_PASSWORD in Secrets";
      console.warn(`[Ambassadori][Submit] ${errMsg}`);
      await writeAttempt(client, recordId, rec, adminId, attemptType, submitPayload, null, null, errMsg, "failed");
      await client.query(`UPDATE developer_registration_records SET status='failed', last_error=$1, updated_at=NOW() WHERE id=$2`, [errMsg, recordId]);
      return { success: false, outcome: "failed", responseStatus: null, responseBody: null, errorMessage: errMsg, attemptId: 0, payload: submitPayload };
    }

    // ── 4. Mark as submitting ────────────────────────────────────────────────
    await client.query(`UPDATE developer_registration_records SET status='submitting', updated_at=NOW() WHERE id=$1`, [recordId]);

    console.log(`[Ambassadori][Submit] recordId=${recordId} leadId=${rec.crm_lead_id} phone=${phone} name="${submitPayload.name} ${submitPayload.surname}"`);

    let hash = "";
    let uniquenessRaw = "";
    let responseBody: string | null = null;
    let responseStatus: number | null = null;
    let errorMessage: string | null = null;
    let dealId: string | undefined;
    let outcome: "success" | "protected" | "failed" = "failed";

    try {
      // ── 5. Authenticate ──────────────────────────────────────────────────
      hash = await authenticate(creds.username, creds.password);
      console.log(`[Ambassadori][Submit] Authenticated ✓ hash_len=${hash.length}`);

      // ── 6. Uniqueness check ──────────────────────────────────────────────
      const uniqueness = await checkLeadUniqueness(hash, phone);
      uniquenessRaw = uniqueness.rawResponse;
      console.log(`[Ambassadori][Submit] Uniqueness: isDuplicate=${uniqueness.isDuplicate} isUnique=${uniqueness.isUnique} — ${uniqueness.diagnosis}`);

      if (uniqueness.isDuplicate) {
        outcome = "protected";
        errorMessage = `Lead already registered in Ambassadori portal (duplicate). Phone: ${phone}. ${uniqueness.diagnosis}`;
        console.log(`[Ambassadori][Submit] status=protected`);
      } else {
        // ── 7. Create deal ─────────────────────────────────────────────────
        const dealResult = await createDeal(hash, submitPayload);
        responseBody = dealResult.rawResponse;
        dealId       = dealResult.dealId;

        if (dealResult.success) {
          outcome = "success";
          console.log(`[Ambassadori][Submit] Deal created ✓ dealId=${dealId}`);
        } else {
          outcome       = "failed";
          errorMessage  = dealResult.errorMessage;
          console.warn(`[Ambassadori][Submit] Deal creation failed: ${errorMessage}`);
        }
      }
    } catch (err: any) {
      outcome      = "failed";
      errorMessage = err.message ?? "Unexpected error during Ambassadori submission";
      console.error(`[Ambassadori][Submit] Error: ${errorMessage}`);
    }

    // ── 8. Update record status ──────────────────────────────────────────────
    const isSuccess  = outcome === "success";
    const isProtected = outcome === "protected";
    const newStatus  = isSuccess ? "success" : isProtected ? "success" : "failed";
    const newProt    = isSuccess || isProtected ? "protected" : undefined;
    const now        = new Date();
    const nextReg    = (isSuccess || isProtected)
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

    // ── 9. Audit log ─────────────────────────────────────────────────────────
    const auditPayload = {
      ...submitPayload,
      uniqueness_check_raw: uniquenessRaw || undefined,
      deal_id:              dealId,
    };

    const resultMsg = isSuccess
      ? `Ambassadori deal created ✓${dealId ? ` dealId=${dealId}` : ""}`
      : isProtected
        ? `Lead protected — duplicate already exists. ${errorMessage}`
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

// ── Audit log helper ──────────────────────────────────────────────────────────

async function writeAttempt(
  client: any,
  recordId: number,
  rec: any,
  adminId: number,
  attemptType: string,
  payload: Record<string, any>,
  responseStatus: number | null,
  responseBody: string | null,
  errorMessage: string | null,
  status: "success" | "failed",
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
