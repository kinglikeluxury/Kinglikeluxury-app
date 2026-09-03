import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { ensureKayTables, pool } from "./db";
import {
  acceptPromiseHandoff,
  executeAssistedRescue,
  listPromiseHandoffs,
  setAssistedRescueTestHook,
  undoAssistedRescue,
} from "./kayRescueService";

const marker = `KAY_E1_TEST:${Date.now()}:${Math.random().toString(36).slice(2)}`;
const leadIds: number[] = [];
let adminId = 0;
let ownerId = 0;
let targetId = 0;
let otherTargetId = 0;
let nonAdminId = 0;

async function setMode(mode: "shadow" | "assisted") {
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES('mode',$1::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({ mode })]);
}

async function fixture(options: { target?: number; threshold?: number } = {}) {
  const lead = await pool.query(`INSERT INTO crm_leads(lead_source,full_name,status,assigned_to,notes,wa_stage)
    VALUES('manual',$1,'no_answer_1',$2,$3,'new_lead') RETURNING id,status`, [`${marker} controlled lead`, ownerId, marker]);
  const leadId = Number(lead.rows[0].id);
  leadIds.push(leadId);
  // Replace the bootstrap trigger's immediate insert with one exact controlled
  // status window so service revalidation and the decision fingerprint agree.
  await pool.query(`DELETE FROM kay_lead_status_history WHERE lead_id=$1`, [leadId]);
  const entered = (await pool.query(`INSERT INTO kay_lead_status_history(lead_id,status,entered_at,event_key)
    VALUES($1,'no_answer_1',NOW()-interval '2 hours',$2) RETURNING entered_at`, [leadId, `${marker}:status:${leadId}`])).rows[0].entered_at;
  const event = await pool.query(`INSERT INTO kay_events(lead_id,event_type,event_source,metadata,kay_generated,idempotency_key)
    VALUES($1,'shadow_rescue_evaluated','test',$2::jsonb,false,$3) RETURNING id`,
    [leadId, JSON.stringify({ marker }), `${marker}:event:${leadId}`]);
  const payload = {
    state: "ACTIVE", status: "no_answer_1", status_entered_at: new Date(entered).toISOString(),
    threshold_minutes: options.threshold ?? 1, max_rescue_attempts: 2,
    recommended_employee_id: options.target ?? targetId,
    settings_snapshot: { assisted_rescue_undo_minutes: 15 },
  };
  const decision = await pool.query(`INSERT INTO kay_decisions(lead_id,event_id,decision_type,mode,rationale,payload)
    VALUES($1,$2,'no_answer_1_rescue_eligible','shadow','controlled E.1 test',$3::jsonb) RETURNING id`,
    [leadId, event.rows[0].id, JSON.stringify(payload)]);
  return { leadId, decisionId: Number(decision.rows[0].id), command: { leadId, decisionId: Number(decision.rows[0].id), expectedOwnerId: ownerId } };
}

async function rejected(command: any, actor: number, code: string) {
  await assert.rejects(() => executeAssistedRescue(command, actor), (error: any) => error?.code === code);
  const audit = await pool.query(`SELECT outcome,rejection_reason FROM kay_rescue_executions
    WHERE lead_id=$1 AND decision_id=$2 ORDER BY id DESC LIMIT 1`, [command.leadId, command.decisionId]);
  assert.deepEqual(audit.rows[0], { outcome: "REJECTED", rejection_reason: code });
}

before(async () => {
  process.env.KAY_E1_TEST_HOOKS = "true";
  await ensureKayTables();
  await pool.query(`SELECT value FROM kay_settings WHERE key='mode'`);
  const users = await pool.query(`INSERT INTO users(username,password,is_admin,role) VALUES
    ($1,'x',true,'admin'),($2,'x',false,'sub_agent'),($3,'x',false,'sub_agent'),
    ($4,'x',false,'sub_agent'),($5,'x',false,'user') RETURNING id,username`,
    [`${marker}:admin`, `${marker}:owner`, `${marker}:target`, `${marker}:other`, `${marker}:nonadmin`]);
  const ids = Object.fromEntries(users.rows.map((row: any) => [row.username.split(":").pop(), Number(row.id)]));
  adminId = ids.admin; ownerId = ids.owner; targetId = ids.target; otherTargetId = ids.other; nonAdminId = ids.nonadmin;
});

test("E.1 promise handoff catalog uses nullable SET NULL history references", async () => {
  const catalog = await pool.query(`SELECT a.attname, a.attnotnull, c.confdeltype
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY k(attnum,ord) ON true
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
    WHERE c.contype='f' AND c.conrelid='kay_promise_handoffs'::regclass
      AND a.attname=ANY(ARRAY['promise_id','lead_id','original_owner_id','current_responsible_id'])
    ORDER BY a.attname`);
  assert.equal(catalog.rows.length, 4);
  for (const row of catalog.rows) {
    assert.equal(row.attnotnull, false, `${row.attname} must remain nullable`);
    assert.equal(row.confdeltype, "n", `${row.attname} must use ON DELETE SET NULL`);
  }
});

after(async () => {
  try {
    setAssistedRescueTestHook();
    if (leadIds.length) {
      await pool.query(`DELETE FROM kay_promise_handoffs WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM kay_rescue_executions WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM lead_assignment_history WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM kay_internal_briefings WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM user_notifications WHERE (data->>'leadId') = ANY($1::text[])`, [leadIds.map(String)]);
      await pool.query(`DELETE FROM kay_commitments WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM kay_promises WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM kay_missions WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM crm_tasks WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM kay_lead_protection WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM kay_decisions WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM kay_events WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM kay_lead_status_history WHERE lead_id=ANY($1::int[])`, [leadIds]);
      await pool.query(`DELETE FROM crm_leads WHERE id=ANY($1::int[]) AND notes=$2`, [leadIds, marker]);
    }
    await pool.query(`DELETE FROM users WHERE username LIKE $1`, [`${marker}%`]);
  } finally {
    // Never leave a shared database executable after a controlled test failure.
    await setMode("shadow");
  }
});

test("E.1 uses controlled PostgreSQL rows for rejects and audit", async () => {
  const shadow = await fixture();
  await setMode("shadow");
  await rejected(shadow.command, adminId, "MODE_NOT_ASSISTED");
  await setMode("assisted");
  const notAdmin = await fixture();
  await rejected(notAdmin.command, nonAdminId, "NOT_ADMIN");

  const stale = await fixture();
  await pool.query(`UPDATE kay_decisions SET payload=jsonb_set(payload,'{state}','"STALE"') WHERE id=$1`, [stale.decisionId]);
  await rejected(stale.command, adminId, "STALE_RECOMMENDATION");
  const status = await fixture();
  await pool.query(`UPDATE crm_leads SET status='follow_up' WHERE id=$1`, [status.leadId]);
  await pool.query(`UPDATE kay_decisions SET payload=jsonb_set(payload,'{state}','"ACTIVE"') WHERE id=$1`, [status.decisionId]);
  await rejected(status.command, adminId, "STATE_CHANGED");
  const owner = await fixture();
  await pool.query(`UPDATE crm_leads SET assigned_to=$1 WHERE id=$2`, [otherTargetId, owner.leadId]);
  await rejected(owner.command, adminId, "OWNER_CHANGED");
  const protectedLead = await fixture();
  await pool.query(`INSERT INTO kay_lead_protection(lead_id,reason) VALUES($1,'KAY_E1_TEST')`, [protectedLead.leadId]);
  await rejected(protectedLead.command, adminId, "PROTECTED");
  const blocker = await fixture();
  await pool.query(`INSERT INTO crm_tasks(lead_id,title) VALUES($1,$2)`, [blocker.leadId, marker]);
  await rejected(blocker.command, adminId, "BLOCKER_ADDED");
  const threshold = await fixture({ threshold: 999999 });
  await rejected(threshold.command, adminId, "THRESHOLD_NOT_MET");
  const attempts = await fixture();
  await pool.query(`INSERT INTO lead_assignment_history(lead_id,from_user_id,to_user_id,reason,automatic,metadata)
    VALUES($1,$2,$3,'kay_rescue',false,'{"mode":"assisted"}'),($1,$2,$3,'kay_rescue',false,'{"mode":"assisted"}')`,
    [attempts.leadId, ownerId, targetId]);
  await rejected(attempts.command, adminId, "LIMIT_REACHED");
  const same = await fixture({ target: ownerId });
  await rejected({ ...same.command, targetEmployeeId: ownerId }, adminId, "TARGET_UNAVAILABLE");
  const invalid = await fixture();
  await rejected({ ...invalid.command, targetEmployeeId: nonAdminId, overrideReason: "WORKLOAD" }, adminId, "TARGET_UNAVAILABLE");
  // Model-level active flag is authoritative and restored immediately so no
  // later controlled lifecycle case inherits the rejection setup.
  await pool.query(`UPDATE users SET is_active=false WHERE id=$1`, [targetId]);
  try {
    const inactive = await fixture();
    await rejected(inactive.command, adminId, "TARGET_UNAVAILABLE");
  } finally {
    await pool.query(`UPDATE users SET is_active=true WHERE id=$1`, [targetId]);
  }
  const missingReason = await fixture();
  await rejected({ ...missingReason.command, targetEmployeeId: otherTargetId }, adminId, "OVERRIDE_REASON_REQUIRED");
});

test("E.1 transactional execution, retry, handoff, override, and safe undo persist exactly once", async () => {
  await setMode("assisted");
  const row = await fixture();
  await pool.query(`INSERT INTO kay_missions(lead_id,employee_id,mission_type,priority,reason_code,objective,suggested_action,idempotency_key)
    VALUES($1,$2,'FOLLOW_UP_DUE','HIGH','KAY_E1_TEST','x','x',$3)`, [row.leadId, ownerId, `${marker}:old-mission`]);
  await pool.query(`INSERT INTO kay_commitments(lead_id,employee_id,action,due_at,idempotency_key)
    VALUES($1,$2,'KAY_E1_TEST',NOW()+interval '1 day',$3)`, [row.leadId, ownerId, `${marker}:old-commitment`]);
  const promise = await pool.query(`INSERT INTO kay_promises(lead_id,employee_id,promise_text,due_at,idempotency_key)
    VALUES($1,$2,'KAY_E1_TEST promise',NOW()+interval '1 day',$3) RETURNING id`, [row.leadId, ownerId, `${marker}:promise`]);
  const before = await pool.query(`SELECT status FROM crm_leads WHERE id=$1`, [row.leadId]);
  const first = await executeAssistedRescue(row.command, adminId);
  const retry = await executeAssistedRescue(row.command, adminId);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.executionId, first.executionId);
  const result = await pool.query(`SELECT
    (SELECT assigned_to FROM crm_leads WHERE id=$1) owner,
    (SELECT status FROM crm_leads WHERE id=$1) status,
    (SELECT count(*)::int FROM lead_assignment_history WHERE lead_id=$1 AND reason='kay_rescue') history,
    (SELECT count(*)::int FROM kay_rescue_executions WHERE decision_id=$2 AND outcome='SUCCESS') executions,
    (SELECT status || ':' || (result_details->>'stale_reason') FROM kay_missions WHERE idempotency_key=$3) old_mission,
    (SELECT status || ':' || (details->>'stale_reason') FROM kay_commitments WHERE idempotency_key=$4) old_commitment,
    (SELECT count(*)::int FROM kay_promise_handoffs WHERE promise_id=$5) handoffs,
    (SELECT count(*)::int FROM kay_missions WHERE lead_id=$1 AND employee_id=$6 AND reason_code='RESCUE_LEAD_ASSIGNED') new_mission,
    (SELECT count(*)::int FROM kay_internal_briefings WHERE lead_id=$1) briefings,
    (SELECT count(*)::int FROM user_notifications WHERE (data->>'leadId')=$1::text) notifications`,
    [row.leadId, row.decisionId, `${marker}:old-mission`, `${marker}:old-commitment`, promise.rows[0].id, targetId]);
  assert.deepEqual(result.rows[0], { owner: targetId, status: before.rows[0].status, history: 1, executions: 1,
    old_mission: "STALE:LEAD_REASSIGNED", old_commitment: "STALE:LEAD_REASSIGNED", handoffs: 1, new_mission: 1, briefings: 2, notifications: 2 });
  const handoff = await pool.query(`SELECT id FROM kay_promise_handoffs WHERE promise_id=$1`, [promise.rows[0].id]);
  await assert.rejects(() => acceptPromiseHandoff(Number(handoff.rows[0].id), ownerId, false));
  assert.ok((await acceptPromiseHandoff(Number(handoff.rows[0].id), targetId, false)).accepted_at);
  const undone = await undoAssistedRescue(first.executionId, adminId, "KAY_E1_TEST safe undo");
  assert.equal(undone.restoredOwnerId, ownerId);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM lead_assignment_history WHERE lead_id=$1`, [row.leadId])).rows[0].n, 2);
  await pool.query(`DELETE FROM kay_promises WHERE id=$1`, [promise.rows[0].id]);
  const preserved = (await listPromiseHandoffs(adminId, true)).find((item: any) => Number(item.id) === Number(handoff.rows[0].id));
  assert.ok(preserved, "handoff history remains listable after controlled promise deletion");
  assert.equal(preserved.promise_id, null);

  const override = await fixture();
  const overridden = await executeAssistedRescue({ ...override.command, targetEmployeeId: otherTargetId, overrideReason: "WORKLOAD" }, adminId);
  const overrideMeta = await pool.query(`SELECT metadata->>'overrideReason' reason FROM kay_rescue_executions WHERE id=$1`, [overridden.executionId]);
  assert.equal(overrideMeta.rows[0].reason, "WORKLOAD");
});

test("E.1 concurrent confirms have one winner, rollback leaves no transfer, and unsafe undo fails closed", async () => {
  await setMode("assisted");
  const concurrent = await fixture();
  const settled = await Promise.allSettled([executeAssistedRescue(concurrent.command, adminId), executeAssistedRescue(concurrent.command, adminId)]);
  assert.equal(settled.filter(result => result.status === "fulfilled").length, 2);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM kay_rescue_executions WHERE decision_id=$1 AND outcome='SUCCESS'`, [concurrent.decisionId])).rows[0].n, 1);

  const rollback = await fixture();
  setAssistedRescueTestHook(step => { if (step === "after_owner_update") throw new Error("KAY_E1_TEST forced rollback"); });
  await assert.rejects(() => executeAssistedRescue(rollback.command, adminId));
  setAssistedRescueTestHook();
  const rolled = await pool.query(`SELECT (SELECT assigned_to FROM crm_leads WHERE id=$1) owner,
    (SELECT count(*)::int FROM kay_rescue_executions WHERE decision_id=$2 AND outcome='SUCCESS') success,
    (SELECT count(*)::int FROM lead_assignment_history WHERE lead_id=$1 AND reason='kay_rescue') history`, [rollback.leadId, rollback.decisionId]);
  assert.deepEqual(rolled.rows[0], { owner: ownerId, success: 0, history: 0 });

  const unsafe = await fixture();
  const execution = await executeAssistedRescue(unsafe.command, adminId);
  await pool.query(`INSERT INTO kay_commitments(lead_id,employee_id,action,due_at,idempotency_key)
    VALUES($1,$2,'new activity',NOW()+interval '1 day',$3)`, [unsafe.leadId, targetId, `${marker}:unsafe`]);
  await assert.rejects(() => undoAssistedRescue(execution.executionId, adminId, "must not undo"), (error: any) => error?.code === "MANUAL_REVIEW_REQUIRED");
});