import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerWhatsappOperationsStatusRoutes, stagingArchiveCredentialProbeConfig, stagingArchiveWorkerProbeConfig, stagingArchiveWorkerProbeBlocker } from "./whatsappOperationsStatusRoutes";

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

const isolated:NodeJS.ProcessEnv = {
  APP_DEPLOYMENT_MODE:"staging",
  APP_STAGING_DATABASE_URL:"postgresql://app:example@app-staging.railway.internal/kinglike_staging",
  APP_STAGING_DATABASE_EXPECTED_HOST:"app-staging.railway.internal",
  APP_STAGING_DATABASE_EXPECTED_NAME:"kinglike_staging",
  APP_STAGING_DATABASE_CONFIRMATION:"yes",APP_STAGING_STORAGE_CONFIRMATION:"yes",
  NEON_DATABASE_URL:"postgresql://prod:example@ep-live.neon.tech/neondb",
  PRODUCTION_DATABASE_HOST:"ep-live.neon.tech",PRODUCTION_DATABASE_NAME:"neondb",
  WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST:"archive-staging.railway.internal",
  WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME:"kinglike_whatsapp_archive",
  WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:
    "postgresql://kinglike_wa_archive_reader:synthetic-reader@archive-staging.railway.internal:5432/kinglike_whatsapp_archive",
  WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL:
    "postgresql://kinglike_wa_archive_auditwriter:synthetic-audit@archive-staging.railway.internal:5432/kinglike_whatsapp_archive",
};

test("synthetic Railway inbox rollback probe is POST-only, admin-only and fails closed",async()=>{
  const endpoint="/api/admin/staging/whatsapp-archive-inbox-rollback-probe";
  const env={...isolated,
    WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64:Buffer.alloc(32,11).toString("base64"),
    WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64:Buffer.alloc(32,12).toString("base64"),
  };
  await withServer(env,101,null,async base=>{
    assert.equal((await fetch(base+endpoint)).status,404);
    assert.equal((await fetch(base+endpoint,{method:"POST"})).status,403);
    assert.equal((await fetch(base+endpoint,{
      method:"POST",headers:{"x-kinglike-staging-probe":"synthetic-rollback",
        Origin:"https://attacker.example","Sec-Fetch-Site":"cross-site"},
    })).status,403);
    const response=await fetch(base+endpoint,{method:"POST",
      headers:{"x-kinglike-staging-probe":"synthetic-rollback",
        Origin:base,"Sec-Fetch-Site":"same-origin"}});
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.inbox,"configuration_blocked");
    assert.equal(body.rowsPersisted,0);
    assert.equal(body.liveArchive,"disabled");
  });
  await withServer({...env,APP_DEPLOYMENT_MODE:"production"},101,null,async base=>{
    const response=await fetch(base+endpoint,{
      method:"POST",headers:{"x-kinglike-staging-probe":"synthetic-rollback"}});
    assert.equal(response.status,404);
  });
  await withServer(env,null,null,async base=>{
    const response=await fetch(base+endpoint,{
      method:"POST",headers:{"x-kinglike-staging-probe":"synthetic-rollback"}});
    assert.equal(response.status,403);
  });
});

test("isolated staging crypto self-test is admin-only and never persists synthetic messages",async()=>{
  const endpoint="/api/admin/staging/whatsapp-archive-crypto-probe";
  const config={...isolated,
    WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64:Buffer.alloc(32,1).toString("base64"),
    WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64:Buffer.alloc(32,2).toString("base64"),
  };
  await withServer(config,101,null,async base=>{
    const response=await fetch(base+endpoint);
    assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"no-store");
    const data=await response.json();
    assert.equal(data.crypto,"passed");
    assert.equal(data.tamperProtection,"passed");
    assert.equal(data.persistentWrites,0);
    assert.equal(data.liveArchive,"disabled");
    assert.equal(JSON.stringify(data).includes(config.WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64!),false);
  });
  await withServer({...config,WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64:config.WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64},
    101,null,async base=>{
      const data=await (await fetch(base+endpoint)).json();
      assert.equal(data.crypto,"configuration_blocked");
      assert.equal(data.persistentWrites,0);
    });
  await withServer({...config,APP_DEPLOYMENT_MODE:"production"},101,null,
    async base=>assert.equal((await fetch(base+endpoint)).status,404));
  await withServer(config,null,null,
    async base=>assert.equal((await fetch(base+endpoint)).status,403));
});

test("archive credential probe config works with all live flags disabled, strictly isolated",()=>{
  assert.ok(stagingArchiveCredentialProbeConfig(isolated));
  const negative:NodeJS.ProcessEnv[] = [
    {...isolated,APP_DEPLOYMENT_MODE:"production"},
    {...isolated,APP_STAGING_DATABASE_URL:isolated.NEON_DATABASE_URL},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST:"example.com"},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:isolated.NEON_DATABASE_URL},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:isolated.WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL:
      "postgresql://postgres:x@archive-staging.railway.internal/kinglike_whatsapp_archive"},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL:
      "postgresql://kinglike_wa_archive_auditwriter:synthetic-reader@archive-staging.railway.internal/kinglike_whatsapp_archive"},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:
      "postgresql://kinglike_wa_archive_reader:x@archive-staging.railway.internal/neondb"},
    {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:
      "postgresql://kinglike_wa_archive_reader:x@archive-staging.railway.internal/kinglike_whatsapp_archive?sslmode=disable"},
  ];
  negative.forEach(env=>assert.equal(stagingArchiveCredentialProbeConfig(env),null));
});

test("credential probe is unavailable outside staging and rejects non-admin actors",async()=>{
  const endpoint="/api/admin/staging/whatsapp-archive-credential-probe";
  await withServer({...isolated,APP_DEPLOYMENT_MODE:"production"},101,null,
    async base=>assert.equal((await fetch(base+endpoint)).status,404));
  await withServer(isolated,null,null,
    async base=>assert.equal((await fetch(base+endpoint)).status,403));
  await withServer({...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:undefined},101,null,
    async base=>{
      const r=await fetch(base+endpoint);
      assert.equal(r.status,200);
      const body=await r.json();
      assert.equal(body.status,"configuration_blocked");
      assert.equal(body.reader,"not_tested");
      assert.equal(body.liveArchive,"disabled");
      assert.equal(JSON.stringify(body).includes("synthetic-audit"),false);
    });
});

test("worker-only preflight requires exact isolated restricted worker credential",()=>{
  const valid = {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:
    "postgresql://kinglike_wa_archive_worker:synthetic-worker@archive-staging.railway.internal:5432/kinglike_whatsapp_archive"};
  assert.ok(stagingArchiveWorkerProbeConfig(valid));
  const invalid:NodeJS.ProcessEnv[] = [
    {...valid,APP_DEPLOYMENT_MODE:"production"},
    {...valid,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:undefined},
    {...valid,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:valid.WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL},
    {...valid,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:valid.WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL},
    {...valid,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:"postgresql://postgres:x@archive-staging.railway.internal/kinglike_whatsapp_archive"},
    {...valid,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:"postgresql://kinglike_wa_archive_worker:x@ep-live.neon.tech/neondb"},
    {...valid,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:"postgresql://kinglike_wa_archive_worker:synthetic-reader@archive-staging.railway.internal/kinglike_whatsapp_archive"},
    {...valid,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:"postgresql://kinglike_wa_archive_worker:x@archive-staging.railway.internal/kinglike_whatsapp_archive?options=unsafe"},
  ];
  invalid.forEach(x=>assert.equal(stagingArchiveWorkerProbeConfig(x),null));
});

test("worker probe blocker is coarse and never exposes a URL or password",()=>{
  const good = {...isolated,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:
    "postgresql://kinglike_wa_archive_worker:synthetic-worker@archive-staging.railway.internal:5432/kinglike_whatsapp_archive"};
  const cases:Array<[NodeJS.ProcessEnv,string|null]> = [
    [good,null],
    [{...good,APP_DEPLOYMENT_MODE:"production"},"staging_boundary"],
    [{...good,WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL:undefined},"reader_audit_configuration"],
    [{...good,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:undefined},"worker_url_missing"],
    [{...good,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:"synthetic-unresolved-reference"},"worker_url_invalid"],
    [{...good,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:"postgresql://other:synthetic-worker@archive-staging.railway.internal/kinglike_whatsapp_archive"},"worker_identity_mismatch"],
    [{...good,WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL:"postgresql://kinglike_wa_archive_worker:synthetic-reader@archive-staging.railway.internal/kinglike_whatsapp_archive"},"worker_password_reused"],
  ];
  for (const [env,expected] of cases) {
    const outcome=stagingArchiveWorkerProbeBlocker(env);
    assert.equal(outcome,expected);
    assert.ok(!JSON.stringify(outcome).includes("synthetic-worker"));
  }
});

test("worker probe rejects production and unauthenticated users and stays dormant",async()=>{
  const endpoint="/api/admin/staging/whatsapp-archive-worker-probe";
  await withServer({...isolated,APP_DEPLOYMENT_MODE:"production"},101,null,
    async base=>assert.equal((await fetch(base+endpoint)).status,404));
  await withServer(isolated,null,null,
    async base=>assert.equal((await fetch(base+endpoint)).status,403));
  await withServer(isolated,101,null,async base=>{
    const r=await fetch(base+endpoint);
    assert.equal(r.status,200);
    const body=await r.json();
    assert.equal(body.worker,"configuration_blocked");
    assert.equal(body.blocker,"worker_url_missing");
    assert.equal(body.liveArchive,"disabled");
    assert.equal(body.messagesWritten,0);
  });
});
