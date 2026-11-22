import crypto from "node:crypto";

export type MetaTokenBinding = Readonly<{
  requestId: number;
  employeeId: number;
  businessId: string;
  wabaId: string;
  phoneNumberId: string;
}>;

export type EncryptedMetaToken = Readonly<{
  keyVersion: "meta-token-v1";
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}>;

const META_ID = /^[0-9]{1,40}$/;

export function parseMetaTokenEncryptionKey(value: string | undefined): Buffer | null {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 && key.toString("base64") === value ? key : null;
}

function aad(binding: MetaTokenBinding, keyVersion: string): Buffer {
  if (!Number.isSafeInteger(binding.requestId) || binding.requestId < 1 ||
      !Number.isSafeInteger(binding.employeeId) || binding.employeeId < 1 ||
      !META_ID.test(binding.businessId) || !META_ID.test(binding.wabaId) ||
      !META_ID.test(binding.phoneNumberId)) {
    throw new Error("meta_token_binding_invalid");
  }
  return Buffer.from([
    "kinglike-staging-meta-token",
    keyVersion,
    String(binding.requestId),
    String(binding.employeeId),
    binding.businessId,
    binding.wabaId,
    binding.phoneNumberId,
  ].join("\0"), "utf8");
}

export function encryptMetaAccessToken(
  token: string,
  key: Buffer,
  binding: MetaTokenBinding,
): EncryptedMetaToken {
  if (!Buffer.isBuffer(key) || key.length !== 32 ||
      typeof token !== "string" || token.length < 8 || token.length > 8192) {
    throw new Error("meta_token_input_invalid");
  }
  const keyVersion = "meta-token-v1" as const;
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(binding, keyVersion));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return { keyVersion, nonce, ciphertext, authTag: cipher.getAuthTag() };
}

export function decryptMetaAccessToken(
  encrypted: EncryptedMetaToken,
  key: Buffer,
  binding: MetaTokenBinding,
): string {
  if (!Buffer.isBuffer(key) || key.length !== 32 ||
      encrypted.keyVersion !== "meta-token-v1" ||
      !Buffer.isBuffer(encrypted.nonce) || encrypted.nonce.length !== 12 ||
      !Buffer.isBuffer(encrypted.authTag) || encrypted.authTag.length !== 16 ||
      !Buffer.isBuffer(encrypted.ciphertext) ||
      encrypted.ciphertext.length < 8 || encrypted.ciphertext.length > 8192) {
    throw new Error("meta_token_ciphertext_invalid");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, encrypted.nonce);
  decipher.setAAD(aad(binding, encrypted.keyVersion));
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
