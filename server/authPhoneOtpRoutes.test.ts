import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import express from "express";
import session from "express-session";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import type { User } from "@shared/schema";
import { createRegisterHandler, type EmailRegistrationOtpStore } from "./authRegisterRoute";
import { createPhoneOtpVerificationHandler } from "./authPhoneOtpRoutes";
import { createLoginHandler } from "./authLoginRoute";
import { createSessionAuthGuards, type AuthSessionStorage } from "./authSessionRoutes";
import {
  bindPhoneOtpLoginChallenge,
  createPhoneOtpAttemptLimiter,
} from "./phoneOtpProof";
import type { RegistrationStorage } from "./authRegisterRoute";

const COOKIE_POLICY = { secure: false, sameSite: "lax" as const };
const SYNTHETIC_SESSION_SECRET = "synthetic-phone-otp-session-secret-only";
const SYNTHETIC_CODE = "482951";
const BUYER_PHONE = "+995555000051";
const NEW_PHONE = "+995555000052";

function makeUser(id: number, phoneNumber: string): User {
  return {
    id,
    username: `synthetic-phone-${id}`,
    password: "synthetic-only-password",
    email: `synthetic-phone-${id}@example.test`,
    phoneNumber,
    whatsappNumber: null,
    facebookId: null,
    authMethod: "phone",
    isVerified: true,
    isAdmin: false,
    isActive: true,
    role: "buyer",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  } as User;
}

function createStorage(initialUsers: User[]) {
  const users = new Map(initialUsers.map((user) => [user.id, user]));
  const verificationCodes = new Map<string, {
    code: string;
    expiresAt: Date;
    verified: boolean;
  }>();
  let verifyCalls = 0;
  let consumeRegistrationProofCalls = 0;
  let createUserCalls = 0;
  let nextId = Math.max(0, ...users.keys()) + 1;

  const storage: AuthSessionStorage & RegistrationStorage = {
    getUser: async (id) => users.get(id),
    getUserByUsername: async (username) =>
      [...users.values()].find((user) => user.username === username),
    getUserByEmail: async (email) =>
      [...users.values()].find((user) => user.email === email),
    getUserByPhone: async (phoneNumber) =>
      [...users.values()].find((user) => user.phoneNumber === phoneNumber),
    verifyCode: async (phoneNumber, code) => {
      verifyCalls += 1;
      const record = verificationCodes.get(phoneNumber);
      if (
        !record ||
        record.verified ||
        record.code !== code ||
        Date.now() >= record.expiresAt.getTime()
      ) {
        return false;
      }
      record.verified = true;
      return true;
    },
    consumePhoneVerification: async (phoneNumber) => {
      consumeRegistrationProofCalls += 1;
      const record = verificationCodes.get(phoneNumber);
      if (!record?.verified || Date.now() >= record.expiresAt.getTime()) return false;
      verificationCodes.delete(phoneNumber);
      return true;
    },
    createUser: async (data) => {
      createUserCalls += 1;
      const user = {
        ...makeUser(nextId++, data.phoneNumber ?? ""),
        ...data,
        email: data.email ?? null,
        phoneNumber: data.phoneNumber ?? null,
        whatsappNumber: null,
        facebookId: null,
        isVerified: true,
        isAdmin: false,
        isActive: true,
        role: "buyer",
        createdAt: new Date(),
      } as User;
      users.set(user.id, user);
      return user;
    },
  };

  return {
    storage,
    users,
    verificationCodes,
    get verifyCalls() { return verifyCalls; },
    get consumeRegistrationProofCalls() { return consumeRegistrationProofCalls; },
    get createUserCalls() { return createUserCalls; },
  };
}

async function startHarness(
  t: TestContext,
  initialUsers: User[] = [makeUser(51, BUYER_PHONE)],
  limiter = createPhoneOtpAttemptLimiter(),
) {
  const app = express();
  const data = createStorage(initialUsers);
  const emailOtpStore: EmailRegistrationOtpStore = new Map();
  const phoneOtpAttempts: Array<{ phoneNumber: string; ipAddress: string }> = [];
  const observedLimiter = (phoneNumber: string, ipAddress: string) => {
    phoneOtpAttempts.push({ phoneNumber, ipAddress });
    return limiter(phoneNumber, ipAddress);
  };
  app.use(express.json());
  app.use(session({
    secret: SYNTHETIC_SESSION_SECRET,
    store: new session.MemoryStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: COOKIE_POLICY.secure,
      sameSite: COOKIE_POLICY.sameSite,
    },
  }));

  // Test-only OTP delivery seam: stores a synthetic code and binds the challenge
  // to the actual server-side session without contacting an SMS provider.
  app.post("/__synthetic/send-code", async (req, res) => {
    const phoneNumber = String(req.body?.phoneNumber ?? "");
    const codeExpiresAt = Number(req.body?.codeExpiresAt ?? Date.now() + 60_000);
    const challengeExpiresAt = Number(req.body?.challengeExpiresAt ?? codeExpiresAt);
    const account = await data.storage.getUserByPhone(phoneNumber);
    data.verificationCodes.set(phoneNumber, {
      code: SYNTHETIC_CODE,
      expiresAt: new Date(codeExpiresAt),
      verified: false,
    });
    bindPhoneOtpLoginChallenge(
      req.session,
      phoneNumber,
      account?.id ?? null,
      challengeExpiresAt,
    );
    res.status(204).end();
  });
  app.get("/__synthetic/challenge", (req, res) =>
    res.json(req.session.phoneOtpLoginChallenge ?? null),
  );

  app.post("/api/auth/verify-code", createPhoneOtpVerificationHandler({
    storage: data.storage,
    allowPhoneOtpAttempt: observedLimiter,
  }));
  app.post("/api/auth/login", createLoginHandler({
    storage: data.storage,
    comparePassword: async (candidate, stored) => candidate === stored,
    allowPhoneOtpAttempt: observedLimiter,
  }));
  app.post("/api/auth/register", createRegisterHandler({
    storage: data.storage,
    emailOtpStore,
    hashPassword: async (plainText) => `synthetic-bcrypt:${plainText}`,
    sendWelcomeEmail: async () => undefined,
    sendWelcomeWhatsApp: async () => undefined,
    logError: () => undefined,
  }));

  const guards = createSessionAuthGuards(data.storage, COOKIE_POLICY);
  app.get("/api/vip/synthetic", guards.isAuthenticated, (req, res) =>
    res.json({ userId: req.session.userId, role: req.session.role }),
  );
  app.get("/__synthetic/session", (req, res) => {
    if (!req.session.userId) return res.status(401).json({ authenticated: false });
    return res.json({ authenticated: true, userId: req.session.userId });
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  }));
  const address = server.address() as AddressInfo;
  return {
    storage: data.storage,
    users: data.users,
    verificationCodes: data.verificationCodes,
    get verifyCalls() { return data.verifyCalls; },
    get consumeRegistrationProofCalls() { return data.consumeRegistrationProofCalls; },
    get createUserCalls() { return data.createUserCalls; },
    phoneOtpAttempts,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function cookieFrom(response: Response): string | undefined {
  return response.headers.get("set-cookie")?.split(";")[0];
}

async function request(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers({ connection: "close" });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
}

async function startPhoneChallenge(
  baseUrl: string,
  phoneNumber: string,
  options: { codeExpiresAt?: number; challengeExpiresAt?: number } = {},
): Promise<string> {
  const response = await request(baseUrl, "/__synthetic/send-code", {
    method: "POST",
    body: { phoneNumber, ...options },
  });
  assert.equal(response.status, 204);
  const cookie = cookieFrom(response);
  assert.ok(cookie);
  return cookie;
}

function phoneLoginBody(phoneNumber: string, code = SYNTHETIC_CODE) {
  return { authMethod: "phone", phoneNumber, code };
}

test("phone login rejects absent, cross-session, wrong-account, and expired proof", async (t) => {
  const harness = await startHarness(t);
  const noChallenge = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    body: phoneLoginBody(BUYER_PHONE),
  });
  assert.equal(noChallenge.status, 401);
  assert.equal(harness.verifyCalls, 0);

  const issuingSession = await startPhoneChallenge(harness.baseUrl, BUYER_PHONE);
  const storedChallenge = await (await request(harness.baseUrl, "/__synthetic/challenge", {
    cookie: issuingSession,
  })).json();
  assert.equal(storedChallenge.phoneNumber, BUYER_PHONE);
  assert.equal(storedChallenge.accountId, 51);
  assert.ok(storedChallenge.expiresAt > Date.now());
  const crossSession = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    body: phoneLoginBody(BUYER_PHONE),
  });
  assert.equal(crossSession.status, 401);
  assert.equal(harness.verifyCalls, 0);

  const invalidCode = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    cookie: issuingSession,
    body: phoneLoginBody(BUYER_PHONE, "000000"),
  });
  assert.equal(invalidCode.status, 401);
  assert.equal(
    harness.verifyCalls,
    1,
    JSON.stringify({ body: await invalidCode.clone().json(), attempts: harness.phoneOtpAttempts }),
  );

  const wrongAccount = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    cookie: issuingSession,
    body: phoneLoginBody("+995555000099"),
  });
  assert.equal(wrongAccount.status, 401);
  assert.equal(harness.verifyCalls, 1);

  const expiredChallenge = await startPhoneChallenge(harness.baseUrl, BUYER_PHONE, {
    challengeExpiresAt: Date.now() - 1,
  });
  const expiredChallengeLogin = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    cookie: expiredChallenge,
    body: phoneLoginBody(BUYER_PHONE),
  });
  assert.equal(expiredChallengeLogin.status, 401);

  const expiredCodeSession = await startPhoneChallenge(harness.baseUrl, BUYER_PHONE, {
    codeExpiresAt: Date.now() - 1,
    challengeExpiresAt: Date.now() + 60_000,
  });
  const expiredCodeLogin = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    cookie: expiredCodeSession,
    body: phoneLoginBody(BUYER_PHONE),
  });
  assert.equal(expiredCodeLogin.status, 401);
  assert.equal(harness.verifyCalls, 2);

  const accountChangedSession = await startPhoneChallenge(harness.baseUrl, BUYER_PHONE);
  harness.users.delete(51);
  harness.users.set(52, makeUser(52, BUYER_PHONE));
  const changedAccountLogin = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    cookie: accountChangedSession,
    body: phoneLoginBody(BUYER_PHONE),
  });
  assert.equal(changedAccountLogin.status, 401);
  assert.equal(harness.verifyCalls, 3);
  assert.equal((await request(harness.baseUrl, "/__synthetic/session", {
    cookie: accountChangedSession,
  })).status, 401);
});

test("valid phone OTP is single-use, rotates the session, and reaches the authenticated VIP gate", async (t) => {
  const harness = await startHarness(t);
  const oldCookie = await startPhoneChallenge(harness.baseUrl, BUYER_PHONE);
  const login = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    cookie: oldCookie,
    body: phoneLoginBody(BUYER_PHONE),
  });
  assert.equal(login.status, 200);
  const currentCookie = cookieFrom(login);
  assert.ok(currentCookie);
  assert.notEqual(currentCookie, oldCookie);
  assert.equal((await login.json()).id, 51);
  assert.equal(harness.verifyCalls, 1);

  const vipGate = await request(harness.baseUrl, "/api/vip/synthetic", {
    cookie: currentCookie,
  });
  assert.equal(vipGate.status, 200);
  assert.deepEqual(await vipGate.json(), { userId: 51, role: "buyer" });
  assert.equal((await request(harness.baseUrl, "/api/vip/synthetic", {
    cookie: oldCookie,
  })).status, 401);

  const replay = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    cookie: currentCookie,
    body: phoneLoginBody(BUYER_PHONE),
  });
  assert.equal(replay.status, 401);
  assert.equal(harness.verifyCalls, 1);
});

test("phone registration OTP verification is same-session and consumed once", async (t) => {
  const harness = await startHarness(t, [makeUser(51, BUYER_PHONE)]);
  const cookie = await startPhoneChallenge(harness.baseUrl, NEW_PHONE);
  const verified = await request(harness.baseUrl, "/api/auth/verify-code", {
    method: "POST",
    cookie,
    body: { phoneNumber: NEW_PHONE, code: SYNTHETIC_CODE },
  });
  assert.equal(verified.status, 200);

  const replay = await request(harness.baseUrl, "/api/auth/verify-code", {
    method: "POST",
    cookie,
    body: { phoneNumber: NEW_PHONE, code: SYNTHETIC_CODE },
  });
  assert.equal(replay.status, 401);
  assert.equal(harness.verifyCalls, 1);

  const registrationBody = {
    username: "synthetic-new-buyer",
    password: "synthetic-password",
    phoneNumber: NEW_PHONE,
    authMethod: "phone",
  };
  const otherSession = await request(harness.baseUrl, "/api/auth/register", {
    method: "POST",
    body: registrationBody,
  });
  assert.equal(otherSession.status, 400);
  assert.equal(harness.createUserCalls, 0);

  const registration = await request(harness.baseUrl, "/api/auth/register", {
    method: "POST",
    cookie,
    body: registrationBody,
  });
  assert.equal(registration.status, 201);
  const authenticatedRegistrationCookie = cookieFrom(registration);
  assert.ok(authenticatedRegistrationCookie);
  assert.notEqual(authenticatedRegistrationCookie, cookie);
  assert.equal((await request(harness.baseUrl, "/__synthetic/session", {
    cookie,
  })).status, 401);
  assert.equal((await request(harness.baseUrl, "/__synthetic/session", {
    cookie: authenticatedRegistrationCookie,
  })).status, 200);
  assert.equal(harness.createUserCalls, 1);
  assert.equal(harness.consumeRegistrationProofCalls, 1);
  assert.equal(harness.verificationCodes.has(NEW_PHONE), false);
});

test("WhatsApp and Facebook identifiers or assertion-shaped input fail closed", async (t) => {
  const harness = await startHarness(t);
  for (const body of [
    { authMethod: "whatsapp", whatsappNumber: BUYER_PHONE },
    { authMethod: "facebook", facebookId: "synthetic-provider-subject" },
    {
      authMethod: "facebook",
      facebookId: "synthetic-provider-subject",
      providerAssertion: "synthetic-unverified-assertion",
    },
  ]) {
    const response = await request(harness.baseUrl, "/api/auth/login", {
      method: "POST",
      body,
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { message: "Invalid login credentials." });
  }
  assert.equal(harness.verifyCalls, 0);
  assert.equal((await request(harness.baseUrl, "/__synthetic/session")).status, 401);
});

test("phone OTP attempts are limited by both phone and source address", () => {
  let now = 1000;
  const limiter = createPhoneOtpAttemptLimiter({
    maxPerPhone: 2,
    maxPerIp: 3,
    windowMs: 100,
    now: () => now,
  });
  assert.equal(limiter(BUYER_PHONE, "127.0.0.1"), true);
  assert.equal(limiter(BUYER_PHONE, "127.0.0.1"), true);
  assert.equal(limiter(BUYER_PHONE, "127.0.0.1"), false);
  assert.equal(limiter(NEW_PHONE, "127.0.0.1"), true);
  assert.equal(limiter("+995555000053", "127.0.0.1"), false);
  now += 101;
  assert.equal(limiter(BUYER_PHONE, "127.0.0.1"), true);
});

test("production OTP issue route retains preflight guards before the injectable issue handler", () => {
  const routes = readFileSync("server/routes.ts", "utf8");
  assert.match(
    routes,
    /app\.post\("\/api\/auth\/send-verification",\s*createPhoneOtpIssueHandler\(\{/,
  );
  assert.match(routes, /checkPhoneOtpIssueRateLimit\(/);
  assert.match(routes, /storage\.consumeOtpRateLimit/);
  assert.match(routes, /verifyTurnstile\(req\.body\?\.turnstileToken, ip\)/);
  assert.match(routes, /twilioClient\.messages\.create/);
});

test("OTP verification fails closed when the shared limiter database is unavailable", async (t) => {
  const unavailable = async () => {
    throw new Error("synthetic database outage");
  };
  const harness = await startHarness(t, [makeUser(52, BUYER_PHONE)], unavailable);
  const sent = await request(harness.baseUrl, "/__synthetic/send-code", {
    method: "POST",
    body: {
      phoneNumber: BUYER_PHONE,
      codeExpiresAt: Date.now() + 60_000,
      challengeExpiresAt: Date.now() + 60_000,
    },
  });
  assert.equal(sent.status, 204);
  const cookie = cookieFrom(sent);
  assert.ok(cookie);
  const verification = await request(harness.baseUrl, "/api/auth/verify-code", {
    method: "POST",
    body: { phoneNumber: BUYER_PHONE, code: SYNTHETIC_CODE },
    cookie,
  });
  assert.equal(verification.status, 503);
  assert.deepEqual(await verification.json(), {
    code: "RATE_LIMIT_UNAVAILABLE",
    message: "Verification is temporarily unavailable.",
  });
});
