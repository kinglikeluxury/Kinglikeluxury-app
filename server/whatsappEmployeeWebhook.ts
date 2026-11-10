import crypto from "node:crypto";
import type { Express } from "express";
import pg from "pg";
import { stagingDatabaseIsIsolated } from "./stagingExternalGuard";
import { isEmployeeWhatsappMediaKind, normalizeEmployeeWhatsappMedia } from "./whatsappEmployeeMedia";

const PATH = "/api/webhooks/whatsapp-employee";
const enabled = () => process.env.APP_DEPLOYMENT_MODE !== "staging" &&
  process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED === "true";

export function verifyWhatsappSignature(raw: Buffer, header: unknown, appSecret: string): boolean {
  if (!Buffer.isBuffer(raw) || typeof header !== "string" || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(raw).digest("hex")}`;
  const supplied = Buffer.from(header, "utf8");
  const calculated = Buffer.from(expected, "utf8");
  return supplied.length === calculated.length && crypto.timingSafeEqual(supplied, calculated);
}

type NormalizedEvent = {
  eventKey: string; wabaId: string; phoneNumberId: string; contactWaId: string; contactUserId: string | null;
  businessDisplayPhoneNumber: string | null;
  kind: "message" | "status" | "edit" | "revoke"; direction: "inbound" | "outbound" | "status";
  metaMessageId: string; eventStatus: string | null; messageType: string | null;
  text: string | null; occurredAt: string | null; sourceField: string; relatedMessageId: string | null;
  mediaMimeType: string | null; mediaSizeBytes: number | null; mediaSha256: string | null;
};

export function isEligibleRegistration(
  registration: {
    is_active: boolean; consent_status: string; revoked_at: unknown; business_authorized_at: unknown;
    coexistence_enabled: boolean; coexistence_verified_at?: unknown; coexistence_verification_ref?: string | null;
    registration_kind?: string; display_phone_number?: string | null;
  } | undefined,
  sourceField: string,
  businessDisplayPhoneNumber?: string | null,
): boolean {
  return registration?.registration_kind === "company" &&
    !!registration.is_active &&
    registration.consent_status === "consented" &&
    !registration.revoked_at &&
    !!registration.business_authorized_at &&
    (sourceField !== "smb_message_echoes" || (!!registration.coexistence_enabled &&
      !!registration.coexistence_verified_at && !!registration.coexistence_verification_ref &&
      !!digits(businessDisplayPhoneNumber) &&
      digits(registration.display_phone_number) === digits(businessDisplayPhoneNumber)));
}

function digits(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

function messageText(type: unknown, content: any): string | null {
  if (type === "text" && typeof content?.text?.body === "string") return content.text.body;
  if (["image", "video", "document"].includes(String(type))) {
    return typeof content?.[String(type)]?.caption === "string" ? content[String(type)].caption : null;
  }
  return null;
}

export function normalizeWhatsappWebhook(payload: any): NormalizedEvent[] {
  if (payload?.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return [];
  const events: NormalizedEvent[] = [];
  for (const entry of payload.entry) {
    const wabaId = String(entry?.id ?? "");
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const field = change?.field;
      if (field !== "messages" && field !== "smb_message_echoes") continue;
      const value = change?.value ?? {};
      const phoneNumberId = String(value?.metadata?.phone_number_id ?? "");
      if (!wabaId || !phoneNumberId) continue;
      const echo = field === "smb_message_echoes";
      const sourceMessages = echo ? value.message_echoes : value.messages;
      for (const msg of Array.isArray(sourceMessages) ? sourceMessages : []) {
        if (typeof msg?.id !== "string" || !msg.id.trim() || typeof msg.type !== "string") continue;
        const customer = echo ? msg.to : msg.from;
        const matchedContact = Array.isArray(value.contacts)
          ? value.contacts.find((c: any) => digits(c?.wa_id) === digits(customer) && (!msg.to_user_id || c?.user_id === msg.to_user_id))
          : undefined;
        const contactUserId = echo ? (msg.to_user_id ?? matchedContact?.user_id) : matchedContact?.user_id;
        if (echo && msg.to_user_id != null && typeof msg.to_user_id !== "string") continue;
        if (echo && customer != null && !digits(customer)) continue;
        if (echo && (!digits(customer) && (typeof msg.to_user_id !== "string" || !msg.to_user_id.trim()))) continue;
        if (echo && (!digits(msg.from) || !digits(value?.metadata?.display_phone_number) ||
            digits(msg.from) !== digits(value.metadata.display_phone_number))) continue;
        if (!echo && !digits(customer)) continue;
        if (echo && Array.isArray(value.contacts) && value.contacts.length) {
          const matched = value.contacts.some((c: any) =>
            (!customer || digits(c?.wa_id) === digits(customer)) && (!msg.to_user_id || c?.user_id === msg.to_user_id));
          if (!matched) continue;
        }
        if (!echo && Array.isArray(value.contacts) && value.contacts.length && !matchedContact) continue;
        let kind: NormalizedEvent["kind"] = "message";
        let relatedMessageId: string | null = null;
        let contentType: unknown = msg.type;
        let content: any = msg;
        if (msg.type === "edit") {
          relatedMessageId = typeof msg.edit?.original_message_id === "string" ? msg.edit.original_message_id : null;
          content = msg.edit?.message;
          contentType = content?.type;
          if (!relatedMessageId || (contentType !== "text" && !isEmployeeWhatsappMediaKind(contentType))) continue;
          kind = "edit";
        } else if (msg.type === "revoke") {
          relatedMessageId = typeof msg.revoke?.original_message_id === "string" ? msg.revoke.original_message_id : null;
          if (!relatedMessageId) continue;
          kind = "revoke";
        } else if (msg.type !== "text" && !isEmployeeWhatsappMediaKind(msg.type)) continue;
        const text = kind === "revoke" ? null : messageText(contentType, content);
        const media = kind === "revoke" ? null : normalizeEmployeeWhatsappMedia(contentType, content);
        const ts = msg.timestamp ? String(msg.timestamp) : null;
        const contactWaId = digits(customer) ? String(customer) : `bsuid:${msg.to_user_id}`;
        events.push({
          eventKey: echo ? `echo:${kind}:${msg.id}` : `message:${msg.id}`, wabaId, phoneNumberId, contactWaId,
          contactUserId: typeof contactUserId === "string" ? contactUserId : null,
          businessDisplayPhoneNumber: echo ? String(value?.metadata?.display_phone_number ?? "") : null,
          kind, direction: echo ? "outbound" : "inbound", metaMessageId: String(msg.id),
          eventStatus: null, messageType: String(contentType), text, occurredAt: ts, sourceField: field, relatedMessageId,
          mediaMimeType: media?.mimeType ?? null, mediaSizeBytes: media?.sizeBytes ?? null,
          mediaSha256: media?.sha256Hex ?? null,
        });
      }
      for (const status of !echo && Array.isArray(value.statuses) ? value.statuses : []) {
        if (!status?.id || !status?.status || !status?.recipient_id) continue;
        const ts = status.timestamp ? String(status.timestamp) : null;
        events.push({
          eventKey: `status:${status.id}:${status.status}:${ts ?? ""}`, wabaId, phoneNumberId,
          contactWaId: String(status.recipient_id), contactUserId: null, businessDisplayPhoneNumber: null,
          kind: "status", direction: "status",
          metaMessageId: String(status.id), eventStatus: String(status.status), messageType: null,
          text: null, occurredAt: ts, sourceField: field, relatedMessageId: null,
          mediaMimeType: null, mediaSizeBytes: null, mediaSha256: null,
        });
      }
    }
  }
  return events;
}

/**
 * Isolated end-to-end test bridge:
 * encrypted durable inbox -> existing authorized, idempotent event archiver.
 *
 * Safe by construction: NEVER usable by a running Staging/production server.
 * A real pilot needs a separately reviewed DI worker with a dedicated archive
 * DB role, audit and persisted consent. It must not use this test-only pool.
 */
export async function archiveQueuedWhatsappEmployeePayloadForTest(
  raw: Buffer,
  scope: {
    employeeId: number;
    wabaId: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
  },
): Promise<number> {
  if (process.env.NODE_ENV !== "test" || process.env.APP_DEPLOYMENT_MODE !== "test" ||
      process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED !== "true" ||
      !Buffer.isBuffer(raw) || raw.length === 0 || raw.length > 1024 * 1024 ||
      !Number.isSafeInteger(scope?.employeeId) || scope.employeeId < 1) {
    throw new Error("Employee queue archiver is disabled outside isolated tests.");
  }
  return archiveScopedPayload(raw,scope,getTestOnlyPool());
}

/** Core writer remains hidden behind the isolated test guard or an explicitly
 * verified private archive-worker factory. No app DB fallback is permitted.
 */
async function archiveScopedPayload(
  raw: Buffer,
  scope: {employeeId:number;wabaId:string;phoneNumberId:string;displayPhoneNumber:string},
  db: Pick<pg.Pool,"connect">,
): Promise<number> {
  if(!Buffer.isBuffer(raw) || raw.length===0 || raw.length>1024*1024 ||
     !Number.isSafeInteger(scope?.employeeId) || scope.employeeId<1 ||
     !/^[0-9]{4,24}$/.test(scope.wabaId) ||
     !/^[0-9]{4,24}$/.test(scope.phoneNumberId) ||
     !/^[0-9]{8,24}$/.test(scope.displayPhoneNumber))
    throw new Error("Employee queue scope invalid");
  let payload: any;
  try { payload = JSON.parse(raw.toString("utf8")); }
  catch { throw new Error("Malformed signed employee queue payload"); }
  if (payload?.object !== "whatsapp_business_account" ||
      !Array.isArray(payload.entry) || payload.entry.length === 0) {
    throw new Error("Invalid employee queue object");
  }
  let supportedChanges = 0;
  for (const entry of payload.entry) {
    if (entry?.id !== scope.wabaId || !Array.isArray(entry.changes)) {
      throw new Error("Wrong or missing employee WABA");
    }
    for (const change of entry.changes) {
      // Never acknowledge history before a separate durable history importer
      // has been implemented and verified. No history rows can be silently lost.
      if (change?.field === "history" || change?.field === "smb_app_state_sync") {
        throw new Error("Employee history or contact import is not available");
      }
      if (change?.field !== "messages" && change?.field !== "smb_message_echoes") continue;
      supportedChanges++;
      if (change?.value?.metadata?.phone_number_id !== scope.phoneNumberId ||
          (change?.value?.metadata?.display_phone_number !== undefined &&
           String(change.value.metadata.display_phone_number).replace(/\D/g, "") !== scope.displayPhoneNumber)) {
        throw new Error("Employee phone identity mismatch");
      }
    }
  }
  if (!supportedChanges) throw new Error("No supported employee message changes");
  const events = normalizeWhatsappWebhook(payload);
  if (!events.length || events.some(e =>
    e.wabaId !== scope.wabaId || e.phoneNumberId !== scope.phoneNumberId ||
    (e.businessDisplayPhoneNumber !== null &&
     e.businessDisplayPhoneNumber.replace(/\D/g,"") !== scope.displayPhoneNumber))) {
    throw new Error("Employee event identity mismatch");
  }
  // At-least-once replay is safe: persistEvent uses unique Meta event keys,
  // transactionally validates current registration/consent, and audits outcome.
  // Individual events may commit before an exception. Retry deduplicates those.
  let stored = 0;
  for (const event of events) {
    const outcome = await persistEvent(event,db,scope.employeeId);
    if (outcome === "identity_mismatch" || outcome === "not_consented") {
      throw new Error("Employee archive policy rejected event");
    }
    if (outcome === "stored") stored++;
  }
  return stored;
}

async function persistEvent(event: NormalizedEvent,
  db: Pick<pg.Pool,"connect">,expectedEmployeeId: number,
): Promise<"stored" | "duplicate" | "not_consented" | "identity_mismatch" | "unresolved_reference"> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const registration = await client.query(
      `SELECT n.employee_id,n.registration_kind,n.display_phone_number,n.is_active,n.business_authorized_at,n.coexistence_enabled,
              n.coexistence_verified_at,n.coexistence_verification_ref,
              c.status AS consent_status, c.revoked_at
         FROM whatsapp_employee_numbers n
         JOIN whatsapp_employee_consents c
           ON c.phone_number_id=n.phone_number_id AND c.employee_id=n.employee_id
        WHERE n.phone_number_id=$1 AND n.waba_id=$2
        LIMIT 1`,
      [event.phoneNumberId, event.wabaId],
    );
    if (!isEligibleRegistration(registration.rows[0], event.sourceField, event.businessDisplayPhoneNumber)) {
      await client.query(
        `INSERT INTO whatsapp_employee_audit (action, phone_number_id, waba_id, meta_event_key, outcome)
         VALUES ('webhook_event', $1, $2, $3, 'not_consented') ON CONFLICT DO NOTHING`,
        [event.phoneNumberId, event.wabaId, event.eventKey],
      );
      await client.query("COMMIT");
      return "not_consented";
    }
    const employeeId = Number(registration.rows[0].employee_id);
    if(employeeId!==expectedEmployeeId) {
      await client.query("ROLLBACK");
      return "identity_mismatch";
    }
    const existing = await client.query(
      `SELECT e.employee_id,c.phone_number_id,c.waba_id,c.contact_wa_id,c.contact_user_id
         FROM whatsapp_employee_events e JOIN whatsapp_employee_conversations c ON c.id=e.conversation_id
        WHERE e.meta_event_key=$1`,
      [event.eventKey],
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      const sameIdentity = Number(row.employee_id) === employeeId && row.phone_number_id === event.phoneNumberId &&
        row.waba_id === event.wabaId && row.contact_wa_id === event.contactWaId &&
        (!row.contact_user_id || !event.contactUserId || row.contact_user_id === event.contactUserId);
      await client.query(
        `INSERT INTO whatsapp_employee_audit (employee_id,action,phone_number_id,waba_id,meta_event_key,outcome)
         VALUES ($1,'webhook_event',$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [employeeId,event.phoneNumberId,event.wabaId,event.eventKey,sameIdentity ? "duplicate" : "identity_mismatch"],
      );
      await client.query("COMMIT");
      return sameIdentity ? "duplicate" : "identity_mismatch";
    }
    const conversation = await client.query(
      `INSERT INTO whatsapp_employee_conversations (employee_id,phone_number_id,waba_id,contact_wa_id,contact_user_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (employee_id, phone_number_id, contact_wa_id)
       DO UPDATE SET updated_at=NOW(),
         contact_user_id=COALESCE(whatsapp_employee_conversations.contact_user_id,EXCLUDED.contact_user_id)
       WHERE whatsapp_employee_conversations.contact_user_id IS NULL
          OR EXCLUDED.contact_user_id IS NULL
          OR whatsapp_employee_conversations.contact_user_id=EXCLUDED.contact_user_id
       RETURNING id`,
      [employeeId,event.phoneNumberId,event.wabaId,event.contactWaId,event.contactUserId],
    );
    if (!conversation.rowCount) {
      await client.query("ROLLBACK");
      return "identity_mismatch";
    }
    if (event.relatedMessageId) {
      const original = await client.query(
        `SELECT id FROM whatsapp_employee_events
          WHERE conversation_id=$1 AND meta_message_id=$2 AND direction=$3 AND event_kind='message'
          LIMIT 1`,
        [conversation.rows[0].id,event.relatedMessageId,event.direction],
      );
      if (!original.rowCount) {
        await client.query(
          `INSERT INTO whatsapp_employee_audit (employee_id,action,phone_number_id,waba_id,meta_event_key,outcome)
           VALUES ($1,'webhook_event',$2,$3,$4,'unresolved_reference') ON CONFLICT DO NOTHING`,
          [employeeId,event.phoneNumberId,event.wabaId,event.eventKey],
        );
        if (event.kind !== "revoke") {
          // Edits without an original cannot be interpreted safely.
          await client.query("COMMIT");
          return "unresolved_reference";
        }
        // A signed revoke may arrive before its original message. Keep a
        // separate immutable revoke event so the archive can mark the
        // original whenever it arrives later, without rewriting its body.
      }
    }
    const saved = await client.query(
      `INSERT INTO whatsapp_employee_events
        (conversation_id, employee_id, meta_event_key, meta_message_id, event_kind, direction,
         event_status, message_type, message_text, source_field, occurred_at, related_message_id,
         media_mime_type, media_size_bytes, media_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         CASE WHEN $11::text ~ '^[0-9]+$' THEN to_timestamp($11::double precision) ELSE NULL END,
         $12,$13,$14,$15)
       ON CONFLICT (meta_event_key) DO NOTHING RETURNING id`,
      [conversation.rows[0].id, employeeId, event.eventKey, event.metaMessageId, event.kind,
       event.direction,event.eventStatus,event.messageType,event.text,event.sourceField,event.occurredAt,event.relatedMessageId,
       event.mediaMimeType,event.mediaSizeBytes,event.mediaSha256],
    );
    if (!saved.rowCount) {
      const winner = await client.query(
        `SELECT e.employee_id,c.phone_number_id,c.waba_id,c.contact_wa_id,c.contact_user_id
           FROM whatsapp_employee_events e JOIN whatsapp_employee_conversations c ON c.id=e.conversation_id
          WHERE e.meta_event_key=$1`,
        [event.eventKey],
      );
      const row = winner.rows[0];
      const sameIdentity = !!row && Number(row.employee_id) === employeeId &&
        row.phone_number_id === event.phoneNumberId && row.waba_id === event.wabaId &&
        row.contact_wa_id === event.contactWaId &&
        (!row.contact_user_id || !event.contactUserId || row.contact_user_id === event.contactUserId);
      if (!sameIdentity) {
        await client.query("ROLLBACK");
        return "identity_mismatch";
      }
    }
    await client.query(
      `INSERT INTO whatsapp_employee_audit (employee_id, action, phone_number_id, waba_id, meta_event_key, outcome)
       VALUES ($1, 'webhook_event', $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [employeeId, event.phoneNumberId, event.wabaId, event.eventKey, saved.rowCount ? "stored" : "duplicate"],
    );
    await client.query("COMMIT");
    return saved.rowCount ? "stored" : "duplicate";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


/**
 * Restricted Staging worker-consumer adapter. Requires a separately created
 * PRIVATE archive pool authenticating as kinglike_wa_archive_worker.
 * It NEVER registers HTTP routes, starts a worker, sends a Meta request or
 * connects to a database merely by being imported.
 */
export function createRestrictedStagingWhatsappEmployeeConsumer(
  db: Pick<pg.Pool,"connect">,
  env: NodeJS.ProcessEnv=process.env,
): null | ((raw:Buffer,scope:{
  employeeId:number;wabaId:string;phoneNumberId:string;displayPhoneNumber:string
})=>Promise<number>) {
  const required=[
    "WHATSAPP_EMPLOYEE_ARCHIVE_WORKER_ENABLED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED",
    "WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY",
    "WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY",
  ];
  if(env.APP_DEPLOYMENT_MODE!=="staging" ||
     !stagingDatabaseIsIsolated(env) ||
     required.some(flag=>env[flag]!=="true") ||
     !db || typeof db.connect!=="function")return null;

  return async(raw,scope)=>{
    const client=await db.connect();
    try {
      const v=await client.query([
        "SELECT current_database() AS db,current_user AS role,",
        "(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,",
        "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS owner,",
        "has_table_privilege(current_user,'whatsapp_employee_events','INSERT') AS can_insert,",
        "has_table_privilege(current_user,'whatsapp_employee_events','SELECT') AS can_read,",
        "has_table_privilege(current_user,'whatsapp_employee_events','UPDATE') AS can_update,",
        "has_table_privilege(current_user,'whatsapp_employee_events','DELETE') AS can_delete,",
        "has_table_privilege(current_user,'kinglike_whatsapp.whatsapp_employee_inbox','INSERT') AS inbox_insert,",
        "has_schema_privilege(current_user,'public','CREATE') AS can_create",
      ].join(" "));
      const r=v.rows[0]??{};
      if(r.db!=="kinglike_whatsapp_archive" ||
         r.role!=="kinglike_wa_archive_worker" ||
         r.role===r.owner || r.superuser!==false ||
         r.can_insert!==true || r.can_read!==true ||
         r.inbox_insert!==true ||
         r.can_update!==false || r.can_delete!==false ||
         r.can_create!==false)throw Error("Restricted archive worker role refused");
    } finally { client.release(); }
    return archiveScopedPayload(raw,scope,db);
  };
}

let testOnlyPool: pg.Pool | undefined;
export async function closeWhatsappEmployeeWebhookTestPool(): Promise<void> {
  if (!testOnlyPool) return;
  const pool = testOnlyPool;
  testOnlyPool = undefined;
  await pool.end();
}

function getTestOnlyPool(): pg.Pool {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Employee WhatsApp ingestion is restricted to isolated test processes.");
  }
  const connectionString = process.env.WHATSAPP_EMPLOYEE_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Dedicated WhatsApp employee test database is not configured.");
  const parsed = new URL(connectionString);
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (!loopback || !/(^|[_-])(test|testing)([_-]|$)/.test(databaseName)) {
    throw new Error("WhatsApp employee tests require a loopback database with a test-only name.");
  }
  return testOnlyPool ??= new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 1500 });
}

export function registerWhatsappEmployeeWebhook(app: Express): void {
  app.get(PATH, (req, res) => {
    if (!enabled()) return res.sendStatus(404);
    const verifyToken = process.env.WHATSAPP_EMPLOYEE_WEBHOOK_VERIFY_TOKEN;
    if (!verifyToken || req.query["hub.mode"] !== "subscribe" || req.query["hub.verify_token"] !== verifyToken) {
      return res.sendStatus(403);
    }
    return res.status(200).type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
  });

  app.post(PATH, async (req: any, res) => {
    if (!enabled()) return res.sendStatus(404);
    const secret = process.env.WHATSAPP_EMPLOYEE_META_APP_SECRET;
    if (!secret || !Buffer.isBuffer(req.rawBody) ||
        !verifyWhatsappSignature(req.rawBody, req.get("x-hub-signature-256"), secret)) {
      return res.sendStatus(401);
    }
    let payload: unknown;
    try { payload = JSON.parse(req.rawBody.toString("utf8")); }
    catch { return res.sendStatus(400); }
    const events = normalizeWhatsappWebhook(payload);
    try {
      for (const event of events) await persistEvent(event);
      return res.status(200).send("EVENT_RECEIVED");
    } catch {
      return res.sendStatus(500);
    }
  });
}
