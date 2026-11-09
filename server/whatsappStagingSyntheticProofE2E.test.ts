import assert from "node:assert/strict";
import test from "node:test";
import {
  runSyntheticWhatsappProofE2E,
  syntheticProofProbeApproved,
  type SyntheticProofPool,
} from "./whatsappStagingSyntheticProofE2E";

const env: NodeJS.ProcessEnv = {
  APP_DEPLOYMENT_MODE: "staging",
  APP_STAGING_DATABASE_URL: "postgresql://app:password@app-staging.railway.internal/app_staging",
  APP_STAGING_DATABASE_EXPECTED_HOST: "app-staging.railway.internal",
  APP_STAGING_DATABASE_EXPECTED_NAME: "app_staging",
  PRODUCTION_DATABASE_HOST: "ep-prod.neon.tech",
  PRODUCTION_DATABASE_NAME: "neondb",
  APP_STAGING_DATABASE_CONFIRMATION: "isolated-stage-confirmed",
  APP_STAGING_STORAGE_CONFIRMATION: "isolated-stage-storage-confirmed",
  WHATSAPP_STAGING_PROOF_SERVICE_ID: "3991af5c-76a5-4739-926f-60c11f5cfd68",
  WHATSAPP_STAGING_PROOF_DATABASE_URL:
    "postgresql://restricted:synthetic-password@wa-proof.railway.internal/railway",
  WHATSAPP_STAGING_PROOF_EXPECTED_HOST: "wa-proof.railway.internal",
  WHATSAPP_STAGING_PROOF_EXPECTED_NAME: "railway",
  WHATSAPP_STAGING_PROOF_PREFLIGHT_ENABLED: "true",
  WHATSAPP_STAGING_SYNTHETIC_PROOF_PROBE_ENABLED: "true",
  WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED: "false",
  WHATSAPP_STAGING_META_GRAPH_VERIFIER_ENABLED: "false",
  WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED: "false",
  WHATSAPP_EMPLOYEE_MONITORING_ENABLED: "false",
};

type Row = Record<string, any>;

function fakeProofDb() {
  let flows: Row[] = [], proofs: Row[] = [], tx = false, released = false;
  const db: SyntheticProofPool = {
    async query(sql) {
      if (sql.includes("SELECT COUNT(*) FROM kinglike_whatsapp")) return {
        rows: [{ flows: flows.length, proofs: proofs.length }],
      };
      throw Error("Unexpected pool query");
    },
    async connect() {
      if (released) throw Error("Already released");
      return {
        async query(sql, args: any[] = []) {
          if (sql === "BEGIN") {
            if (tx) throw Error("Nested transaction");
            tx = true;
            return { rows: [] };
          }
          if (sql === "ROLLBACK") {
            flows = [];
            proofs = [];
            tx = false;
            return { rows: [] };
          }
          if (!tx) throw Error("Synthetic write without explicit transaction");
          if (sql.includes("SELECT COUNT(*) FROM kinglike_whatsapp")) {
            return { rows: [{ flows: flows.length, proofs: proofs.length }] };
          }
          if (sql.startsWith("INSERT INTO kinglike_whatsapp.whatsapp_onboarding_flows")) {
            flows.push({
              id: args[0], actorId: args[1], sessionHash: args[2],
              origin: args[3], stateHash: args[4], csrfHash: args[5], expiresAt: args[6],
              consumed: false,
            });
            return { rows: [] };
          }
          if (sql.startsWith("UPDATE kinglike_whatsapp.whatsapp_onboarding_flows")) {
            const flow = flows.find(x=>x.id === args[0] && x.actorId === args[1] &&
              x.sessionHash === args[2] && x.origin === args[3] &&
              x.stateHash === args[4] && x.csrfHash === args[5] && !x.consumed);
            if (!flow) return { rows: [] };
            flow.consumed = true;
            return { rows: [{
              flow_id: flow.id, actor_id: flow.actorId,
              origin: flow.origin, consumed_at: new Date(),
            }] };
          }
          if (sql.startsWith("INSERT INTO kinglike_whatsapp.whatsapp_onboarding_proofs")) {
            proofs.push({ portfolio: args[0], waba: args[1], phoneId: args[2] });
            return { rows: [] };
          }
          throw Error("Unexpected SQL operation");
        },
        release() { released = true; },
      };
    },
  };
  return { db, getState: () => ({ flows: flows.length, proofs: proofs.length, tx, released }) };
}

test("probe rejects production and any employee activation before opening DB", async () => {
  for (const changed of [
    { APP_DEPLOYMENT_MODE: "production" },
    { WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED: "true" },
    { WHATSAPP_STAGING_META_GRAPH_VERIFIER_ENABLED: "true" },
    { WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED: "true" },
    { WHATSAPP_EMPLOYEE_MONITORING_ENABLED: "true" },
    { WHATSAPP_STAGING_SYNTHETIC_PROOF_PROBE_ENABLED: "false" },
    { WHATSAPP_STAGING_PROOF_PREFLIGHT_ENABLED: "false" },
    { WHATSAPP_STAGING_PROOF_DATABASE_URL: env.APP_STAGING_DATABASE_URL },
  ]) {
    const attempt = { ...env, ...changed };
    assert.equal(syntheticProofProbeApproved(attempt), false);
    const { db } = fakeProofDb();
    await assert.rejects(runSyntheticWhatsappProofE2E(db, attempt));
  }
});

test("same proof implementation validates fake Meta callback, replay and DB rollback", async () => {
  const mock = fakeProofDb();
  const result = await runSyntheticWhatsappProofE2E(mock.db, env);
  assert.deepEqual(result, {
    status: "synthetic_verified_rolled_back",
    realNumbersConnected: false,
    recordsPersisted: 0,
    metaRequests: 0,
  });
  assert.deepEqual(mock.getState(), {
    flows: 0, proofs: 0, tx: false, released: true,
  });
});

test("probe refuses a database already containing an enrollment record", async () => {
  let connected = false;
  const db: SyntheticProofPool = {
    async query() { return { rows: [{ flows: 0, proofs: 1 }] }; },
    async connect() { connected = true; throw Error("Must not begin"); },
  };
  await assert.rejects(runSyntheticWhatsappProofE2E(db, env));
  assert.equal(connected, false);
});
