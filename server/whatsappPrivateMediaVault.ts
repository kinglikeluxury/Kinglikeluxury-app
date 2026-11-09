/**
 * Employee WhatsApp private-media vault boundary.
 *
 * Dependency-injected, NO network/database/storage side effects on import.
 * Only trusted server code may provide an already-scoped media resolver and a
 * separate private encrypted-object storage adapter. No HTTP route is exposed.
 *
 * IMPORTANT: encrypted envelopes are server-private. NEVER send them to a
 * browser or write them to the shared CRM/Cloudinary/WhatsApp AI tables.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_EMPLOYEE_MEDIA_BYTES = 16 * 1024 * 1024;

export type EmployeeMediaScope = Readonly<{
  employeeId: number;
  conversationId: string;
  eventId: string;
  phoneNumberId: string;
}>;

export type PrivateMediaEnvelope = Readonly<{
  version: 1;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  iv: string;
  tag: string;
  ciphertext: string;
}>;

export type MediaOperation = "ingest" | "read";

export type PrivateMediaGate = {
  // Must recheck authenticated employee/supervisor access, consent and
  // exact business phone/conversation association on EVERY request.
  authorize(scope: EmployeeMediaScope, operation: MediaOperation): Promise<boolean>;
  // Must commit an append-only audit entry successfully BEFORE retrieval.
  audit(scope: EmployeeMediaScope, operation: MediaOperation, outcome: "allowed" | "denied"): Promise<void>;
};

export class EmployeeMediaUnavailable extends Error {
  constructor() {
    super("Employee media is unavailable");
    this.name = "EmployeeMediaUnavailable";
  }
}

const ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/webp",
  "video/mp4", "video/3gpp",
  "audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr",
  "application/pdf", "application/octet-stream",
]);

function fail(): never { throw new EmployeeMediaUnavailable(); }

function validatedScope(scope: EmployeeMediaScope): string {
  if (!scope || !Number.isSafeInteger(scope.employeeId) || scope.employeeId < 1 ||
      typeof scope.conversationId !== "string" || !/^[a-zA-Z0-9:_-]{1,100}$/.test(scope.conversationId) ||
      typeof scope.eventId !== "string" || !/^[a-zA-Z0-9:_-]{1,180}$/.test(scope.eventId) ||
      typeof scope.phoneNumberId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(scope.phoneNumberId)) fail();
  // Crypto AAD binds each object to employee, conversation, event and number.
  return JSON.stringify([scope.employeeId, scope.conversationId, scope.eventId, scope.phoneNumberId]);
}

function validatedKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
}

function validatedMime(mime: string): string {
  if (typeof mime !== "string" || !ALLOWED_MIME.has(mime.toLowerCase())) fail();
  return mime.toLowerCase();
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function sameDigest(actual: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

async function allowOrDeny(gate: PrivateMediaGate, scope: EmployeeMediaScope, operation: MediaOperation) {
  // Fails closed on authorization/audit exceptions. Denials are audited.
  const allowed = await gate.authorize(scope, operation);
  await gate.audit(scope, operation, allowed ? "allowed" : "denied");
  if (!allowed) fail();
}

export async function sealEmployeeMedia(input: {
  scope: EmployeeMediaScope;
  encryptionKey: Buffer;
  declaredMimeType: string;
  expectedSha256: string;
  gate: PrivateMediaGate;
  // This callback must retrieve media through a server-side, ID-bound Meta
  // adapter AFTER permission and audit; NEVER accept a webhook-supplied URL.
  retrieveTrustedMedia(): Promise<Buffer>;
}): Promise<PrivateMediaEnvelope> {
  const aad = validatedScope(input.scope);
  validatedKey(input.encryptionKey);
  const mimeType = validatedMime(input.declaredMimeType);
  if (!validDigest(input.expectedSha256)) fail();
  await allowOrDeny(input.gate, input.scope, "ingest");

  const data = await input.retrieveTrustedMedia();
  if (!Buffer.isBuffer(data) || data.byteLength < 1 || data.byteLength > MAX_EMPLOYEE_MEDIA_BYTES) fail();
  const digest = sha256(data);
  if (!sameDigest(digest, input.expectedSha256)) fail();

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", input.encryptionKey, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Object.freeze({
    version: 1 as const, mimeType, sizeBytes: data.length, sha256: digest,
    iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("base64"),
  });
}

export async function openEmployeeMedia(input: {
  scope: EmployeeMediaScope;
  encryptionKey: Buffer;
  envelope: PrivateMediaEnvelope;
  gate: PrivateMediaGate;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const aad = validatedScope(input.scope);
  validatedKey(input.encryptionKey);
  const envelope = input.envelope;
  if (!envelope || envelope.version !== 1 || !validDigest(envelope.sha256) ||
      !Number.isSafeInteger(envelope.sizeBytes) || envelope.sizeBytes < 1 ||
      envelope.sizeBytes > MAX_EMPLOYEE_MEDIA_BYTES ||
      typeof envelope.iv !== "string" || !/^[0-9a-f]{24}$/.test(envelope.iv) ||
      typeof envelope.tag !== "string" || !/^[0-9a-f]{32}$/.test(envelope.tag) ||
      typeof envelope.ciphertext !== "string" ||
      envelope.ciphertext.length > 4 * Math.ceil(MAX_EMPLOYEE_MEDIA_BYTES / 3) ||
      !/^[a-zA-Z0-9+/]+={0,2}$/.test(envelope.ciphertext)) fail();
  const mimeType = validatedMime(envelope.mimeType);
  await allowOrDeny(input.gate, input.scope, "read");

  try {
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    if (ciphertext.length !== envelope.sizeBytes) fail();
    const decipher = createDecipheriv("aes-256-gcm", input.encryptionKey, Buffer.from(envelope.iv, "hex"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
    const bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (!sameDigest(sha256(bytes), envelope.sha256)) fail();
    return { bytes, mimeType };
  } catch {
    // Never leak underlying decryption/provider errors to users.
    return fail();
  }
}
