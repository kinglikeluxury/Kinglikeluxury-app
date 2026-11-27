import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { createLoginHandler, type LoginStorage } from "./authLoginRoute";
import { bindPhoneOtpLoginChallenge } from "./phoneOtpProof";

const user = {
  id: 41,
  username: "agent",
  password: "correct-password",
  email: "agent@example.test",
  phoneNumber: "+995555000000",
  whatsappNumber: null,
  facebookId: null,
  authMethod: "email",
  isAdmin: true,
  role: "admin",
  isActive: true,
  isVerified: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

function fakeStorage(overrides: Partial<LoginStorage> = {}): LoginStorage {
  return {
    getUserByUsername: async () => user,
    getUserByEmail: async () => user,
    getUserByPhone: async () => user,
    verifyCode: async () => false,
    ...overrides,
  };
}

async function startLoginHttpHarness(
  t: TestContext,
  storage: LoginStorage,
  regenerateError?: Error,
  allowPhoneOtpAttempt: () => boolean | Promise<boolean> = () => true,
) {
  const app = express();
  const fakeSession: Record<string, unknown> = {};
  let sessionId = "anonymous-session";
  let regenerateCalls = 0;
  Object.defineProperty(fakeSession, "regenerate", {
    enumerable: false,
    value: (callback: (error?: Error | null) => void) => {
      regenerateCalls += 1;
      if (regenerateError) {
        callback(regenerateError);
        return;
      }
      for (const key of Object.keys(fakeSession)) delete fakeSession[key];
      sessionId = `rotated-session-${regenerateCalls}`;
      callback(null);
    },
  });
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = fakeSession;
    next();
  });
  app.post(
    "/api/auth/login",
    createLoginHandler({
      storage,
      comparePassword: async (plainText, hash) => plainText === hash,
      allowPhoneOtpAttempt,
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
    url: `http://127.0.0.1:${address.port}/api/auth/login`,
    fakeSession,
    get sessionId() { return sessionId; },
    get regenerateCalls() { return regenerateCalls; },
  };
}

async function postLogin(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("LOGIN HTTP returns 401 for an unknown account, not 500", async (t) => {
  const harness = await startLoginHttpHarness(t, fakeStorage({
    getUserByUsername: async () => undefined,
  }));
  const result = await postLogin(harness.url, { username: "missing", password: "guess" });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { message: "Invalid login credentials." });
});

test("LOGIN HTTP returns 401 for a wrong password", async (t) => {
  const harness = await startLoginHttpHarness(t, fakeStorage());
  const result = await postLogin(harness.url, { username: "agent", password: "wrong" });
  assert.equal(result.status, 401);
  assert.deepEqual(result.body, { message: "Invalid login credentials." });
});

test("LOGIN HTTP succeeds and writes the existing session identity and role", async (t) => {
  const harness = await startLoginHttpHarness(t, fakeStorage());
  const oldSessionId = harness.sessionId;
  const result = await postLogin(harness.url, { username: "agent", password: "correct-password" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    id: 41,
    username: "agent",
    authMethod: "email",
    isAdmin: true,
    role: "admin",
    email: "agent@example.test",
    phoneNumber: "+995555000000",
  });
  assert.deepEqual(harness.fakeSession, { userId: 41, isAdmin: true, role: "admin" });
  assert.notEqual(harness.sessionId, oldSessionId);
  assert.equal(harness.regenerateCalls, 1);
});

test("LOGIN rejects inactive and unverified accounts without creating an authenticated session", async (t) => {
  for (const account of [
    { ...user, isActive: false },
    { ...user, isVerified: false },
    { ...user, isVerified: null } as any,
  ]) {
    const harness = await startLoginHttpHarness(t, fakeStorage({
      getUserByUsername: async () => account,
    }));
    const oldSessionId = harness.sessionId;
    const result = await postLogin(harness.url, {
      username: "agent",
      password: "correct-password",
    });
    assert.equal(result.status, 401);
    assert.deepEqual(harness.fakeSession, {});
    assert.equal(harness.sessionId, oldSessionId);
    assert.equal(harness.regenerateCalls, 0);
  }
});

test("LOGIN fails closed if session regeneration fails", async (t) => {
  const harness = await startLoginHttpHarness(
    t,
    fakeStorage(),
    new Error("synthetic session-store failure"),
  );
  const result = await postLogin(harness.url, {
    username: "agent",
    password: "correct-password",
  });
  assert.equal(result.status, 500);
  assert.deepEqual(harness.fakeSession, {});
  assert.equal(harness.regenerateCalls, 1);
});

test("LOGIN does not regenerate or authenticate the session after a bad password", async (t) => {
  const harness = await startLoginHttpHarness(t, fakeStorage());
  const oldSessionId = harness.sessionId;
  const result = await postLogin(harness.url, { username: "agent", password: "wrong" });
  assert.equal(result.status, 401);
  assert.deepEqual(harness.fakeSession, {});
  assert.equal(harness.sessionId, oldSessionId);
  assert.equal(harness.regenerateCalls, 0);
});

test("PHONE LOGIN fails closed if session regeneration fails after OTP proof", async (t) => {
  const harness = await startLoginHttpHarness(
    t,
    fakeStorage({
      getUserByPhone: async () => user,
      verifyCode: async () => true,
    }),
    new Error("synthetic session-store failure"),
  );
  bindPhoneOtpLoginChallenge(
    harness.fakeSession,
    user.phoneNumber!,
    user.id,
    Date.now() + 60_000,
  );
  const result = await postLogin(harness.url, {
    authMethod: "phone",
    phoneNumber: user.phoneNumber,
    code: "482951",
  });
  assert.equal(result.status, 500);
  assert.deepEqual(harness.fakeSession, {});
  assert.equal(harness.regenerateCalls, 1);
});

test("PHONE LOGIN fails closed when the shared OTP limiter is unavailable", async (t) => {
  let verifyCalls = 0;
  const harness = await startLoginHttpHarness(
    t,
    fakeStorage({
      verifyCode: async () => {
        verifyCalls += 1;
        return true;
      },
    }),
    undefined,
    async () => {
      throw new Error("synthetic shared limiter outage");
    },
  );
  bindPhoneOtpLoginChallenge(
    harness.fakeSession as any,
    user.phoneNumber!,
    user.id,
    Date.now() + 60_000,
  );
  const result = await postLogin(harness.url, {
    authMethod: "phone",
    phoneNumber: user.phoneNumber,
    code: "123456",
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "RATE_LIMIT_UNAVAILABLE");
  assert.equal(verifyCalls, 0);
  assert.equal(harness.regenerateCalls, 0);
});

test("LOGIN HTTP masks storage failures behind the existing generic 500", async (t) => {
  const harness = await startLoginHttpHarness(t, fakeStorage({
    getUserByUsername: async () => {
      throw new Error("sensitive database diagnostic");
    },
  }));
  const result = await postLogin(harness.url, { username: "agent", password: "correct-password" });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { message: "Server error" });
  assert.equal(JSON.stringify(result.body).includes("sensitive"), false);
});
