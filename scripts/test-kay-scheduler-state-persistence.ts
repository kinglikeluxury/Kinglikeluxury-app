import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertSafeKayMutationTestDatabase } from "../server/kayTestDatabaseSafety";
import {
  persistKayRecommendationSchedulerState,
  readKayRecommendationSchedulerState,
} from "../server/kayRecommendationSchedulerState";

const STATE_KEY = "recommendation_scheduler_health";
const thisFile = fileURLToPath(import.meta.url);
const fixtureRunId = process.env.KAY_TEST_RUN_ID ?? randomUUID();
const fixtureTime = "2001-02-03T04:05:06.000Z";

function isolatedEnvironment() {
  const keys = [
    "KAY_TEST_DATABASE_URL",
    "KAY_TEST_RUN_ID",
    "KAY_TEST_NEON_PROJECT_ID",
    "KAY_TEST_NEON_CLUSTER_ID",
    "KAY_TEST_DATABASE_USER",
    "KAY_TEST_DATABASE_CREDENTIAL_ID",
    "KAY_PRODUCTION_DATABASE_HOST",
    "KAY_PRODUCTION_DATABASE_USER",
    "NEON_PROJECT_ID",
    "NEON_CLUSTER_ID",
    "NEON_DATABASE_CREDENTIAL_ID",
  ];
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", KAY_ALLOW_DESTRUCTIVE_TEST_DATABASE: "true" };
  env.KAY_TEST_RUN_ID = fixtureRunId;
  for (const key of keys) if (process.env[key]) env[key] = process.env[key];
  assert.equal(env.KAY_RECOMMENDATION_SCHEDULER_ENABLED, undefined);
  assertSafeKayMutationTestDatabase("kaySchedulerState.persistence", env);
  return env;
}

function runChild(mode: string, extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["--import", "tsx", thisFile, mode], {
    encoding: "utf8",
    env: { ...isolatedEnvironment(), ...extraEnv },
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${mode} subprocess failed (output withheld)`);
  return JSON.parse(result.stdout.trim());
}

async function childMain(mode: string) {
  neonConfig.webSocketConstructor = ws;
  const env = isolatedEnvironment();
  assertSafeKayMutationTestDatabase(`kaySchedulerState.${mode}`, env);
  const pool = new Pool({ connectionString: env.KAY_TEST_DATABASE_URL, max: 1 });
  try {
    if (mode === "seed") {
      const identity = await pool.query("SELECT current_database() AS db,current_user AS username");
      const safe = assertSafeKayMutationTestDatabase("kaySchedulerState.seed", env);
      assert.equal(identity.rows[0]?.db, safe.database);
      assert.equal(identity.rows[0]?.username, env.KAY_TEST_DATABASE_USER);
      const prior = await pool.query("SELECT value,updated_at FROM kay_runtime_state WHERE key=$1", [STATE_KEY]);
      const previous = prior.rows[0] ?? null;
      await persistKayRecommendationSchedulerState({
        enabledObserved: false,
        lastRunAt: fixtureTime,
        lastResult: "PASS",
        checkedCount: 17,
        recommendationCount: 6,
        eligibleCount: 6,
        staleCount: 2,
        disabledReason: "FIXTURE_DISABLED",
        errorCode: null,
      });
      console.log(JSON.stringify({ previous: previous ? { value: previous.value, updatedAt: previous.updated_at } : null }));
      return;
    }
    if (mode === "read") {
      const state = await readKayRecommendationSchedulerState();
      assert.equal(state.lastRunAt, fixtureTime);
      assert.equal(state.lastResult, "PASS");
      assert.equal(state.checkedCount, 17);
      assert.equal(state.recommendationCount, 6);
      assert.equal(state.eligibleCount, 6);
      assert.equal(state.staleCount, 2);
      assert.equal(state.disabledReason, "FIXTURE_DISABLED");
      console.log(JSON.stringify({ processRecreated: true, valuesMatched: true }));
      return;
    }
    if (mode === "restore") {
      const prior = JSON.parse(process.env.KAY_STATE_PRIOR_ROW ?? "null");
      if (prior) {
        await pool.query(
          `INSERT INTO kay_runtime_state(key,value,updated_at) VALUES($1,$2::jsonb,$3)
           ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`,
          [STATE_KEY, JSON.stringify(prior.value), prior.updatedAt],
        );
        const restored = await pool.query("SELECT value,updated_at FROM kay_runtime_state WHERE key=$1", [STATE_KEY]);
        assert.deepEqual(restored.rows[0]?.value, prior.value);
        assert.equal(new Date(restored.rows[0]?.updated_at).toISOString(), new Date(prior.updatedAt).toISOString());
      } else {
        await pool.query("DELETE FROM kay_runtime_state WHERE key=$1", [STATE_KEY]);
        const restored = await pool.query("SELECT 1 FROM kay_runtime_state WHERE key=$1", [STATE_KEY]);
        assert.equal(restored.rowCount, 0);
      }
      console.log(JSON.stringify({ baselineRestored: true }));
      return;
    }
    throw new Error("unknown test mode");
  } finally {
    await pool.end();
  }
}

if (process.argv[2]) {
  await childMain(process.argv[2]);
} else {
  isolatedEnvironment();
  assert.equal(process.env.KAY_RECOMMENDATION_SCHEDULER_ENABLED, undefined, "scheduler opt-in must remain absent");
  const seeded = runChild("seed");
  const prior = JSON.stringify(seeded.previous);
  let readVerified = false;
  try {
    runChild("read");
    readVerified = true;
  } finally {
    runChild("restore", { KAY_STATE_PRIOR_ROW: prior });
  }
  assert.equal(readVerified, true);
  console.log(JSON.stringify({
    result: "PASS",
    testDatabase: "kay_testing",
    processRecreated: true,
    schedulerEnabled: false,
    schedulerCycleRun: false,
    fixtureCleaned: true,
    baselineRestored: true,
  }));
}
