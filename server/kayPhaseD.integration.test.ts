import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { ensureKayTables, pool } from "./db";
import { assertSafeKayMutationTestDatabase } from "./kayTestDatabaseSafety";
assertSafeKayMutationTestDatabase("kayPhaseD.integration");
import { acquirePhaseDLease, acknowledgeBriefing, completeCommitment, evaluatePhaseD } from "./kayPhaseDService";

before(async () => { await ensureKayTables(); });
after(async () => { await pool.end(); });

async function employeeId() {
  const result = await pool.query(`SELECT id FROM users ORDER BY id LIMIT 1`);
  assert.ok(result.rows[0]?.id, "Phase D integration tests require one user");
  return Number(result.rows[0].id);
}

test("Phase D database provides isolated tables, lifecycle columns, and unique dedupe indexes", async () => {
  const result = await pool.query(`SELECT
    to_regclass('public.kay_commitments') IS NOT NULL AS commitments,
    to_regclass('public.kay_promises') IS NOT NULL AS promises,
    to_regclass('public.kay_manager_reviews') IS NOT NULL AS reviews,
    to_regclass('public.kay_internal_briefings') IS NOT NULL AS briefings,
    EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='kay_commitments_idempotency_key_unique_idx') AS commitment_dedupe,
    EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='kay_promises_idempotency_key_unique_idx') AS promise_dedupe,
    EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='kay_manager_reviews_idempotency_key_unique_idx') AS review_dedupe,
    EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='kay_internal_briefings_idempotency_key_unique_idx') AS briefing_dedupe`);
  assert.deepEqual(result.rows[0], { commitments: true, promises: true, reviews: true, briefings: true, commitment_dedupe: true, promise_dedupe: true, review_dedupe: true, briefing_dedupe: true });
});

test("Phase D concurrent review creation has exactly one idempotent winner", async () => {
  const key = `phase-d-review:${Date.now()}:${Math.random()}`;
  try {
    const insert = () => pool.query(`INSERT INTO kay_manager_reviews(reason,idempotency_key,details)
      VALUES ('TEST_DEDUPE',$1,'{"internalOnly":true}'::jsonb)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, [key]);
    const [a, b] = await Promise.all([insert(), insert()]);
    assert.equal(a.rowCount! + b.rowCount!, 1);
  } finally { await pool.query(`DELETE FROM kay_manager_reviews WHERE idempotency_key=$1`, [key]); }
});

test("Phase D concurrent promise persistence has exactly one idempotent winner", async () => {
  const [employee, lead] = await Promise.all([employeeId(), pool.query(`SELECT id FROM crm_leads ORDER BY id LIMIT 1`)]);
  assert.ok(lead.rows[0]?.id, "Phase D integration tests require one CRM lead");
  const key = `phase-d-promise:${Date.now()}:${Math.random()}`;
  try {
    const insert = () => pool.query(`INSERT INTO kay_promises(lead_id,employee_id,promise_text,importance,due_at,idempotency_key,details)
      VALUES ($1,$2,'Internal promise persistence test','IMPORTANT',NOW()+interval '1 day',$3,'{"internalOnly":true}'::jsonb)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, [Number(lead.rows[0].id), employee, key]);
    const [a, b] = await Promise.all([insert(), insert()]);
    assert.equal(a.rowCount! + b.rowCount!, 1);
  } finally { await pool.query(`DELETE FROM kay_promises WHERE idempotency_key=$1`, [key]); }
});

test("Phase D commitment lifecycle persists the configured extension cap without CRM writes", async () => {
  const employee = await employeeId();
  const leadBefore = await pool.query(`SELECT id, assigned_to, status FROM crm_leads ORDER BY id LIMIT 1`);
  assert.ok(leadBefore.rows[0]?.id, "Phase D integration tests require one CRM lead");
  const key = `phase-d-commitment:${Date.now()}:${Math.random()}`;
  try {
    const created = await pool.query(`INSERT INTO kay_commitments(employee_id,action,due_at,max_extensions,idempotency_key,details)
      VALUES ($1,'Internal lifecycle test',NOW()+interval '1 day',2,$2,'{"internalOnly":true}'::jsonb) RETURNING id,max_extensions,status`, [employee, key]);
    assert.deepEqual(created.rows[0].max_extensions, 2);
    assert.equal(created.rows[0].status, "PENDING");
    const completed = await completeCommitment(Number(created.rows[0].id), employee, true);
    assert.equal(completed.status, "COMPLETED");
    const persisted = await pool.query(`SELECT status, completed_at IS NOT NULL AS completed FROM kay_commitments WHERE id=$1`, [created.rows[0].id]);
    assert.deepEqual(persisted.rows[0], { status: "COMPLETED", completed: true });
    const leadAfter = await pool.query(`SELECT id, assigned_to, status FROM crm_leads WHERE id=$1`, [leadBefore.rows[0].id]);
    assert.deepEqual(leadAfter.rows[0], leadBefore.rows[0]);
  } finally { await pool.query(`DELETE FROM kay_commitments WHERE idempotency_key=$1`, [key]); }
});

test("Phase D briefing dedupe and acknowledgement are persisted and cannot cross employee ownership", async () => {
  const employee = await employeeId();
  const key = `phase-d-briefing:${Date.now()}:${Math.random()}`;
  try {
    const insert = () => pool.query(`INSERT INTO kay_internal_briefings(employee_id,trigger_type,severity,text,idempotency_key)
      VALUES ($1,'TEST','NORMAL','Internal test briefing',$2) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`, [employee, key]);
    const [a, b] = await Promise.all([insert(), insert()]);
    assert.equal(a.rowCount! + b.rowCount!, 1);
    const selected = await pool.query(`SELECT id FROM kay_internal_briefings WHERE idempotency_key=$1`, [key]);
    const id = Number(selected.rows[0].id);
    const acknowledged = await acknowledgeBriefing(id, employee, false);
    assert.ok(acknowledged.acknowledgedAt);
    await assert.rejects(() => acknowledgeBriefing(id, employee + 99999999, false), (error: any) => error?.status === 404);
    const stored = await pool.query(`SELECT acknowledged_at IS NOT NULL AS acknowledged FROM kay_internal_briefings WHERE id=$1`, [id]);
    assert.equal(stored.rows[0].acknowledged, true);
  } finally { await pool.query(`DELETE FROM kay_internal_briefings WHERE idempotency_key=$1`, [key]); }
});

test("Phase D evaluator lease permits only one concurrent holder", async () => {
  const previous = await pool.query(`SELECT value FROM kay_settings WHERE key='phase_d_evaluator_lease'`);
  try {
    await pool.query(`INSERT INTO kay_settings(key,value) VALUES ('phase_d_evaluator_lease','{"released":true}'::jsonb)
      ON CONFLICT(key) DO UPDATE SET value='{"released":true}'::jsonb`);
    const [a, b] = await Promise.all([acquirePhaseDLease(), acquirePhaseDLease()]);
    assert.equal([a, b].filter(Boolean).length, 1);
  } finally {
    if (previous.rows[0]) await pool.query(`UPDATE kay_settings SET value=$1::jsonb WHERE key='phase_d_evaluator_lease'`, [JSON.stringify(previous.rows[0].value)]);
    else await pool.query(`DELETE FROM kay_settings WHERE key='phase_d_evaluator_lease'`);
  }
});

test("Phase D lost lease aborts before any evaluator write", async () => {
  const employee = await employeeId();
  const key = `phase-d-lost-lease:${Date.now()}:${Math.random()}`;
  const previousLease = await pool.query(`SELECT value FROM kay_settings WHERE key='phase_d_evaluator_lease'`);
  const previousSettings = await pool.query(`SELECT value FROM kay_settings WHERE key='phase_d_workflow'`);
  try {
    await pool.query(`INSERT INTO kay_commitments(employee_id,action,status,due_at,idempotency_key,details)
      VALUES ($1,'Fencing test','PENDING',NOW()-interval '1 minute',$2,'{"internalOnly":true}'::jsonb)`, [employee, key]);
    const enabled = { ...(previousSettings.rows[0]?.value || {}), enabled: true };
    await pool.query(`INSERT INTO kay_settings(key,value) VALUES ('phase_d_workflow',$1::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(enabled)]);
    await pool.query(`INSERT INTO kay_settings(key,value) VALUES ('phase_d_evaluator_lease',$1::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ token: "current-owner", locked_until: new Date(Date.now() + 60_000).toISOString() })]);
    const result = await evaluatePhaseD("stale-owner", 10);
    assert.equal((result as any).aborted, "lease_lost");
    const unchanged = await pool.query(`SELECT status FROM kay_commitments WHERE idempotency_key=$1`, [key]);
    assert.equal(unchanged.rows[0].status, "PENDING");
  } finally {
    await pool.query(`DELETE FROM kay_commitments WHERE idempotency_key=$1`, [key]);
    if (previousLease.rows[0]) await pool.query(`UPDATE kay_settings SET value=$1::jsonb WHERE key='phase_d_evaluator_lease'`, [JSON.stringify(previousLease.rows[0].value)]);
    else await pool.query(`DELETE FROM kay_settings WHERE key='phase_d_evaluator_lease'`);
    if (previousSettings.rows[0]) await pool.query(`UPDATE kay_settings SET value=$1::jsonb WHERE key='phase_d_workflow'`, [JSON.stringify(previousSettings.rows[0].value)]);
  }
});