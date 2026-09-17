import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";
import { getKayScopeConfiguration, getKayScopeForLead } from "./kayLeadScopeReadService";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export async function getAutoRescueReadiness(limit = 500) {
  return withKayReadonlyAnalysis(async analysis => {
    const settingsRow = await analysis.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`);
    const settings: any = settingsRow.rows[0]?.value || {};
    const scopeConfig = await getKayScopeConfiguration(analysis as any);
    if (scopeConfig.status !== "OK") return { checked: 0, wouldExecute: 0, wouldBlock: 0, managerReview: 0, noEligibleEmployee: 0, protected: 0, dailyLimitImpact: 0, blockedReason: scopeConfig.status };
    const rows = await analysis.query(`SELECT l.id,l.status,l.assigned_to,h.entered_at,p.id protection_id,
      EXISTS(SELECT 1 FROM crm_tasks t WHERE t.lead_id=l.id AND t.completed_at IS NULL) blocker
      FROM crm_leads l LEFT JOIN LATERAL (SELECT entered_at FROM kay_lead_status_history WHERE lead_id=l.id AND status=l.status ORDER BY entered_at DESC LIMIT 1) h ON true
      LEFT JOIN kay_lead_protection p ON p.lead_id=l.id AND p.removed_at IS NULL
      WHERE l.status IN ('no_answer_1','no_answer_2') ORDER BY l.id LIMIT $1`, [clamp(limit, 1, 1000)]);
    const result = { checked: rows.rows.length, wouldExecute: 0, wouldBlock: 0, managerReview: 0, noEligibleEmployee: 0, protected: 0, dailyLimitImpact: 0 };
    for (const lead of rows.rows as any[]) {
      const scope = await getKayScopeForLead(Number(lead.id));
      if (scope.outcome !== "IN_KAY_SCOPE") continue;
      const threshold = Number(lead.status === "no_answer_2" ? settings.no_answer_2_threshold_hours : settings.no_answer_1_threshold_hours) * 3600000;
      if (!lead.entered_at || Date.now() - new Date(lead.entered_at).getTime() < threshold) continue;
      if (lead.protection_id || lead.blocker) { if (lead.protection_id) result.protected++; result.wouldBlock++; continue; }
      const eligible = await analysis.query(`SELECT id FROM users WHERE role='sub_agent' AND is_active=true AND id<>$1
        AND COALESCE((SELECT value->>'availability' FROM kay_settings WHERE key='phase_c_availability:'||users.id::text),'AVAILABLE')='AVAILABLE' LIMIT 1`, [lead.assigned_to]);
      if (!eligible.rows[0]) { result.managerReview++; result.noEligibleEmployee++; } else result.wouldExecute++;
    }
    return result;
  });
}

export async function getAutoRescueHealth() {
  return withKayReadonlyAnalysis(async analysis => {
    const [rules, mode, health, counts, today] = await Promise.all([
      analysis.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`),
      analysis.query(`SELECT value FROM kay_settings WHERE key='mode'`),
      analysis.query(`SELECT value FROM kay_settings WHERE key='phase_e2_auto_rescue_health'`),
      analysis.query(`SELECT status,count(*)::int count FROM kay_auto_rescue_queue GROUP BY status`),
      analysis.query(`SELECT count(*)::int count FROM lead_assignment_history WHERE reason='kay_rescue_automatic' AND ((assigned_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE 'Asia/Tbilisi')::date=(NOW() AT TIME ZONE 'Asia/Tbilisi')::date`),
    ]);
    const settings: any = rules.rows[0]?.value || {}, state: any = health.rows[0]?.value || {};
    const by = Object.fromEntries(counts.rows.map((r: any) => [r.status, r.count]));
    return { enabled: false, mode: mode.rows[0]?.value?.mode || "shadow", killSwitch: settings.auto_rescue_kill_switch === true,
      canaryEnabled: settings.auto_rescue_canary_enabled === true, canaryEmployees: (settings.auto_rescue_canary_employee_ids || []).length,
      pendingWarnings: by.WARNING || 0, ready: by.READY || 0, blocked: by.BLOCKED || 0, rejected: by.REJECTED || 0,
      executedToday: Number(today.rows[0]?.count || 0), canaryLimit: Number(settings.auto_rescue_canary_daily_limit ?? 1),
      canaryCount: 0, canaryFrozen: settings.auto_rescue_kill_switch === true, lastSuccessfulCycle: state.last_successful_cycle || null,
      lastAutomaticRescue: state.last_automatic_rescue || null, errors: Number(state.errors || 0),
      consecutiveFailures: Number(state.consecutive_failures || 0), circuit: state.halted === true ? "HALTED" : "OK", leaseState: state.lease_state || "unknown" };
  });
}