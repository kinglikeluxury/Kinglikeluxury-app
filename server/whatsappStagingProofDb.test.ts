import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPECTED_WA_PROOF_SERVICE_ID,
  openWhatsappStagingProofDb,
  resolveWhatsappProofDbConfig,
} from "./whatsappStagingProofDb";

const validEnv: NodeJS.ProcessEnv = {
  APP_DEPLOYMENT_MODE: "staging",
  APP_STAGING_DATABASE_URL: "postgresql://app:password@app-staging.railway.internal/app_staging",
  APP_STAGING_DATABASE_EXPECTED_HOST: "app-staging.railway.internal",
  APP_STAGING_DATABASE_EXPECTED_NAME: "app_staging",
  PRODUCTION_DATABASE_HOST: "ep-prod.neon.tech",
  PRODUCTION_DATABASE_NAME: "neondb",
  APP_STAGING_DATABASE_CONFIRMATION: "isolated-app-stage-reviewed",
  APP_STAGING_STORAGE_CONFIRMATION: "isolated-app-stage-storage-reviewed",
  WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED: "true",
  WHATSAPP_STAGING_APPROVED_BUSINESS_PORTFOLIO_ID: "729915175562618",
  WHATSAPP_STAGING_APPROVED_EMPLOYEE_PHONE: "+995555000001",
  WHATSAPP_STAGING_EMPLOYEE_NOTICE_REVIEWED: "true",
  WHATSAPP_STAGING_PROOF_SCHEMA_REVIEWED: "true",
  WHATSAPP_STAGING_PROOF_SERVICE_ID: EXPECTED_WA_PROOF_SERVICE_ID,
  WHATSAPP_STAGING_PROOF_DATABASE_URL:
    "postgresql://wa_runtime:synthetic-password@postgres-3ccz.railway.internal/railway",
  WHATSAPP_STAGING_PROOF_EXPECTED_HOST: "postgres-3ccz.railway.internal",
  WHATSAPP_STAGING_PROOF_EXPECTED_NAME: "railway",
};

test("dedicated WhatsApp proof DB requires exact service and a separate private host", () => {
  const valid = resolveWhatsappProofDbConfig(validEnv);
  assert.ok(valid);
  assert.equal(valid.expectedHost, "postgres-3ccz.railway.internal");
  assert.equal(valid.expectedName, "railway");
  for (const override of [
    { APP_DEPLOYMENT_MODE: "production" },
    { WHATSAPP_STAGING_PROOF_SERVICE_ID: "not-the-dedicated-service" },
    { WHATSAPP_STAGING_PROOF_DATABASE_URL: validEnv.APP_STAGING_DATABASE_URL },
    { WHATSAPP_STAGING_PROOF_DATABASE_URL: "postgresql://app:pw@ep-prod.neon.tech/neondb" },
    { WHATSAPP_STAGING_PROOF_EXPECTED_HOST: "public.example.com" },
    { WHATSAPP_STAGING_PROOF_DATABASE_URL: "postgresql://wa_runtime:pw@postgres-3ccz.railway.internal/another" },
    { WHATSAPP_STAGING_PROOF_DATABASE_URL: "postgresql://wa_runtime:pw@postgres-3ccz.railway.internal/railway?options=-c" },
  ]) {
    assert.equal(resolveWhatsappProofDbConfig({ ...validEnv, ...override }), null);
  }
});

function healthyRows(sql: string): Array<Record<string, unknown>> {
  if (sql.startsWith("SELECT current_database()")) {
    return [{
      database_name: "railway", runtime_role: "wa_proof_runtime",
      is_superuser: false, database_owner: "postgres",
    }];
  }
  if (sql.includes("FROM pg_tables")) return [
    { tablename: "whatsapp_onboarding_flows", tableowner: "postgres" },
    { tablename: "whatsapp_onboarding_proofs", tableowner: "postgres" },
  ];
  if (sql.includes("has_schema_privilege")) {
    return {
      schema_usage: true,
      flow_select: true, flow_insert: true, flow_update: true,
      proof_select: true, proof_insert: true, proof_update: true,
    } as unknown as Array<Record<string, unknown>>;
  }
  throw new Error("Unexpected DB probe");
}

test("validates database identity, table schema and least-privilege grants before accepting pool", async () => {
  const queries: string[] = [];
  let ended = false;
  const pool = await openWhatsappStagingProofDb(validEnv, cfg => {
    assert.equal(cfg.expectedName, "railway");
    assert.ok(cfg.url.includes("wa_runtime:synthetic-password"));
    return {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("has_schema_privilege")) {
          return { rows: [{
            schema_usage: true,
            flow_select: true, flow_insert: true, flow_update: true,
            proof_select: true, proof_insert: true, proof_update: true,
          }] };
        }
        return { rows: healthyRows(sql) };
      },
      async end() { ended = true; },
    };
  });
  assert.ok(pool);
  assert.equal(queries.length, 3);
  assert.equal(ended, false);
  await pool.end();
  assert.equal(ended, true);
});

test("refuses wrong actual DB, superuser, DB owner, table owner, or missing grant", async () => {
  const cases = ["wrong-db", "superuser", "db-owner", "table-owner", "missing-insert"];
  for (const change of cases) {
    let ended = false;
    const pool = await openWhatsappStagingProofDb(validEnv, () => ({
      async query(sql: string) {
        if (sql.startsWith("SELECT current_database()")) {
          return { rows: [{
            database_name: change === "wrong-db" ? "neondb" : "railway",
            runtime_role: change === "db-owner" ? "postgres" : "wa_proof_runtime",
            is_superuser: change === "superuser",
            database_owner: change === "db-owner" ? "postgres" : "postgres",
          }] };
        }
        if (sql.includes("FROM pg_tables")) return { rows: [
          { tablename: "whatsapp_onboarding_flows", tableowner: change === "table-owner" ? "wa_proof_runtime" : "postgres" },
          { tablename: "whatsapp_onboarding_proofs", tableowner: "postgres" },
        ] };
        if (sql.includes("has_schema_privilege")) return { rows: [{
          schema_usage: true,
          flow_select: true, flow_insert: change !== "missing-insert", flow_update: true,
          proof_select: true, proof_insert: true, proof_update: true,
        }] };
        throw new Error("Unexpected SQL");
      },
      async end() { ended = true; },
    }));
    assert.equal(pool, null, change);
    assert.equal(ended, true, change);
  }
});

test("with missing approval the database factory is never called", async () => {
  let called = false;
  const pool = await openWhatsappStagingProofDb(
    { ...validEnv, WHATSAPP_STAGING_EMPLOYEE_NOTICE_REVIEWED: "false" },
    () => {
      called = true;
      throw new Error("must not connect");
    },
  );
  assert.equal(pool, null);
  assert.equal(called, false);
});

test("read-only preflight checks dedicated DB with all real Meta onboarding flags disabled", async () => {
  const env = {
    ...validEnv,
    WHATSAPP_STAGING_PROOF_PREFLIGHT_ENABLED: "true",
    WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED: "false",
    WHATSAPP_STAGING_META_GRAPH_VERIFIER_ENABLED: "false",
    WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED: "false",
    WHATSAPP_STAGING_EMPLOYEE_NOTICE_REVIEWED: "false",
  };
  let queries = 0;
  let closed = false;
  const db = await openWhatsappStagingProofDb(env, () => ({
    async query(sql: string) {
      queries++;
      if (sql.startsWith("SELECT current_database()")) return { rows: [{
        database_name: "railway", runtime_role: "wa_proof_runtime",
        is_superuser: false, database_owner: "postgres",
      }] };
      if (sql.includes("FROM pg_tables")) return { rows: [
        { tablename: "whatsapp_onboarding_flows", tableowner: "postgres" },
        { tablename: "whatsapp_onboarding_proofs", tableowner: "postgres" },
      ] };
      if (sql.includes("has_schema_privilege")) return { rows: [{
        schema_usage: true, flow_select: true, flow_insert: true, flow_update: true,
        proof_select: true, proof_insert: true, proof_update: true,
      }] };
      throw new Error("Unexpected query");
    },
    async end() { closed = true; },
  }));
  assert.ok(db);
  assert.equal(queries, 3);
  await db.end();
  assert.equal(closed, true);
  assert.equal(
    resolveWhatsappProofDbConfig({ ...env, APP_DEPLOYMENT_MODE: "production" }), null,
  );
  let invoked = false;
  const deny = await openWhatsappStagingProofDb(
    { ...env, APP_DEPLOYMENT_MODE: "production" },
    () => { invoked = true; throw Error("must not reach production DB"); },
  );
  assert.equal(deny, null);
  assert.equal(invoked, false);
});
