import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { ensureKayTables, pool } from "./db";
import { getRescueSettings, rescueSettingsSchema, validateKayModeUpdate } from "./kayService";
import { getAutoRescueReadiness, runKayAutoRescueWorker } from "./kayAutoRescueService";

// This suite intentionally uses PostgreSQL only when a maintainer explicitly
// opts in. It never creates data on an ordinary developer/production run.
const enabled = process.env.KAY_E2_POSTGRES_TESTS === "true";
const marker = `KAY_E2_TEST:${Date.now()}:${Math.random().toString(36).slice(2)}`;
let priorMode: any; let priorRules: any; const ids: number[] = [];

before(async () => {
  if (!enabled) return;
  await ensureKayTables();
  priorMode = (await pool.query(`SELECT value FROM kay_settings WHERE key='mode'`)).rows[0]?.value;
  priorRules = (await pool.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`)).rows[0]?.value;
});
after(async () => {
  if (!enabled) return;
  try {
    if (ids.length) {
      await pool.query(`DELETE FROM kay_auto_rescue_queue WHERE lead_id=ANY($1::int[])`, [ids]);
      await pool.query(`DELETE FROM kay_rescue_executions WHERE lead_id=ANY($1::int[])`, [ids]);
      await pool.query(`DELETE FROM lead_assignment_history WHERE lead_id=ANY($1::int[])`, [ids]);
      await pool.query(`DELETE FROM kay_decisions WHERE lead_id=ANY($1::int[])`, [ids]);
      await pool.query(`DELETE FROM kay_events WHERE lead_id=ANY($1::int[])`, [ids]);
      await pool.query(`DELETE FROM kay_lead_status_history WHERE lead_id=ANY($1::int[])`, [ids]);
      await pool.query(`DELETE FROM crm_leads WHERE id=ANY($1::int[]) AND notes=$2`, [ids, marker]);
    }
  } finally {
    // Production safety invariant, even if a test fails mid-cycle.
    await pool.query(`INSERT INTO kay_settings(key,value) VALUES('mode','{"mode":"shadow"}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
    await pool.query(`UPDATE kay_settings SET value=value || '{"auto_rescue_no_answer_1_enabled":false,"auto_rescue_no_answer_2_enabled":false,"auto_rescue_kill_switch":true,"auto_rescue_canary_employee_ids":[]}'::jsonb WHERE key='rescue_rules'`);
  }
});

test("E.2 strict mode/settings safety contract", async () => {
  assert.equal(validateKayModeUpdate({ mode: "controlled_automation" }).ok, true);
  assert.equal(validateKayModeUpdate({ mode: "full_approved_automation" }).ok, false);
  const rules = rescueSettingsSchema.parse({ ...await getRescueSettings() });
  assert.equal(rules.auto_rescue_daily_limit >= 1 && rules.auto_rescue_daily_limit <= 50, true);
  assert.equal(rules.rescue_grace_minutes >= 10 && rules.rescue_grace_minutes <= 60, true);
});

test("E.2 worker is fail-closed in shadow and dry run writes no queue rows", async () => {
  if (!enabled) return;
  await pool.query(`UPDATE kay_settings SET value='{"mode":"shadow"}'::jsonb WHERE key='mode'`);
  const before = Number((await pool.query(`SELECT count(*)::int n FROM kay_auto_rescue_queue`)).rows[0].n);
  const result = await runKayAutoRescueWorker();
  assert.equal(result.disabled, true);
  await getAutoRescueReadiness(20);
  const afterCount = Number((await pool.query(`SELECT count(*)::int n FROM kay_auto_rescue_queue`)).rows[0].n);
  assert.equal(afterCount, before);
});