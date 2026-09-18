import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db";
import { assertSafeKayMutationTestDatabase, kaySyntheticMarker } from "./kayTestDatabaseSafety";
import {
  executeAutomaticRescue,
  freezeE24NoExecution,
  setAssistedRescueTestHook,
  undoAssistedRescue,
} from "./kayRescueService";
import {
  applyAutoRescueLastChance,
  ensureWarningArtifactsForTest,
  getAutoRescueHealth,
  getAutoRescueReadiness,
  reconcileAutoRescueUncertainForTest,
  runKayAutoRescueWorker,
  setAutoRescueTestHook,
} from "./kayAutoRescueService";
import { activateE24Fadi } from "./kayPhaseE24Service";

assertSafeKayMutationTestDatabase("kayPhaseE2.integration");
const enabled = process.env.KAY_E2_POSTGRES_TESTS === "true";
const marker = kaySyntheticMarker("KAY_E2_TEST");
const leadIds: number[] = [];
let adminId = 0;
let ownerId = 0;
let targetId = 0;
let otherId = 0;
let priorMode: unknown;
let priorRules: unknown;
let priorLaunch: { value: unknown; updated_by: number | null } | null = null;
let priorHealth: unknown;
let priorLease: unknown;
let priorE24State: Record<string, unknown> | null = null;

const safeRules = {
  no_answer_1_threshold_hours: 1, no_answer_2_threshold_hours: 1,
  max_human_rescue_attempts: 2, rescue_warning_minutes: 30,
  protected_review_after_days: 7, assisted_rescue_undo_minutes: 15,
  auto_rescue_no_answer_1_enabled: true, auto_rescue_no_answer_2_enabled: true,
  auto_rescue_kill_switch: false, auto_rescue_canary_enabled: true,
  auto_rescue_canary_employee_ids: [] as number[], auto_rescue_canary_daily_limit: 5, auto_rescue_daily_limit: 50,
  auto_rescue_per_employee_daily_limit: 50, rescue_grace_minutes: 30,
  rescue_grace_max_count: 1, auto_rescue_rule_version: "phase_e2_test_v1",
  rescue_enabled: false,
};

async function settings(patch: Record<string, unknown> = {}, mode = "controlled_automation") {
  const rules = { ...safeRules, auto_rescue_canary_employee_ids: [ownerId, targetId, otherId], ...patch };
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES
    ('mode',$1::jsonb),('rescue_rules',$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
  [JSON.stringify({ mode }), JSON.stringify(rules)]);
  return rules;
}

async function fixture(status: "no_answer_1" | "no_answer_2" = "no_answer_1", age = "2 hours") {
  const lead = await pool.query(`INSERT INTO crm_leads(lead_source,full_name,status,assigned_to,notes,wa_stage)
    VALUES('manual',$1,$2,$3,$4,'new_lead') RETURNING id`, [`${marker} synthetic`, status, ownerId, marker]);
  const leadId = Number(lead.rows[0].id); leadIds.push(leadId);
  await pool.query(`DELETE FROM kay_lead_status_history WHERE lead_id=$1`, [leadId]);
  const entered = (await pool.query(`INSERT INTO kay_lead_status_history(lead_id,status,entered_at,event_key)
    VALUES($1,$2,NOW()-$3::interval,$4) RETURNING entered_at`, [leadId,status,age,`${marker}:window:${leadId}`])).rows[0].entered_at;
  await pool.query(`UPDATE lead_assignment_history
    SET assigned_at=$2::timestamptz-interval '1 minute'
    WHERE lead_id=$1 AND to_user_id=$3`,[leadId,entered,ownerId]);
  const event = await pool.query(`INSERT INTO kay_events(lead_id,event_type,event_source,metadata,kay_generated,idempotency_key)
    VALUES($1,'shadow_rescue_evaluated','test',$2::jsonb,false,$3) RETURNING id`,
  [leadId,JSON.stringify({marker}),`${marker}:event:${leadId}`]);
  const decision = await pool.query(`INSERT INTO kay_decisions(lead_id,event_id,decision_type,mode,rationale,payload)
    VALUES($1,$2,$3,'controlled_automation','synthetic E.2',$4::jsonb) RETURNING id`, [
      leadId,event.rows[0].id,`${status}_rescue_eligible`,JSON.stringify({
        state:"ACTIVE",status,status_entered_at:new Date(entered).toISOString(),
        threshold_minutes:60,max_rescue_attempts:2,recommended_employee_id:targetId,
        settings_snapshot:{assisted_rescue_undo_minutes:15},
      }),
    ]);
  const queue = await pool.query(`INSERT INTO kay_auto_rescue_queue
    (lead_id,status,rule_status,status_window,rescue_attempt,rule_version,expected_owner_id,target_employee_id,
     lease_token,lease_expires_at,fencing_token,next_run_at,warning_at)
     VALUES($1,'CLAIMED',$2,$3,0,'phase_e2_test_v1',$4,$5,$6,NOW()+interval '10 minutes',1,NOW(),NOW()-interval '1 hour') RETURNING id`,
  [leadId,status,entered,ownerId,targetId,`${marker}:lease:${leadId}`]);
  const warningMission=(await pool.query(`INSERT INTO kay_missions
    (lead_id,employee_id,mission_type,priority,reason_code,objective,suggested_action,idempotency_key)
    VALUES($1,$2,'RESCUE_RISK','HIGH','FINAL_RESCUE_WARNING','Synthetic final warning','Synthetic action',$3)
    RETURNING id`,[leadId,ownerId,`${marker}:warning:${leadId}`])).rows[0];
  await pool.query(`UPDATE kay_auto_rescue_queue SET warning_mission_id=$2 WHERE id=$1`,[queue.rows[0].id,warningMission.id]);
  await pool.query(`UPDATE kay_decisions SET payload=jsonb_set(payload,'{automaticQueueId}',$2::text::jsonb) WHERE id=$1`,
    [decision.rows[0].id,queue.rows[0].id]);
  const leaseToken = `${marker}:lease:${leadId}`;
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES('phase_e2_auto_rescue_lease',$1::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify({token:leaseToken,locked_until:new Date(Date.now()+600_000).toISOString()})]);
  return {
    leadId, decisionId:Number(decision.rows[0].id), queueId:Number(queue.rows[0].id), entered,
    command:{leadId,decisionId:Number(decision.rows[0].id),expectedOwnerId:ownerId,targetEmployeeId:targetId,
      queueId:Number(queue.rows[0].id),leaseToken,fencingToken:1},
  };
}

async function expectCode(row: Awaited<ReturnType<typeof fixture>>, code: string, expectedOwner = ownerId) {
  await assert.rejects(() => executeAutomaticRescue(row.command), (error:any) => error?.code === code, code);
  assert.equal(Number((await pool.query(`SELECT assigned_to FROM crm_leads WHERE id=$1`,[row.leadId])).rows[0].assigned_to), expectedOwner);
}

async function isolateWorkerLead(leadId: number, allowTarget = true) {
  await pool.query(`UPDATE crm_leads SET status='interested' WHERE notes=$1 AND id<>$2 AND status IN ('no_answer_1','no_answer_2')`,[marker,leadId]);
  if (!allowTarget) {
    const users=await pool.query(`SELECT id FROM users WHERE role='sub_agent' AND is_active=true AND id<>$1`,[ownerId]);
    for (const user of users.rows) await pool.query(`INSERT INTO lead_assignment_history
       (lead_id,from_user_id,to_user_id,reason,automatic,metadata,assigned_at) VALUES($1,$2,$3,'crm_assignment',false,'{}',NOW()-interval '3 hours')`,
    [leadId,user.id,ownerId]);
  } else {
    const users=await pool.query(`SELECT id FROM users WHERE role='sub_agent' AND is_active=true AND id<>ALL($1::int[])`,[[ownerId,targetId]]);
    for (const user of users.rows) await pool.query(`INSERT INTO lead_assignment_history
       (lead_id,from_user_id,to_user_id,reason,automatic,metadata,assigned_at) VALUES($1,$2,$3,'crm_assignment',false,'{}',NOW()-interval '3 hours')`,
    [leadId,user.id,ownerId]);
  }
  await pool.query(`UPDATE kay_settings SET value='{"released":true}'::jsonb WHERE key='phase_e2_auto_rescue_lease'`);
}

before(async () => {
  if (!enabled) return;
  process.env.KAY_E1_TEST_HOOKS = "true";
  process.env.KAY_E2_TEST_HOOKS = "true";
  priorMode=(await pool.query(`SELECT value FROM kay_settings WHERE key='mode'`)).rows[0]?.value;
  priorRules=(await pool.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`)).rows[0]?.value;
  priorLaunch=(await pool.query(`SELECT value,updated_by FROM kay_settings WHERE key='kay_operational_launch_at'`)).rows[0] ?? null;
  priorHealth=(await pool.query(`SELECT value FROM kay_settings WHERE key='phase_e2_auto_rescue_health'`)).rows[0]?.value;
  priorLease=(await pool.query(`SELECT value FROM kay_settings WHERE key='phase_e2_auto_rescue_lease'`)).rows[0]?.value;
  priorE24State=(await pool.query(`SELECT * FROM phase_e24_first_canary_state WHERE id=1`)).rows[0] ?? null;
  if (priorE24State) throw new Error("E.2 shared-database tests refuse to run after E.2.4 activation");
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES('kay_operational_launch_at',$1::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify("2026-09-09T00:00:00+04:00")]);
  const users=await pool.query(`INSERT INTO users(username,password,is_admin,role,is_active) VALUES
    ($1,'x',true,'admin',true),($2,'x',false,'sub_agent',true),($3,'x',false,'sub_agent',true),($4,'x',false,'sub_agent',true)
    RETURNING id,username`,[`${marker}:admin`,`${marker}:owner`,`${marker}:target`,`${marker}:other`]);
  const by=Object.fromEntries(users.rows.map((r:any)=>[r.username.split(":").pop(),Number(r.id)]));
  adminId=by.admin; ownerId=by.owner; targetId=by.target; otherId=by.other;
  await settings();
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES
    ('phase_e2_auto_rescue_health','{"halted":false,"errors":0,"consecutive_failures":0}'::jsonb),
    ('phase_e2_auto_rescue_lease','{"released":true}'::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
});

after(async () => {
  if (!enabled) return;
  try {
    setAssistedRescueTestHook();
    setAutoRescueTestHook();
    if (leadIds.length) {
      const p=[leadIds];
      await pool.query(`DELETE FROM kay_promise_handoffs WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM kay_manager_reviews WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM kay_events
        WHERE metadata->>'executionId' IN (
          SELECT id::text FROM kay_rescue_executions WHERE lead_id=ANY($1::int[])
        )`,p);
      await pool.query(`DELETE FROM kay_rescue_executions WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM lead_assignment_history WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM kay_internal_briefings WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM user_notifications WHERE data->>'leadId'=ANY($1::text[])`,[leadIds.map(String)]);
      await pool.query(`DELETE FROM kay_commitments WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM kay_promises WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM kay_auto_rescue_queue WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM kay_missions WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM crm_tasks WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM kay_lead_protection WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM kay_decisions WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM kay_events WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM kay_events
        WHERE metadata->>'canaryPeriod' LIKE 'phase_e24_test:%'
           OR (metadata->>'phase'='E.2.4' AND metadata->>'candidateLeadId'=ANY($1::text[]))`,
        [leadIds.map(String)]);
      await pool.query(`DELETE FROM kay_lead_status_history WHERE lead_id=ANY($1::int[])`,p);
      await pool.query(`DELETE FROM crm_leads WHERE id=ANY($1::int[]) AND notes=$2`,[leadIds,marker]);
    }
    await pool.query(`DELETE FROM users WHERE username LIKE $1`,[`${marker}%`]);
    if (priorLaunch) await pool.query(`INSERT INTO kay_settings(key,value,updated_by) VALUES('kay_operational_launch_at',$1::jsonb,$2)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by`, [JSON.stringify(priorLaunch.value),priorLaunch.updated_by]);
    else await pool.query(`DELETE FROM kay_settings WHERE key='kay_operational_launch_at'`);
  } finally {
    // Integration fixtures must restore the shared database byte-for-byte.
    // The suite verifies its own disarmed states without overwriting approved
    // production limits after cleanup.
    assert.notEqual(priorMode, undefined);
    assert.notEqual(priorRules, undefined);
    await pool.query(`UPDATE kay_settings SET value=$1::jsonb WHERE key='mode'`, [JSON.stringify(priorMode)]);
    await pool.query(`UPDATE kay_settings SET value=$1::jsonb WHERE key='rescue_rules'`, [JSON.stringify(priorRules)]);
    if (priorHealth === undefined) await pool.query(`DELETE FROM kay_settings WHERE key='phase_e2_auto_rescue_health'`);
    else await pool.query(`UPDATE kay_settings SET value=$1::jsonb WHERE key='phase_e2_auto_rescue_health'`,[JSON.stringify(priorHealth)]);
    if (priorLease === undefined) await pool.query(`DELETE FROM kay_settings WHERE key='phase_e2_auto_rescue_lease'`);
    else await pool.query(`UPDATE kay_settings SET value=$1::jsonb WHERE key='phase_e2_auto_rescue_lease'`,[JSON.stringify(priorLease)]);
    const currentE24=(await pool.query(`SELECT * FROM phase_e24_first_canary_state WHERE id=1`)).rows[0]??null;
    assert.deepEqual(currentE24,priorE24State,"E.2 tests must not mutate the production E.2.4 singleton");
    delete process.env.KAY_E2_TEST_HOOKS;
  }
});

test("E.2 PostgreSQL mutation suite requires its explicit synthetic-data gate", { skip:!enabled }, async () => {
  assert.equal(process.env.KAY_E2_POSTGRES_TESTS,"true");
  assert.notEqual(process.env.KAY_E2_ALLOW_SHARED_DB_MUTATIONS, "true");
  assert.ok(adminId && ownerId && targetId && otherId);
  assert.equal(new Set([adminId,ownerId,targetId,otherId]).size,4);
});

test("E.2.4 activation requires explicit first-real-canary confirmation", async () => {
  await assert.rejects(() => activateE24Fadi(0, false), (error:any) => error?.status === 400);
});

test("E.2 three independent gates, exact statuses, boundaries, and races fail closed", { skip:!enabled }, async () => {
  await settings({}, "shadow"); await expectCode(await fixture(),"MODE_NOT_CONTROLLED_AUTOMATION");
  await settings({}, "assisted"); await expectCode(await fixture(),"MODE_NOT_CONTROLLED_AUTOMATION");
  await settings({auto_rescue_kill_switch:true}); await expectCode(await fixture(),"AUTOMATION_GATE_CLOSED");
  await settings({auto_rescue_no_answer_1_enabled:false}); await expectCode(await fixture(),"AUTOMATION_GATE_CLOSED");
  await settings({auto_rescue_canary_employee_ids:[targetId]}); await expectCode(await fixture(),"CANARY_DENIED");
  await settings(); const early=await fixture("no_answer_1","30 minutes"); await expectCode(early,"THRESHOLD_NOT_MET");
  await settings(); const ownerRace=await fixture(); await pool.query(`UPDATE crm_leads SET assigned_to=$1 WHERE id=$2`,[otherId,ownerRace.leadId]); await expectCode(ownerRace,"OWNER_CHANGED",otherId);
  await settings(); const statusRace=await fixture(); await pool.query(`UPDATE crm_leads SET status='interested' WHERE id=$1`,[statusRace.leadId]); await expectCode(statusRace,"FENCE_LOST");
  await settings(); const protection=await fixture(); await pool.query(`INSERT INTO kay_lead_protection(lead_id,reason) VALUES($1,'synthetic')`,[protection.leadId]); await expectCode(protection,"PROTECTED");
  await settings(); const task=await fixture(); await pool.query(`INSERT INTO crm_tasks(lead_id,title) VALUES($1,$2)`,[task.leadId,marker]); await expectCode(task,"BLOCKER_ADDED");
  await settings(); const inactive=await fixture(); await pool.query(`UPDATE users SET is_active=false WHERE id=$1`,[targetId]);
  try { await expectCode(inactive,"TARGET_UNAVAILABLE"); } finally { await pool.query(`UPDATE users SET is_active=true WHERE id=$1`,[targetId]); }
  await settings(); const same=await fixture();
  await pool.query(`UPDATE kay_decisions SET payload=jsonb_set(payload,'{recommended_employee_id}',$2::text::jsonb)
    WHERE id=$1`,[same.decisionId,ownerId]);
  await pool.query(`UPDATE kay_auto_rescue_queue SET target_employee_id=$2 WHERE id=$1`,[same.queueId,ownerId]);
  same.command.targetEmployeeId=ownerId; await expectCode(same,"TARGET_UNAVAILABLE");
  await settings(); const changed=await fixture(); await pool.query(`UPDATE kay_settings SET value=jsonb_set(value,'{no_answer_1_threshold_hours}','2') WHERE key='rescue_rules'`); await expectCode(changed,"RULE_CHANGED");
});

test("E.2 automatic transaction writes the exact E.1 artifacts once and supports safe undo", { skip:!enabled }, async () => {
  await settings();
  const row=await fixture("no_answer_2");
  await pool.query(`INSERT INTO kay_missions(lead_id,employee_id,mission_type,priority,reason_code,objective,suggested_action,idempotency_key)
    VALUES($1,$2,'FOLLOW_UP_DUE','HIGH','SYNTHETIC','x','x',$3)`,[row.leadId,ownerId,`${marker}:old-mission:${row.leadId}`]);
  await pool.query(`INSERT INTO kay_commitments(lead_id,employee_id,action,due_at,idempotency_key)
    VALUES($1,$2,'synthetic',NOW()+interval '1 day',$3)`,[row.leadId,ownerId,`${marker}:commitment:${row.leadId}`]);
  const promise=(await pool.query(`INSERT INTO kay_promises(lead_id,employee_id,promise_text,due_at,idempotency_key)
    VALUES($1,$2,'synthetic promise',NOW()+interval '1 day',$3) RETURNING id`,[row.leadId,ownerId,`${marker}:promise:${row.leadId}`])).rows[0];
  const originalStatus=(await pool.query(`SELECT status FROM crm_leads WHERE id=$1`,[row.leadId])).rows[0].status;
  const done=await executeAutomaticRescue(row.command);
  const retry=await executeAutomaticRescue(row.command);
  assert.equal(retry.idempotent,true);
  assert.equal(retry.executionId,done.executionId);
  const exact=(await pool.query(`SELECT
    (SELECT assigned_to FROM crm_leads WHERE id=$1) owner,
    (SELECT status FROM crm_leads WHERE id=$1) status,
    (SELECT count(*)::int FROM lead_assignment_history WHERE lead_id=$1 AND reason='kay_rescue_automatic') history,
    (SELECT count(*)::int FROM kay_rescue_executions WHERE decision_id=$2 AND outcome='SUCCESS') executions,
    (SELECT metadata->>'executionMode' FROM kay_rescue_executions WHERE id=$3) mode,
    (SELECT status FROM kay_missions WHERE idempotency_key=$4) old_mission,
    (SELECT status FROM kay_commitments WHERE idempotency_key=$5) old_commitment,
    (SELECT count(*)::int FROM kay_promise_handoffs WHERE promise_id=$6) handoffs,
    (SELECT count(*)::int FROM kay_missions WHERE lead_id=$1 AND employee_id=$7 AND reason_code='RESCUE_LEAD_ASSIGNED') new_mission,
    (SELECT count(*)::int FROM kay_internal_briefings WHERE lead_id=$1) briefings,
    (SELECT count(*)::int FROM user_notifications WHERE data->>'leadId'=$1::text) notices`,
  [row.leadId,row.decisionId,done.executionId,`${marker}:old-mission:${row.leadId}`,`${marker}:commitment:${row.leadId}`,promise.id,targetId])).rows[0];
  assert.equal(exact.owner,targetId);
  assert.equal(exact.status,originalStatus);
  assert.equal(exact.history,1);
  assert.equal(exact.executions,1);
  assert.equal(exact.mode,"automatic");
  assert.equal(exact.old_mission,"STALE");
  assert.equal(exact.old_commitment,"STALE");
  assert.equal(exact.handoffs,1);
  assert.equal(exact.new_mission,1);
  assert.equal(exact.briefings,2);
  assert.equal(exact.notices,2);
  const undone=await undoAssistedRescue(done.executionId,adminId,"synthetic safe undo");
  assert.equal(undone.restoredOwnerId,ownerId);
  assert.equal((await pool.query(`SELECT outcome FROM kay_rescue_executions WHERE id=$1`,[done.executionId])).rows[0].outcome,"UNDONE");
});

test("E.2 rollback, attempt limit, ping-pong and dry-run zero-write invariants", { skip:!enabled }, async () => {
  await settings();
  const rollback=await fixture();
  setAssistedRescueTestHook(step=>{if(step==="after_owner_update") throw new Error("synthetic rollback");});
  await assert.rejects(()=>executeAutomaticRescue(rollback.command));
  setAssistedRescueTestHook();
  assert.equal(Number((await pool.query(`SELECT assigned_to FROM crm_leads WHERE id=$1`,[rollback.leadId])).rows[0].assigned_to),ownerId);
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM lead_assignment_history WHERE lead_id=$1`,[rollback.leadId])).rows[0].n),0);
  const limit=await fixture();
  await pool.query(`INSERT INTO lead_assignment_history(lead_id,from_user_id,to_user_id,reason,automatic,metadata)
    VALUES($1,$2,$3,'kay_rescue_automatic',true,'{"mode":"automatic"}'),($1,$2,$3,'kay_rescue_automatic',true,'{"mode":"automatic"}')`,
  [limit.leadId,ownerId,otherId]);
  await pool.query(`UPDATE kay_auto_rescue_queue SET rescue_attempt=2 WHERE id=$1`,[limit.queueId]);
  await expectCode(limit,"LIMIT_REACHED");
  const ping=await fixture();
  await pool.query(`INSERT INTO lead_assignment_history(lead_id,from_user_id,to_user_id,reason,automatic,metadata,assigned_at)
    VALUES($1,$2,$3,'crm_assignment',false,'{}',$4::timestamptz-interval '1 minute')`,[ping.leadId,targetId,ownerId,ping.entered]);
  await expectCode(ping,"PING_PONG_PREVENTED");
  const before=(await pool.query(`SELECT assigned_to,status FROM crm_leads WHERE id=$1`,[ping.leadId])).rows[0];
  const queueCount=Number((await pool.query(`SELECT count(*)::int n FROM kay_auto_rescue_queue`)).rows[0].n);
  const report=await getAutoRescueReadiness(1000);
  const afterRow=(await pool.query(`SELECT assigned_to,status FROM crm_leads WHERE id=$1`,[ping.leadId])).rows[0];
  assert.deepEqual(afterRow,before);
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM kay_auto_rescue_queue`)).rows[0].n),queueCount);
  assert.ok(report.checked>=1);
});

test("E.2 PostgreSQL concurrency fence, business limits, promise review, and unsafe undo", { skip:!enabled }, async () => {
  await settings();
  const concurrent=await fixture();
  const settled=await Promise.allSettled([
    executeAutomaticRescue(concurrent.command),
    executeAutomaticRescue(concurrent.command),
  ]);
  assert.equal(settled.filter(x=>x.status==="fulfilled").length,2);
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM kay_rescue_executions WHERE decision_id=$1 AND outcome='SUCCESS'`,[concurrent.decisionId])).rows[0].n),1);
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM lead_assignment_history WHERE lead_id=$1 AND reason='kay_rescue_automatic'`,[concurrent.leadId])).rows[0].n),1);

  const fenced=await fixture();
  await assert.rejects(()=>executeAutomaticRescue({...fenced.command,leaseToken:"stale-worker"}),(e:any)=>e?.code==="FENCE_LOST");
  assert.equal(Number((await pool.query(`SELECT assigned_to FROM crm_leads WHERE id=$1`,[fenced.leadId])).rows[0].assigned_to),ownerId);

  await settings({auto_rescue_daily_limit:1});
  const daily=await fixture();
  await pool.query(`INSERT INTO lead_assignment_history(lead_id,from_user_id,to_user_id,reason,automatic,assigned_at,metadata)
    VALUES($1,$2,$3,'kay_rescue_automatic',true,NOW(),$4::jsonb)`,[daily.leadId,otherId,targetId,JSON.stringify({businessDate:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tbilisi"}).format(new Date())})]);
  await expectCode(daily,"DAILY_LIMIT_REACHED");
  await pool.query(`DELETE FROM lead_assignment_history WHERE lead_id=$1 AND from_user_id=$2 AND to_user_id=$3 AND reason='kay_rescue_automatic'`,[daily.leadId,otherId,targetId]);

  await settings({auto_rescue_daily_limit:50,auto_rescue_per_employee_daily_limit:1});
  const employee=await fixture();
  await pool.query(`INSERT INTO lead_assignment_history(lead_id,from_user_id,to_user_id,reason,automatic,assigned_at,metadata)
    VALUES($1,$2,$3,'kay_rescue_automatic',true,NOW(),'{}')`,[employee.leadId,otherId,targetId]);
  await expectCode(employee,"EMPLOYEE_LIMIT_REACHED");
  await pool.query(`DELETE FROM lead_assignment_history WHERE lead_id=$1 AND from_user_id=$2 AND to_user_id=$3 AND reason='kay_rescue_automatic'`,[employee.leadId,otherId,targetId]);

  await settings();
  const promiseReview=await fixture();
  await pool.query(`INSERT INTO kay_promises(lead_id,employee_id,promise_text,due_at,owner_review_required_at,idempotency_key)
    VALUES($1,$2,'manager review promise',NOW()+interval '1 day',NOW(),$3)`,[promiseReview.leadId,ownerId,`${marker}:review-promise:${promiseReview.leadId}`]);
  await expectCode(promiseReview,"PROMISE_MANAGER_REVIEW_REQUIRED");

  const unsafe=await fixture();
  const execution=await executeAutomaticRescue(unsafe.command);
  await pool.query(`INSERT INTO kay_commitments(lead_id,employee_id,action,due_at,idempotency_key)
    VALUES($1,$2,'new owner activity',NOW()+interval '1 day',$3)`,[unsafe.leadId,targetId,`${marker}:unsafe:${unsafe.leadId}`]);
  await assert.rejects(()=>undoAssistedRescue(execution.executionId,adminId,"unsafe"),(e:any)=>e?.code==="MANUAL_REVIEW_REQUIRED");
  assert.equal(Number((await pool.query(`SELECT assigned_to FROM crm_leads WHERE id=$1`,[unsafe.leadId])).rows[0].assigned_to),targetId);
});

test("E.2.4 first-real-canary caps one success and freezes atomically", { skip:!enabled }, async () => {
  const version=`phase_e24_test:${Date.now()}`;
  await settings({auto_rescue_canary_daily_limit:1,auto_rescue_rule_version:version});
  const first=await fixture();
  const done=await executeAutomaticRescue(first.command);
  const second=await fixture();
  await assert.rejects(()=>executeAutomaticRescue(second.command),(e:any)=>["CANARY_LIMIT_REACHED","AUTOMATION_GATE_CLOSED"].includes(e?.code));
  const evidence=(await pool.query(`SELECT
    (SELECT count(*)::int FROM kay_rescue_executions WHERE outcome='SUCCESS' AND metadata->>'canaryPeriod'=$1) successes,
    (SELECT count(*)::int FROM lead_assignment_history WHERE lead_id=ANY($2::int[]) AND reason='kay_rescue_automatic') histories,
    (SELECT count(*)::int FROM kay_missions WHERE lead_id=ANY($2::int[]) AND reason_code='RESCUE_LEAD_ASSIGNED') missions,
    (SELECT count(*)::int FROM kay_internal_briefings WHERE lead_id=ANY($2::int[])) briefings,
    (SELECT count(*)::int FROM user_notifications WHERE data->>'executionId'=$3) notices,
    (SELECT count(*)::int FROM kay_events WHERE event_type='kay_rule_changed' AND metadata->>'change'='canary-frozen' AND metadata->>'canaryPeriod'=$1) freezes,
    (SELECT (value->>'auto_rescue_kill_switch')::boolean FROM kay_settings WHERE key='rescue_rules') frozen`,
  [version,[first.leadId,second.leadId],String(done.executionId)])).rows[0];
  assert.deepEqual(evidence,{successes:1,histories:1,missions:1,briefings:2,notices:2,freezes:1,frozen:true});
  assert.equal(Number((await pool.query(`SELECT assigned_to FROM crm_leads WHERE id=$1`,[first.leadId])).rows[0].assigned_to),targetId);
  assert.equal(Number((await pool.query(`SELECT assigned_to FROM crm_leads WHERE id=$1`,[second.leadId])).rows[0].assigned_to),ownerId);
});

test("E.2.4 lifetime state cannot reset by business day or rule version", { skip:!enabled }, async () => {
  assert.equal((await pool.query(`SELECT count(*)::int n FROM phase_e24_first_canary_state WHERE id=1`)).rows[0].n,0);
  await settings({auto_rescue_rule_version:"phase_e24_first_fadi_canary"});
  const first=await fixture();
  try {
    await pool.query(`INSERT INTO phase_e24_first_canary_state
      (id,period,status,source_employee_id,candidate_lead_id,admin_id,successful_executions,source_owner_epoch,activated_at)
      VALUES(1,'phase_e24_first_fadi_canary','ACTIVE',$1,$2,$3,0,
        (SELECT kay_owner_epoch FROM crm_leads WHERE id=$2),NOW())`,
      [ownerId,first.leadId,adminId]);
    const done=await executeAutomaticRescue(first.command);
    const state=(await pool.query(`SELECT status,successful_executions,execution_id FROM phase_e24_first_canary_state WHERE id=1`)).rows[0];
    assert.deepEqual(state,{status:"FROZEN_SUCCESS",successful_executions:1,execution_id:done.executionId});

    await settings({auto_rescue_rule_version:"phase_e2_after_day_boundary",auto_rescue_kill_switch:false});
    const second=await fixture();
    await assert.rejects(()=>executeAutomaticRescue(second.command),(e:any)=>e?.code==="CANARY_LIMIT_REACHED");
    assert.equal(Number((await pool.query(`SELECT assigned_to FROM crm_leads WHERE id=$1`,[second.leadId])).rows[0].assigned_to),ownerId);
  } finally {
    await pool.query(`DELETE FROM phase_e24_first_canary_state WHERE id=1 AND admin_id=$1`,[adminId]);
  }
});

test("E.2.4 immediate technical failure freezes despite warning wait", { skip:!enabled }, async () => {
  await settings({auto_rescue_rule_version:"phase_e24_first_fadi_canary"});
  const row=await fixture();
  await pool.query(`UPDATE kay_auto_rescue_queue SET warning_at=NOW() WHERE id=$1`,[row.queueId]);
  try {
    await pool.query(`INSERT INTO phase_e24_first_canary_state
      (id,period,status,source_employee_id,candidate_lead_id,admin_id,successful_executions,source_owner_epoch,activated_at)
      VALUES(1,'phase_e24_first_fadi_canary','ACTIVE',$1,$2,$3,0,
        (SELECT kay_owner_epoch FROM crm_leads WHERE id=$2),NOW())`,[ownerId,row.leadId,adminId]);
    assert.equal(await freezeE24NoExecution("TEST_TECHNICAL_FAILURE",row.leadId,true),true);
    assert.deepEqual((await pool.query(`SELECT status,freeze_reason FROM phase_e24_first_canary_state WHERE id=1`)).rows[0],
      {status:"FROZEN_NO_EXECUTION",freeze_reason:"TEST_TECHNICAL_FAILURE"});
    assert.equal((await pool.query(`SELECT (value->>'auto_rescue_kill_switch')::boolean frozen FROM kay_settings WHERE key='rescue_rules'`)).rows[0].frozen,true);
  } finally {
    await pool.query(`DELETE FROM phase_e24_first_canary_state WHERE id=1 AND admin_id=$1 AND candidate_lead_id=$2`,[adminId,row.leadId]);
  }
});

test("E.2.4 final warning interval and target receiving limit fail closed", { skip:!enabled }, async () => {
  await settings({auto_rescue_rule_version:`phase_e24_warning:${Date.now()}`});
  const warning=await fixture();
  await pool.query(`UPDATE kay_auto_rescue_queue SET warning_at=NOW() WHERE id=$1`,[warning.queueId]);
  await expectCode(warning,"WARNING_GRACE_GATE");

  await settings({auto_rescue_rule_version:`phase_e24_target:${Date.now()}`,auto_rescue_per_employee_daily_limit:1});
  const receiving=await fixture();
  await pool.query(`INSERT INTO lead_assignment_history(lead_id,from_user_id,to_user_id,reason,automatic,assigned_at,metadata)
    VALUES($1,$2,$3,'kay_rescue_automatic',true,NOW(),'{}')`,[receiving.leadId,otherId,targetId]);
  await expectCode(receiving,"EMPLOYEE_LIMIT_REACHED");
});

test("E.2.4 owner epoch rejects a round trip even when assignment observation is missing", { skip:!enabled }, async () => {
  await settings({auto_rescue_rule_version:"phase_e24_first_fadi_canary"});
  const roundTrip=await fixture();
  try {
    const before=Number((await pool.query(`SELECT kay_owner_epoch FROM crm_leads WHERE id=$1`,[roundTrip.leadId])).rows[0].kay_owner_epoch);
    await pool.query(`INSERT INTO phase_e24_first_canary_state
      (id,period,status,source_employee_id,candidate_lead_id,admin_id,successful_executions,source_owner_epoch,activated_at)
      VALUES(1,'phase_e24_first_fadi_canary','ACTIVE',$1,$2,$3,0,$4,NOW())`,
      [ownerId,roundTrip.leadId,adminId,before]);
    await pool.query(`UPDATE crm_leads SET assigned_to=$2 WHERE id=$1`,[roundTrip.leadId,otherId]);
    await pool.query(`UPDATE crm_leads SET assigned_to=$2 WHERE id=$1`,[roundTrip.leadId,ownerId]);
    assert.equal(Number((await pool.query(`SELECT kay_owner_epoch FROM crm_leads WHERE id=$1`,[roundTrip.leadId])).rows[0].kay_owner_epoch),before+2);
    await expectCode(roundTrip,"CANARY_LIMIT_REACHED");
    assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM lead_assignment_history
      WHERE lead_id=$1 AND reason='kay_rescue_automatic'`,[roundTrip.leadId])).rows[0].n),0);
  } finally {
    await pool.query(`DELETE FROM phase_e24_first_canary_state WHERE id=1 AND admin_id=$1 AND candidate_lead_id=$2`,[adminId,roundTrip.leadId]);
  }
});

test("E.2 worker warning is one-cycle, deduplicated, canary-scoped, and disabled gates write no queue", { skip:!enabled }, async () => {
  const row=await fixture();
  await pool.query(`DELETE FROM kay_auto_rescue_queue WHERE id=$1`,[row.queueId]);
  await settings({}, "shadow");
  const before=Number((await pool.query(`SELECT count(*)::int n FROM kay_auto_rescue_queue WHERE lead_id=$1`,[row.leadId])).rows[0].n);
  assert.equal((await runKayAutoRescueWorker()).disabled,true);
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM kay_auto_rescue_queue WHERE lead_id=$1`,[row.leadId])).rows[0].n),before);
  await settings();
  await pool.query(`UPDATE kay_settings SET value='{"released":true}'::jsonb WHERE key='phase_e2_auto_rescue_lease'`);
  const warningRace=await Promise.all([runKayAutoRescueWorker(100),runKayAutoRescueWorker(100)]);
  assert.equal(warningRace.filter(result=>result.executed===0).length,1);
  assert.equal(warningRace.filter(result=>result.busy===true).length,1);
  const warning=(await pool.query(`SELECT id,status,warning_mission_id FROM kay_auto_rescue_queue WHERE lead_id=$1`,[row.leadId])).rows[0];
  assert.equal(warning.status,"WARNING");
  assert.ok(warning.warning_mission_id);
  await pool.query(`UPDATE kay_settings SET value=jsonb_set(value,'{auto_rescue_kill_switch}','true') WHERE key='rescue_rules'`);
  assert.equal((await runKayAutoRescueWorker()).disabled,true);
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM user_notifications WHERE type='kay_rescue_warning' AND data->>'queueId'=$1`,[String(warning.id)])).rows[0].n),1);
});

test("E.2 warning artifacts fail closed on expected-owner and employee eligibility changes", { skip:!enabled }, async () => {
  const assertNoWarningArtifacts = async (row: Awaited<ReturnType<typeof fixture>>) => {
    await ensureWarningArtifactsForTest(row.queueId, row.leadId, ownerId);
    const evidence = (await pool.query(`SELECT
      (SELECT count(*)::int FROM kay_missions WHERE idempotency_key=$1) missions,
      (SELECT count(*)::int FROM kay_internal_briefings WHERE idempotency_key=$2) briefings,
      (SELECT count(*)::int FROM user_notifications WHERE idempotency_key=$3) notifications,
      (SELECT status FROM kay_auto_rescue_queue WHERE id=$4) status`,
    [`e2:warning:${row.queueId}`, `e2:warning-brief:${row.queueId}`,
      `e2:warning-notification:${row.queueId}`, row.queueId])).rows[0];
    assert.deepEqual(evidence, { missions: 0, briefings: 0, notifications: 0, status: "PENDING" });
  };

  const expectedOwner = await fixture();
  const expectedOwnerWarning = (await pool.query(`SELECT warning_mission_id FROM kay_auto_rescue_queue WHERE id=$1`,
    [expectedOwner.queueId])).rows[0].warning_mission_id;
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='PENDING',warning_mission_id=NULL,
    expected_owner_id=$2 WHERE id=$1`, [expectedOwner.queueId, otherId]);
  await pool.query(`DELETE FROM kay_missions WHERE id=$1`, [expectedOwnerWarning]);
  await assertNoWarningArtifacts(expectedOwner);

  const inactive = await fixture();
  const inactiveWarning = (await pool.query(`SELECT warning_mission_id FROM kay_auto_rescue_queue WHERE id=$1`, [inactive.queueId])).rows[0].warning_mission_id;
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='PENDING',warning_mission_id=NULL WHERE id=$1`, [inactive.queueId]);
  await pool.query(`DELETE FROM kay_missions WHERE id=$1`, [inactiveWarning]);
  await pool.query(`UPDATE users SET is_active=false WHERE id=$1`, [ownerId]);
  try {
    await assertNoWarningArtifacts(inactive);
  } finally {
    await pool.query(`UPDATE users SET is_active=true WHERE id=$1`, [ownerId]);
  }

  const role = await fixture();
  const roleWarning = (await pool.query(`SELECT warning_mission_id FROM kay_auto_rescue_queue WHERE id=$1`, [role.queueId])).rows[0].warning_mission_id;
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='PENDING',warning_mission_id=NULL WHERE id=$1`, [role.queueId]);
  await pool.query(`DELETE FROM kay_missions WHERE id=$1`, [roleWarning]);
  await pool.query(`UPDATE users SET role='viewer' WHERE id=$1`, [ownerId]);
  try {
    await assertNoWarningArtifacts(role);
  } finally {
    await pool.query(`UPDATE users SET role='sub_agent' WHERE id=$1`, [ownerId]);
  }
});

test("E.2 last-chance actions are atomic, grace has one winner, and CONTACT NOW is not a CRM blocker", { skip:!enabled }, async () => {
  await settings();
  const grace=await fixture();
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='WARNING',lease_token=NULL,lease_expires_at=NULL WHERE id=$1`,[grace.queueId]);
  const races=await Promise.allSettled([
    applyAutoRescueLastChance(grace.queueId,ownerId,false,"NEED_30_MINUTES"),
    applyAutoRescueLastChance(grace.queueId,ownerId,false,"NEED_30_MINUTES"),
  ]);
  assert.equal(races.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(races.filter(x=>x.status==="rejected" && (x.reason as any)?.code==="GRACE_USED").length,1);
  const graceRow=(await pool.query(`SELECT status,grace_count,grace_until,next_run_at FROM kay_auto_rescue_queue WHERE id=$1`,[grace.queueId])).rows[0];
  assert.equal(graceRow.status,"WARNING");
  assert.equal(graceRow.grace_count,1);
  assert.ok(new Date(graceRow.grace_until).getTime()>Date.now());
  assert.equal(new Date(graceRow.grace_until).getTime(),new Date(graceRow.next_run_at).getTime());

  const contact=await fixture();
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='WARNING',lease_token=NULL,lease_expires_at=NULL WHERE id=$1`,[contact.queueId]);
  await applyAutoRescueLastChance(contact.queueId,ownerId,false,"CONTACT_NOW");
  const contactState=(await pool.query(`SELECT
    (SELECT count(*)::int FROM kay_missions WHERE idempotency_key=$1) missions,
    (SELECT count(*)::int FROM kay_commitments WHERE idempotency_key=$2 AND status='PENDING') commitments,
    (SELECT count(*)::int FROM crm_tasks WHERE lead_id=$3 AND completed_at IS NULL) crm_blockers,
    (SELECT status FROM crm_leads WHERE id=$3) crm_status`,
  [`e2:contact-now:${contact.queueId}`,`e2:contact-now-commitment:${contact.queueId}`,contact.leadId])).rows[0];
  assert.deepEqual(contactState,{missions:1,commitments:1,crm_blockers:0,crm_status:"no_answer_1"});

  const cannot=await fixture();
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='WARNING',lease_token=NULL,lease_expires_at=NULL WHERE id=$1`,[cannot.queueId]);
  await applyAutoRescueLastChance(cannot.queueId,ownerId,false,"CANNOT_HANDLE");
  const review=(await pool.query(`SELECT q.status,q.rejection_reason,
    (SELECT count(*)::int FROM kay_manager_reviews WHERE lead_id=q.lead_id AND reason='CANNOT_HANDLE') reviews
    FROM kay_auto_rescue_queue q WHERE q.id=$1`,[cannot.queueId])).rows[0];
  assert.deepEqual(review,{status:"MANAGER_REVIEW",rejection_reason:"CANNOT_HANDLE",reviews:1});
  await assert.rejects(()=>applyAutoRescueLastChance(cannot.queueId,ownerId,false,"CONTACT_NOW"),(e:any)=>e?.code==="STALE_WINDOW");
});

test("E.2 uncertain reconciliation has committed, safe-retry, and ambiguous branches", { skip:!enabled }, async () => {
  await settings();
  const committed=await fixture();
  const done=await executeAutomaticRescue(committed.command);
  await reconcileAutoRescueUncertainForTest({id:committed.queueId,fencing_token:1},committed.command.leaseToken);
  const committedQueue=(await pool.query(`SELECT status,execution_id,lease_token FROM kay_auto_rescue_queue WHERE id=$1`,[committed.queueId])).rows[0];
  assert.equal(committedQueue.status,"EXECUTED");
  assert.equal(Number(committedQueue.execution_id),done.executionId);
  assert.equal(committedQueue.lease_token,null);

  const retry=await fixture();
  await reconcileAutoRescueUncertainForTest({id:retry.queueId,fencing_token:1},retry.command.leaseToken);
  const retryQueue=(await pool.query(`SELECT status,rejection_reason,lease_token FROM kay_auto_rescue_queue WHERE id=$1`,[retry.queueId])).rows[0];
  assert.equal(retryQueue.status,"READY");
  assert.match(retryQueue.rejection_reason,/RETRY_AFTER_UNCERTAIN/);
  assert.equal(retryQueue.lease_token,null);

  const ambiguous=await fixture();
  await pool.query(`UPDATE crm_leads SET assigned_to=$2 WHERE id=$1`,[ambiguous.leadId,otherId]);
  await reconcileAutoRescueUncertainForTest({id:ambiguous.queueId,fencing_token:1},ambiguous.command.leaseToken);
  const ambiguousQueue=(await pool.query(`SELECT status,rejection_reason FROM kay_auto_rescue_queue WHERE id=$1`,[ambiguous.queueId])).rows[0];
  assert.deepEqual(ambiguousQueue,{status:"MANAGER_REVIEW",rejection_reason:"AMBIGUOUS_RESULT"});
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM kay_manager_reviews WHERE lead_id=$1 AND reason='AMBIGUOUS_RESULT'`,[ambiguous.leadId])).rows[0].n),1);
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES('phase_e2_auto_rescue_health','{"halted":false,"errors":0,"consecutive_failures":0}'::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
});

test("E.2 worker completes WARNING to READY to one automatic transfer and creates actual reviews", { skip:!enabled }, async () => {
  await settings();
  const lifecycle=await fixture();
  await pool.query(`DELETE FROM kay_auto_rescue_queue WHERE id=$1`,[lifecycle.queueId]);
  await isolateWorkerLead(lifecycle.leadId);
  const first=await runKayAutoRescueWorker(100);
  assert.equal(first.executed,0);
  const warning=(await pool.query(`SELECT id,status FROM kay_auto_rescue_queue WHERE lead_id=$1`,[lifecycle.leadId])).rows[0];
  assert.ok(warning, JSON.stringify(first));
  assert.equal(warning.status,"WARNING");
  await pool.query(`UPDATE kay_auto_rescue_queue
    SET warning_at=NOW()-interval '31 minutes',next_run_at=NOW()
    WHERE id=$1`,[warning.id]);
  await pool.query(`UPDATE kay_settings SET value='{"released":true}'::jsonb WHERE key='phase_e2_auto_rescue_lease'`);
  const second=await runKayAutoRescueWorker(100);
  assert.equal(second.executed,1);
  const completed=(await pool.query(`SELECT status,execution_id FROM kay_auto_rescue_queue WHERE id=$1`,[warning.id])).rows[0];
  assert.equal(completed.status,"EXECUTED");
  assert.ok(completed.execution_id);
  assert.equal(Number((await pool.query(`SELECT assigned_to FROM crm_leads WHERE id=$1`,[lifecycle.leadId])).rows[0].assigned_to),targetId);
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM lead_assignment_history WHERE lead_id=$1 AND reason='kay_rescue_automatic'`,[lifecycle.leadId])).rows[0].n),1);

  await settings();
  const none=await fixture();
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='READY',lease_token=NULL,lease_expires_at=NULL,next_run_at=NOW(),fencing_token=0 WHERE id=$1`,[none.queueId]);
  await isolateWorkerLead(none.leadId,false);
  const noTarget=await runKayAutoRescueWorker(100);
  assert.equal(noTarget.executed,0);
  assert.deepEqual((await pool.query(`SELECT status,rejection_reason FROM kay_auto_rescue_queue WHERE id=$1`,[none.queueId])).rows[0],
    {status:"MANAGER_REVIEW",rejection_reason:"NO_ELIGIBLE_EMPLOYEE"});
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM kay_manager_reviews WHERE lead_id=$1 AND reason='NO_ELIGIBLE_EMPLOYEE'`,[none.leadId])).rows[0].n),1);

  await settings({auto_rescue_daily_limit:1});
  const daily=await fixture();
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='READY',lease_token=NULL,lease_expires_at=NULL,next_run_at=NOW(),fencing_token=0 WHERE id=$1`,[daily.queueId]);
  await isolateWorkerLead(daily.leadId);
  await runKayAutoRescueWorker(100);
  assert.deepEqual((await pool.query(`SELECT status,rejection_reason FROM kay_auto_rescue_queue WHERE id=$1`,[daily.queueId])).rows[0],
    {status:"MANAGER_REVIEW",rejection_reason:"DAILY_LIMIT_REACHED"});
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM kay_manager_reviews WHERE lead_id=$1 AND reason='DAILY_LIMIT_REACHED'`,[daily.leadId])).rows[0].n),1);

  await settings({auto_rescue_daily_limit:50,auto_rescue_per_employee_daily_limit:1});
  const employeeLimit=await fixture();
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='READY',lease_token=NULL,lease_expires_at=NULL,next_run_at=NOW(),fencing_token=0 WHERE id=$1`,[employeeLimit.queueId]);
  await isolateWorkerLead(employeeLimit.leadId);
  await runKayAutoRescueWorker(100);
  assert.deepEqual((await pool.query(`SELECT status,rejection_reason FROM kay_auto_rescue_queue WHERE id=$1`,[employeeLimit.queueId])).rows[0],
    {status:"MANAGER_REVIEW",rejection_reason:"EMPLOYEE_LIMIT_REACHED"});
  assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM kay_manager_reviews WHERE lead_id=$1 AND reason='EMPLOYEE_LIMIT_REACHED'`,[employeeLimit.leadId])).rows[0].n),1);
});

test("E.2 circuit counts only execution-system failures and empty cycles never reset it", { skip:!enabled }, async () => {
  await settings();
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES('phase_e2_auto_rescue_health','{"halted":false,"errors":0,"consecutive_failures":0}'::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
  const failing=await fixture();
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='READY',lease_token=NULL,lease_expires_at=NULL,next_run_at=NOW(),fencing_token=0 WHERE id=$1`,[failing.queueId]);
  await isolateWorkerLead(failing.leadId);
  setAutoRescueTestHook(step=>{if(step==="before_execute") throw new Error("synthetic infrastructure failure");});
  for (let expected=1;expected<=3;expected++) {
    await settings();
    await pool.query(`UPDATE kay_auto_rescue_queue SET status='READY',lease_token=NULL,lease_expires_at=NULL,next_run_at=NOW() WHERE id=$1`,[failing.queueId]);
    await pool.query(`UPDATE kay_settings SET value='{"released":true}'::jsonb WHERE key='phase_e2_auto_rescue_lease'`);
    await runKayAutoRescueWorker(100);
    const health=await getAutoRescueHealth();
    assert.equal(health.consecutiveFailures,expected);
    if (expected<3) {
      await settings({auto_rescue_canary_employee_ids:[]});
      await pool.query(`UPDATE kay_settings SET value='{"released":true}'::jsonb WHERE key='phase_e2_auto_rescue_lease'`);
      await runKayAutoRescueWorker(100);
      assert.equal((await getAutoRescueHealth()).consecutiveFailures,expected);
    }
  }
  setAutoRescueTestHook();
  assert.equal((await getAutoRescueHealth()).circuit,"HALTED");

  await pool.query(`UPDATE kay_settings SET value='{"halted":false,"errors":0,"consecutive_failures":0}'::jsonb WHERE key='phase_e2_auto_rescue_health'`);
  await settings();
  const business=await fixture();
  await pool.query(`UPDATE kay_auto_rescue_queue SET status='READY',lease_token=NULL,lease_expires_at=NULL,next_run_at=NOW(),fencing_token=0 WHERE id=$1`,[business.queueId]);
  await pool.query(`INSERT INTO kay_lead_protection(lead_id,reason) VALUES($1,'synthetic business rejection')`,[business.leadId]);
  await isolateWorkerLead(business.leadId);
  await runKayAutoRescueWorker(100);
  assert.equal((await getAutoRescueHealth()).consecutiveFailures,0);
  assert.equal((await pool.query(`SELECT status FROM kay_auto_rescue_queue WHERE id=$1`,[business.queueId])).rows[0].status,"BLOCKED");
});