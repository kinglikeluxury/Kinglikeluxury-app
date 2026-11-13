import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredTurnstileSiteKey,
  consumeOtpRecord,
  isOtpActive,
  isTurnstileTestSecret,
  normalizeAuthEmail,
  parseHttpError,
  registrationConflictResponse,
  uniqueUserFieldFromError,
  verifyStoredPassword,
} from "./authFlowUtils";

test("normalizes email identifiers consistently", () => {
  assert.equal(normalizeAuthEmail("  PERSON@Example.COM "), "person@example.com");
});

test("OTP validation rejects wrong, malformed, and expired values", () => {
  const now = 1_000_000;
  const active = { code: "123456", expiresAt: new Date(now + 60_000) };
  assert.equal(isOtpActive(active, "123456", now), true);
  assert.equal(isOtpActive(active, "12345", now), false);
  assert.equal(isOtpActive(active, "654321", now), false);
  assert.equal(isOtpActive(active, "123456", now + 60_000), false);
});

test("consumes an OTP exactly once and rejects expired records", () => {
  const now = 1_000_000;
  const active = { code: "123456", expiresAt: new Date(now + 60_000), verified: false };
  assert.equal(consumeOtpRecord(active, "123456", now), true);
  assert.equal(consumeOtpRecord(active, "123456", now), false);
  assert.equal(consumeOtpRecord({ ...active, verified: false }, "123456", now + 60_000), false);
});

test("password verification rejects missing accounts and preserves legacy and bcrypt checks", async () => {
  let compared = false;
  const compare = async (plainText: string, hash: string) => {
    compared = true;
    return plainText === "password" && hash === "$2b$hash";
  };
  assert.equal(await verifyStoredPassword(undefined, "password", compare), false);
  assert.equal(compared, false);
  assert.equal(await verifyStoredPassword("legacy-password", "legacy-password", compare), true);
  assert.equal(await verifyStoredPassword("$2b$hash", "password", compare), true);
});

test("maps database unique conflicts to safe validation fields", () => {
  assert.equal(uniqueUserFieldFromError({ code: "23505", constraint: "users_email_unique" }), "email");
  assert.equal(uniqueUserFieldFromError({ cause: { code: "23505", constraint: "users_email_unique" } }), "email");
  assert.equal(uniqueUserFieldFromError({ code: "23505", constraint: "users_username_unique" }), "username");
  assert.equal(uniqueUserFieldFromError({ code: "23505", constraint: "users_phone_number_unique" }), "phoneNumber");
  assert.equal(uniqueUserFieldFromError({ code: "23505", constraint: "other_unique" }), null);
  assert.equal(uniqueUserFieldFromError({ code: "42P01", constraint: "users_email_unique" }), null);
});

test("returns consistent 409 validation responses for registration conflicts", () => {
  assert.deepEqual(registrationConflictResponse("email"), {
    status: 409,
    body: {
      code: "EMAIL_ALREADY_REGISTERED",
      message: "An account with this email already exists. Sign in or reset your password.",
    },
  });
  assert.equal(registrationConflictResponse("phoneNumber").status, 409);
  assert.equal(registrationConflictResponse("username").body.code, "USERNAME_ALREADY_REGISTERED");
});

test("rejects missing and known Turnstile test keys", () => {
  assert.equal(configuredTurnstileSiteKey(undefined), null);
  assert.equal(configuredTurnstileSiteKey("  "), null);
  assert.equal(configuredTurnstileSiteKey("1x00000000000000000000AA"), null);
  assert.equal(configuredTurnstileSiteKey("0123456789abcdef0123456789abcdef01234567"), "0123456789abcdef0123456789abcdef01234567");
  assert.equal(isTurnstileTestSecret("1x0000000000000000000000000000000AA"), true);
  assert.equal(isTurnstileTestSecret("real-secret-value"), false);
});

test("parses API status and safe machine-readable error code", () => {
  assert.deepEqual(
    parseHttpError(new Error('429: {"code":"RATE_LIMITED","message":"wait"}')),
    { status: 429, code: "RATE_LIMITED" },
  );
  assert.deepEqual(
    parseHttpError(new Error('403: {"code":"SECURITY_VALIDATION_FAILED"}')),
    { status: 403, code: "SECURITY_VALIDATION_FAILED" },
  );
  assert.deepEqual(parseHttpError(new Error("network failed")), { status: null });
});
