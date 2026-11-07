import crypto from "node:crypto";
import type { Express } from "express";
import pg from "pg";

const PATH = "/api/webhooks/whatsapp-employee";
const enabled = () => process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED === "true";

export function verifyWhatsappSignature(raw: Buffer, header: unknown, appSecret: string): boolean {
  if (!Buffer.isBuffer(raw) || typeof header !== "string" || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(raw).digest("hex")}`;
  const supplied = Buffer.from(header, "utf8");
  const calculated = Buffer.from(expected, "utf8");
  return supplied.length === calculated.length && crypto.timingSafeEqual(supplied, calculated);
}

type NormalizedEvent = {
  eventKey: string; wabaId: string; phoneNumberId: string; contactWaId: string;
  kind: "message" | "status"; direction: "inbound" | "outbound" | "status";
  metaMessageId: string; eventStatus: string | null; messageType: string | null;
  text: string | null; occurredAt: string | null; sourceField: string;
};

export function isEligibleRegistration(
  registration: { is_active: boolean; consent_status: string; revoked_at: unknown; business_authorized_at: unknown; coexistence_enabled: boolean } | undefined,
  sourceField: string,
): boolean {
  return !!registration?.is_active &&
    registration.consent_status === "consented" &&
    !registration.revoked_at &&
    !!registration.business_authorized_at &&
    (sourceField !== "smb_message_echoes" || !!registration.coexistence_enabled);
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
      for (const msg of Array.isArray(value.messages) ? value.messages : []) {
        if (!msg?.id || !msg?.from) continue;
        const echo = field === "smb_message_echoes";
        const text = msg.type === "text" && typeof msg.text?.body === "string" ? msg.text.body : null;
        const ts = msg.timestamp ? String(msg.timestamp) : null;
        events.push({
          eventKey: `message:${msg.id}`, wabaId, phoneNumberId, contactWaId: String(msg.from),
          kind: "message", direction: echo ? "outbound" : "inbound", metaMessageId: String(msg.id),
          eventStatus: null, messageType: String(msg.type ?? "unknown"), text, occurredAt: ts, sourceField: field,
        });
      }
      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!status?.id || !status?.status || !status?.recipient_id) continue;
        const ts = status.timestamp ? String(status.timestamp) : null;
        events.push({
          eventKey: `status:${status.id}:${status.status}:${ts ?? ""}`, wabaId, phoneNumberId,
          contactWaId: String(status.recipient_id), kind: "status", direction: "status",
          metaMessageId: String(status.id), eventStatus: String(status.status), messageType: null,
          text: null, occurredAt: ts, sourceField: field,
        });
      }
    }
  }
  return events;
}

async function persistEvent(event: NormalizedEvent): Promise<"stored" | "duplicate" | "not_consented"> {
  const client = await getTestOnlyPool().connect();
  try {
    await client.query("BEGIN");
    const registration = await client.query(
      `SELECT n.employee_id, n.is_active, n.business_authorized_at, n.coexistence_enabled,
              c.status AS consent_status, c.revoked_at
         FROM whatsapp_employee_numbers n
         JOIN whatsapp_employee_consents c
           ON c.phone_number_id=n.phone_number_id AND c.employee_id=n.employee_id
        WHERE n.phone_number_id=$1 AND n.waba_id=$2
        LIMIT 1 FOR SHARE OF n, c`,
      [event.phoneNumberId, event.wabaId],
    );
    if (!isEligibleRegistration(registration.rows[0], event.sourceField)) {
      await client.query(
        `INSERT INTO whatsapp_employee_audit (action, phone_number_id, waba_id, meta_event_key, outcome)
         VALUES ('webhook_event', $1, $2, $3, 'not_consented') ON CONFLICT DO NOTHING`,
        [event.phoneNumberId, event.wabaId, event.eventKey],
      );
      await client.query("COMMIT");
      return "not_consented";
    }
    const employeeId = Number(registration.rows[0].employee_id);
    const conversation = await client.query(
      `INSERT INTO whatsapp_employee_conversations (employee_id, phone_number_id, waba_id, contact_wa_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (employee_id, phone_number_id, contact_wa_id)
       DO UPDATE SET updated_at=NOW()
       RETURNING id`,
      [employeeId, event.phoneNumberId, event.wabaId, event.contactWaId],
    );
    const saved = await client.query(
      `INSERT INTO whatsapp_employee_events
        (conversation_id, employee_id, meta_event_key, meta_message_id, event_kind, direction,
         event_status, message_type, message_text, source_field, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         CASE WHEN $11::text ~ '^[0-9]+$' THEN to_timestamp($11::double precision) ELSE NULL END)
       ON CONFLICT (meta_event_key) DO NOTHING RETURNING id`,
      [conversation.rows[0].id, employeeId, event.eventKey, event.metaMessageId, event.kind,
       event.direction, event.eventStatus, event.messageType, event.text, event.sourceField, event.occurredAt],
    );
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
