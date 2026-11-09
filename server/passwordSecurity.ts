import bcrypt from "bcrypt";
import { createHash, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = /^\$2[aby]\$\d{2}\$/;
const MAX_PASSWORD_LENGTH = 1024;

/** New credentials are never persisted as readable passwords. */
export async function hashAccountPassword(password: unknown): Promise<string> {
  if (typeof password !== "string" || password.length < 8 ||
      password.length > MAX_PASSWORD_LENGTH) throw new Error("Invalid password");
  return bcrypt.hash(password, 12);
}

/**
 * Compatibility for old un-hashed records already present in the database.
 * This MUST NOT be used to persist new plaintext passwords.
 */
export async function verifyAccountPassword(
  supplied: unknown,
  saved: unknown,
): Promise<boolean> {
  if (typeof supplied !== "string" || typeof saved !== "string" ||
      !supplied.length || supplied.length > MAX_PASSWORD_LENGTH || !saved.length) {
    return false;
  }
  if (HASH_PREFIX.test(saved)) {
    try { return await bcrypt.compare(supplied, saved); } catch { return false; }
  }
  // Legacy plaintext comparison without a fast-exit string equality check.
  const candidateDigest = createHash("sha256").update(supplied, "utf8").digest();
  const storedDigest = createHash("sha256").update(saved, "utf8").digest();
  return timingSafeEqual(candidateDigest, storedDigest);
}

export function needsLegacyPasswordUpgrade(saved: unknown): boolean {
  return typeof saved === "string" && saved.length > 0 && !HASH_PREFIX.test(saved);
}
