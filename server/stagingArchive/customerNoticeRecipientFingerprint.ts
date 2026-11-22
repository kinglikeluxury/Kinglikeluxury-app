import crypto from "node:crypto";

export const CUSTOMER_NOTICE_RECIPIENT_HMAC_ENV =
  "WHATSAPP_ARCHIVE_STAGING_NOTICE_RECIPIENT_HMAC_KEY";

export function parseCustomerNoticeRecipientHmacKey(value: unknown): Buffer | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 && key.toString("base64") === value ? key : null;
}

export function fingerprintCustomerNoticeRecipient(
  recipientId: string,
  key: Buffer,
): Buffer | null {
  const normalized = recipientId.replace(/\D/g, "");
  if (!/^[0-9]{5,40}$/.test(normalized) ||
      !Buffer.isBuffer(key) || key.length !== 32) return null;
  return crypto.createHmac("sha256", key).update(normalized, "utf8").digest();
}
