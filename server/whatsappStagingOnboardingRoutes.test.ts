import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import express from "express";
import {
  stagingSignupPolicy,
  stagingProofRepository,
  registerStagingWhatsappOnboardingRoutes,
} from "./whatsappStagingOnboardingRoutes";
import type { MetaOnboardingVerifier } from "./whatsappMetaOnboardingProof";

const approvedPhone = "+995511746491"; // Synthetic company allowlist fixture only; no requests to this number.
const exampleEnv = {
  APP_DEPLOYMENT_MODE: "staging",
  WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED: "true",
  WHATSAPP_STAGING_EMPLOYEE_NOTICE_REVIEWED: "true",
  WHATSAPP_STAGING_PROOF_SCHEMA_REVIEWED: "true",
  WHATSAPP_STAGING_APPROVED_BUSINESS_PORTFOLIO_ID: "123456789",
  WHATSAPP_STAGING_APPROVED_EMPLOYEE_PHONE: approvedPhone,
  APP_STAGING_DATABASE_URL: "postgresql://staging@example.invalid:5432/stage_safe",
  APP_STAGING_DATABASE_EXPECTED_HOST: "example.invalid",
  APP_STAGING_DATABASE_EXPECTED_NAME: "stage_safe",
  PRODUCTION_DATABASE_HOST: "production.invalid",
  PRODUCTION_DATABASE_NAME: "production",
  APP_STAGING_DATABASE_CONFIRMATION: "synthetic-confirmation",
  APP_STAGING_STORAGE_CONFIRMATION: "synthetic-storage-isolation",
};

const digest = (x: string) => createHash("sha256").update(x).digest("hex");

test("production and unreviewed Staging are always blocked", () => {
  assert.equal(stagingSignupPolicy({ ...exampleEnv, APP_DEPLOYMENT_MODE: "production" }), null);
  assert.equal(stagingSignupPolicy({ ...exampleEnv, WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED: "false" }), null);
  assert.equal(stagingSignupPolicy({ ...exampleEnv, WHATSAPP_STAGING_EMPLOYEE_NOTICE_REVIEWED: "false" }), null);
  assert.equal(stagingSignupPolicy({ ...exampleEnv, WHATSAPP_STAGING_PROOF_SCHEMA_REVIEWED: "false" }), null);
  assert.equal(stagingSignupPolicy({ ...exampleEnv, APP_STAGING_DATABASE_URL: "postgresql://x@production.invalid:5432/production" }), null);
  assert.equal(stagingSignupPolicy({ ...exampleEnv, WHATSAPP_STAGING_APPROVED_EMPLOYEE_PHONE: "unknown" }), null);
  assert.ok(stagingSignupPolicy(exampleEnv));
});

test("proof repository hashes one-time state and never stores codes", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const fakeDb = {
    async query(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 1 };
    },
  };
  const repo = stagingProofRepository(fakeDb as any);
  const oneTimeCode = "SECRET-ONETIME-META-CODE-NOT-TO-STORE";
  await repo.createFlow({
    flowId: "01234567-89ab-cdef-0123-456789abcdef",
    actorId: 7, sessionHash: digest("session"),
    origin: "https://staging.example.invalid",
    state: "state-12345678", csrfToken: "csrf-12345678",
    expiresAt: new Date("2026-11-09T00:00:00Z"),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values[4], digest("state-12345678"));
  assert.equal(calls[0].values[5], digest("csrf-12345678"));
  assert.equal(JSON.stringify(calls).includes(oneTimeCode), false);
});

test("HTTP onboarding fails closed with no verifier even when all flags are set", async () => {
  const app = express();
  app.use(express.json());
  registerStagingWhatsappOnboardingRoutes(app, {
    env: exampleEnv,
    db: { query: async () => { throw new Error("DB must not be reached"); } } as any,
    authorizeAdmin: async () => 301,
    // Real Meta verifier intentionally not wired.
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => listener.once("listening", resolve));
  const port = (listener.address() as any).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/staging/whatsapp-verified-signup/csrf`);
    assert.equal(res.status, 404);
  } finally {
    listener.close();
  }
});

test("synthetic verified flow is CSRF, origin, admin, portfolio and phone scoped", async () => {
  const row = new Map<string, any>();
  const saved: unknown[][] = [];
  let verifierCalls = 0;
  const fakeDb = {
    async query(sql: string, values: any[] = []) {
      if (sql.startsWith("INSERT INTO whatsapp_onboarding_flows")) {
        row.set(values[0], { actorId: values[1], sessionHash: values[2], origin: values[3],
          stateHash: values[4], csrfHash: values[5], expiresAt: values[6], consumed: false });
        return { rowCount: 1, rows: [] };
      }
      if (sql.startsWith("UPDATE whatsapp_onboarding_flows")) {
        const flow = row.get(values[0]);
        if (!flow || flow.consumed || flow.actorId !== values[1] ||
            flow.sessionHash !== values[2] || flow.origin !== values[3] ||
            flow.stateHash !== values[4] || flow.csrfHash !== values[5]) return { rows: [], rowCount: 0 };
        flow.consumed = true;
        return { rows: [{ flow_id: values[0], actor_id: flow.actorId,
          origin: flow.origin, consumed_at: new Date() }], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO whatsapp_onboarding_proofs")) {
        saved.push(values);
        return { rowCount: 1, rows: [] };
      }
      throw new Error("Unexpected test SQL");
    },
  };
  const verifier: MetaOnboardingVerifier = {
    async exchangeAndVerify(input) {
      verifierCalls++;
      assert.equal(input.displayPhoneNumber, approvedPhone);
      return {
        businessPortfolioId: input.businessPortfolioId,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: approvedPhone,
        coexistence: "verified",
        grantedPermissions: ["whatsapp_business_management", "whatsapp_business_messaging"],
        ownershipVerified: true,
      };
    },
  };
  const app = express();
  app.use(express.json());
  const session: any = { isAdmin: true, userId: 301,
    save(cb: (err?: Error) => void) { cb(); } };
  app.use((req: any, _res, next) => {
    req.session = session; req.sessionID = "a".repeat(40); next();
  });
  registerStagingWhatsappOnboardingRoutes(app, {
    env: exampleEnv,
    db: fakeDb as any,
    authorizeAdmin: async req => (req.session as any).isAdmin ? 301 : null,
    verifier,
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => listener.once("listening", resolve));
  const port = (listener.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/admin/staging/whatsapp-verified-signup`;
  const headers = { origin: "https://staging.example.invalid", host: "staging.example.invalid",
    "content-type": "application/json" };
  const call = (method: string, path: string, body?: unknown, csrf?: string) => fetch(base+path, {
    method, headers: { ...headers, ...(csrf ? { "x-csrf-token": csrf } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    const unauthorized = await call("POST", "/start", {});
    assert.equal(unauthorized.status, 403);
    const csrf = await call("GET", "/csrf");
    assert.equal(csrf.status, 200);
    const { csrfToken } = await csrf.json() as any;
    const start = await call("POST", "/start", {}, csrfToken);
    assert.equal(start.status, 201);
    const flow = await start.json() as any;
    const finish = {
      flowId: flow.flowId, state: flow.state,
      code: "FAKE-META-EXCHANGE-CODE-ONLY",
      businessPortfolioId: exampleEnv.WHATSAPP_STAGING_APPROVED_BUSINESS_PORTFOLIO_ID,
      wabaId: "234567891", phoneNumberId: "345678912",
      displayPhoneNumber: approvedPhone,
    };
    assert.equal((await call("POST", "/finish",
      { ...finish, displayPhoneNumber: "+995555888888" }, flow.csrfToken)).status, 400);
    assert.equal((await call("POST", "/finish", finish, "0".repeat(64))).status, 400);
    assert.equal(verifierCalls, 0);
    const ok = await call("POST", "/finish", finish, flow.csrfToken);
    assert.equal(ok.status, 201);
    assert.deepEqual(await ok.json(), { status: "verified_pending_activation" });
    assert.equal((await call("POST", "/finish", finish, flow.csrfToken)).status, 400);
    assert.equal(verifierCalls, 1);
    assert.equal(saved.length, 1);
    assert.equal(JSON.stringify(saved).includes("FAKE-META-EXCHANGE-CODE-ONLY"), false);
    assert.equal(session.stagingVerifiedSignupStartCsrf, null);
  } finally { listener.close(); }
});
