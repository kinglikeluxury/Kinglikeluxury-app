import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import {
  createRegisterHandler,
  type EmailRegistrationOtpStore,
  type RegistrationStorage,
} from "./authRegisterRoute";

const email = "client@example.test";
const phone = "+995555000000";
const futureOtp = () => ({ code: "123456", expiresAt: new Date(Date.now() + 60_000), verified: true });

function fakeStorage(overrides: Partial<RegistrationStorage> = {}): RegistrationStorage {
  let nextId = 1;
  return {
    getUserByUsername: async () => undefined,
    getUserByEmail: async () => undefined,
    getUserByPhone: async () => undefined,
    isPhoneVerified: async () => false,
    createUser: async (data) => ({
      ...data,
      id: nextId++,
      password: data.password ?? null,
      email: data.email ?? null,
      phoneNumber: data.phoneNumber ?? null,
      whatsappNumber: null,
      facebookId: null,
      authMethod: data.authMethod ?? "phone",
      isVerified: true,
      isAdmin: false,
      isActive: true,
      role: "user",
      createdAt: new Date(),
    }),
    ...overrides,
  };
}

async function startRegisterHttpHarness(
  t: TestContext,
  options: {
    storage?: RegistrationStorage;
    emailOtpStore?: EmailRegistrationOtpStore;
  } = {},
) {
  const app = express();
  const fakeSession: Record<string, unknown> = {};
  const storage = options.storage ?? fakeStorage();
  const emailOtpStore = options.emailOtpStore ?? new Map();
  let welcomeEmailCalls = 0;
  let welcomeWhatsAppCalls = 0;
  const appErrors: unknown[] = [];

  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = fakeSession;
    next();
  });
  app.post(
    "/api/auth/register",
    createRegisterHandler({
      storage,
      emailOtpStore,
      sendWelcomeEmail: async () => { welcomeEmailCalls += 1; },
      sendWelcomeWhatsApp: async () => { welcomeWhatsAppCalls += 1; },
      logError: (error) => appErrors.push(error),
    }),
  );

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/api/auth/register`,
    fakeSession,
    emailOtpStore,
    appErrors,
    get notifications() { return { welcomeEmailCalls, welcomeWhatsAppCalls }; },
  };
}

async function postRegister(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function validRegistration(overrides: Record<string, unknown> = {}) {
  return {
    username: "new-client",
    password: "a-safe-test-password",
    email,
    phoneNumber: phone,
    authMethod: "email",
    ...overrides,
  };
}

async function mockedPhoneVerification(turnstileAccepted: boolean, otpAccepted: boolean) {
  const turnstile = async () => turnstileAccepted;
  const smsOtp = async () => otpAccepted;
  return (await turnstile()) && (await smsOtp());
}

test("REGISTER HTTP succeeds with mocked prior Turnstile and OTP proof", async (t) => {
  const verifiedPhone = await mockedPhoneVerification(true, true);
  const harness = await startRegisterHttpHarness(t, {
    storage: fakeStorage({ isPhoneVerified: async () => verifiedPhone }),
  });
  const result = await postRegister(harness.url, validRegistration());
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {
    id: 1,
    username: "new-client",
    authMethod: "email",
    isAdmin: false,
    email,
    phoneNumber: phone,
  });
  assert.deepEqual(harness.fakeSession, { userId: 1, isAdmin: false, role: "user" });
  assert.deepEqual(harness.notifications, { welcomeEmailCalls: 1, welcomeWhatsAppCalls: 1 });
});

test("REGISTER HTTP consumes a verified email OTP after successful creation", async (t) => {
  const emailOtpStore = new Map([[email, futureOtp()]]);
  const harness = await startRegisterHttpHarness(t, { emailOtpStore });
  const result = await postRegister(harness.url, validRegistration());
  assert.equal(result.status, 201);
  assert.equal(harness.emailOtpStore.has(email), false);
});

test("REGISTER HTTP rejects missing, expired, and unverified OTP proof", async (t) => {
  const missing = await startRegisterHttpHarness(t);
  const missingResult = await postRegister(missing.url, validRegistration());
  assert.equal(missingResult.status, 400);

  const expiredStore = new Map([[email, {
    code: "123456",
    expiresAt: new Date(Date.now() - 1),
    verified: true,
  }]]);
  const expired = await startRegisterHttpHarness(t, { emailOtpStore: expiredStore });
  const expiredResult = await postRegister(expired.url, validRegistration());
  assert.equal(expiredResult.status, 400);
  assert.equal(expired.emailOtpStore.has(email), true);

  const noPhoneOrEmailProof = await startRegisterHttpHarness(t);
  const noProofResult = await postRegister(noPhoneOrEmailProof.url, validRegistration({
    phoneNumber: undefined,
    authMethod: "email",
  }));
  assert.equal(noProofResult.status, 400);
});

test("REGISTER HTTP returns 409 for an existing email without creating or changing records", async (t) => {
  let createCalls = 0;
  const store = fakeStorage({
    isPhoneVerified: async () => true,
    getUserByEmail: async () => ({ id: 88 } as any),
    createUser: async () => { createCalls += 1; throw new Error("must not create"); },
  });
  const harness = await startRegisterHttpHarness(t, { storage: store });
  const result = await postRegister(harness.url, validRegistration());
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "EMAIL_ALREADY_REGISTERED");
  assert.equal(createCalls, 0);
});

test("REGISTER HTTP maps a concurrent duplicate-email insert to one 409, not 500", async (t) => {
  let emailLookups = 0;
  let releaseLookups!: () => void;
  const bothLookedUp = new Promise<void>((resolve) => { releaseLookups = resolve; });
  const created = new Set<string>();
  let nextId = 1;
  const store = fakeStorage({
    isPhoneVerified: async () => true,
    getUserByEmail: async () => {
      emailLookups += 1;
      if (emailLookups === 2) releaseLookups();
      await bothLookedUp;
      return undefined;
    },
    createUser: async (data) => {
      if (data.email && created.has(data.email)) {
        throw { code: "23505", constraint: "users_email_unique" };
      }
      if (data.email) created.add(data.email);
      return { ...await fakeStorage().createUser(data), id: nextId++ };
    },
  });
  const harness = await startRegisterHttpHarness(t, { storage: store });
  const [first, second] = await Promise.all([
    postRegister(harness.url, validRegistration({ username: "client-a" })),
    postRegister(harness.url, validRegistration({ username: "client-b" })),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [201, 409]);
  const conflict = first.status === 409 ? first : second;
  assert.equal(conflict.body.code, "EMAIL_ALREADY_REGISTERED");
  assert.equal(JSON.stringify(conflict.body).includes(email), false);
});

test("REGISTER HTTP returns safe unique-conflict responses for username and phone races", async (t) => {
  for (const conflict of [
    { constraint: "users_username_unique", expectedCode: "USERNAME_ALREADY_REGISTERED" },
    { constraint: "users_phone_number_unique", expectedCode: "PHONE_ALREADY_REGISTERED" },
  ]) {
    const harness = await startRegisterHttpHarness(t, {
      storage: fakeStorage({
        isPhoneVerified: async () => true,
        createUser: async () => { throw { code: "23505", constraint: conflict.constraint }; },
      }),
    });
    const result = await postRegister(harness.url, validRegistration());
    assert.equal(result.status, 409);
    assert.equal(result.body.code, conflict.expectedCode);
    assert.equal(JSON.stringify(result.body).includes("23505"), false);
  }
});

test("REGISTER HTTP fails closed on verification/storage errors without leaking diagnostics", async (t) => {
  const turnstileRejectedProof = await mockedPhoneVerification(false, true);
  const noProof = await startRegisterHttpHarness(t, {
    storage: fakeStorage({ isPhoneVerified: async () => turnstileRejectedProof }),
  });
  const denied = await postRegister(noProof.url, validRegistration());
  assert.equal(denied.status, 400);

  const failingStore = await startRegisterHttpHarness(t, {
    storage: fakeStorage({
      isPhoneVerified: async () => { throw new Error("private provider secret"); },
    }),
  });
  const failed = await postRegister(failingStore.url, validRegistration());
  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, "REGISTRATION_UNAVAILABLE");
  assert.equal(JSON.stringify(failed.body).includes("private provider secret"), false);
  assert.equal(failingStore.appErrors.length, 1);
});
