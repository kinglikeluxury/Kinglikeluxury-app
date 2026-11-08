import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { runSyntheticWhatsappOnboardingFlow } from "../client/src/lib/whatsappMetaOnboardingClient";
import { establishAuthenticatedSession } from "./authSession";
import pg from "pg";
import {
  closeWhatsappMetaOnboardingTestPool,
  registerWhatsappMetaOnboardingRoutes,
} from "./whatsappMetaOnboardingRoutes";
import type { MetaOnboardingProof, MetaOnboardingVerifier } from "./whatsappMetaOnboardingProof";

const connectionString = process.env.WHATSAPP_META_ONBOARDING_TEST_DATABASE_URL;
const expectedProof: MetaOnboardingProof = {
  businessPortfolioId: "123456", wabaId: "234567", phoneNumberId: "345678",
  displayPhoneNumber: "+995555000001", coexistence: "verified",
  grantedPermissions: ["whatsapp_business_management", "whatsapp_business_messaging"],
  ownershipVerified: true,
};

test("onboarding HTTP flow uses atomic one-time PostgreSQL state and synthetic verifier only", {
  skip: !connectionString,
}, async () => {
  assert.ok(connectionString);
  const dbUrl = new URL(connectionString);
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(dbUrl.hostname));
  assert.match(dbUrl.pathname, /(^|[_-])(test|testing)([_-]|$)/);
  const pool = new pg.Pool({ connectionString, max: 2 });
  let sessionPool: pg.Pool | undefined;
  const setup = await pool.connect();
  const schema = `wa_onboard_test_${process.pid}_${Date.now()}`;
  const migration = await readFile(
    new URL("../docs/sql/2026-11-08-whatsapp-onboarding-proof.sql.txt", import.meta.url), "utf8",
  );
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  const oldEnv = {
    nodeEnv: process.env.NODE_ENV,
    appMode: process.env.APP_DEPLOYMENT_MODE,
    flag: process.env.WHATSAPP_META_ONBOARDING_ENABLED,
    dbUrl: process.env.WHATSAPP_META_ONBOARDING_TEST_DATABASE_URL,
  };
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}"`);
    await setup.query("CREATE TABLE users(id BIGINT PRIMARY KEY,is_admin BOOLEAN NOT NULL,is_active BOOLEAN NOT NULL)");
    await setup.query(migration);
    await setup.query("INSERT INTO users VALUES (301,true,true),(201,false,true)");
    const routeUrl = new URL(connectionString);
    routeUrl.searchParams.set("options", `-c search_path=${schema}`);
    process.env.WHATSAPP_META_ONBOARDING_TEST_DATABASE_URL = routeUrl.toString();
    process.env.NODE_ENV = "test";
    process.env.APP_DEPLOYMENT_MODE = "test";
    process.env.WHATSAPP_META_ONBOARDING_ENABLED = "true";

    const verifier: MetaOnboardingVerifier = {
      async exchangeAndVerify(input) {
        if (input.code === "synthetic-verifier-failure") throw new Error("fixture verifier failure");
        if (input.code === "synthetic-code-concurrent") return {
          ...expectedProof, phoneNumberId: "345679", displayPhoneNumber: "+995555000002",
        };
        if (input.code === "synthetic-client-flow") return {
          ...expectedProof, phoneNumberId: "345680", displayPhoneNumber: "+995555000003",
        };
        return expectedProof;
      },
    };
    const cookies = new Map<string, string>();
    const app = express();
    app.use(express.json({ limit: "8kb" }));
    sessionPool = new pg.Pool({ connectionString: routeUrl.toString(), max: 2 });
    const PgSessionStore = connectPg(session);
    const sessionStore = new PgSessionStore({
      pool: sessionPool, tableName: "wa_test_sessions", createTableIfMissing: true,
    });
    app.use(session({
      store: sessionStore,
      secret: "synthetic-only-session-secret-for-tests",
      resave: false, saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax", secure: false },
    }));
    app.get("/__test/pre-auth-session", (req: any, res) => {
      req.session.preAuth = "synthetic";
      req.session.save(() => res.sendStatus(204));
    });
    app.get("/__test/whoami", (req: any, res) =>
      res.json({ userId: req.session.userId ?? null, role: req.session.role ?? null }));
    app.post("/__test/login", async (req: any, res) => {
      const userId = Number(req.body?.userId);
      if (![201, 301].includes(userId)) return res.sendStatus(400);
      try {
        await establishAuthenticatedSession(req, {
          id: userId, isAdmin: userId === 301, role: userId === 301 ? "admin" : "user",
        });
        return res.sendStatus(204);
      } catch { return res.sendStatus(500); }
    });
    app.post("/__test/rotate-session", (req: any, res) => {
      const userId = req.session.userId;
      if (!userId) return res.sendStatus(401);
      req.session.regenerate((error: unknown) => {
        if (error) return res.sendStatus(500);
        req.session.userId = userId;
        req.session.isAdmin = userId === 301;
        req.session.role = userId === 301 ? "admin" : "user";
        req.session.save(() => res.sendStatus(204));
      });
    });
    registerWhatsappMetaOnboardingRoutes(app, verifier);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const adminSession = "admin-cookie";
    const preAuth = await fetch(`${origin}/__test/pre-auth-session`);
    const oldAuthCookie = preAuth.headers.get("set-cookie")?.split(";")[0];
    assert.ok(oldAuthCookie);
    const loginAfterPreAuth = await fetch(`${origin}/__test/login`, {
      method: "POST",
      headers: { cookie: oldAuthCookie, origin, "content-type": "application/json" },
      body: JSON.stringify({ userId: 301 }),
    });
    assert.equal(loginAfterPreAuth.status, 204);
    const authenticatedCookie = loginAfterPreAuth.headers.get("set-cookie")?.split(";")[0];
    assert.ok(authenticatedCookie);
    assert.notEqual(authenticatedCookie, oldAuthCookie);
    const oldSessionIdentity = await fetch(`${origin}/__test/whoami`, {
      headers: { cookie: oldAuthCookie },
    });
    assert.deepEqual(await oldSessionIdentity.json(), { userId: null, role: null });
    cookies.set(adminSession, authenticatedCookie);
    const request = (method: string, path: string, userId?: number, body?: unknown,
      sessionId = adminSession, overrides: Record<string, string> = {}) =>
      (async () => {
        if (userId && !cookies.has(sessionId)) {
          const login = await fetch(`${origin}/__test/login`, {
            method: "POST", headers: { "content-type": "application/json", origin },
            body: JSON.stringify({ userId }),
          });
          assert.equal(login.status, 204);
          const cookie = login.headers.get("set-cookie")?.split(";")[0];
          assert.ok(cookie);
          cookies.set(sessionId, cookie);
        }
        return fetch(`${origin}${path}`, {
        method,
        headers: {
          ...(cookies.has(sessionId) ? { cookie: cookies.get(sessionId)! } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          origin, ...overrides,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      })();
    const start = async () => {
      const csrfResponse = await request("GET", "/api/admin/whatsapp-meta/onboarding/csrf", 301);
      assert.equal(csrfResponse.status, 200);
      const csrfToken = (await csrfResponse.json() as any).csrfToken;
      const response = await request("POST", "/api/admin/whatsapp-meta/onboarding/start", 301, {},
        adminSession, { "x-csrf-token": csrfToken });
      assert.equal(response.status, 201);
      return { ...(await response.json() as any), startCsrfToken: csrfToken };
    };
    const clientCookie = () => cookies.get(adminSession)!;
    const clientFetch: typeof fetch = (input, init) => fetch(new URL(String(input), origin), {
      ...init,
      headers: {
        ...init?.headers,
        cookie: clientCookie(),
        origin,
      },
    });
    const finishBody = (flow: any, overrides: Record<string, string> = {}) => ({
      flowId: flow.flowId, state: flow.state, code: "synthetic-code-valid",
      businessPortfolioId: expectedProof.businessPortfolioId, wabaId: expectedProof.wabaId,
      phoneNumberId: expectedProof.phoneNumberId, displayPhoneNumber: expectedProof.displayPhoneNumber,
      ...overrides,
    });

    assert.equal((await request("GET", "/api/admin/whatsapp-meta/onboarding/csrf", undefined, undefined, "")).status, 401);
    assert.equal((await request("GET", "/api/admin/whatsapp-meta/onboarding/csrf", 201, undefined,
      "synthetic-nonadmin-session-201")).status, 403);
    assert.equal((await request("POST", "/api/admin/whatsapp-meta/onboarding/start", 301, {},
      adminSession, { origin: "http://attacker.invalid", "x-csrf-token": "bad" })).status, 403);

    const flow = await start();
    const persistedFlow = await setup.query(
      "SELECT session_hash,state_hash,csrf_hash FROM whatsapp_onboarding_flows WHERE flow_id=$1",
      [flow.flowId],
    );
    assert.equal(persistedFlow.rowCount, 1);
    assert.notEqual(persistedFlow.rows[0].state_hash, flow.state);
    assert.notEqual(persistedFlow.rows[0].csrf_hash, flow.csrfToken);
    assert.notEqual(persistedFlow.rows[0].session_hash, adminSession);
    const wrongCsrf = await request("POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
      finishBody(flow), adminSession, { "x-csrf-token": "0".repeat(64) });
    assert.equal(wrongCsrf.status, 400);
    const wrongState = await request("POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
      finishBody(flow, { state: "spoofed-state-value-that-is-long-enough" }), adminSession,
      { "x-csrf-token": flow.csrfToken });
    assert.equal(wrongState.status, 400);
    const wrongSession = await request("POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
      finishBody(flow), "other-admin-cookie", { "x-csrf-token": flow.csrfToken });
    assert.equal(wrongSession.status, 400);
    const wrongOrigin = await request("POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
      finishBody(flow), adminSession, { origin: "http://attacker.invalid", "x-csrf-token": flow.csrfToken });
    assert.equal(wrongOrigin.status, 403);
    const valid = await request("POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
      finishBody(flow), adminSession, { "x-csrf-token": flow.csrfToken });
    assert.equal(valid.status, 201);
    assert.deepEqual(await valid.json(), { status: "verified_pending_activation" });
    assert.equal((await request("POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
      finishBody(flow), adminSession, { "x-csrf-token": flow.csrfToken })).status, 400);

    await runSyntheticWhatsappOnboardingFlow(clientFetch, origin, {
      code: "synthetic-client-flow",
      businessPortfolioId: expectedProof.businessPortfolioId,
      wabaId: expectedProof.wabaId,
      phoneNumberId: "345680",
      displayPhoneNumber: "+995555000003",
    });

    const rotated = await start();
    const oldCookie = cookies.get(adminSession)!;
    const rotate = await fetch(`${origin}/__test/rotate-session`, {
      method: "POST", headers: { cookie: oldCookie, origin },
    });
    assert.equal(rotate.status, 204);
    const rotatedCookie = rotate.headers.get("set-cookie")?.split(";")[0];
    assert.ok(rotatedCookie);
    cookies.set(adminSession, rotatedCookie);
    assert.equal((await request("POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
      finishBody(rotated), adminSession, { "x-csrf-token": rotated.csrfToken })).status, 400);

    const concurrent = await start();
    const attempts = await Promise.all([1, 2].map(() => request(
      "POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
      { ...finishBody(concurrent, { phoneNumberId: "345679", displayPhoneNumber: "+995555000002" }),
        code: "synthetic-code-concurrent" },
      adminSession, { "x-csrf-token": concurrent.csrfToken },
    )));
    assert.deepEqual(attempts.map(response => response.status).sort(), [201, 400]);

    for (const spoof of [
      { businessPortfolioId: "999999" }, { wabaId: "999998" },
      { phoneNumberId: "999997" }, { displayPhoneNumber: "+995555000099" },
    ]) {
      const flowForSpoof = await start();
      const response = await request("POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
        finishBody(flowForSpoof, spoof), adminSession, { "x-csrf-token": flowForSpoof.csrfToken });
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), /99999|synthetic-code/);
    }
    const failedVerifierFlow = await start();
    const verifierFailure = await request("POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
      { ...finishBody(failedVerifierFlow), code: "synthetic-verifier-failure" }, adminSession,
      { "x-csrf-token": failedVerifierFlow.csrfToken });
    assert.equal(verifierFailure.status, 400);
    assert.doesNotMatch(await verifierFailure.text(), /synthetic-verifier-failure/);

    const expired = await start();
    await setup.query(`UPDATE whatsapp_onboarding_flows SET expires_at=NOW()-INTERVAL '1 second' WHERE flow_id=$1`, [expired.flowId]);
    assert.equal((await request("POST", "/api/admin/whatsapp-meta/onboarding/finish", 301,
      finishBody(expired), adminSession, { "x-csrf-token": expired.csrfToken })).status, 400);

    const saved = await setup.query("SELECT count(*)::int AS count FROM whatsapp_onboarding_proofs");
    assert.equal(saved.rows[0].count, 3);
    const storedSessions = await setup.query("SELECT count(*)::int AS count FROM wa_test_sessions");
    assert.ok(storedSessions.rows[0].count > 0);

    const priorUrl = process.env.WHATSAPP_META_ONBOARDING_TEST_DATABASE_URL!;
    const unavailable = new URL(priorUrl);
    unavailable.port = "1";
    await closeWhatsappMetaOnboardingTestPool();
    process.env.WHATSAPP_META_ONBOARDING_TEST_DATABASE_URL = unavailable.toString();
    assert.equal((await request("GET", "/api/admin/whatsapp-meta/onboarding/csrf", 301)).status, 503);
    process.env.WHATSAPP_META_ONBOARDING_TEST_DATABASE_URL = priorUrl;
    await closeWhatsappMetaOnboardingTestPool();

    process.env.NODE_ENV = "production";
    const prodApp = express();
    registerWhatsappMetaOnboardingRoutes(prodApp, verifier);
    const prodServer = prodApp.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => prodServer.once("listening", resolve));
    const prodAddress = prodServer.address() as any;
    const prodResponse = await fetch(`http://127.0.0.1:${prodAddress.port}/api/admin/whatsapp-meta/onboarding/csrf`, {
      headers: { origin: `http://127.0.0.1:${prodAddress.port}` },
    });
    assert.equal(prodResponse.status, 404);
    await new Promise<void>(resolve => prodServer.close(() => resolve()));
    process.env.NODE_ENV = "test";
    process.env.APP_DEPLOYMENT_MODE = "staging";
    assert.equal((await request("GET", "/api/admin/whatsapp-meta/onboarding/csrf", 301)).status, 404);
    process.env.APP_DEPLOYMENT_MODE = "test";
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await closeWhatsappMetaOnboardingTestPool();
    await setup.query("RESET search_path");
    await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    setup.release();
    await sessionPool?.end();
    await pool.end();
    if (oldEnv.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv.nodeEnv;
    if (oldEnv.appMode === undefined) delete process.env.APP_DEPLOYMENT_MODE;
    else process.env.APP_DEPLOYMENT_MODE = oldEnv.appMode;
    if (oldEnv.flag === undefined) delete process.env.WHATSAPP_META_ONBOARDING_ENABLED;
    else process.env.WHATSAPP_META_ONBOARDING_ENABLED = oldEnv.flag;
    if (oldEnv.dbUrl === undefined) delete process.env.WHATSAPP_META_ONBOARDING_TEST_DATABASE_URL;
    else process.env.WHATSAPP_META_ONBOARDING_TEST_DATABASE_URL = oldEnv.dbUrl;
  }
});
