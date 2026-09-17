import { createHash } from "node:crypto";
import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";
import { getKayScopeConfiguration, kayScopeSql } from "./kayLeadScopeReadService";

export const LEGACY_STATUSES = ["no_answer_1", "no_answer_2"] as const;
export const LEGACY_BASELINE_WARNING = "Actual historical status-entry time is unknown. Eligibility is based only on continuous observation since the recorded baseline timestamp.";
export type E22TestScope = { marker: string };
type Queryable = { query: (sql: string, values?: any[]) => Promise<any> };

export async function resolveKayStatusWindow(leadId: number, status?: string) {
  return withKayReadonlyAnalysis(async c => {
    const row = (await c.query(`SELECT l.status,
      (SELECT CASE WHEN h.status=l.status THEN jsonb_build_object('enteredAt',h.entered_at,'source','STATUS_TRANSITION','trusted',true,'warning',null) END
       FROM kay_lead_status_history h WHERE h.lead_id=l.id ORDER BY h.entered_at DESC,h.id DESC LIMIT 1) history,
      (SELECT jsonb_build_object('enteredAt',b.observation_started_at,'source','LEGACY_BASELINE','trusted',false,'warning',$2::text)
       FROM kay_legacy_rescue_baselines b WHERE b.lead_id=l.id AND b.observed_status=l.status AND b.state='ACTIVE'
       ORDER BY b.observation_started_at DESC,b.id DESC LIMIT 1) baseline
      FROM crm_leads l WHERE l.id=$1`, [leadId, LEGACY_BASELINE_WARNING])).rows[0];
    if (!row || (status && row.status !== status)) return null;
    return row.history || row.baseline || null;
  });
}

export async function getLegacyBaselineReadiness(_scope?: E22TestScope) {
  return withKayReadonlyAnalysis(async c => {
    const config = await getKayScopeConfiguration(c);
    if (config.status !== "OK") throw new Error(`KAY_SCOPE_${config.status}`);
    const rows = await c.query(`SELECT observed_status,state,count(*)::int count
      FROM kay_legacy_rescue_baselines GROUP BY observed_status,state ORDER BY observed_status,state`);
    const statuses: any = Object.fromEntries(LEGACY_STATUSES.map(s => [s, { active: 0, invalidated: 0, reachedThreshold: 0, underThreshold: 0, blocked: 0, wouldRescue: 0, lackingTrusted: 0, trustedCurrentWindows: 0, dueWithin6: 0, dueWithin12: 0, dueWithin24: 0, statusChanged: 0, noEligible: 0, managerReview: 0 }]));
    for (const row of rows.rows) if (statuses[row.observed_status]) statuses[row.observed_status][row.state === "ACTIVE" ? "active" : "invalidated"] += Number(row.count);
    return { asOf: new Date().toISOString(), statuses };
  });
}

export async function getLegacyOwnerDiagnostics(_scope?: E22TestScope) {
  return withKayReadonlyAnalysis(async c => (await c.query(`SELECT COALESCE(u.username,'UNASSIGNED') account,u.role,u.is_active,u.is_admin,
    count(l.id)::int active_leads,count(l.id) FILTER(WHERE l.status='no_answer_1')::int no_answer_1,count(l.id) FILTER(WHERE l.status='no_answer_2')::int no_answer_2
    FROM crm_leads l LEFT JOIN users u ON u.id=l.assigned_to GROUP BY u.id,u.username,u.role,u.is_active,u.is_admin ORDER BY active_leads DESC`)).rows);
}

export async function getLegacyLeadAgeBuckets(_scope?: E22TestScope) {
  return withKayReadonlyAnalysis(async c => {
    const r = await c.query(`SELECT CASE WHEN NOW()-created_at<interval '7 days' THEN '0-7' WHEN NOW()-created_at<interval '30 days' THEN '8-30' WHEN NOW()-created_at<interval '90 days' THEN '31-90' WHEN NOW()-created_at<interval '180 days' THEN '91-180' ELSE '180+' END bucket,count(*)::int count FROM crm_leads WHERE status=ANY($1::text[]) GROUP BY bucket`, [LEGACY_STATUSES]);
    return Object.fromEntries(["0-7","8-30","31-90","91-180","180+"].map(k => [k, Number(r.rows.find((x: any) => x.bucket === k)?.count || 0)]));
  });
}

export async function getLegacyCapacitySensitivity(_scope?: E22TestScope) {
  return withKayReadonlyAnalysis(async c => (await c.query(`SELECT u.username employee,count(l.id)::int all_nonterminal,
    count(l.id) FILTER(WHERE l.updated_at>=NOW()-interval '30 days')::int touched30,
    count(l.id) FILTER(WHERE l.updated_at>=NOW()-interval '60 days')::int touched60,
    count(l.id) FILTER(WHERE l.updated_at>=NOW()-interval '90 days')::int touched90
    FROM users u LEFT JOIN crm_leads l ON l.assigned_to=u.id WHERE u.role='sub_agent' GROUP BY u.id,u.username ORDER BY u.username`)).rows);
}

export async function previewLegacyBaselineInitialization(limit = 500, _scope?: E22TestScope) {
  return withKayReadonlyAnalysis(async c => {
    const r = await c.query(`SELECT l.id,l.status,
      EXISTS(SELECT 1 FROM kay_lead_status_history h WHERE h.lead_id=l.id AND h.status=l.status) trusted,
      EXISTS(SELECT 1 FROM kay_legacy_rescue_baselines b WHERE b.lead_id=l.id AND b.observed_status=l.status AND b.state='ACTIVE') existing
      FROM crm_leads l WHERE l.status=ANY($1::text[]) ORDER BY l.id LIMIT $2`, [LEGACY_STATUSES, Math.min(1000, Math.max(1, limit))]);
    const candidates = r.rows.map((x: any) => ({ id: Number(x.id), status: String(x.status), trusted: x.trusted === true, existing: x.existing === true }));
    return { inspected: candidates.length, eligible: candidates.filter(x => !x.trusted && !x.existing).length, fingerprint: createHash("sha256").update(JSON.stringify(candidates)).digest("hex"), limit, candidates, counts: { inspected: candidates.length, created: 0, skippedTrusted: candidates.filter(x => x.trusted).length, skippedChanged: 0, skippedInvalid: 0, skippedExisting: candidates.filter(x => x.existing).length } };
  });
}