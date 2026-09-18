import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db";
import { assertSafeKayMutationTestDatabase, kaySyntheticMarker } from "./kayTestDatabaseSafety";
import { runKayE21ReadonlyAudit } from "./kayAutoRescueAuditService";

// This suite is deliberately opt-in: it creates and removes only marked
// synthetic rows, never changes rescue settings, and never runs a worker.
const enabled = process.env.KAY_E21_POSTGRES_TESTS === "true";
assertSafeKayMutationTestDatabase("kayPhaseE21.integration");
const marker = kaySyntheticMarker("KAY_E21_TEST");
let ids: number[] = [];
let ownerId = 0;

after(async () => {
  await pool.end();
});

test("E.2.1 read-only snapshot paginates and cannot mutate", { skip: !enabled }, async () => {
  try {
    const owner = await pool.query(`INSERT INTO users
      (username,password,role,is_admin,is_active)
      VALUES($1,'x','sub_agent',false,true) RETURNING id`, [`${marker}:owner`]);
    ownerId = Number(owner.rows[0].id);
    const safetyBefore = await pool.query(`SELECT key,value FROM kay_settings WHERE key IN ('mode','rescue_rules') ORDER BY key`);
    const inserted = await pool.query(`INSERT INTO crm_leads(lead_source,full_name,status,assigned_to,notes)
      SELECT 'manual',$1||':'||g,'no_answer_1',$2,$1 FROM generate_series(1,251) g RETURNING id`, [marker, ownerId]);
    ids = inserted.rows.map(r => Number(r.id));
    await pool.query(`INSERT INTO kay_lead_status_history(lead_id,status,entered_at,event_key)
      SELECT id,'no_answer_1',NOW()-interval '48 hours',$1||':window:'||id FROM crm_leads WHERE id=ANY($2::int[])`, [marker, ids]);
    const report = await runKayE21ReadonlyAudit({ verifyWriteRejectionForTest: true });
    assert.ok(report.fullPopulation.relevantEvaluated >= 251, "keyset audit must pass the 250-row page boundary");
    assert.equal(report.integrity.deltas.crm_leads, 0);
    assert.equal(report.integrity.readOnlyWriteRejectionProven, true);
    assert.equal(report.integrity.integrityFailed, false);
    assert.ok(["SHADOW", "ASSISTED", "CONTROLLED_AUTOMATION"].includes(report.safetyState.mode));
    assert.equal(JSON.stringify(report).match(/full_name|phone|email|notes/gi), null, "report must exclude PII fields");
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "on");
      await assert.rejects(() => client.query(`UPDATE crm_leads SET status='new' WHERE id=$1`, [ids[0]]));
      await client.query("ROLLBACK");
    } finally { client.release(); }
    const after = await pool.query(`SELECT key,value FROM kay_settings WHERE key IN ('mode','rescue_rules') ORDER BY key`);
    assert.deepEqual(after.rows, safetyBefore.rows, "audit leaves safety state unchanged");
  } finally {
    if (ids.length) {
      await pool.query(`DELETE FROM kay_lead_status_history WHERE lead_id=ANY($1::int[])`, [ids]);
      await pool.query(`DELETE FROM crm_leads WHERE id=ANY($1::int[]) AND notes=$2`, [ids, marker]);
    }
    if (ownerId) {
      await pool.query(`DELETE FROM users WHERE id=$1 AND username=$2`, [ownerId, `${marker}:owner`]);
    }
  }
});
