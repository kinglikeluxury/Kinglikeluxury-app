import { pool } from "./db";
import { rescueSettingsSchema, defaultRescueSettings } from "./kayService";
import { getKayScopeForLead } from "./kayLeadScopeService";
import { resolveKayStatusWindow } from "./kayLegacyBaselineService";
import { getE23CapacitySnapshot, selectE23Target } from "./kayPhaseE23Service";

type Check = { ok: boolean; reason?: string };
const PERIOD = "phase_e24_first_fadi_canary";

async function inspect(executor: any = pool) {
  const fadi = await executor.query(`SELECT id,username,role,is_active,is_admin FROM users WHERE lower(username)=lower($1)`, ["Fadi al-Mofti"]);
  const rulesRow = await executor.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`);
  const modeRow = await executor.query(`SELECT value FROM kay_settings WHERE key='mode'`);
  const healthRow = await executor.query(`SELECT value FROM kay_settings WHERE key='phase_e2_auto_rescue_health'`);
  const rawRules = rulesRow.rows[0]?.value || {};
  const rules: any = { ...defaultRescueSettings, ...rawRules };
  const checks: Record<string, Check> = {};
  checks.uniqueFadi = { ok: fadi.rows.length === 1, reason: fadi.rows.length === 1 ? undefined : "FADI_NOT_UNIQUE" };
  checks.fadiActive = { ok: !!fadi.rows[0] && fadi.rows[0].is_active === true && fadi.rows[0].role === "sub_agent" && fadi.rows[0].is_admin !== true, reason: "FADI_NOT_ACTIVE_SALES_USER" };
  checks.mode = { ok: modeRow.rows[0]?.value?.mode === "shadow", reason: "MODE_NOT_SHADOW" };
  checks.settings = { ok: rules.auto_rescue_daily_limit === 5 && rules.auto_rescue_per_employee_daily_limit === 3, reason: "SETTINGS_NOT_5_3" };
  checks.disarmed = { ok: rules.auto_rescue_kill_switch === true && rules.auto_rescue_no_answer_1_enabled === false && rules.auto_rescue_no_answer_2_enabled === false &&
    rules.auto_rescue_canary_enabled === true && Array.isArray(rules.auto_rescue_canary_employee_ids) && rules.auto_rescue_canary_employee_ids.length === 0 &&
    rules.auto_rescue_canary_daily_limit === 1, reason: "NOT_FULLY_DISARMED" };
  checks.scheduler = { ok: process.env.ENABLE_BACKGROUND_SCHEDULERS === "true", reason: "SCHEDULER_DISABLED" };
  const heartbeat = healthRow.rows[0]?.value?.last_safe_disabled_cycle;
  checks.health = { ok: !!healthRow.rows[0] && healthRow.rows[0]?.value?.halted !== true && Number(healthRow.rows[0]?.value?.consecutive_failures || 0) === 0 &&
    !!heartbeat && Date.now() - new Date(heartbeat).getTime() <= 10 * 60_000, reason: "HEALTH_CIRCUIT_NOT_READY" };
  checks.intervals = { ok: Number(rules.rescue_warning_minutes) === 30 && Number(rules.rescue_grace_minutes) === 30 && Number(rules.rescue_grace_max_count) === 1, reason: "INTERVAL_SETTINGS_NOT_30_30_1" };
  try { await executor.query("SELECT 1"); checks.database = { ok: true }; } catch { checks.database = { ok: false, reason: "DATABASE_UNHEALTHY" }; }
  const prior = await executor.query(`SELECT 1 FROM kay_rescue_executions WHERE outcome='SUCCESS' AND metadata->>'canaryPeriod'=$1 LIMIT 1`, [PERIOD]);
  checks.noPriorSuccess = { ok: prior.rows.length === 0, reason: "CANARY_PERIOD_ALREADY_USED" };
  const candidates: any[] = [];
  if (fadi.rows.length === 1 && checks.fadiActive.ok) {
    const raw = await executor.query(`SELECT l.id,l.status,l.assigned_to,h.entered_at,
      (SELECT count(*)::int FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ah.reason IN ('kay_rescue','kay_rescue_assisted','kay_rescue_automatic') AND (ah.automatic=true OR ah.metadata->>'mode' IN ('assisted','automatic'))) attempts,
      EXISTS(SELECT 1 FROM kay_lead_protection p WHERE p.lead_id=l.id AND p.removed_at IS NULL) protected,
      EXISTS(SELECT 1 FROM crm_tasks t WHERE t.lead_id=l.id AND t.completed_at IS NULL) task_blocker,
      EXISTS(SELECT 1 FROM kay_promises p WHERE p.lead_id=l.id AND p.owner_review_required_at IS NOT NULL AND p.status=ANY($2)) promise_blocker
      FROM crm_leads l LEFT JOIN LATERAL (SELECT entered_at FROM kay_lead_status_history WHERE lead_id=l.id AND status=l.status ORDER BY entered_at DESC LIMIT 1) h ON true
      WHERE l.assigned_to=$1 AND l.status IN ('no_answer_1','no_answer_2')`, [fadi.rows[0].id, ["PENDING","DUE_SOON","OVERDUE","OPEN"]]);
    for (const row of raw.rows) {
      const scope = await getKayScopeForLead(executor, Number(row.id));
      const window = await resolveKayStatusWindow(executor, Number(row.id), row.status);
      const threshold = Number(row.status === "no_answer_1" ? rules.no_answer_1_threshold_hours : rules.no_answer_2_threshold_hours) * 60;
      const elapsed = row.entered_at ? Math.max(0, Math.floor((Date.now() - new Date(row.entered_at).getTime()) / 60000)) : 0;
      const blockers = [scope.outcome !== "IN_KAY_SCOPE" ? `SCOPE_${scope.outcome}` : null, window?.source !== "STATUS_TRANSITION" ? "UNTRUSTED_STATUS_WINDOW" : null,
        row.protected ? "PROTECTED" : null, row.task_blocker ? "ACTIVE_TASK" : null, row.promise_blocker ? "PROMISE_MANAGER_REVIEW_REQUIRED" : null,
        Number(row.attempts) >= Number(rules.max_human_rescue_attempts) ? "LIMIT_REACHED" : null].filter(Boolean);
      candidates.push({ id: Number(row.id), status: row.status, statusWindow: row.entered_at, timingSource: window?.source || null, elapsedMinutes: elapsed,
        thresholdMinutes: threshold, attempts: Number(row.attempts), blockers, eligible: blockers.length === 0 && elapsed >= threshold });
    }
  }
  checks.candidates = { ok: candidates.filter(c => c.eligible).length > 0, reason: "NO_TRUSTED_ELIGIBLE_CANDIDATE" };
  const eligible = candidates.filter(c => c.eligible);
  let target: any = null;
  if (eligible.length) {
    const owner = Number(fadi.rows[0].id);
    const [capacity, history] = await Promise.all([
      getE23CapacitySnapshot(executor),
      executor.query(`SELECT u.id,count(h.id) FILTER (WHERE h.reason='kay_rescue_automatic'
          AND ((h.assigned_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Tbilisi')::date=(NOW() AT TIME ZONE 'Asia/Tbilisi')::date)::int received_today,
        max(h.assigned_at) FILTER (WHERE h.reason='kay_rescue_automatic') last_rescue_at
        FROM users u LEFT JOIN lead_assignment_history h ON h.to_user_id=u.id GROUP BY u.id`),
    ]);
    const byId = new Map(history.rows.map((x: any) => [Number(x.id), x]));
    const candidates = [];
    for (const x of capacity as any[]) {
      const pingPong = (await executor.query(`SELECT 1 FROM lead_assignment_history WHERE lead_id=$1 AND from_user_id=$2 AND to_user_id=$3 AND assigned_at>NOW()-interval '30 days' LIMIT 1`, [eligible[0].id, x.id, owner])).rows[0];
      const h: any = byId.get(Number(x.id)) || {};
      candidates.push({ id:Number(x.id), username:x.username, active:x.is_active, isAdmin:x.is_admin, role:x.role, availability:x.availability,
        operationalLoad:Number(x.operationalLoad), receivedToday:Number(h.received_today || 0), lastRescueAt:h.last_rescue_at || null, doNotAssign:!!pingPong });
    }
    target = selectE23Target(candidates, owner, { dailyLimit:Number(rules.auto_rescue_per_employee_daily_limit), pingPong:false }) || null;
  }
  checks.target = { ok: !!target, reason: "NO_DETERMINISTIC_TARGET" };
  const ready = Object.values(checks).every(c => c.ok);
  return { ready, fadi: fadi.rows[0] || null, candidates, candidate: eligible[0] || null, target, checks, mode: modeRow.rows[0]?.value?.mode || "shadow", period: PERIOD };
}

export async function getE24FadiPrecheck() { return inspect(pool); }

export async function activateE24Fadi(adminId: number, confirmFirstRealCanary = false) {
  if (!confirmFirstRealCanary) throw Object.assign(new Error("Explicit first-real-canary confirmation is required"), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('kay:e24-control'))`);
    const admin = (await client.query(`SELECT is_admin FROM users WHERE id=$1 FOR UPDATE`, [adminId])).rows[0];
    if (admin?.is_admin !== true) throw Object.assign(new Error("Admin authorization required"), { status: 403 });
    await client.query(`CREATE TABLE IF NOT EXISTS phase_e24_first_canary_state (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id=1), period TEXT NOT NULL, status TEXT NOT NULL,
      source_employee_id INTEGER, candidate_lead_id INTEGER, admin_id INTEGER,
      successful_executions INTEGER NOT NULL DEFAULT 0, source_owner_epoch BIGINT, activated_at TIMESTAMPTZ,
      execution_id INTEGER, frozen_at TIMESTAMPTZ, freeze_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await client.query(`ALTER TABLE phase_e24_first_canary_state ADD COLUMN IF NOT EXISTS source_owner_epoch BIGINT`);
    const existing = (await client.query(`SELECT * FROM phase_e24_first_canary_state WHERE id=1 FOR UPDATE`)).rows[0];
    if (existing && (["ACTIVE","FROZEN_SUCCESS","SUCCESS","FROZEN_NO_EXECUTION"].includes(existing.status) || Number(existing.successful_executions) > 0)) {
      throw Object.assign(new Error("E.2.4 first canary lifetime has already been consumed or frozen"), { status: 409, code: "E24_LIFETIME_CLOSED" });
    }
    await client.query(`SELECT 1 FROM kay_settings WHERE key IN ('mode','rescue_rules') FOR UPDATE`);
    const pre = await inspect(client);
    if (!pre.ready) throw Object.assign(new Error("E.2.4 activation gate failed"), { status: 409, code: "E24_PRECHECK_FAILED", details: pre });
    const pinnedLead = (await client.query(`SELECT assigned_to,status,kay_owner_epoch FROM crm_leads WHERE id=$1 FOR UPDATE`,[pre.candidate.id])).rows[0];
    if (!pinnedLead || Number(pinnedLead.assigned_to) !== Number(pre.fadi.id) || pinnedLead.status !== pre.candidate.status) {
      throw Object.assign(new Error("E.2.4 candidate changed during activation"), { status:409, code:"E24_CANDIDATE_CHANGED" });
    }
    const oldRules = (await client.query(`SELECT value FROM kay_settings WHERE key='rescue_rules' FOR UPDATE`)).rows[0].value;
    const oldMode = (await client.query(`SELECT value FROM kay_settings WHERE key='mode' FOR UPDATE`)).rows[0].value;
    const next: any = { ...oldRules, auto_rescue_no_answer_1_enabled: pre.candidate.status === "no_answer_1", auto_rescue_no_answer_2_enabled: pre.candidate.status === "no_answer_2",
      auto_rescue_kill_switch: false, auto_rescue_canary_enabled: true, auto_rescue_canary_employee_ids: [Number(pre.fadi.id)],
      auto_rescue_canary_daily_limit: 1, auto_rescue_rule_version: PERIOD };
    const parsed = rescueSettingsSchema.safeParse(next);
    if (!parsed.success) throw Object.assign(new Error("Activation configuration failed schema validation"), { status: 409 });
    await client.query(`UPDATE kay_settings SET value=$1::jsonb,updated_by=$2,updated_at=NOW() WHERE key='rescue_rules'`, [JSON.stringify(parsed.data), adminId]);
    await client.query(`UPDATE kay_settings SET value='{"mode":"controlled_automation"}'::jsonb,updated_by=$1,updated_at=NOW() WHERE key='mode'`, [adminId]);
    await client.query(`INSERT INTO phase_e24_first_canary_state(id,period,status,source_employee_id,candidate_lead_id,admin_id,successful_executions,source_owner_epoch,activated_at)
      VALUES(1,$1,'ACTIVE',$2,$3,$4,0,$5,NOW())`, [PERIOD, Number(pre.fadi.id), Number(pre.candidate.id), adminId, Number(pinnedLead.kay_owner_epoch)]);
    await client.query(`INSERT INTO kay_events(event_type,event_source,metadata,previous_value,new_value,kay_generated)
      VALUES('kay_rule_changed','admin',$1::jsonb,$2::jsonb,$3::jsonb,false)`, [JSON.stringify({ phase:"E.2.4", action:"guarded_activation", actorAdminId:adminId, period:PERIOD, candidateId:pre.candidate.id }), JSON.stringify(oldRules), JSON.stringify(parsed.data)]);
    await client.query(`INSERT INTO kay_events(event_type,event_source,metadata,previous_value,new_value,kay_generated)
      VALUES('kay_rule_changed','admin',$1::jsonb,$2::jsonb,$3::jsonb,false)`, [JSON.stringify({ phase:"E.2.4", setting:"mode", actorAdminId:adminId }), JSON.stringify(oldMode), JSON.stringify({ mode:"controlled_automation" })]);
    await client.query(`INSERT INTO kay_events(event_type,event_source,metadata,new_value,kay_generated)
      VALUES('kay_rule_changed','admin',$1::jsonb,$2::jsonb,false)`,
      [JSON.stringify({phase:"E.2.4", setting:"phase_e24_first_canary_state", actorAdminId:adminId, period:PERIOD}), JSON.stringify({status:"ACTIVE",sourceEmployeeId:pre.fadi.id,candidateLeadId:pre.candidate.id})]);
    await client.query("COMMIT");
    return { activated:true, candidate:pre.candidate, target:pre.target, workerStarted:false };
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}