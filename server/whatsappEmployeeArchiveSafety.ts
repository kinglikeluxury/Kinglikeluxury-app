import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;

export type EncryptedArchiveValue = Readonly<{
  version: 1;
  nonce: string;
  ciphertext: string;
  tag: string;
}>;

export function parseArchiveEncryptionKey(value: string | undefined): Buffer | null {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key = Buffer.from(value, "base64");
  return key.length === KEY_BYTES && key.toString("base64") === value ? key : null;
}

export function encryptArchiveValue(plaintext: string, key: Buffer): EncryptedArchiveValue {
  if (key.length !== KEY_BYTES) throw new Error("Archive encryption key is invalid");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    version: 1,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptArchiveValue(value: EncryptedArchiveValue, key: Buffer): string {
  if (key.length !== KEY_BYTES || value.version !== 1) {
    throw new Error("Archive value cannot be decrypted");
  }
  const nonce = Buffer.from(value.nonce, "base64");
  const tag = Buffer.from(value.tag, "base64");
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Archive value cannot be decrypted");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export type ArchiveRuntimeDecision =
  | Readonly<{ enabled: true; retentionDays: number; encryptionKey: Buffer }>
  | Readonly<{ enabled: false; reason: "not_staging" | "not_approved" | "invalid_key" | "invalid_retention" }>;

export function getEmployeeArchiveRuntimeDecision(
  env: NodeJS.ProcessEnv,
): ArchiveRuntimeDecision {
  if (env.APP_DEPLOYMENT_MODE !== "staging") {
    return { enabled: false, reason: "not_staging" };
  }
  if (
    env.WHATSAPP_EMPLOYEE_ARCHIVE_ENABLED !== "true" ||
    env.WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED !== "true" ||
    env.WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED !== "true"
  ) {
    return { enabled: false, reason: "not_approved" };
  }
  const encryptionKey = parseArchiveEncryptionKey(env.WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY);
  if (!encryptionKey) return { enabled: false, reason: "invalid_key" };

  const rawRetention = env.WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_DAYS;
  if (!rawRetention || !/^[1-9]\d*$/.test(rawRetention)) {
    return { enabled: false, reason: "invalid_retention" };
  }
  const retentionDays = Number(rawRetention);
  if (
    !Number.isSafeInteger(retentionDays) ||
    retentionDays < MIN_RETENTION_DAYS ||
    retentionDays > MAX_RETENTION_DAYS
  ) {
    return { enabled: false, reason: "invalid_retention" };
  }
  return { enabled: true, retentionDays, encryptionKey };
}
