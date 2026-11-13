import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import {
  createPasswordRecoveryHandlers,
  type PasswordRecoveryStorage,
  type PasswordResetStore,
} from "./authPasswordRecoveryRoutes";

const email = "client@example.test";
const phoneNumber = "+995555000000";
const otp = "123456";
const user = {
  id: 17,
  username: "client",
  email,
  phoneNumber,
  password: "old-hash",
  authMethod: "email",
  isAdmin: false,
  role: "user",
} as any;
const genericAccepted = {
  code: "RECOVERY_REQUEST_ACCEPTED",
  message: "If an account exists, a code may be sent. We cannot confirm delivery; if it does not arrive, try again later.",
};

function fakeStorage(overrides: Partial<PasswordRecoveryStorage> = {}): PasswordRecoveryStorage {
  return {
    getUserByEmail: async () => user,
    getUserByPhone: async () => user,
    updateUserPassword: async (id) => ({ ...user, id }),
    ...overrides,
  };
}

async function startRecoveryHarness(
  t: TestContext,
  overrides: {
    storage?: PasswordRecoveryStorage;
    store?: PasswordResetStore;
    ipLimit?: "ok" | "rate_limited" | "blocked";
    requestAllowed?: boolean;
    verifyAllowed?: boolean;
    turnstile?: (token: string | undefined, ip: string) => Promise<boolean>;
    sms?: (phone: string, message: string) => Promise<boolean>;
    emailSend?: (address: string, code: string) => Promise<unknown>;
    now?: number;
  } = {},
) {
  const app = express();
  const store = overrides.store ?? new Map<string, { code: string; expiresAt: Date }>();
  const events = {
    sms: [] as Array<{ phone: string; message: string }>,
    email: [] as Array<{ address: string; code: string }>,
    turnstile: [] as Array<{ token: string | undefined; ip: string }>,
    logs: [] as unknown[],
    warnings: [] as unknown[],
    errors: [] as unknown[],
  };
  let now = overrides.now ?? Date.now();
  const handlers = createPasswordRecoveryHandlers({
    storage: overrides.storage ?? fakeStorage(),
    passwordResetStore: store,
    getClientIp: () => "127.0.0.9",
    checkIpOtpLimit: () => overrides.ipLimit ?? "ok",
    checkRequestRateLimit: () => overrides.requestAllowed ?? true,
    checkVerifyRateLimit: () => overrides.verifyAllowed ?? true,
    verifyTurnstile: async (token, ip) => {
      events.turnstile.push({ token, ip });
      return overrides.turnstile ? overrides.turnstile(token, ip) : true;
    },
    sendSms: async (phone, message) => {
      events.sms.push({ phone, message });
      return overrides.sms ? overrides.sms(phone, message) : true;
    },
    sendEmailOtp: async (address, code) => {
      events.email.push({ address, code });
      return overrides.emailSend ? overrides.emailSend(address, code) : undefined;
    },
    generateCode: () => otp,
    now: () => now,
    maskIdentifier: (identifier) => identifier.includes("@") ? "c***@example.test" : "****000",
    addOtpLog: (entry) => events.logs.push(entry),
    logWarning: (message, error) => events.warnings.push({ message, error }),
    logError: (message, error) => events.errors.push({ message, error }),
  });

  app.use(express.json());
  app.post("/api/auth/send-reset-otp", handlers.sendResetOtp);
  app.post("/api/auth/verify-reset-otp", handlers.verifyResetOtp);
  app.post("/api/auth/reset-password", handlers.resetPassword);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/auth`,
    store,
    events,
    advanceTime: (milliseconds: number) => { now += milliseconds; },
  };
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const sendEmailReset = (baseUrl: string, address = email) =>
  post(`${baseUrl}/send-reset-otp`, { method: "email", email: address, turnstileToken: "mock-token" });
const verifyEmailCode = (baseUrl: string, code: string) =>
  post(`${baseUrl}/verify-reset-otp`, { method: "email", email, code });
const resetEmailPassword = (baseUrl: string, code = otp, newPassword = "new-safe-password") =>
  post(`${baseUrl}/reset-password`, { method: "email", email, code, newPassword });

test("FORGOT HTTP gives the same generic response for existing and unknown email accounts", async (t) => {
  const existing = await startRecoveryHarness(t);
  const missing = await startRecoveryHarness(t, {
    storage: fakeStorage({ getUserByEmail: async () => undefined }),
  });
  const [knownResult, missingResult] = await Promise.all([
    sendEmailReset(existing.baseUrl),
    sendEmailReset(missing.baseUrl),
  ]);
  assert.equal(knownResult.status, 200);
  assert.deepEqual(knownResult.body, genericAccepted);
  assert.deepEqual(missingResult.body, genericAccepted);
  assert.equal(existing.events.email.length, 1);
  assert.equal(missing.events.email.length, 0);
  assert.equal(existing.store.has(`email:${email}`), true);
  assert.equal(missing.store.size, 0);
  assert.equal(JSON.stringify(knownResult.body).includes(email), false);
});

test("FORGOT HTTP reports generic acceptance but saves no OTP when delivery fails", async (t) => {
  const failed = await startRecoveryHarness(t, {
    emailSend: async () => { throw new Error("private mail provider detail"); },
  });
  const result = await sendEmailReset(failed.baseUrl);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, genericAccepted);
  assert.equal(failed.store.size, 0);
  assert.equal(JSON.stringify(result.body).includes("code sent successfully"), false);
  assert.equal(JSON.stringify(result.body).includes("private mail provider detail"), false);
  assert.equal(failed.events.warnings.length, 1);
});

test("FORGOT HTTP uses the mocked SMS-to-email fallback and stores only delivered codes", async (t) => {
  const fallback = await startRecoveryHarness(t, { sms: async () => false });
  const result = await post(`${fallback.baseUrl}/send-reset-otp`, {
    method: "phone",
    phoneNumber,
    turnstileToken: "mock-token",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, genericAccepted);
  assert.equal(fallback.events.sms.length, 1);
  assert.deepEqual(fallback.events.email[0], { address: email, code: otp });
  assert.equal(fallback.store.has(`phone:${phoneNumber}`), true);

  const noDelivery = await startRecoveryHarness(t, {
    sms: async () => false,
    emailSend: async () => { throw new Error("mail unavailable"); },
  });
  const failed = await post(`${noDelivery.baseUrl}/send-reset-otp`, {
    method: "phone",
    phoneNumber,
    turnstileToken: "mock-token",
  });
  assert.deepEqual(failed.body, genericAccepted);
  assert.equal(noDelivery.store.has(`phone:${phoneNumber}`), false);
});

test("FORGOT HTTP enforces Turnstile failures and fails closed on verifier errors", async (t) => {
  const rejected = await startRecoveryHarness(t, { turnstile: async () => false });
  const denied = await sendEmailReset(rejected.baseUrl);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "SECURITY_VALIDATION_FAILED");
  assert.equal(rejected.events.email.length, 0);

  const unavailable = await startRecoveryHarness(t, {
    turnstile: async () => { throw new Error("private verifier detail"); },
  });
  const failed = await sendEmailReset(unavailable.baseUrl);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.code, "RECOVERY_UNAVAILABLE");
  assert.equal(JSON.stringify(failed.body).includes("private verifier detail"), false);
});

test("FORGOT and VERIFY HTTP return 429 when their existing limit checks reject", async (t) => {
  const ipLimited = await startRecoveryHarness(t, { ipLimit: "rate_limited" });
  const requestLimit = await sendEmailReset(ipLimited.baseUrl);
  assert.equal(requestLimit.status, 429);
  assert.equal(ipLimited.events.turnstile.length, 0);

  const identifierLimited = await startRecoveryHarness(t, { requestAllowed: false });
  const request429 = await sendEmailReset(identifierLimited.baseUrl);
  assert.equal(request429.status, 429);

  const verifyLimited = await startRecoveryHarness(t, { verifyAllowed: false });
  const verify429 = await verifyEmailCode(verifyLimited.baseUrl, otp);
  assert.equal(verify429.status, 429);
  const reset429 = await resetEmailPassword(verifyLimited.baseUrl);
  assert.equal(reset429.status, 429);
});

test("VERIFY and RESET HTTP reject wrong, expired, and already-consumed codes", async (t) => {
  const harness = await startRecoveryHarness(t);
  harness.store.set(`email:${email}`, { code: otp, expiresAt: new Date(Date.now() + 60_000) });
  const wrong = await verifyEmailCode(harness.baseUrl, "654321");
  assert.equal(wrong.status, 400);
  const valid = await verifyEmailCode(harness.baseUrl, otp);
  assert.equal(valid.status, 200);
  assert.equal(harness.store.has(`email:${email}`), true);

  harness.advanceTime(11 * 60 * 1000);
  const expired = await verifyEmailCode(harness.baseUrl, otp);
  assert.equal(expired.status, 400);

  harness.advanceTime(-11 * 60 * 1000);
  const reset = await resetEmailPassword(harness.baseUrl);
  assert.equal(reset.status, 200);
  assert.equal(harness.store.has(`email:${email}`), false);
  const reused = await verifyEmailCode(harness.baseUrl, otp);
  assert.equal(reused.status, 400);
});

test("RESET HTTP consumes the code only after a confirmed password update", async (t) => {
  const store = new Map([[`email:${email}`, { code: otp, expiresAt: new Date(Date.now() + 60_000) }]]);
  let codePresentDuringUpdate = false;
  const harness = await startRecoveryHarness(t, {
    store,
    storage: fakeStorage({
      updateUserPassword: async () => {
        codePresentDuringUpdate = store.has(`email:${email}`);
        return { ...user };
      },
    }),
  });
  const result = await resetEmailPassword(harness.baseUrl);
  assert.equal(result.status, 200);
  assert.equal(codePresentDuringUpdate, true);
  assert.equal(store.has(`email:${email}`), false);
});

test("RESET HTTP retains a valid code and masks storage update failures", async (t) => {
  for (const updateUserPassword of [
    async () => { throw new Error("private database diagnostic"); },
    async () => undefined,
  ]) {
    const store = new Map([[`email:${email}`, { code: otp, expiresAt: new Date(Date.now() + 60_000) }]]);
    const harness = await startRecoveryHarness(t, {
      store,
      storage: fakeStorage({ updateUserPassword }),
    });
    const result = await resetEmailPassword(harness.baseUrl);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "RECOVERY_UNAVAILABLE");
    assert.equal(JSON.stringify(result.body).includes("private database diagnostic"), false);
    assert.equal(store.has(`email:${email}`), true);
  }
});

test("RESET HTTP returns generic success without consuming a code if the account disappeared", async (t) => {
  const store = new Map([[`email:${email}`, { code: otp, expiresAt: new Date(Date.now() + 60_000) }]]);
  const harness = await startRecoveryHarness(t, {
    store,
    storage: fakeStorage({ getUserByEmail: async () => undefined }),
  });
  const result = await resetEmailPassword(harness.baseUrl);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true });
  assert.equal(store.has(`email:${email}`), true);
});
