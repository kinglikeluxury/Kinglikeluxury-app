import { pool } from "./db";
import { getKayStatusIntelligence, isKayRescueEvaluatedStatus } from "./kayStatusClassification";
import { getKayScopeForLead } from "./kayLeadScopeService";
import { resolveKayStatusWindow } from "./kayLegacyBaselineService";
import { assertKayProductionEntry } from "./kaySyntheticSafety";
import { denyKayWrite } from "./kayActionGateway";

const activeMission = ["NEW", "ACCEPTED", "IN_PROGRESS"];
const openPromise = ["PENDING", "DUE_SOON", "OVERDUE", "OPEN"];
const openCommitment = ["PENDING", "ACCEPTED", "EXTENDED", "OVERDUE", "ACTIVE"];
const overrideReasons = ["EMPLOYEE_LANGUAGE", "EMPLOYEE_AVAILABILITY", "WORKLOAD", "MANAGER_DECISION", "OTHER"];
type Reject = Error & { code?: string; status?: number };
const reject = (code: string) => Object.assign(new Error("RESCUE STATE CHANGED — REVIEW AGAIN"), { code, status: 409 }) as Reject;

export type RescueCommand = { leadId: number; decisionId: number; expectedOwnerId: number; targetEmployeeId?: number; overrideReason?: string; overrideNote?: string };
export type AutomaticRescueCommand = RescueCommand & { queueId: number; leaseToken: string; fencingToken: number };
type RescueTestHook = (step: "after_owner_update" | "after_audit_event") => void | Promise<void>;
let rescueTestHook: RescueTestHook | undefined;

/** Test-only fault injection. It is deliberately unavailable unless explicitly enabled. */
export function setAssistedRescueTestHook(hook?: RescueTestHook) {
  if (process.env.KAY_E1_TEST_HOOKS !== "true") throw new Error("Assisted Rescue test hooks are disabled");
  rescueTestHook = hook;
}

async function auditRejected(command: RescueCommand, adminId: number, code: string) {
  // FK-safe nullable canonical references plus requested IDs in immutable
  // metadata ensure malformed/stale commands are never invisible.
  const known = await pool.query(`SELECT
    (SELECT id FROM crm_leads WHERE id=$1) lead_id,
    (SELECT id FROM kay_decisions WHERE id=$2) decision_id,
    (SELECT id FROM users WHERE id=$3) admin_id`, [command.leadId, command.decisionId, adminId]);
  const row: any = known.rows[0];
  await pool.query(`INSERT INTO kay_rescue_executions(lead_id,decision_id,from_user_id,to_user_id,approved_by,outcome,rejection_reason,metadata)
    VALUES($1,$2,NULL,NULL,$3,'REJECTED',$4,$5::jsonb)`,
    [row.lead_id, row.decision_id, row.admin_id, code, JSON.stringify({ phase: "E.1", requestedLeadId: command.leadId, requestedDecisionId: command.decisionId, requestedOwnerId: command.expectedOwnerId, requestedTargetId: command.targetEmployeeId ?? null })]);
}

/** The sole transactional ownership-transfer primitive for E.1 and E.2. */
export async function executeRescueTransaction(command: RescueCommand, actorId: number | null, executionMode: "assisted" | "automatic" = "assisted") {
  assertKayProductionEntry(command);
  await denyKayWrite("rescue.execute", actorId ?? undefined, "crm_lead", command.leadId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (executionMode === "automatic") {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('kay:e24-control'))`);
    }
    let automaticQueue: any = null;
    let e24State: any = null;
    // Automatic callers must prove that the exact durable work item is still
    // theirs *inside the same transaction* that changes CRM ownership.  A
    // stale worker can therefore never write after its lease was fenced.
    if (executionMode === "automatic") {
      const automatic = command as AutomaticRescueCommand;
      const queue = await client.query(`SELECT * FROM kay_auto_rescue_queue WHERE id=$1 FOR UPDATE`, [automatic.queueId]);
      const item: any = queue.rows[0];
      if (!item || item.status !== "CLAIMED" || item.lease_token !== automatic.leaseToken ||
        Number(item.fencing_token) !== Number(automatic.fencingToken) ||
        !item.lease_expires_at || new Date(item.lease_expires_at).getTime() <= Date.now() ||
        Number(item.lead_id) !== command.leadId || Number(item.expected_owner_id) !== command.expectedOwnerId) throw reject("FENCE_LOST");
      automaticQueue = item;
      const workerLease = await client.query(`SELECT value FROM kay_settings WHERE key='phase_e2_auto_rescue_lease' FOR UPDATE`);
      const lease: any = workerLease.rows[0]?.value;
      if (lease?.token !== automatic.leaseToken || !lease?.locked_until ||
        new Date(lease.locked_until).getTime() <= Date.now()) throw reject("FENCE_LOST");
    }
    if (executionMode === "assisted") {
      const admin = await client.query(`SELECT is_admin FROM users WHERE id=$1 FOR UPDATE`, [actorId]);
      if (admin.rows[0]?.is_admin !== true) throw reject("NOT_ADMIN");
    }
    const now = new Date();
    const leadResult = await client.query(`SELECT l.*, h.entered_at, p.id protection_id
      FROM crm_leads l LEFT JOIN LATERAL (SELECT entered_at FROM kay_lead_status_history WHERE lead_id=l.id AND status=l.status ORDER BY entered_at DESC LIMIT 1) h ON true
      LEFT JOIN kay_lead_protection p ON p.lead_id=l.id AND p.removed_at IS NULL WHERE l.id=$1 FOR UPDATE OF l`, [command.leadId]);
    const lead: any = leadResult.rows[0]; if (!lead) throw reject("LEAD_MISSING");
    assertKayProductionEntry(lead);
    // The lead row lock serializes confirms. A retry after a committed winner
    // returns that immutable result before re-evaluating now-stale eligibility.
    const prior = await client.query(`SELECT id,from_user_id,to_user_id,created_at FROM kay_rescue_executions WHERE decision_id=$1 AND outcome='SUCCESS' LIMIT 1`, [command.decisionId]);
    if (prior.rows[0]) {
      await client.query("COMMIT");
      return { executionId: Number(prior.rows[0].id), leadId: command.leadId, fromUserId: prior.rows[0].from_user_id, toUserId: prior.rows[0].to_user_id, idempotent: true };
    }
    if (executionMode === "automatic") {
      const scope = await getKayScopeForLead(client, Number(command.leadId));
      if (scope.outcome !== "IN_KAY_SCOPE") throw reject(`KAY_SCOPE_${scope.outcome}`);
      const trustedWindow = await resolveKayStatusWindow(client, Number(command.leadId), lead.status);
      if (!trustedWindow || trustedWindow.source !== "STATUS_TRANSITION" ||
        new Date(trustedWindow.enteredAt).getTime() !== new Date(lead.entered_at).getTime()) {
        throw reject("UNTRUSTED_STATUS_WINDOW");
      }
      const source = (await client.query(`SELECT role,is_active,is_admin FROM users WHERE id=$1 FOR UPDATE`,[lead.assigned_to])).rows[0];
      if (!source || source.role !== "sub_agent" || source.is_active !== true || source.is_admin === true) throw reject("SOURCE_UNAVAILABLE");
    }
    if (automaticQueue && (automaticQueue.rule_status !== lead.status ||
      new Date(automaticQueue.status_window).getTime() !== new Date(lead.entered_at).getTime())) throw reject("FENCE_LOST");
    const decisionResult = await client.query(`SELECT d.*, e.event_type FROM kay_decisions d JOIN kay_events e ON e.id=d.event_id WHERE d.id=$1 AND d.lead_id=$2 FOR UPDATE`, [command.decisionId, command.leadId]);
    const decision: any = decisionResult.rows[0]; const payload: any = decision?.payload || {};
    const mode = (await client.query(`SELECT value->>'mode' mode FROM kay_settings WHERE key='mode' FOR UPDATE`)).rows[0]?.mode;
    if (mode !== (executionMode === "automatic" ? "controlled_automation" : "assisted")) throw reject(executionMode === "automatic" ? "MODE_NOT_CONTROLLED_AUTOMATION" : "MODE_NOT_ASSISTED");
    if (lead.protection_id) throw reject("PROTECTED");
    if (!decision || decision.event_type !== "shadow_rescue_evaluated" || payload.state !== "ACTIVE") throw reject("STALE_RECOMMENDATION");
    if (executionMode === "automatic") {
      const rules: any = (await client.query(`SELECT value FROM kay_settings WHERE key='rescue_rules' FOR UPDATE`)).rows[0]?.value || {};
      const enabled = lead.status === "no_answer_1" ? rules.auto_rescue_no_answer_1_enabled : lead.status === "no_answer_2" ? rules.auto_rescue_no_answer_2_enabled : false;
      if (!enabled) throw reject("AUTOMATION_GATE_CLOSED");
      const canary: number[] = Array.isArray(rules.auto_rescue_canary_employee_ids) ? rules.auto_rescue_canary_employee_ids.map(Number) : [];
      if (rules.auto_rescue_canary_enabled !== true || !canary.includes(Number(lead.assigned_to))) throw reject("CANARY_DENIED");
      if (!["no_answer_1", "no_answer_2"].includes(lead.status)) throw reject("RULE_STATUS_NOT_ALLOWED");
      const configuredThresholdMinutes = Number(lead.status === "no_answer_1"
        ? rules.no_answer_1_threshold_hours : rules.no_answer_2_threshold_hours) * 60;
      if (!Number.isFinite(configuredThresholdMinutes) ||
        Number(payload.threshold_minutes) !== configuredThresholdMinutes) throw reject("RULE_CHANGED");
      if (Number(payload.max_rescue_attempts) !== Number(rules.max_human_rescue_attempts)) throw reject("RULE_CHANGED");
      const promisesNeedingReview = await client.query(`SELECT EXISTS(SELECT 1 FROM kay_promises WHERE lead_id=$1 AND owner_review_required_at IS NOT NULL AND status=ANY($2)) blocked`, [command.leadId, openPromise]);
      if (promisesNeedingReview.rows[0]?.blocked) throw reject("PROMISE_MANAGER_REVIEW_REQUIRED");
      // Serialize business-day reservations across workers. The day boundary
      // is explicitly Asia/Tbilisi rather than server-local time.
      const businessDate = (await client.query(`SELECT to_char(NOW() AT TIME ZONE 'Asia/Tbilisi','YYYY-MM-DD') AS business_date`)).rows[0].business_date;
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [`kay-auto-limit:${businessDate}`]);
      const lifetimeState = (await client.query(`SELECT * FROM phase_e24_first_canary_state WHERE id=1 FOR UPDATE`)).rows[0];
      if (lifetimeState && ["FROZEN_SUCCESS","SUCCESS","FROZEN_NO_EXECUTION"].includes(lifetimeState.status)) throw reject("CANARY_LIMIT_REACHED");
      if (lifetimeState?.status === "ACTIVE") {
        e24State = lifetimeState;
        if (!e24State || e24State.status !== "ACTIVE" || Number(e24State.successful_executions) !== 0 ||
          Number(e24State.source_employee_id) !== Number(lead.assigned_to) ||
          Number(e24State.candidate_lead_id) !== Number(command.leadId) ||
          e24State.source_owner_epoch == null ||
          Number(e24State.source_owner_epoch) !== Number(lead.kay_owner_epoch)) throw reject("CANARY_LIMIT_REACHED");
      }
      if (String(rules.auto_rescue_rule_version) === "phase_e24_first_fadi_canary" && !lifetimeState) throw reject("CANARY_LIMIT_REACHED");
      if (!automaticQueue.warning_at || !automaticQueue.warning_mission_id ||
        new Date(automaticQueue.warning_at).getTime() + Number(rules.rescue_warning_minutes ?? 30) * 60000 > now.getTime() ||
        (automaticQueue.grace_until && new Date(automaticQueue.grace_until).getTime() > now.getTime())) {
        throw reject("WARNING_GRACE_GATE");
      }
      const canaryPeriod = String(rules.auto_rescue_rule_version || "phase_e2_v1");
      const canaryUsage = await client.query(`SELECT count(*)::int total
        FROM kay_rescue_executions
        WHERE outcome='SUCCESS' AND metadata->>'executionMode'='automatic'
          AND metadata->>'canaryPeriod'=$1 AND metadata->>'businessDate'=$2`, [canaryPeriod, businessDate]);
      if (Number(canaryUsage.rows[0]?.total || 0) >= Number(rules.auto_rescue_canary_daily_limit ?? 1)) throw reject("CANARY_LIMIT_REACHED");
      if (rules.auto_rescue_kill_switch !== false) throw reject("AUTOMATION_GATE_CLOSED");
      const usage = await client.query(`SELECT
        count(*) FILTER (WHERE ((assigned_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Tbilisi')::date=$1::date)::int total,
        count(*) FILTER (WHERE to_user_id=$2 AND ((assigned_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Tbilisi')::date=$1::date)::int owner_total
        FROM lead_assignment_history WHERE reason='kay_rescue_automatic'`, [businessDate, Number(command.targetEmployeeId ?? payload.recommended_employee_id)]);
      if (Number(usage.rows[0].total) >= Number(rules.auto_rescue_daily_limit)) throw reject("DAILY_LIMIT_REACHED");
      if (Number(usage.rows[0].owner_total) >= Number(rules.auto_rescue_per_employee_daily_limit)) throw reject("EMPLOYEE_LIMIT_REACHED");
    }
    if (lead.assigned_to !== command.expectedOwnerId) throw reject("OWNER_CHANGED");
    if (!isKayRescueEvaluatedStatus(lead.status) || lead.status !== payload.status || !lead.entered_at || new Date(lead.entered_at).toISOString() !== payload.status_entered_at) throw reject("STATE_CHANGED");
    if (getKayStatusIntelligence(lead.status).classification === "CLOSING") throw reject("CLOSING");
    const threshold = Number(payload.threshold_minutes); if (!Number.isFinite(threshold) || Date.now() - new Date(lead.entered_at).getTime() < threshold * 60000) throw reject("THRESHOLD_NOT_MET");
    const blockers = await client.query(`SELECT EXISTS(SELECT 1 FROM crm_tasks WHERE lead_id=$1 AND completed_at IS NULL) blocker`, [command.leadId]);
    if (blockers.rows[0].blocker) throw reject("BLOCKER_ADDED");
    const attempts = await client.query(`SELECT count(*)::int n FROM lead_assignment_history WHERE lead_id=$1
      AND (reason IN ('kay_rescue','kay_rescue_assisted','kay_rescue_automatic'))
      AND (automatic=true OR metadata->>'mode' IN ('assisted','automatic'))`, [command.leadId]);
    if (automaticQueue && Number(automaticQueue.rescue_attempt) !== Number(attempts.rows[0].n)) throw reject("FENCE_LOST");
    if (Number(attempts.rows[0].n) >= Number(payload.max_rescue_attempts)) throw reject("LIMIT_REACHED");
    const targetId = command.targetEmployeeId ?? Number(payload.recommended_employee_id);
    const isOverride = targetId !== Number(payload.recommended_employee_id);
    if (isOverride && (!overrideReasons.includes(command.overrideReason || "") || (command.overrideReason === "OTHER" && !command.overrideNote?.trim()))) throw reject("OVERRIDE_REASON_REQUIRED");
    const target = await client.query(`SELECT u.id,u.role,u.is_active,u.is_admin,COALESCE(a.value->>'availability','AVAILABLE') availability FROM users u
      LEFT JOIN kay_settings a ON a.key='phase_c_availability:'||u.id::text WHERE u.id=$1 AND u.role='sub_agent' FOR UPDATE OF u`, [targetId]);
    if (!target.rows[0] || targetId === lead.assigned_to || target.rows[0].role !== "sub_agent" || target.rows[0].is_active !== true || target.rows[0].is_admin === true || target.rows[0].availability !== "AVAILABLE") throw reject("TARGET_UNAVAILABLE");
    if (executionMode === "automatic" && (await client.query(`SELECT 1 FROM lead_assignment_history WHERE lead_id=$1 AND from_user_id=$2 AND to_user_id=$3 AND assigned_at>NOW()-interval '30 days' LIMIT 1`, [command.leadId, targetId, lead.assigned_to])).rows[0]) throw reject("PING_PONG_PREVENTED");
    const txid = (await client.query("SELECT txid_current()::text id")).rows[0].id;
    const updated = await client.query(`UPDATE crm_leads SET assigned_to=$1,updated_at=NOW() WHERE id=$2 AND assigned_to=$3 RETURNING id`, [targetId, command.leadId, command.expectedOwnerId]);
    if (!updated.rows[0]) throw reject("OWNER_CHANGED");
    await rescueTestHook?.("after_owner_update");
    const eventType = executionMode === "automatic" ? "automatic_rescue_executed" : "assisted_rescue_executed";
    const businessDate = executionMode === "automatic"
      ? (await client.query(`SELECT to_char(NOW() AT TIME ZONE 'Asia/Tbilisi','YYYY-MM-DD') business_date`)).rows[0].business_date
      : null;
    const canaryPeriod = executionMode === "automatic" ? String((await client.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`)).rows[0]?.value?.auto_rescue_rule_version || "phase_e2_v1") : null;
    const artifactMetadata = { decisionId: command.decisionId, transactionId: txid, executionMode, ...(executionMode === "automatic" ? { canary: true, canaryPeriod, businessDate } : {}) };
    const event = await client.query(`INSERT INTO kay_events(lead_id,user_id,employee_id,event_type,event_source,metadata,kay_generated) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id`,
      [command.leadId, actorId, targetId, eventType, executionMode === "automatic" ? "kay" : "admin", JSON.stringify(artifactMetadata), executionMode === "automatic"]);
    await rescueTestHook?.("after_audit_event");
    const execution = await client.query(`INSERT INTO kay_rescue_executions(lead_id,decision_id,from_user_id,to_user_id,approved_by,outcome,transaction_id,metadata) VALUES($1,$2,$3,$4,$5,'SUCCESS',$6,$7::jsonb) RETURNING id`,
      [command.leadId, command.decisionId, lead.assigned_to, targetId, actorId, txid, JSON.stringify({ override: isOverride, overrideReason: command.overrideReason || null, overrideNote: command.overrideNote || null, eventId: event.rows[0].id, executionMode, automaticQueueId: automaticQueue?.id ?? null, ...(executionMode === "automatic" ? { canary: true, canaryPeriod, businessDate } : {}) })]);
    await client.query(`INSERT INTO lead_assignment_history(lead_id,from_user_id,to_user_id,reason,automatic,kay_decision_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [command.leadId, lead.assigned_to, targetId, executionMode === "automatic" ? "kay_rescue_automatic" : "kay_rescue", executionMode === "automatic", command.decisionId, JSON.stringify({ mode: executionMode, rescueReason: executionMode === "automatic" ? "kay_rescue_automatic" : "kay_rescue_assisted", adminId: actorId, decisionId: command.decisionId, automaticQueueId: automaticQueue?.id ?? null, statusWindow: payload.status_entered_at, thresholdMinutes: threshold, transactionId: txid, ...(executionMode === "automatic" ? { canary: true, canaryPeriod, businessDate } : {}) })]);
    if (executionMode === "automatic") {
      const currentRules: any = (await client.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`)).rows[0]?.value || {};
      const frozenRules = { ...currentRules, auto_rescue_kill_switch: true };
      await client.query(`UPDATE kay_settings SET value=jsonb_set(value,'{auto_rescue_kill_switch}','true'::jsonb),updated_at=NOW() WHERE key='rescue_rules'`);
      await client.query(`INSERT INTO kay_events(event_type,event_source,metadata,previous_value,new_value,kay_generated)
        VALUES('kay_rule_changed','kay',$1::jsonb,$2::jsonb,$3::jsonb,true)`,
        [JSON.stringify({ setting:"rescue_rules", change:"canary-frozen", canaryPeriod, businessDate, executionId: execution.rows[0].id, actorAdminId:null }),
         JSON.stringify(currentRules), JSON.stringify(frozenRules)]);
      if (e24State) {
        await client.query(`UPDATE phase_e24_first_canary_state SET successful_executions=1,status='FROZEN_SUCCESS',
          execution_id=$2,frozen_at=NOW() WHERE id=$1 AND status='ACTIVE' AND successful_executions=0`,
          [e24State.id, execution.rows[0].id]);
      }
    }
    await client.query(`UPDATE kay_missions SET status='STALE',updated_at=NOW(),result_details=COALESCE(result_details,'{}'::jsonb)||'{"stale_reason":"LEAD_REASSIGNED"}'::jsonb WHERE lead_id=$1 AND employee_id=$2 AND status=ANY($3)`, [command.leadId, lead.assigned_to, activeMission]);
    await client.query(`UPDATE kay_commitments SET status='STALE',stale_at=NOW(),updated_at=NOW(),details=details||'{"stale_reason":"LEAD_REASSIGNED"}'::jsonb WHERE lead_id=$1 AND employee_id=$2 AND status=ANY($3)`, [command.leadId, lead.assigned_to, openCommitment]);
    const promises = await client.query(`SELECT id,employee_id FROM kay_promises WHERE lead_id=$1 AND status=ANY($2) FOR UPDATE`, [command.leadId, openPromise]);
    for (const promise of promises.rows) await client.query(`INSERT INTO kay_promise_handoffs(promise_id,lead_id,original_owner_id,current_responsible_id,execution_id,transfer_reason) VALUES($1,$2,$3,$4,$5,'LEAD_REASSIGNED')`, [promise.id, command.leadId, promise.employee_id, targetId, execution.rows[0].id]);
    const mission = await client.query(`INSERT INTO kay_missions(lead_id,employee_id,mission_type,priority,priority_score,reason_code,reason_details,objective,suggested_action,source_decision_id,idempotency_key) VALUES($1,$2,'RESCUE_ELIGIBLE','HIGH',50,'RESCUE_LEAD_ASSIGNED',$3::jsonb,'You have received a Rescue Lead.','Review the existing CRM lead and decide the next contact action.',$4,$5) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
      [command.leadId, targetId, JSON.stringify({ previousStatus: lead.status, previousContactStage: lead.wa_stage, openPromiseCount: promises.rows.length }), command.decisionId, `assisted-rescue:${execution.rows[0].id}:mission`]);
    const safeName = String(lead.first_name || lead.full_name || `Lead #${lead.id}`).slice(0,80);
    await client.query(`INSERT INTO kay_internal_briefings(employee_id,lead_id,mission_id,trigger_type,severity,text,idempotency_key) VALUES($1,$2,$3,'RESCUE_LEAD_ASSIGNED','HIGH',$4,$5),($6,$2,NULL,'RESCUE_LEAD_MOVED','NORMAL',$7,$8) ON CONFLICT(idempotency_key) DO NOTHING`,
      [targetId, command.leadId, mission.rows[0]?.id ?? null, `You have received ${safeName} as a Rescue Lead. Please review the Lead and decide the next contact action.`, `assisted-rescue:${execution.rows[0].id}:new-brief`, lead.assigned_to, `${safeName} has moved to Rescue handling so the team can continue trying to reach the customer.`, `assisted-rescue:${execution.rows[0].id}:old-brief`]);
    await client.query(`INSERT INTO user_notifications(user_id,type,title,message,data,idempotency_key) VALUES
      ($1,'kay_rescue','Kay Rescue Lead Assigned',$2,$3::jsonb,$4),
      ($5,'kay_rescue','Kay Rescue Update',$6,$7::jsonb,$8)
      ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [targetId, `You have received ${safeName} as a Rescue Lead.`, JSON.stringify({ leadId: command.leadId, executionId: execution.rows[0].id, priority:"HIGH" }), `kay-rescue:${execution.rows[0].id}:target`,
       lead.assigned_to, `${safeName} moved to Rescue handling so the team can continue trying to reach the customer.`, JSON.stringify({ leadId: command.leadId, executionId: execution.rows[0].id, priority:"NORMAL" }), `kay-rescue:${execution.rows[0].id}:source`]);
    await client.query("COMMIT"); return { executionId: Number(execution.rows[0].id), leadId: command.leadId, fromUserId: lead.assigned_to, toUserId: targetId, undoUntil: new Date(now.getTime() + Number(payload.settings_snapshot?.assisted_rescue_undo_minutes ?? 15) * 60000).toISOString() };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    const code = (error as Reject).code || "EXECUTION_FAILED";
    try { await auditRejected(command, actorId ?? 0, code); } catch (auditError) {
      throw Object.assign(new Error(`Rescue rejected but required audit could not be recorded: ${auditError instanceof Error ? auditError.message : "unknown error"}`), { status: 500, code: "AUDIT_FAILED" });
    }
    throw error;
  } finally { client.release(); }
}

/** Explicit administrator wrapper; schedulers never call this wrapper. */
export async function executeAssistedRescue(command: RescueCommand, adminId: number) {
  return executeRescueTransaction(command, adminId, "assisted");
}

/** E.2 worker wrapper. Automatic gates are revalidated by the common core. */
export async function executeAutomaticRescue(command: AutomaticRescueCommand) {
  return executeRescueTransaction(command, null, "automatic");
}

/** Permanently freezes an E.2.4 canary which cannot safely execute. */
export async function freezeE24NoExecution(reason: string, candidateLeadId?: number, immediate = false) {
  await denyKayWrite("settings.update", undefined, "kay_phase", "E.2.4");
  assertKayProductionEntry();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('kay:e24-control'))`);
    const state: any = (await client.query(`SELECT * FROM phase_e24_first_canary_state WHERE id=1 FOR UPDATE`)).rows[0];
    if (!state || state.status !== "ACTIVE" || (candidateLeadId != null && Number(state.candidate_lead_id) !== Number(candidateLeadId))) {
      await client.query("COMMIT"); return false;
    }
    const guardedLeadId = candidateLeadId ?? Number(state.candidate_lead_id);
    const q: any = (await client.query(`SELECT id FROM kay_auto_rescue_queue
      WHERE lead_id=$1 AND status IN ('PENDING','WARNING','READY','CLAIMED')
      ORDER BY id DESC LIMIT 1 FOR UPDATE`, [guardedLeadId])).rows[0];
    // An actionable queue item is not evidence of "no safe execution", even
    // when its warning boundary passes during this scheduler cycle.
    if (q && !immediate) { await client.query("COMMIT"); return false; }
    await client.query(`UPDATE phase_e24_first_canary_state SET status='FROZEN_NO_EXECUTION',freeze_reason=$1,frozen_at=NOW() WHERE id=1`, [reason]);
    const oldRules: any = (await client.query(`SELECT value FROM kay_settings WHERE key='rescue_rules' FOR UPDATE`)).rows[0]?.value || {};
    const next = { ...oldRules, auto_rescue_kill_switch: true };
    await client.query(`UPDATE kay_settings SET value=jsonb_set(value,'{auto_rescue_kill_switch}','true'::jsonb),updated_at=NOW() WHERE key='rescue_rules'`);
    await client.query(`INSERT INTO kay_events(event_type,event_source,metadata,previous_value,new_value,kay_generated)
      VALUES('kay_rule_changed','kay',$1::jsonb,$2::jsonb,$3::jsonb,true)`,
      [JSON.stringify({phase:"E.2.4",change:"canary-frozen-no-execution",reason,candidateLeadId:guardedLeadId}),JSON.stringify(oldRules),JSON.stringify(next)]);
    await client.query("COMMIT"); return true;
  } catch (e) { await client.query("ROLLBACK").catch(()=>{}); throw e; } finally { client.release(); }
}

/** Explicit reversal command; it is deliberately not callable by any scheduler. */
export async function undoAssistedRescue(executionId: number, adminId: number, reason: string) {
  await denyKayWrite("rescue.execute", adminId, "rescue_execution", executionId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const admin = await client.query(`SELECT is_admin FROM users WHERE id=$1 FOR UPDATE`, [adminId]);
    if (admin.rows[0]?.is_admin !== true) throw reject("NOT_ADMIN");
    const execution: any = (await client.query(`SELECT x.*,l.status,l.assigned_to,p.id protection_id FROM kay_rescue_executions x JOIN crm_leads l ON l.id=x.lead_id LEFT JOIN kay_lead_protection p ON p.lead_id=l.id AND p.removed_at IS NULL WHERE x.id=$1 FOR UPDATE OF x,l`, [executionId])).rows[0];
    if (!execution || execution.outcome !== "SUCCESS" || execution.undone_at) throw reject("MANUAL_REVIEW_REQUIRED");
    const settings: any = (await client.query(`SELECT value FROM kay_settings WHERE key='rescue_rules' FOR UPDATE`)).rows[0]?.value || {};
    const undoMinutes = Number(settings.assisted_rescue_undo_minutes ?? 15);
    const conflictingWork = (await client.query(`SELECT EXISTS(SELECT 1 FROM kay_commitments WHERE lead_id=$1 AND employee_id=$2 AND created_at>$3)
      OR EXISTS(SELECT 1 FROM kay_promises WHERE lead_id=$1 AND employee_id=$2 AND created_at>$3)
      OR EXISTS(SELECT 1 FROM kay_missions WHERE lead_id=$1 AND employee_id=$2 AND reason_code='RESCUE_LEAD_ASSIGNED' AND (status NOT IN ('NEW','STALE') OR accepted_at IS NOT NULL OR started_at IS NOT NULL OR completed_at IS NOT NULL))
      OR EXISTS(SELECT 1 FROM kay_events WHERE lead_id=$1 AND created_at>$3 AND event_type NOT IN ('assisted_rescue_executed','automatic_rescue_executed','mission_created','mission_notification_created')) conflict`, [execution.lead_id, execution.to_user_id, execution.created_at])).rows[0]?.conflict;
    const unsafe = execution.assigned_to !== execution.to_user_id || execution.protection_id || getKayStatusIntelligence(execution.status).classification === "CLOSING" ||
      Date.now() > new Date(execution.created_at).getTime() + undoMinutes * 60000 ||
      conflictingWork ||
      (await client.query(`SELECT 1 FROM lead_assignment_history WHERE lead_id=$1 AND assigned_at>$2 AND reason NOT IN ('kay_rescue','kay_rescue_automatic') LIMIT 1`, [execution.lead_id, execution.created_at])).rows[0];
    if (unsafe) throw reject("MANUAL_REVIEW_REQUIRED");
    const updated = await client.query(`UPDATE crm_leads SET assigned_to=$1,updated_at=NOW() WHERE id=$2 AND assigned_to=$3 RETURNING id`, [execution.from_user_id, execution.lead_id, execution.to_user_id]);
    if (!updated.rows[0]) throw reject("MANUAL_REVIEW_REQUIRED");
    const txid = (await client.query("SELECT txid_current()::text id")).rows[0].id;
    await client.query(`INSERT INTO lead_assignment_history(lead_id,from_user_id,to_user_id,reason,automatic,kay_decision_id,metadata) VALUES($1,$2,$3,'kay_rescue_undo',false,$4,$5::jsonb)`, [execution.lead_id, execution.to_user_id, execution.from_user_id, execution.decision_id, JSON.stringify({ mode:"assisted", adminId, executionId, reason, transactionId:txid })]);
    await client.query(`UPDATE kay_rescue_executions SET outcome='UNDONE',undone_at=NOW(),metadata=metadata||$2::jsonb WHERE id=$1`, [executionId, JSON.stringify({ undoAdminId:adminId, undoReason:reason, undoTransactionId:txid })]);
    await client.query(`UPDATE kay_missions SET status='STALE',updated_at=NOW(),result_details=COALESCE(result_details,'{}'::jsonb)||'{"stale_reason":"RESCUE_UNDONE"}'::jsonb WHERE lead_id=$1 AND employee_id=$2 AND reason_code='RESCUE_LEAD_ASSIGNED' AND status=ANY($3)`, [execution.lead_id, execution.to_user_id, activeMission]);
    await client.query(`INSERT INTO kay_events(lead_id,user_id,employee_id,event_type,event_source,metadata,kay_generated) VALUES($1,$2,$3,$4,'admin',$5::jsonb,false)`, [execution.lead_id, adminId, execution.from_user_id, execution.metadata?.executionMode === "automatic" ? "automatic_rescue_undone" : "assisted_rescue_undone", JSON.stringify({ executionId, reason, transactionId:txid })]);
    await client.query("COMMIT"); return { executionId, leadId:execution.lead_id, restoredOwnerId:execution.from_user_id, outcome:"UNDONE" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function getAssistedRescuePreview(leadId: number, decisionId: number) {
  const result = await pool.query(`SELECT l.id,l.status,l.assigned_to,l.wa_stage,h.entered_at,d.payload,u.username owner_name,r.username recommended_name,
    p.id IS NOT NULL protected,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'dueDate',t.due_date,'dueTime',t.due_time)) FROM crm_tasks t WHERE t.lead_id=l.id AND t.completed_at IS NULL),'[]'::jsonb) blockers,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'type',m.mission_type,'status',m.status,'priority',m.priority) ORDER BY m.created_at DESC) FROM (SELECT * FROM kay_missions WHERE lead_id=l.id ORDER BY created_at DESC LIMIT 1) m),'[]'::jsonb) last_mission,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'action',c.action,'status',c.status,'dueAt',c.due_at)) FROM kay_commitments c WHERE c.lead_id=l.id AND c.status=ANY(ARRAY['PENDING','ACCEPTED','EXTENDED','OVERDUE','ACTIVE'])),'[]'::jsonb) commitments,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'type',x.importance,'description',x.promise_text,'status',x.status,'dueAt',x.due_at)) FROM kay_promises x WHERE x.lead_id=l.id AND x.status=ANY(ARRAY['PENDING','DUE_SOON','OVERDUE','OPEN'])),'[]'::jsonb) promises,
    COALESCE(a.value->>'availability','AVAILABLE') target_availability,r.is_active target_active,r.role target_role
    FROM crm_leads l JOIN kay_decisions d ON d.id=$2 AND d.lead_id=l.id LEFT JOIN kay_lead_status_history h ON h.lead_id=l.id AND h.status=l.status
    LEFT JOIN kay_lead_protection p ON p.lead_id=l.id AND p.removed_at IS NULL LEFT JOIN users u ON u.id=l.assigned_to
    LEFT JOIN users r ON r.id=(d.payload->>'recommended_employee_id')::int LEFT JOIN kay_settings a ON a.key='phase_c_availability:'||(d.payload->>'recommended_employee_id')
    WHERE l.id=$1 ORDER BY h.entered_at DESC LIMIT 1`, [leadId, decisionId]);
  const row: any = result.rows[0]; if (!row) return null;
  const thresholdMinutes = Number(row.payload?.threshold_minutes ?? 0);
  const elapsedMinutes = row.entered_at ? Math.max(0, Math.floor((Date.now() - new Date(row.entered_at).getTime()) / 60000)) : 0;
  return { lead: { id:row.id,status:row.status,ownerId:row.assigned_to,ownerName:row.owner_name,contactStage:row.wa_stage },
    decision: { id:decisionId, state:row.payload?.state, statusWindow:row.entered_at, thresholdMinutes, elapsedMinutes, why:row.payload?.employee_selection_explanation, fingerprint:row.payload?.evaluation_fingerprint },
    protection: { protected:row.protected }, blockers:row.blockers, lastMission:row.last_mission?.[0] ?? null,
    commitments:row.commitments, promises:row.promises, target: { id:row.payload?.recommended_employee_id, name:row.recommended_name, role:row.target_role, active:row.target_active === true, availability:row.target_availability, eligible: row.target_role === "sub_agent" && row.target_active === true && row.target_availability === "AVAILABLE" && row.payload?.recommended_employee_id !== row.assigned_to } };
}

export async function listPromiseHandoffs(employeeId: number, admin: boolean) {
  return (await pool.query(`SELECT h.*,p.promise_text,p.due_at,p.importance FROM kay_promise_handoffs h LEFT JOIN kay_promises p ON p.id=h.promise_id WHERE $2 OR (h.current_responsible_id=$1 AND EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=h.lead_id AND l.assigned_to=$1)) ORDER BY h.transferred_at DESC`, [employeeId, admin])).rows;
}
export async function acceptPromiseHandoff(id: number, employeeId: number, admin: boolean) {
  await denyKayWrite("workflow.transition", employeeId, "promise_handoff", id);
  const result = await pool.query(`UPDATE kay_promise_handoffs h SET accepted_at=COALESCE(accepted_at,NOW()) WHERE h.id=$1 AND ($3 OR (h.current_responsible_id=$2 AND EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=h.lead_id AND l.assigned_to=$2))) RETURNING *`, [id, employeeId, admin]);
  if (!result.rows[0]) throw Object.assign(new Error("Promise handoff not found."), { status: 404 }); return result.rows[0];
}