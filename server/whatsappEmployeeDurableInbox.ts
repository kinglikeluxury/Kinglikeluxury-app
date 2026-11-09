/**
 * Encrypted, at-least-once employee WhatsApp inbox. No startup hooks, HTTP
 * routes, Meta calls, secrets or DB connections are created on import.
 *
 * The caller must supply a dedicated least-privilege archive DB and secrets.
 * Never ACK an incoming Meta webhook until enqueueSigned() commits successfully.
 * The consumer MUST deduplicate each Meta message/event, because worker crashes
 * after archive commit can legitimately cause at-least-once redelivery.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { verifyWhatsappSignature } from "./whatsappEmployeeWebhook";

const TABLE = "kinglike_whatsapp.whatsapp_employee_inbox";
export const EMPLOYEE_WEBHOOK_MAX_BYTES = 1024 * 1024;

export type EmployeeInboxScope = Readonly<{
  employeeId: number;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
}>;
export type InboxJobStatus = "empty" | "processed" | "retry" | "dead_letter" | "blocked";
export class EmployeeInboxRejected extends Error {
  constructor() { super("Employee WhatsApp inbox operation rejected"); this.name = "EmployeeInboxRejected"; }
}
type Db = Pick<Pool, "query">;
type AccessGate = (scope: EmployeeInboxScope) => Promise<boolean>;
type Consumer = (rawBody: Buffer, scope: EmployeeInboxScope) => Promise<void>;

export type InboxDependencies = Readonly<{
  db: Db;
  encryptionKey: Buffer; // 32-byte AES-256-GCM key.
  dedupeKey: Buffer; // INDEPENDENT 32-byte HMAC key.
  metaAppSecret: string;
  authorizeScope: AccessGate;
  consume: Consumer;
  maxAttempts?: number;
  leaseSeconds?: number;
}>;

type ClaimedJob = {
  id: string;
  employee_id: number;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string;
  delivery_key: string;
  payload_ciphertext: Buffer;
  payload_iv: Buffer;
  payload_tag: Buffer;
  attempt_count: number;
  lease_token: string;
};

function reject(): never { throw new EmployeeInboxRejected(); }

function checkScope(scope: EmployeeInboxScope): void {
  if (!scope || !Number.isSafeInteger(scope.employeeId) || scope.employeeId < 1 ||
      !/^[0-9]{4,24}$/.test(scope.wabaId) ||
      !/^[0-9]{4,24}$/.test(scope.phoneNumberId) ||
      !/^[0-9]{8,24}$/.test(scope.displayPhoneNumber)) reject();
}

function checkSecret(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) reject();
}

function matchesSignedPayload(raw: Buffer, scope: EmployeeInboxScope): boolean {
  let payload: any;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { return false; }
  if (payload?.object !== "whatsapp_business_account" ||
      !Array.isArray(payload.entry) || payload.entry.length < 1 ||
      payload.entry.length > 20) return false;
  let relevant = 0;
  const kinds = new Set(["messages", "smb_message_echoes", "history"]);
  for (const entry of payload.entry) {
    if (entry?.id !== scope.wabaId || !Array.isArray(entry.changes) ||
        entry.changes.length > 50) return false;
    for (const change of entry.changes) {
      if (!kinds.has(change?.field)) continue;
      const meta = change?.value?.metadata;
      if (meta?.phone_number_id !== scope.phoneNumberId ||
          (meta.display_phone_number !== undefined &&
           String(meta.display_phone_number).replace(/\D/g,"") !== scope.displayPhoneNumber)) return false;
      relevant++;
    }
  }
  return relevant > 0;
}

function aad(scope: EmployeeInboxScope, deliveryKey: string): Buffer {
  return Buffer.from(JSON.stringify([
    scope.employeeId, scope.wabaId, scope.phoneNumberId,
    scope.displayPhoneNumber, deliveryKey,
  ]), "utf8");
}

export function createEmployeeWhatsappDurableInbox(deps: InboxDependencies) {
  checkSecret(deps.encryptionKey);
  checkSecret(deps.dedupeKey);
  if (deps.encryptionKey.equals(deps.dedupeKey) ||
      !deps.metaAppSecret || typeof deps.metaAppSecret !== "string" ||
      !deps.db || typeof deps.db.query !== "function" ||
      typeof deps.authorizeScope !== "function" ||
      typeof deps.consume !== "function") reject();
  const maxAttempts = deps.maxAttempts ?? 6;
  const leaseSeconds = deps.leaseSeconds ?? 60;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 ||
      !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 600) reject();

  async function enqueueSigned(raw: Buffer, signature: unknown, scope: EmployeeInboxScope):
    Promise<"accepted" | "duplicate"> {
    checkScope(scope);
    if (!Buffer.isBuffer(raw) || raw.length < 1 || raw.length > EMPLOYEE_WEBHOOK_MAX_BYTES ||
        !verifyWhatsappSignature(raw,signature,deps.metaAppSecret) ||
        !matchesSignedPayload(raw,scope)) reject();
    if (!(await deps.authorizeScope(scope))) reject();

    // Keyed digest avoids exposing hash of private message text to DB readers.
    const deliveryKey = createHmac("sha256",deps.dedupeKey)
      .update(aad(scope,"raw")).update(raw).digest("hex");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm",deps.encryptionKey,iv);
    cipher.setAAD(aad(scope,deliveryKey));
    const encrypted = Buffer.concat([cipher.update(raw),cipher.final()]);
    const digestTag = cipher.getAuthTag();
    const query = [
      "INSERT INTO "+TABLE,
      "(employee_id,waba_id,phone_number_id,display_phone_number,delivery_key,",
      "payload_ciphertext,payload_iv,payload_tag)",
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      "ON CONFLICT (employee_id,waba_id,phone_number_id,delivery_key)",
      "DO NOTHING RETURNING id",
    ].join(" ");
    const result = await deps.db.query(query,[
      scope.employeeId,scope.wabaId,scope.phoneNumberId,scope.displayPhoneNumber,
      deliveryKey,encrypted,iv,digestTag,
    ]);
    return result.rowCount === 1 ? "accepted" : "duplicate";
  }

  async function claim(): Promise<ClaimedJob | null> {
    const token = randomUUID();
    const query = [
      "WITH next_job AS (",
      "SELECT id FROM "+TABLE,
      "WHERE ((status IN ('pending','retry') AND available_at<=now())",
      "OR (status='processing' AND locked_until<now()))",
      "ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)",
      "UPDATE "+TABLE+" j SET status='processing',attempt_count=j.attempt_count+1,",
      "lease_token=$1::uuid,locked_until=now()+($2::int * interval '1 second')",
      "FROM next_job WHERE j.id=next_job.id RETURNING",
      "j.id,j.employee_id,j.waba_id,j.phone_number_id,j.display_phone_number,",
      "j.delivery_key,j.payload_ciphertext,j.payload_iv,j.payload_tag,",
      "j.attempt_count,j.lease_token",
    ].join(" ");
    const result = await deps.db.query(query,[token,leaseSeconds]);
    return (result.rows?.[0] as ClaimedJob | undefined) ?? null;
  }

  async function markProcessed(job: ClaimedJob): Promise<void> {
    const result = await deps.db.query(
      "UPDATE "+TABLE+
      " SET status='processed',processed_at=now(),locked_until=NULL,lease_token=NULL,"+
      " payload_ciphertext=NULL,payload_iv=NULL,payload_tag=NULL,last_error_class=NULL"+
      " WHERE id=$1 AND lease_token=$2::uuid AND status='processing' RETURNING id",
      [job.id,job.lease_token],
    );
    if (result.rowCount !== 1) reject();
  }

  async function reschedule(job: ClaimedJob,status: "blocked" | "retry" | "dead_letter",
    reason: "CONSENT_REVOKED" | "PROCESS_FAILED" | "DECRYPT_FAILED"): Promise<void> {
    const waitSeconds = status === "retry" ? Math.min(3600,2**Math.min(job.attempt_count,12)) : 0;
    const result = await deps.db.query(
      "UPDATE "+TABLE+" SET status=$3,locked_until=NULL,lease_token=NULL,"+
      " available_at=now()+($4::int * interval '1 second'),last_error_class=$5"+
      " WHERE id=$1 AND lease_token=$2::uuid AND status='processing' RETURNING id",
      [job.id,job.lease_token,status,waitSeconds,reason],
    );
    if (result.rowCount !== 1) reject();
  }

  async function processOne(): Promise<InboxJobStatus> {
    const job = await claim();
    if (!job) return "empty";
    const scope: EmployeeInboxScope = {
      employeeId:Number(job.employee_id),wabaId:job.waba_id,
      phoneNumberId:job.phone_number_id,displayPhoneNumber:job.display_phone_number,
    };
    let raw: Buffer | null = null;
    let errorClass: "PROCESS_FAILED" | "DECRYPT_FAILED" = "PROCESS_FAILED";
    try {
      checkScope(scope);
      // Reauthorize after the queue delay, even if the sender was initially valid.
      if (!(await deps.authorizeScope(scope))) {
        await reschedule(job,"blocked","CONSENT_REVOKED");
        return "blocked";
      }
      if (!Buffer.isBuffer(job.payload_iv) || job.payload_iv.length!==12 ||
          !Buffer.isBuffer(job.payload_tag) || job.payload_tag.length!==16 ||
          !Buffer.isBuffer(job.payload_ciphertext)) reject();
      errorClass = "DECRYPT_FAILED";
      const decipher = createDecipheriv("aes-256-gcm",deps.encryptionKey,job.payload_iv);
      decipher.setAAD(aad(scope,job.delivery_key));
      decipher.setAuthTag(job.payload_tag);
      raw = Buffer.concat([decipher.update(job.payload_ciphertext),decipher.final()]);
      errorClass = "PROCESS_FAILED";
      // The caller must commit its idempotent archive before this resolves.
      await deps.consume(raw,scope);
      await markProcessed(job);
      return "processed";
    } catch {
      const status = job.attempt_count >= maxAttempts ? "dead_letter" : "retry";
      await reschedule(job,status,errorClass);
      return status;
    } finally {
      raw?.fill(0);
    }
  }

  return Object.freeze({enqueueSigned,processOne});
}
