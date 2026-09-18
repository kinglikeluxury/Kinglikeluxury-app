import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db";
import { assertSafeKayMutationTestDatabase } from "./kayTestDatabaseSafety";
assertSafeKayMutationTestDatabase("kayPhaseB.integration");
import { claimKayEvaluationQueue, recordImmutableRescueEvaluation } from "./kayService";

after(async () => {
  await pool.end();
});

test("Phase B database has the isolated status trigger and unique decision event index", async () => {
  const result = await pool.query(`
    SELECT
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='kay_crm_lead_status_entry_trigger' AND NOT tgisinternal) AS trigger_ready,
      EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='kay_decisions_event_id_unique_idx') AS unique_index_ready
  `);
  assert.deepEqual(result.rows[0], { trigger_ready: true, unique_index_ready: true });
});

test("concurrent queue claims cannot claim the same Kay job", async () => {
  const seed = Math.floor(Date.now() % 100_000_000);
  const ids = [-2_000_000_000 + seed * 2, -2_000_000_000 + seed * 2 + 1];
  const keys = ids.map(id => `integration-claim:${id}`);
  try {
    await pool.query(
      `INSERT INTO kay_evaluator_queue (id, queue_key, lead_id, status, available_at)
       VALUES ($1,$2,NULL,'pending',NOW()-interval '1 hour'),($3,$4,NULL,'pending',NOW()-interval '1 hour')`,
      [ids[0], keys[0], ids[1], keys[1]],
    );
    const [a, b] = await Promise.all([claimKayEvaluationQueue(1), claimKayEvaluationQueue(1)]);
    const claimed = [a[0]?.id, b[0]?.id].sort((x, y) => Number(x) - Number(y));
    assert.deepEqual(claimed, [...ids].sort((x, y) => x - y));
  } finally {
    await pool.query(`DELETE FROM kay_evaluator_queue WHERE queue_key = ANY($1::text[])`, [keys]);
  }
});

test("24h to 12h rule change preserves history and one current recommendation", async () => {
  const marker = `KAY_PHASE_B_TEST:run:${process.env.KAY_TEST_RUN_ID}:${Date.now()}`;
  const statusEnteredAt = `2099-01-01T00:00:${String(Date.now() % 60).padStart(2, "0")}.000Z`;
  let leadId = 0;
  let keys: string[] = [];
  try {
    const lead = await pool.query(`INSERT INTO crm_leads
      (lead_source,full_name,status,notes)
      VALUES('manual',$1,'no_answer_1',$1) RETURNING id`, [marker]);
    leadId = Number(lead.rows[0].id);
    keys = [`integration-rule-24:${leadId}:${marker}`, `integration-rule-12:${leadId}:${marker}`];
    await recordImmutableRescueEvaluation({
      leadId, employeeId: null, evaluationKey: keys[0], decisionType: "no_answer_1_rescue_eligible", fingerprint: "integration-24",
      payload: { state: "ACTIVE", evaluation_state: "ACTIVE", status: "no_answer_1", status_entered_at: statusEnteredAt,
        threshold_minutes: 1440, rescue_rule_version: "phase_b_1", settings_snapshot: { no_answer_1_threshold_hours: 24 }, shadow: true },
    });
    await recordImmutableRescueEvaluation({
      leadId, employeeId: null, evaluationKey: keys[1], decisionType: "no_answer_1_rescue_eligible", fingerprint: "integration-12",
      payload: { state: "ACTIVE", evaluation_state: "ACTIVE", status: "no_answer_1", status_entered_at: statusEnteredAt,
        threshold_minutes: 720, rescue_rule_version: "phase_b_1", settings_snapshot: { no_answer_1_threshold_hours: 12 }, shadow: true },
    });
    const result = await pool.query(`
      SELECT d.payload FROM kay_decisions d JOIN kay_events e ON e.id=d.event_id
      WHERE e.idempotency_key = ANY($1::text[]) ORDER BY (d.payload->>'threshold_minutes')::int DESC
    `, [keys]);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].payload.threshold_minutes, 1440);
    assert.equal(result.rows[0].payload.settings_snapshot.no_answer_1_threshold_hours, 24);
    assert.equal(result.rows[0].payload.evaluation_state, "ACTIVE");
    assert.equal(result.rows[0].payload.state, "STALE");
    assert.equal(result.rows[1].payload.threshold_minutes, 720);
    assert.equal(result.rows[1].payload.state, "ACTIVE");
  } finally {
    if (keys.length) {
      await pool.query(`DELETE FROM kay_decisions WHERE event_id IN (SELECT id FROM kay_events WHERE idempotency_key = ANY($1::text[]))`, [keys]);
      await pool.query(`DELETE FROM kay_events WHERE idempotency_key = ANY($1::text[])`, [keys]);
    }
    if (leadId) {
      await pool.query(`DELETE FROM kay_lead_status_history WHERE lead_id=$1`, [leadId]);
      await pool.query(`DELETE FROM crm_leads WHERE id=$1 AND notes=$2`, [leadId, marker]);
    }
  }
});