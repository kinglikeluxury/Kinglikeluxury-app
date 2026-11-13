import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { createLoginHandler, type LoginStorage } from "./authLoginRoute";

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
};

function fakeStorage(overrides: Partial<LoginStorage> = {}): LoginStorage {
  return {
    getUserByUsername: async () => user,
    getUserByEmail: async () => user,
    getUserByPhone: async () => user,
    getUserByField: async () => user,
    ...overrides,
  };
}

async function startLoginHttpHarness(
  t: TestContext,
  storage: LoginStorage,
) {
  const app = express();
  const fakeSession: Record<string, unknown> = {};
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
  return { url: `http://127.0.0.1:${address.port}/api/auth/login`, fakeSession };
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
