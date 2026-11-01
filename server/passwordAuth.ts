import bcrypt from "bcrypt";

export async function verifyStoredPassword(
  candidate: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("$2a$") || stored.startsWith("$2b$")) {
    return bcrypt.compare(candidate, stored);
  }
  // Preserve existing legacy credentials without rehashing or migrating them.
  return stored === candidate;
}
