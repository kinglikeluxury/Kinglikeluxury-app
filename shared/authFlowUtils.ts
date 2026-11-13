export type UniqueUserField = "email" | "username" | "phoneNumber";

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isOtpActive(
  record: { code: string; expiresAt: Date } | undefined,
  candidate: string,
  now = Date.now(),
): boolean {
  return Boolean(
    record &&
    /^\d{6}$/.test(candidate) &&
    record.code === candidate &&
    Number.isFinite(record.expiresAt.getTime()) &&
    now < record.expiresAt.getTime(),
  );
}

export function consumeOtpRecord(
  record: { code: string; expiresAt: Date; verified: boolean } | undefined,
  candidate: string,
  now = Date.now(),
): boolean {
  if (!record || record.verified || !isOtpActive(record, candidate, now)) return false;
  record.verified = true;
  return true;
}

export async function verifyStoredPassword(
  storedPassword: string | null | undefined,
  candidate: string,
  compareBcrypt: (plainText: string, hash: string) => Promise<boolean>,
): Promise<boolean> {
  if (!storedPassword) return false;
  if (storedPassword.startsWith("$2b$") || storedPassword.startsWith("$2a$")) {
    return compareBcrypt(candidate, storedPassword);
  }
  return storedPassword === candidate;
}

export function uniqueUserFieldFromError(error: unknown): UniqueUserField | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const dbError = current as { code?: unknown; constraint?: unknown; detail?: unknown; cause?: unknown };
    if (dbError.code === "23505") {
      const description = `${String(dbError.constraint ?? "")} ${String(dbError.detail ?? "")}`.toLowerCase();
      if (description.includes("email")) return "email";
      if (description.includes("username")) return "username";
      if (description.includes("phone_number") || description.includes("phonenumber")) return "phoneNumber";
    }
    current = dbError.cause;
  }
  return null;
}

export function registrationConflictResponse(field: UniqueUserField): {
  status: 409;
  body: { code: string; message: string };
} {
  if (field === "email") {
    return {
      status: 409,
      body: {
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account with this email already exists. Sign in or reset your password.",
      },
    };
  }
  if (field === "phoneNumber") {
    return {
      status: 409,
      body: { code: "PHONE_ALREADY_REGISTERED", message: "Phone number already registered." },
    };
  }
  return {
    status: 409,
    body: { code: "USERNAME_ALREADY_REGISTERED", message: "Username already exists." },
  };
}

const TURNSTILE_TEST_KEYS = new Set([
  "1x00000000000000000000aa",
  "2x00000000000000000000ab",
  "3x00000000000000000000ff",
]);
const TURNSTILE_TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000aa",
  "2x0000000000000000000000000000000ab",
  "3x0000000000000000000000000000000ff",
]);

export function isTurnstileTestSecret(value: unknown): boolean {
  return typeof value === "string" && TURNSTILE_TEST_SECRETS.has(value.trim().toLowerCase());
}

export function configuredTurnstileSiteKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!/^[a-zA-Z0-9_-]{20,128}$/.test(key) || TURNSTILE_TEST_KEYS.has(key.toLowerCase())) return null;
  return key;
}

export function parseHttpError(error: unknown): { status: number | null; code?: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(/^(\d{3}):\s*([\s\S]*)$/);
  if (!match) return { status: null };
  try {
    const body = JSON.parse(match[2]);
    return { status: Number(match[1]), code: typeof body.code === "string" ? body.code : undefined };
  } catch {
    return { status: Number(match[1]) };
  }
}
