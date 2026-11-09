import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerWhatsappOperationsStatusRoutes } from "./whatsappOperationsStatusRoutes";

const BASE = "/api/admin/staging/whatsapp-operations-status";
async function withServer(
  env: NodeJS.ProcessEnv,
  actor: number | null,
  result: { rows: Array<Record<string, unknown>> } | null,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  let queries = 0;
  registerWhatsappOperationsStatusRoutes(app, {
    env,
    authorizeAdmin: async () => actor,
    proofDb: result ? {
      async query(sql) {
        queries++;
        assert.match(sql, /kinglike_whatsapp\.whatsapp_onboarding_flows/);
        assert.match(sql, /kinglike_whatsapp\.whatsapp_onboarding_proofs/);
        return result;
      },
      async end() {},
    } : null,
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => listener.once("listening", resolve));
  const port = (listener.address() as any).port;
  try {
    await run(`http://127.0.0.1:${port}`);
    if (env.APP_DEPLOYMENT_MODE !== "staging" || !actor) assert.equal(queries, 0);
  } finally {
    await new Promise<void>(resolve => listener.close(() => resolve()));
  }
}

test("not exposed outside Staging or to unauthenticated users", async () => {
  const rows = { rows: [{ flows: "0", proofs: "0" }] };
  await withServer({ APP_DEPLOYMENT_MODE: "production" }, 1, rows, async base => {
    assert.equal((await fetch(base + BASE)).status, 404);
  });
  await withServer({ APP_DEPLOYMENT_MODE: "staging" }, null, rows, async base => {
    assert.equal((await fetch(base + BASE)).status, 403);
  });
});

test("read-only report exposes only safe counts and refuses to assert real linkage", async () => {
  const env: NodeJS.ProcessEnv = {
    APP_DEPLOYMENT_MODE: "staging",
    WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED: "false",
    WHATSAPP_EMPLOYEE_MONITORING_ENABLED: "false",
  };
  await withServer(env, 101, { rows: [{ flows: "0", proofs: "0" }] }, async base => {
    const response = await fetch(base + BASE);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body.proofRows, { flows: 0, proofs: 0 });
    assert.equal(body.proofDatabase, "verified");
    assert.equal(body.employeeNumbersConnected, "not_verified");
    assert.equal(body.employeeMonitoring, "disabled");
    assert.equal(body.realEnrollment, "disabled");
    assert.ok(body.checkedAt);
    assert.equal(JSON.stringify(body).includes("token"), false);
    assert.equal(JSON.stringify(body).includes("phoneNumberId"), false);
  });
});

test("missing proof DB reports unknown; never invents healthy counts", async () => {
  await withServer({ APP_DEPLOYMENT_MODE: "staging" }, 101, null, async base => {
    const result = await (await fetch(base + BASE)).json();
    assert.equal(result.proofRows, null);
    assert.equal(result.proofDatabase, "unavailable");
    assert.equal(result.employeeNumbersConnected, "not_verified");
  });
});
