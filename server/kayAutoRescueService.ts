import { pool } from "./db";
import { getRescueSettings, getKayMode, rescueSettingsSchema } from "./kayService";
import { rescueAttemptPredicate } from "./kayAutoRescuePlanner";
import { executeAutomaticRescue, freezeE24NoExecution } from "./kayRescueService";
import { resolveKayStatusWindow } from "./kayLegacyBaselineService";
import { getKayScopeConfiguration, getKayScopeForLead } from "./kayLeadScopeService";
import { getE23CapacitySnapshot, selectE23Target } from "./kayPhaseE23Service";
import { assertKayProductionEntry } from "./kaySyntheticSafety";
import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";
import { denyKayWrite } from "./kayActionGateway";
import { assertSafeKayMutationTestDatabase } from "./kayTestDatabaseSafety";

type Queryable = { query: (sql: string, values?: any[]) => Promise<any> };
type AutoRescueTestHook = (step: "before_execute" | "after_execute", queue: any) => void | Promise<void>;
let autoRescueTestHook: AutoRescueTestHook | undefined;
function isolatedE2Test(): boolean {
  return process.env.NODE_ENV === "test" &&
    process.env.KAY_E2_POSTGRES_TESTS === "true" &&
    process.env.KAY_E2_TEST_HOOKS === "true";
}
function assertAutoRescueRecord(record?: unknown): void {
  if (isolatedE2Test()) {
    assertSafeKayMutationTestDatabase("kayPhaseE2.integration");
  } else {
    assertKayProductionEntry(record);
  }
}
async function assertAutoRescueMutation(
  action: "workflow.transition" | "rescue.execute",
  actorId: number | undefined,
  targetType: string,
  targetId: string | number,
  record?: unknown,
): Promise<void> {
  assertAutoRescueRecord(record);
  if (!isolatedE2Test()) await denyKayWrite(action, actorId, targetType, targetId);
}
export function setAutoRescueTestHook(hook?: AutoRescueTestHook) {
  if (process.env.KAY_E2_TEST_HOOKS !== "true") throw new Error("Automatic Rescue test hooks are disabled");
  autoRescueTestHook = hook;
}

const terminal = ["EXECUTED", "BLOCKED", "REJECTED", "MANAGER_REVIEW", "STALE"];
const businessRejections = new Set([
  "FENCE_LOST", "LEAD_MISSING", "MODE_NOT_CONTROLLED_AUTOMATION",
  "PROTECTED", "STALE_RECOMMENDATION", "AUTOMATION_GATE_CLOSED",
  "CANARY_DENIED", "RULE_STATUS_NOT_ALLOWED", "RULE_CHANGED",
  "CANARY_LIMIT_REACHED", "WARNING_GRACE_GATE",
  "PROMISE_MANAGER_REVIEW_REQUIRED", "DAILY_LIMIT_REACHED",
  "EMPLOYEE_LIMIT_REACHED", "OWNER_CHANGED", "STATE_CHANGED", "CLOSING",
  "THRESHOLD_NOT_MET", "BLOCKER_ADDED", "LIMIT_REACHED",
  "OVERRIDE_REASON_REQUIRED", "TARGET_UNAVAILABLE", "PING_PONG_PREVENTED",
  "SOURCE_UNAVAILABLE", "KAY_SCOPE_EXCLUDED_OWNER", "KAY_SCOPE_OUT_OF_SCOPE_LEGACY", "KAY_SCOPE_LEGACY_DATE_UNCERTAIN",
]);
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const tbilisiDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi" }).format(new Date());

async function health(patch: Record<string, unknown>) {
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES('phase_e2_auto_rescue_health',$1::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=kay_settings.value || EXCLUDED.value,updated_at=NOW()`, [JSON.stringify(patch)]);
}
async function managerReview(queue: any, reason: string, executor: Queryable = pool) {
  const key = `e2:review:${queue.id}:${reason}`;
  await executor.query(`INSERT INTO kay_manager_reviews(lead_id,employee_id,reason,idempotency_key,details)
    VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(idempotency_key) DO NOTHING`,
    [queue.lead_id, queue.expected_owner_id, reason, key, JSON.stringify({ queueId: queue.id, internalOnly: true })]);
  const notice = await executor.query(`INSERT INTO kay_events(event_type,event_source,metadata,kay_generated,idempotency_key)
    VALUES('auto_rescue_manager_review','kay',$1::jsonb,true,$2)
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
    [JSON.stringify({ queueId: queue.id, reason }), `e2:review-notice:${queue.id}:${reason}`]);
  if (notice.rows[0]) await executor.query(`INSERT INTO user_notifications(user_id,type,title,message,data,idempotency_key)
    SELECT id,'kay_manager_review','Automatic Rescue manager review','Automatic Rescue requires manager review.',$1::jsonb,$2
    FROM users WHERE is_admin=true ORDER BY id LIMIT 1
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [JSON.stringify({ queueId: queue.id, reason }),`e2:review-notification:${queue.id}:${reason}`]);
}
async function claimedTransition(q: any, token: string, status: string, reason?: string, executionId?: number) {
  const r = await pool.query(`UPDATE kay_auto_rescue_queue SET status=$4,rejection_reason=$5,execution_id=COALESCE($6,execution_id),
    executed_at=CASE WHEN $4='EXECUTED' THEN NOW() ELSE executed_at END,lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
    WHERE id=$1 AND lease_token=$2 AND fencing_token=$3 AND status='CLAIMED' RETURNING *`,
    [q.id, token, q.fencing_token, status, reason || null, executionId || null]);
  return r.rows[0] || null;
}
async function reconcileUncertain(q: any, token: string, errorCode: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const item: any = (await client.query(`SELECT * FROM kay_auto_rescue_queue WHERE id=$1 FOR UPDATE`, [q.id])).rows[0];
    if (!item || item.lease_token !== token || Number(item.fencing_token)!==Number(q.fencing_token) || item.status!=="CLAIMED") { await client.query("ROLLBACK"); return; }
    const lead: any = (await client.query(`SELECT assigned_to FROM crm_leads WHERE id=$1 FOR UPDATE`, [item.lead_id])).rows[0];
    const success: any = (await client.query(`SELECT x.id FROM kay_rescue_executions x
      JOIN kay_decisions d ON d.id=x.decision_id
      WHERE x.lead_id=$1 AND x.outcome='SUCCESS' AND x.metadata->>'executionMode'='automatic'
        AND x.metadata->>'automaticQueueId'=$2 AND d.payload->>'automaticQueueId'=$2
      ORDER BY x.id DESC LIMIT 1`,[item.lead_id,String(item.id)])).rows[0];
    if (success && lead?.assigned_to === item.target_employee_id) {
      await client.query(`UPDATE kay_auto_rescue_queue SET status='EXECUTED',execution_id=$4,executed_at=NOW(),lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
        WHERE id=$1 AND lease_token=$2 AND fencing_token=$3 AND status='CLAIMED'`,[item.id,token,q.fencing_token,success.id]);
    } else if (lead?.assigned_to === item.expected_owner_id && Number(item.fencing_token) < 3) {
      await client.query(`UPDATE kay_auto_rescue_queue SET status='READY',lease_token=NULL,lease_expires_at=NULL,next_run_at=NOW()+((fencing_token+1)*interval '5 minutes'),rejection_reason=$4,updated_at=NOW()
        WHERE id=$1 AND lease_token=$2 AND fencing_token=$3 AND status='CLAIMED'`,[item.id,token,q.fencing_token,`RETRY_AFTER_UNCERTAIN:${errorCode}`]);
    } else {
      await client.query(`UPDATE kay_auto_rescue_queue SET status='MANAGER_REVIEW',lease_token=NULL,lease_expires_at=NULL,rejection_reason='AMBIGUOUS_RESULT',updated_at=NOW()
        WHERE id=$1 AND lease_token=$2 AND fencing_token=$3 AND status='CLAIMED'`,[item.id,token,q.fencing_token]);
      await managerReview(item,"AMBIGUOUS_RESULT",client);
      await client.query("COMMIT"); await health({halted:true}); return;
    }
    await client.query("COMMIT");
  } catch { await client.query("ROLLBACK").catch(()=>{}); } finally { client.release(); }
}
export async function reconcileAutoRescueUncertainForTest(q: any, token: string, errorCode = "TEST_UNCERTAIN") {
  assertSafeKayMutationTestDatabase("reconcileAutoRescueUncertainForTest");
  if (!isolatedE2Test()) {
    throw new Error("Automatic Rescue reconciliation test helper is disabled");
  }
  return reconcileUncertain(q, token, errorCode);
}

export async function getAutoRescueHealth() {
  const [settings, readonly] = await Promise.all([
    getRescueSettings(),
    withKayReadonlyAnalysis(async analysis => Promise.all([
      analysis.query(`SELECT value FROM kay_settings WHERE key='phase_e2_auto_rescue_health'`),
      analysis.query(`SELECT status,count(*)::int count FROM kay_auto_rescue_queue GROUP BY status`),
      analysis.query(`SELECT count(*)::int count FROM lead_assignment_history WHERE reason='kay_rescue_automatic'
        AND ((assigned_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Tbilisi')::date=(NOW() AT TIME ZONE 'Asia/Tbilisi')::date`),
      analysis.query(`SELECT count(*)::int count FROM kay_rescue_executions
        WHERE outcome='SUCCESS' AND metadata->>'executionMode'='automatic'
          AND metadata->>'businessDate'=to_char(NOW() AT TIME ZONE 'Asia/Tbilisi','YYYY-MM-DD')
          AND metadata->>'canaryPeriod'=COALESCE((SELECT value->>'auto_rescue_rule_version' FROM kay_settings WHERE key='rescue_rules'),'phase_e2_v1')`),
    ])),
  ]);
  const [h, counts, today, canary] = readonly;
  const state: any = h.rows[0]?.value || {}; const by = Object.fromEntries(counts.rows.map((r: any) => [r.status, r.count]));
  return { enabled: process.env.ENABLE_BACKGROUND_SCHEDULERS === "true", mode: await getKayMode(), killSwitch: settings.auto_rescue_kill_switch,
    canaryEnabled: settings.auto_rescue_canary_enabled, canaryEmployees: settings.auto_rescue_canary_employee_ids.length,
    pendingWarnings: by.WARNING || 0, ready: by.READY || 0, blocked: by.BLOCKED || 0, rejected: by.REJECTED || 0,
     executedToday: Number(today.rows[0]?.count || 0), canaryLimit: Number(settings.auto_rescue_canary_daily_limit ?? 1),
     canaryCount: Number(canary.rows[0]?.count || 0), canaryFrozen: settings.auto_rescue_kill_switch === true,
     lastSuccessfulCycle: state.last_successful_cycle || null,
    lastAutomaticRescue: state.last_automatic_rescue || null, errors: Number(state.errors || 0),
    consecutiveFailures: Number(state.consecutive_failures || 0), circuit: state.halted === true ? "HALTED" : "OK", leaseState: state.lease_state || "unknown" };
}

async function acquireLease() {
  const token = `e2:${process.pid}:${Date.now()}:${Math.random()}`;
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES('phase_e2_auto_rescue_lease','{"released":true}'::jsonb) ON CONFLICT DO NOTHING`);
  const r = await pool.query(`UPDATE kay_settings SET value=jsonb_build_object('token',$1::text,'locked_until',(NOW()+interval '10 minutes')::text),updated_at=NOW()
    WHERE key='phase_e2_auto_rescue_lease' AND COALESCE((value->>'locked_until')::timestamptz,to_timestamp(0))<NOW() RETURNING key`, [token]);
  return r.rows[0] ? token : null;
}
async function releaseLease(token: string) {
  await pool.query(`UPDATE kay_settings SET value='{"released":true}'::jsonb,updated_at=NOW() WHERE key='phase_e2_auto_rescue_lease' AND value->>'token'=$1`, [token]);
}

/** Read-only aggregate simulation. It performs no queue, history or CRM writes. */
export async function getAutoRescueReadiness(limit = 500) {
 return withKayReadonlyAnalysis(async analysis => {
  const settingsRow = await analysis.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`);
  const settings = rescueSettingsSchema.parse(settingsRow.rows[0]?.value);
  const scopeConfig = await getKayScopeConfiguration(analysis);
  if (scopeConfig.status !== "OK") {
    return { checked: 0, wouldExecute: 0, wouldBlock: 0, managerReview: 0, noEligibleEmployee: 0, protected: 0, dailyLimitImpact: 0, blockedReason: scopeConfig.status };
  }
  const rows = await analysis.query(`SELECT l.id,l.status,l.assigned_to,h.entered_at,p.id protection_id,
    EXISTS(SELECT 1 FROM crm_tasks t WHERE t.lead_id=l.id AND t.completed_at IS NULL) blocker
    FROM crm_leads l LEFT JOIN LATERAL (SELECT entered_at FROM kay_lead_status_history WHERE lead_id=l.id AND status=l.status ORDER BY entered_at DESC LIMIT 1) h ON true
    LEFT JOIN kay_lead_protection p ON p.lead_id=l.id AND p.removed_at IS NULL
    WHERE l.status IN ('no_answer_1','no_answer_2') ORDER BY l.id LIMIT $1`, [clamp(limit, 1, 1000)]);
  const result = { checked: rows.rows.length, wouldExecute: 0, wouldBlock: 0, managerReview: 0, noEligibleEmployee: 0, protected: 0, dailyLimitImpact: 0 };
  for (const l of rows.rows as any[]) {
    const scope = await getKayScopeForLead(Number(l.id));
    if (scope.outcome !== "IN_KAY_SCOPE") continue;
    const threshold = (l.status === "no_answer_2" ? settings.no_answer_2_threshold_hours : settings.no_answer_1_threshold_hours) * 3600000;
    if (!l.entered_at || Date.now() - new Date(l.entered_at).getTime() < threshold) continue;
    if (l.protection_id) { result.protected++; result.wouldBlock++; continue; }
    if (l.blocker) { result.wouldBlock++; continue; }
    const eligible = await analysis.query(`SELECT id FROM users WHERE role='sub_agent' AND is_active=true AND id<>$1
      AND COALESCE((SELECT value->>'availability' FROM kay_settings WHERE key='phase_c_availability:'||users.id::text),'AVAILABLE')='AVAILABLE' LIMIT 1`, [l.assigned_to]);
    if (!eligible.rows[0]) { result.managerReview++; result.noEligibleEmployee++; } else result.wouldExecute++;
  }
  return result;
 });
}

export type LastChanceAction = "CONTACT_NOW" | "NEED_30_MINUTES" | "CANNOT_HANDLE";
export async function applyAutoRescueLastChance(queueId: number, userId: number, isAdmin: boolean, action: LastChanceAction) {
  await assertAutoRescueMutation("workflow.transition", userId, "auto_rescue_queue", queueId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('kay:e24-control'))`);
    const q: any = (await client.query(`SELECT q.*,l.assigned_to current_owner_id
      FROM kay_auto_rescue_queue q JOIN crm_leads l ON l.id=q.lead_id
      WHERE q.id=$1 FOR UPDATE OF q,l`,[queueId])).rows[0];
    if (!q || (!isAdmin && Number(q.current_owner_id)!==Number(userId))) {
      throw Object.assign(new Error("This Rescue window is not assigned to you."),{status:403,code:"NOT_OWNER"});
    }
    assertAutoRescueRecord(q);
    const scope = await getKayScopeForLead(Number(q.lead_id));
    if (scope.outcome !== "IN_KAY_SCOPE") {
      throw Object.assign(new Error("This Rescue window is outside Kay operational scope."), { status: 409, code: `KAY_SCOPE_${scope.outcome}` });
    }
    if (Number(q.current_owner_id)!==Number(q.expected_owner_id) ||
      !["WARNING","READY","PENDING"].includes(q.status)) {
      throw Object.assign(new Error("This Rescue window is no longer actionable."),{status:409,code:"STALE_WINDOW"});
    }
    if (action==="NEED_30_MINUTES") {
      const rules:any=(await client.query(`SELECT value FROM kay_settings WHERE key='rescue_rules' FOR UPDATE`)).rows[0]?.value||{};
      const updated=await client.query(`UPDATE kay_auto_rescue_queue
        SET grace_count=grace_count+1,grace_until=clock_timestamp()+($2::int * interval '1 minute'),status='WARNING',
          next_run_at=clock_timestamp()+($2::int * interval '1 minute'),updated_at=clock_timestamp()
        WHERE id=$1 AND grace_count<$3::int AND status IN ('WARNING','READY','PENDING') RETURNING grace_until,grace_count`,
      [queueId,Number(rules.rescue_grace_minutes??30),Number(rules.rescue_grace_max_count??1)]);
      if (!updated.rows[0]) throw Object.assign(new Error("The grace extension was already used for this Rescue window."),{status:409,code:"GRACE_USED"});
    } else if (action==="CANNOT_HANDLE") {
      const updated=await client.query(`UPDATE kay_auto_rescue_queue SET status='MANAGER_REVIEW',
        rejection_reason='CANNOT_HANDLE',updated_at=NOW() WHERE id=$1 AND status IN ('WARNING','READY','PENDING') RETURNING id`,[queueId]);
      if (!updated.rows[0]) throw Object.assign(new Error("This Rescue window is no longer actionable."),{status:409,code:"STALE_WINDOW"});
      await managerReview(q,"CANNOT_HANDLE",client);
    } else {
      const mission=await client.query(`INSERT INTO kay_missions
        (lead_id,employee_id,mission_type,priority,priority_score,reason_code,reason_details,objective,suggested_action,idempotency_key)
        VALUES($1,$2,'RESCUE_RISK','HIGH',50,'RESCUE_CONTACT_NOW',$3::jsonb,
          'Make a meaningful protected next action.','Create a legitimate CRM follow-up task and record the outcome.',$4)
        ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id`,
      [q.lead_id,q.current_owner_id,JSON.stringify({queueId:q.id,doesNotBlockRescue:true}),`e2:contact-now:${q.id}`]);
      await client.query(`INSERT INTO kay_commitments
        (lead_id,mission_id,employee_id,action,status,due_at,idempotency_key,details)
        VALUES($1,$2,$3,'Create and complete a meaningful CRM next action','PENDING',NOW()+interval '30 minutes',$4,$5::jsonb)
        ON CONFLICT(idempotency_key) DO NOTHING`,
      [q.lead_id,mission.rows[0]?.id??null,q.current_owner_id,`e2:contact-now-commitment:${q.id}`,JSON.stringify({queueId:q.id,ownershipDependent:true,doesNotBlockRescue:true})]);
    }
    await client.query("COMMIT");
    return {queueId,action,crmStatusUnchanged:true};
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { client.release(); }
}

async function ensureWarningArtifacts(itemId: number, leadId: number, ownerId: number) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const item:any=(await client.query(`SELECT q.id,q.status,q.warning_mission_id,q.expected_owner_id,
        l.assigned_to,u.id employee_id,u.username employee_username,u.role employee_role,
        u.is_active employee_active,u.is_admin employee_admin
      FROM kay_auto_rescue_queue q JOIN crm_leads l ON l.id=q.lead_id
      JOIN users u ON u.id=l.assigned_to
      WHERE q.id=$1 AND q.lead_id=$2
      FOR UPDATE OF q,l FOR SHARE OF u`,[itemId,leadId])).rows[0];
    if (!item || !["PENDING","WARNING"].includes(item.status)) { await client.query("COMMIT"); return; }
    const scope = await getKayScopeForLead(leadId, client);
    if (scope.outcome !== "IN_KAY_SCOPE" ||
      Number(item.expected_owner_id) !== Number(ownerId) ||
      Number(item.assigned_to) !== Number(ownerId) ||
      Number(item.employee_id) !== Number(ownerId) ||
      item.employee_active !== true ||
      item.employee_admin === true ||
      item.employee_role !== "sub_agent" ||
      String(item.employee_username || "").toLowerCase() === "kinglike_admin") {
      await client.query("COMMIT");
      return;
    }
    const mission=await client.query(`INSERT INTO kay_missions
      (lead_id,employee_id,mission_type,priority,priority_score,reason_code,reason_details,objective,suggested_action,idempotency_key)
      VALUES($1,$2,'RESCUE_RISK','HIGH',50,'FINAL_RESCUE_WARNING',$4::jsonb,'Final Rescue warning.',
        'Create a meaningful protected next action, request one grace period, or indicate you cannot handle this lead.',$3)
      ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id`,
    [leadId,ownerId,`e2:warning:${itemId}`,JSON.stringify({queueId:itemId})]);
    const missionId=mission.rows[0].id;
    await client.query(`INSERT INTO kay_internal_briefings(employee_id,lead_id,mission_id,trigger_type,severity,text,idempotency_key)
      VALUES($1,$2,$3,'FINAL_RESCUE_WARNING','HIGH','Final Rescue warning: this lead enters Rescue review soon.',$4)
      ON CONFLICT(idempotency_key) DO NOTHING`,
    [ownerId,leadId,missionId,`e2:warning-brief:${itemId}`]);
    await client.query(`INSERT INTO user_notifications(user_id,type,title,message,data,idempotency_key)
      VALUES($1,'kay_rescue_warning','Final Rescue warning','This lead enters Rescue review soon.',$2::jsonb,$3)
      ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [ownerId,JSON.stringify({queueId:itemId,leadId}),`e2:warning-notification:${itemId}`]);
    // Publishing the artifacts and starting the full warning interval are one
    // transaction. Recovery of any old/incomplete row restarts the clock.
    await client.query(`UPDATE kay_auto_rescue_queue SET status='WARNING',warning_mission_id=$2,
      warning_at=CASE WHEN warning_mission_id IS NULL OR status='PENDING' THEN clock_timestamp() ELSE warning_at END,
      next_run_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND status IN ('PENDING','WARNING')`,[itemId,missionId]);
    await client.query("COMMIT");
  } catch(error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { client.release(); }
}

export async function ensureWarningArtifactsForTest(itemId: number, leadId: number, ownerId: number) {
  assertSafeKayMutationTestDatabase("ensureWarningArtifactsForTest");
  if (process.env.KAY_E2_POSTGRES_TESTS !== "true") {
    throw new Error("Automatic Rescue warning test helper is disabled");
  }
  return ensureWarningArtifacts(itemId, leadId, ownerId);
}

async function evaluateIntoQueue(settings: any, limit: number) {
  assertAutoRescueRecord();
  const scopeConfig = await getKayScopeConfiguration();
  if (scopeConfig.status !== "OK") {
    await health({ halted: true, last_scope_failure: scopeConfig.status });
    throw Object.assign(new Error(`KAY_SCOPE_${scopeConfig.status}`), { code: `KAY_SCOPE_${scopeConfig.status}` });
  }
  const pinned = (await pool.query(`SELECT candidate_lead_id FROM phase_e24_first_canary_state WHERE id=1 AND status='ACTIVE'`)).rows[0]?.candidate_lead_id || null;
  const candidates = await pool.query(`SELECT l.id,l.status,l.assigned_to,h.entered_at,
    (SELECT count(*)::int FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ${rescueAttemptPredicate}) attempts
    FROM crm_leads l JOIN users owner ON owner.id=l.assigned_to
    JOIN LATERAL (SELECT entered_at FROM kay_lead_status_history WHERE lead_id=l.id AND status=l.status ORDER BY entered_at DESC LIMIT 1) h ON true
     WHERE l.status IN ('no_answer_1','no_answer_2') AND owner.is_active=true AND owner.is_admin=false AND owner.role='sub_agent'
      ORDER BY CASE WHEN l.id=$2 THEN 0 ELSE 1 END,l.id LIMIT $1`, [clamp(limit, 1, 100),pinned]);
  for (const lead of candidates.rows as any[]) {
    assertAutoRescueRecord(lead);
      const scope = await getKayScopeForLead(Number(lead.id));
    if (scope.outcome !== "IN_KAY_SCOPE") continue;
    // E.2.2 baselines are observation-only until a separately approved future
    // policy exists. They may appear in readiness, never in queue/mission paths.
    const resolved = await resolveKayStatusWindow(Number(lead.id), lead.status);
    if (!resolved || resolved.source !== "STATUS_TRANSITION") continue;
    const enabled = lead.status === "no_answer_1" ? settings.auto_rescue_no_answer_1_enabled : settings.auto_rescue_no_answer_2_enabled;
    const threshold = (lead.status === "no_answer_1" ? settings.no_answer_1_threshold_hours : settings.no_answer_2_threshold_hours) * 3_600_000;
    if (!enabled || !lead.entered_at || Date.now() - new Date(lead.entered_at).getTime() < threshold - settings.rescue_warning_minutes * 60_000) continue;
    // Canary scope is an execution gate and also a warning gate: employees
    // outside the explicit allowlist must remain completely unaffected.
    if (settings.auto_rescue_canary_enabled !== true ||
      !settings.auto_rescue_canary_employee_ids.map(Number).includes(Number(lead.assigned_to))) continue;
    const queued = await pool.query(`INSERT INTO kay_auto_rescue_queue(lead_id,status,rule_status,status_window,rescue_attempt,rule_version,expected_owner_id,reasons,warning_at,next_run_at)
      VALUES($1,'PENDING',$2,$3,$4,$5,$6,'{}'::jsonb,NULL,NOW())
      ON CONFLICT(lead_id,rule_status,status_window,rescue_attempt,rule_version) DO UPDATE SET
        status=CASE WHEN kay_auto_rescue_queue.status IN ('PENDING','WARNING')
           AND kay_auto_rescue_queue.warning_at IS NOT NULL
            AND kay_auto_rescue_queue.warning_mission_id IS NOT NULL
            AND kay_auto_rescue_queue.warning_at + ($7::int * interval '1 minute')<=NOW()
           AND (kay_auto_rescue_queue.grace_until IS NULL OR kay_auto_rescue_queue.grace_until<=NOW()) THEN 'READY' ELSE kay_auto_rescue_queue.status END,
        next_run_at=CASE WHEN kay_auto_rescue_queue.grace_until>NOW() THEN kay_auto_rescue_queue.grace_until ELSE NOW() END,updated_at=NOW()
      RETURNING id,status,warning_mission_id,(xmax=0) inserted`, [lead.id,lead.status,lead.entered_at,lead.attempts,settings.auto_rescue_rule_version,lead.assigned_to,settings.rescue_warning_minutes]);
    const item: any = queued.rows[0];
    if (item && ["PENDING","WARNING"].includes(item.status)) await ensureWarningArtifacts(item.id,lead.id,lead.assigned_to);
  }
}

export async function runKayAutoRescueWorker(limit = 25) {
  await assertAutoRescueMutation("rescue.execute", undefined, "worker", "auto-rescue");
 try {
  const scopeConfig = await getKayScopeConfiguration();
  if (scopeConfig.status !== "OK") {
    await health({ halted: true, last_scope_failure: scopeConfig.status });
    await freezeE24NoExecution(`KAY_SCOPE_${scopeConfig.status}`,undefined,true);
    return { disabled: true, processed: 0, blockedReason: scopeConfig.status };
  }
  const settings = await getRescueSettings(); const mode = await getKayMode();
  // This is deliberately before lease/queue writes: the production defaults
  // leave no E.2 ownership or queue claim writes.
  if (mode !== "controlled_automation" || settings.auto_rescue_kill_switch || (!settings.auto_rescue_no_answer_1_enabled && !settings.auto_rescue_no_answer_2_enabled)) {
    await health({ last_safe_disabled_cycle: new Date().toISOString(), lease_state: "disabled" });
    return { disabled: true, processed: 0 };
  }
  const token = await acquireLease(); if (!token) return { busy: true, processed: 0 };
  try {
    const old = await getAutoRescueHealth(); if (old.circuit === "HALTED") {
      await freezeE24NoExecution("AUTOMATION_CIRCUIT_HALTED",undefined,true);
      return { halted: true, processed: 0 };
    }
    await health({ lease_state: "owned", last_attempt: new Date().toISOString() });
    await evaluateIntoQueue(settings, limit);
    const activeCanary: any = (await pool.query(`SELECT s.candidate_lead_id,s.source_employee_id,l.assigned_to,l.status,
        u.role source_role,u.is_active source_active,u.is_admin source_admin
      FROM phase_e24_first_canary_state s LEFT JOIN crm_leads l ON l.id=s.candidate_lead_id
      LEFT JOIN users u ON u.id=l.assigned_to
      WHERE s.id=1 AND s.status='ACTIVE'`)).rows[0];
    if (activeCanary) {
      const scope = await getKayScopeForLead(Number(activeCanary.candidate_lead_id));
      const blockers = await pool.query(`SELECT
        EXISTS(SELECT 1 FROM kay_lead_protection WHERE lead_id=$1 AND removed_at IS NULL) protected,
        EXISTS(SELECT 1 FROM crm_tasks WHERE lead_id=$1 AND completed_at IS NULL) task`,
        [activeCanary.candidate_lead_id]);
      const statusEnabled = activeCanary.status === "no_answer_1"
        ? settings.auto_rescue_no_answer_1_enabled === true
        : activeCanary.status === "no_answer_2" && settings.auto_rescue_no_answer_2_enabled === true;
      const valid = Number(activeCanary.assigned_to)===Number(activeCanary.source_employee_id) &&
        activeCanary.source_role === "sub_agent" && activeCanary.source_active === true &&
        activeCanary.source_admin !== true && statusEnabled && scope.outcome === "IN_KAY_SCOPE" &&
        blockers.rows[0]?.protected !== true && blockers.rows[0]?.task !== true;
      const queue = (await pool.query(`SELECT 1 FROM kay_auto_rescue_queue WHERE lead_id=$1 AND status IN ('PENDING','WARNING','READY','CLAIMED') LIMIT 1`,[activeCanary.candidate_lead_id])).rows[0];
      if (!valid) await freezeE24NoExecution("CANDIDATE_INVALIDATED",activeCanary.candidate_lead_id,true);
      else if (!queue) await freezeE24NoExecution("NO_SAFE_EXECUTION",activeCanary.candidate_lead_id,false);
    }
    await pool.query(`UPDATE kay_auto_rescue_queue SET status='READY',lease_token=NULL,lease_expires_at=NULL,next_run_at=NOW(),updated_at=NOW()
      WHERE status='CLAIMED' AND lease_expires_at<NOW() AND (grace_until IS NULL OR grace_until<=NOW())`);
    const claimed = await pool.query(`WITH picked AS (SELECT id FROM kay_auto_rescue_queue WHERE status='READY' AND next_run_at<=NOW()
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1) UPDATE kay_auto_rescue_queue q SET status='CLAIMED',lease_token=$2,lease_expires_at=NOW()+interval '5 minutes',
      fencing_token=fencing_token+1,claimed_at=NOW(),updated_at=NOW() FROM picked WHERE q.id=picked.id RETURNING q.*`, [clamp(limit, 1, 100), token]);
    let executed = 0;
    let systemFailures = 0;
    for (const q of claimed.rows as any[]) {
      try {
        assertAutoRescueRecord(q);
        const lead = (await pool.query(`SELECT * FROM crm_leads WHERE id=$1`, [q.lead_id])).rows[0];
        assertAutoRescueRecord(lead);
      const scope = await getKayScopeForLead(Number(q.lead_id));
        if (scope.outcome !== "IN_KAY_SCOPE") {
          await claimedTransition(q,token,"STALE",`KAY_SCOPE_${scope.outcome}`);
          if (await freezeE24NoExecution(`KAY_SCOPE_${scope.outcome}`, q.lead_id, true)) break;
          continue;
        }
        const ownerCheck = lead ? (await pool.query(`SELECT is_active,role,is_admin FROM users WHERE id=$1`, [lead.assigned_to])).rows[0] : null;
        if (!lead || !ownerCheck || ownerCheck.is_active !== true || ownerCheck.is_admin === true || ownerCheck.role !== "sub_agent" ||
          lead.assigned_to !== q.expected_owner_id || lead.status !== q.rule_status || new Date(q.status_window).getTime() !== new Date((await pool.query(`SELECT entered_at FROM kay_lead_status_history WHERE lead_id=$1 AND status=$2 ORDER BY entered_at DESC LIMIT 1`, [q.lead_id,q.rule_status])).rows[0]?.entered_at).getTime()) {
          await claimedTransition(q,token,"STALE","STATE_CHANGED");
          if (await freezeE24NoExecution("STATE_CHANGED", q.lead_id, true)) break;
          continue;
        }
        const block = await pool.query(`SELECT EXISTS(SELECT 1 FROM kay_lead_protection WHERE lead_id=$1 AND removed_at IS NULL) protected, EXISTS(SELECT 1 FROM crm_tasks WHERE lead_id=$1 AND completed_at IS NULL) task`, [q.lead_id]);
        if (block.rows[0].protected || block.rows[0].task) {
          const reason = block.rows[0].protected ? "PROTECTED" : "BLOCKER_ADDED";
          await claimedTransition(q,token,"BLOCKED",reason);
          if (await freezeE24NoExecution(reason, q.lead_id, true)) break;
          continue;
        }
        const [capacity, received] = await Promise.all([
          getE23CapacitySnapshot(),
          pool.query(`SELECT u.id,count(h.id) FILTER (WHERE h.reason='kay_rescue_automatic'
              AND ((h.assigned_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Tbilisi')::date=(NOW() AT TIME ZONE 'Asia/Tbilisi')::date)::int received_today,
            max(h.assigned_at) FILTER (WHERE h.reason='kay_rescue_automatic') last_rescue_at
            FROM users u LEFT JOIN lead_assignment_history h ON h.to_user_id=u.id GROUP BY u.id`),
        ]);
        const historyById = new Map(received.rows.map((x:any)=>[Number(x.id),x]));
        const routeTargets = [];
        for (const x of capacity as any[]) {
          const pingPong = (await pool.query(`SELECT 1 FROM lead_assignment_history WHERE lead_id=$1 AND from_user_id=$2 AND to_user_id=$3 AND assigned_at>NOW()-interval '30 days' LIMIT 1`,[q.lead_id,x.id,lead.assigned_to])).rows[0];
          const h:any=historyById.get(Number(x.id))||{};
          routeTargets.push({id:Number(x.id),username:x.username,active:x.is_active,isAdmin:x.is_admin,role:x.role,availability:x.availability,
            operationalLoad:Number(x.operationalLoad),receivedToday:Number(h.received_today||0),lastRescueAt:h.last_rescue_at||null,doNotAssign:!!pingPong});
        }
        const candidate = selectE23Target(routeTargets, lead.assigned_to, {dailyLimit:Number(settings.auto_rescue_per_employee_daily_limit)});
        if (!candidate) {
          const uncappedCandidate = selectE23Target(routeTargets, lead.assigned_to);
          const reason = uncappedCandidate ? "EMPLOYEE_LIMIT_REACHED" : "NO_ELIGIBLE_EMPLOYEE";
          if (await claimedTransition(q,token,"MANAGER_REVIEW",reason)) await managerReview(q,reason);
          if (await freezeE24NoExecution(reason, q.lead_id, true)) break;
          continue;
        }
        const day = tbilisiDay();
        const counts = await pool.query(`SELECT count(*) FILTER (WHERE metadata->>'businessDate'=$1)::int total,count(*) FILTER (WHERE metadata->>'businessDate'=$1 AND to_user_id=$2)::int owner_total FROM lead_assignment_history WHERE reason='kay_rescue_automatic'`,[day,candidate.id]);
        if (counts.rows[0].total >= settings.auto_rescue_daily_limit || counts.rows[0].owner_total >= settings.auto_rescue_per_employee_daily_limit) {
          const reason=counts.rows[0].total >= settings.auto_rescue_daily_limit?"DAILY_LIMIT_REACHED":"EMPLOYEE_LIMIT_REACHED";
          if (await claimedTransition(q,token,"MANAGER_REVIEW",reason)) await managerReview(q,reason);
          if (await freezeE24NoExecution(reason, q.lead_id, true)) break;
          continue;
        }
        const event = await pool.query(`INSERT INTO kay_events(lead_id,employee_id,event_type,event_source,metadata,kay_generated,idempotency_key)
          VALUES($1,$2,'shadow_rescue_evaluated','kay',$3::jsonb,true,$4)
          ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL
          DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id`,
        [q.lead_id,lead.assigned_to,JSON.stringify({automaticQueueId:q.id}),`e2:auto:${q.id}`]);
        let decision = (await pool.query(`SELECT id FROM kay_decisions WHERE event_id=$1`,[event.rows[0].id])).rows[0];
        if (!decision) decision=(await pool.query(`INSERT INTO kay_decisions(lead_id,event_id,decision_type,mode,rationale,payload) VALUES($1,$2,$3,'controlled_automation','E.2 automatic rescue',$4::jsonb) RETURNING id`,[q.lead_id,event.rows[0].id,`${q.rule_status}_rescue_eligible`,JSON.stringify({state:"ACTIVE",status:q.rule_status,status_entered_at:new Date(q.status_window).toISOString(),threshold_minutes:(q.rule_status==="no_answer_1"?settings.no_answer_1_threshold_hours:settings.no_answer_2_threshold_hours)*60,max_rescue_attempts:settings.max_human_rescue_attempts,recommended_employee_id:candidate.id,automaticQueueId:q.id,settings_snapshot:settings})])).rows[0];
        const pinned = await pool.query(`UPDATE kay_auto_rescue_queue SET target_employee_id=$4,updated_at=NOW() WHERE id=$1 AND lease_token=$2 AND fencing_token=$3 AND status='CLAIMED' RETURNING id`,[q.id,token,q.fencing_token,candidate.id]);
        if (!pinned.rows[0]) throw Object.assign(new Error("FENCE_LOST"),{code:"FENCE_LOST"});
        await autoRescueTestHook?.("before_execute",q);
        const done = await executeAutomaticRescue({leadId:q.lead_id,decisionId:decision.id,expectedOwnerId:lead.assigned_to,targetEmployeeId:candidate.id,queueId:q.id,leaseToken:token,fencingToken:q.fencing_token});
        await autoRescueTestHook?.("after_execute",q);
        if (!await claimedTransition(q,token,"EXECUTED",undefined,done.executionId)) throw Object.assign(new Error("FENCE_LOST"),{code:"FENCE_LOST"});
        executed++;
        // The transaction freezes the canary atomically. Do not process another
        // row from this already-claimed batch using stale outer settings.
        await pool.query(`UPDATE kay_auto_rescue_queue SET status='REJECTED',rejection_reason='CANARY_LIMIT_REACHED',
          lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
          WHERE status='CLAIMED' AND lease_token=$1 AND id<>$2`, [token, q.id]);
        break;
      } catch (error:any) {
        const code = String(error?.code || "EXECUTION_FAILED");
        const business = businessRejections.has(code);
        if (business) {
           const frozen = code !== "WARNING_GRACE_GATE" && await freezeE24NoExecution(code, q.lead_id, true);
           const needsReview = ["LIMIT_REACHED","PROMISE_MANAGER_REVIEW_REQUIRED","DAILY_LIMIT_REACHED","EMPLOYEE_LIMIT_REACHED","CANARY_LIMIT_REACHED"].includes(code);
          const transitioned = await claimedTransition(q,token,needsReview ? "MANAGER_REVIEW" : "REJECTED",code.slice(0,120));
          if (transitioned && needsReview) await managerReview(q,code);
           if (frozen) break;
        }
         else { systemFailures++; const frozen=await freezeE24NoExecution(String(error?.code||"EXECUTION_FAILED"),q.lead_id,true); await reconcileUncertain(q,token,String(error?.code||"EXECUTION_FAILED")); const h:any=(await pool.query(`SELECT value FROM kay_settings WHERE key='phase_e2_auto_rescue_health'`)).rows[0]?.value||{}; const n=Number(h.consecutive_failures||0)+1; await health({errors:Number(h.errors||0)+1,consecutive_failures:n,halted:n>=3}); if(n>=3) await managerReview(q,"AUTOMATION_CIRCUIT_HALTED"); if (frozen) break; }
      }
    }
    await health({ last_successful_cycle:new Date().toISOString(),last_automatic_rescue:executed?new Date().toISOString():undefined,executed_today:executed, ...(executed > 0 ? { consecutive_failures:0 } : {}),lease_state:"released" });
    return { processed: claimed.rows.length, executed };
  } catch (error:any) {
    await freezeE24NoExecution(`WORKER_FATAL:${String(error?.code||"EXECUTION_FAILED")}`,undefined,true).catch(()=>{});
    throw error;
  } finally { await releaseLease(token).catch(()=>{}); }
 } catch (error:any) {
   await freezeE24NoExecution(`WORKER_OUTER_FATAL:${String(error?.code||"EXECUTION_FAILED")}`,undefined,true).catch(()=>{});
   throw error;
 }
}

export function startKayAutoRescueWorker() {
  if (process.env.ENABLE_BACKGROUND_SCHEDULERS !== "true") return;
  const tick=()=>runKayAutoRescueWorker().catch(()=>{});
  setInterval(tick, 5*60_000).unref();
}