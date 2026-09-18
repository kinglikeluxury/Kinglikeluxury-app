import { pool } from "./db";
import { createHash } from "crypto";
import { denyKayWrite } from "./kayActionGateway";
import { evaluateRescueWindow, recommendRescueEmployee } from "./kayAutoRescuePlanner";
import { getKayScopeConfiguration, kayScopeSql } from "./kayLeadScopeService";
import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";
import { assertSafeKayMutationTestDatabase } from "./kayTestDatabaseSafety";

export const LEGACY_STATUSES = ["no_answer_1", "no_answer_2"] as const;
export const LEGACY_BASELINE_WARNING =
  "Actual historical status-entry time is unknown. Eligibility is based only on continuous observation since the recorded baseline timestamp.";
export type E22TestScope = { marker: string };
type E22Queryable = { query: (sql: string, values?: any[]) => Promise<any> };
function requireTestScope(scope?: E22TestScope) {
  if (!scope) return;
  const e22 = scope.marker.startsWith("KAY_E22:") && process.env.KAY_E22_POSTGRES_TESTS === "true";
  const e23 = scope.marker.startsWith("KAY_E23:") && process.env.KAY_E23_POSTGRES_TESTS === "true";
  if (!e22 && !e23) throw new Error("Kay legacy diagnostic test scope is disabled");
  assertSafeKayMutationTestDatabase(e22 ? "kayPhaseE22.integration" : "kayPhaseE23.integration");
}

export async function repairLegacyBaselineContinuityDuplicates(): Promise<never> {
  await denyKayWrite("crm.write", undefined, "legacy_baseline", "repair");
  throw new Error("Unreachable: Kay CRM mutation gateway did not deny repair.");
}

async function readKayStatusWindow(executor: E22Queryable, leadId: number, status?: string) {
  const row = (await executor.query(`SELECT l.status,
    (SELECT max(assigned_at) FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ah.to_user_id=l.assigned_to) latest_owner_assigned_at,
    (SELECT CASE WHEN h.status=l.status THEN jsonb_build_object('enteredAt',h.entered_at,'source','STATUS_TRANSITION','trusted',true,'warning',null) END
       FROM kay_lead_status_history h WHERE h.lead_id=l.id
       ORDER BY h.entered_at DESC,h.id DESC LIMIT 1) history,
    (SELECT jsonb_build_object('enteredAt',b.observation_started_at,'source','LEGACY_BASELINE','trusted',false,'warning',$2::text)
       FROM kay_legacy_rescue_baselines b
       WHERE b.lead_id=l.id AND b.observed_status=l.status AND b.state='ACTIVE'
         AND NOT EXISTS (SELECT 1 FROM kay_lead_status_history h2
           WHERE h2.lead_id=b.lead_id AND (h2.entered_at>b.observation_started_at
             OR (h2.entered_at=b.observation_started_at AND h2.status<>b.observed_status)))
       ORDER BY b.observation_started_at DESC,b.id DESC LIMIT 1) baseline
    FROM crm_leads l WHERE l.id=$1`, [leadId, LEGACY_BASELINE_WARNING])).rows[0];
  if (!row || (status && row.status !== status)) return null;
  if (row.latest_owner_assigned_at && row.history?.enteredAt && new Date(row.history.enteredAt) < new Date(row.latest_owner_assigned_at)) return null;
  if (row.latest_owner_assigned_at && row.baseline?.enteredAt && new Date(row.baseline.enteredAt) < new Date(row.latest_owner_assigned_at)) return null;
  return row.history || row.baseline || null;
}

export async function resolveKayStatusWindow(leadId: number, status?: string) {
  return withKayReadonlyAnalysis(client => readKayStatusWindow(client, leadId, status));
}

async function readLegacyBaselineReadiness(scope: E22TestScope | undefined, client: E22Queryable) {
  requireTestScope(scope);
  const scopeConfiguration = await getKayScopeConfiguration(client);
  if (scopeConfiguration.status !== "OK") throw new Error(`KAY_SCOPE_${scopeConfiguration.status}`);
  const leadScope = kayScopeSql("l", "owner", "$4");
  const asOf = new Date((await client.query("SELECT clock_timestamp() as now")).rows[0].now);
  const [ruleResult, rows] = await Promise.all([
    client.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`),
    client.query(`SELECT b.*,l.status current_status,
      EXISTS(SELECT 1 FROM kay_lead_status_history h WHERE h.lead_id=b.lead_id AND h.entered_at>b.observation_started_at) changed,
      EXISTS(SELECT 1 FROM crm_tasks t WHERE t.lead_id=b.lead_id AND t.completed_at IS NULL) blocker,
      EXISTS(SELECT 1 FROM kay_lead_protection p WHERE p.lead_id=b.lead_id AND p.removed_at IS NULL) protected
      ,EXISTS(SELECT 1 FROM kay_promises p WHERE p.lead_id=b.lead_id AND p.owner_review_required_at IS NOT NULL AND p.status=ANY(ARRAY['PENDING','DUE_SOON','OVERDUE','OPEN'])) promise_review
      ,(SELECT count(*)::int FROM lead_assignment_history a WHERE a.lead_id=b.lead_id AND a.reason=ANY(ARRAY['kay_rescue','kay_rescue_assisted','kay_rescue_automatic']) AND (a.automatic=true OR a.metadata->>'mode'=ANY(ARRAY['assisted','automatic']))) attempts
      ,l.assigned_to,owner.role owner_role,owner.is_active owner_active
      FROM kay_legacy_rescue_baselines b LEFT JOIN crm_leads l ON l.id=b.lead_id
       LEFT JOIN users owner ON owner.id=l.assigned_to
      WHERE b.observed_status=ANY($1::text[]) AND ($2::text IS NULL OR l.notes=$2)
         AND ($3::boolean IS TRUE OR ${leadScope.outcomeCase}='IN_KAY_SCOPE')
      ORDER BY b.id`, [LEGACY_STATUSES, scope?.marker || null, Boolean(scope?.marker.startsWith("KAY_E22:")), scopeConfiguration.config.cutoffAt]),
  ]);
  const rules: any = ruleResult.rows[0]?.value || {};
  const out: any = Object.fromEntries(LEGACY_STATUSES.map(status => [status, { active: 0, lackingTrusted: 0, trustedCurrentWindows: 0, underThreshold: 0, reachedThreshold: 0, dueWithin6: 0, dueWithin12: 0, dueWithin24: 0, statusChanged: 0, blocked: 0, wouldRescue: 0, invalidated: 0, noEligible: 0, managerReview: 0 }]));
  for (const r of rows.rows as any[]) {
    const item = out[r.observed_status]; if (!item) continue;
    const threshold = Number((r.observed_status === "no_answer_1" ? rules.no_answer_1_threshold_hours : rules.no_answer_2_threshold_hours) || 24) * 3600000;
    if (r.state !== "ACTIVE" || r.current_status !== r.observed_status || r.changed) { item.statusChanged++; if (r.state === "INVALIDATED") item.invalidated++; continue; }
    item.active++;
    const age = asOf.getTime() - new Date(r.observation_started_at).getTime();
    if (age < threshold) { item.underThreshold++; for (const h of [6, 12, 24]) if (threshold - age <= h * 3600000) item[`dueWithin${h}`]++; }
    else {
      item.reachedThreshold++;
      const decision = evaluateRescueWindow({status:r.observed_status,statusEnteredAt:new Date(r.observation_started_at),now:asOf,thresholdHours:threshold/3600000,blockers:[...(r.blocker?["ACTIVE_TASK" as const]:[]),...(r.protected?["PROTECTED_LEAD" as const]:[])],rescueAttempts:Number(r.attempts),maxAttempts:Number(rules.max_human_rescue_attempts || 2)});
      if (!decision.eligible) { item.blocked++; continue; }
      if (!r.assigned_to || r.owner_role !== "sub_agent" || r.owner_active !== true || r.promise_review) { item.managerReview++; item.blocked++; continue; }
      const candidates = await client.query(`SELECT u.id,u.username name,
        count(DISTINCT l.id) FILTER(WHERE l.status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified'))::int active_lead_count,
        count(DISTINCT t.id) FILTER(WHERE t.completed_at IS NULL AND t.due_date~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND t.due_date::date<$2::date)::int overdue_task_count,
        EXISTS(SELECT 1 FROM lead_assignment_history h WHERE h.lead_id=$1 AND h.from_user_id=u.id AND h.assigned_at>$2::timestamp-interval '30 days') recent_previous_owner,
        EXISTS(SELECT 1 FROM lead_assignment_history h WHERE h.lead_id=$1 AND h.from_user_id=u.id AND h.to_user_id=$3 AND h.assigned_at>$2::timestamp-interval '30 days') ping_pong
        FROM users u LEFT JOIN crm_leads l ON l.assigned_to=u.id LEFT JOIN crm_tasks t ON t.lead_id=l.id
        LEFT JOIN kay_settings av ON av.key='phase_c_availability:'||u.id::text
        WHERE u.role='sub_agent' AND u.is_active=true AND u.id<>$3
          AND COALESCE(av.value->>'availability','AVAILABLE')='AVAILABLE'
          AND ($4::text IS NULL OR u.username LIKE $4||':%')
        GROUP BY u.id,u.username`, [r.lead_id, asOf, r.assigned_to, scope?.marker || null]);
      const pick = recommendRescueEmployee(candidates.rows.map((x:any)=>({id:Number(x.id),name:x.name,activeLeadCount:Number(x.active_lead_count),overdueTaskCount:Number(x.overdue_task_count),recentPreviousOwner:x.recent_previous_owner,pingPongPrevented:x.ping_pong})), Number(r.assigned_to));
      if (!pick.candidate) { item.noEligible++; item.blocked++; } else item.wouldRescue++;
    }
  }
  for (const status of LEGACY_STATUSES) {
    const trusted = await client.query(`SELECT count(*)::int n FROM kay_lead_status_history h JOIN crm_leads l ON l.id=h.lead_id AND l.status=h.status JOIN users owner ON owner.id=l.assigned_to
      WHERE h.status=$1 AND ($3::boolean IS TRUE OR ${leadScope.outcomeCase}='IN_KAY_SCOPE') AND ($2::text IS NULL OR l.notes=$2)
        AND h.id=(SELECT h2.id FROM kay_lead_status_history h2 WHERE h2.lead_id=h.lead_id ORDER BY h2.entered_at DESC,h2.id DESC LIMIT 1)`,
      [status, scope?.marker || null, Boolean(scope?.marker?.startsWith("KAY_E22:")), scopeConfiguration.config.cutoffAt]);
    out[status].trustedCurrentWindows = Number(trusted.rows[0].n);
     const lacking = await client.query(`SELECT count(*)::int n FROM crm_leads l JOIN users owner ON owner.id=l.assigned_to WHERE l.status=$1 AND ${leadScope.outcomeCase}='IN_KAY_SCOPE' AND NOT EXISTS
      (SELECT 1 FROM kay_lead_status_history h WHERE h.lead_id=l.id AND h.status=l.status AND h.id=(SELECT h2.id FROM kay_lead_status_history h2 WHERE h2.lead_id=l.id ORDER BY h2.entered_at DESC,h2.id DESC LIMIT 1))
       AND ($2::text IS NULL OR l.notes=$2)
       AND ($3::boolean IS TRUE OR ${leadScope.outcomeCase}='IN_KAY_SCOPE')`,
      [status, scope?.marker || null, Boolean(scope?.marker?.startsWith("KAY_E22:")), scopeConfiguration.config.cutoffAt]);
    out[status].lackingTrusted = Number(lacking.rows[0].n);
  }
   return { asOf: asOf.toISOString(), statuses: out };
}

export async function getLegacyBaselineReadiness(scope?: E22TestScope) {
  return withKayReadonlyAnalysis(client => readLegacyBaselineReadiness(scope, client));
}

async function readLegacyOwnerDiagnostics(scope: E22TestScope | undefined, executor: E22Queryable) {
  requireTestScope(scope);
  const owners = await executor.query(`SELECT COALESCE(u.username,'UNASSIGNED') account,u.role,u.is_active,u.is_admin,
    count(l.id) FILTER (WHERE l.status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified'))::int active_leads,
    count(l.id) FILTER (WHERE l.status='no_answer_1')::int no_answer_1,
    count(l.id) FILTER (WHERE l.status='no_answer_2')::int no_answer_2
    FROM crm_leads l LEFT JOIN users u ON u.id=l.assigned_to
    WHERE ($1::text IS NULL OR l.notes=$1)
    GROUP BY u.id,u.username,u.role,u.is_active,u.is_admin ORDER BY active_leads DESC`, [scope?.marker || null]);
  const mixes = await executor.query(`SELECT COALESCE(u.username,'UNASSIGNED') account,l.status,count(*)::int count
    FROM crm_leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE ($1::text IS NULL OR l.notes=$1) GROUP BY 1,2 ORDER BY 1,2`, [scope?.marker || null]);
  return owners.rows.map((r: any) => {
    const classification = r.account === "UNASSIGNED" ? "INTAKE_OWNER" : (r.account === "kinglike_admin" || r.is_admin === true) ? "ADMIN_OWNER_EXCLUDED" : !r.is_active ? "INACTIVE_OWNER" : r.role === "sub_agent" ? "SALES_OWNER" : "INVALID_OWNER";
    const evidence = r.account === "kinglike_admin" ? [
      `Database account: role=${r.role}, is_admin=${r.is_admin === true}, is_active=${r.is_active === true}`,
      `Current assigned active=${r.active_leads}, no_answer_1=${r.no_answer_1}, no_answer_2=${r.no_answer_2}`,
      "server/routes.ts admin-alias import resolver prefers kinglike_admin",
      "server/routes.ts maps info/admin/kinglike_admin import aliases to the admin destination",
    ] : [`Database role=${r.role || "none"}, active=${r.is_active === true}`];
    return { ...r, classification, evidence, conclusion: classification === "ADMIN_OWNER_EXCLUDED" ? "ADMIN_OWNER_EXCLUDED_FROM_KAY_SALES_AUTOMATION." : null, reason: classification === "ADMIN_OWNER_EXCLUDED" ? "EXCLUDED_OWNER: Kay does not manage this portfolio." : evidence[0] };
  }).map((r: any) => ({ ...r, statusMix: mixes.rows.filter((m: any) => m.account === r.account) }));
}

export async function getLegacyOwnerDiagnostics(scope?: E22TestScope) {
  return withKayReadonlyAnalysis(client => readLegacyOwnerDiagnostics(scope, client));
}

export async function getLegacyLeadAgeBuckets(scope?: E22TestScope) {
  requireTestScope(scope);
  return withKayReadonlyAnalysis(async client => {
    const r = await client.query(`SELECT CASE WHEN NOW()-created_at<interval '7 days' THEN '0-7'
      WHEN NOW()-created_at<interval '30 days' THEN '8-30' WHEN NOW()-created_at<interval '90 days' THEN '31-90'
      WHEN NOW()-created_at<interval '180 days' THEN '91-180' ELSE '180+' END bucket,count(*)::int count
      FROM crm_leads WHERE status=ANY($1::text[]) AND ($2::text IS NULL OR notes=$2) GROUP BY bucket`, [LEGACY_STATUSES, scope?.marker || null]);
    return Object.fromEntries(["0-7","8-30","31-90","91-180","180+"].map(k => [k, Number(r.rows.find((x: any) => x.bucket === k)?.count || 0)]));
  });
}

async function readLegacyCapacitySensitivity(scope: E22TestScope | undefined, executor: E22Queryable) {
  requireTestScope(scope);
  const config = await getKayScopeConfiguration(executor);
  if (config.status !== "OK") throw new Error(`KAY_SCOPE_${config.status}`);
  const capacityScope = kayScopeSql("l", "u", "$2");
  return (await executor.query(`SELECT u.username employee,
     count(l.id) FILTER(WHERE l.status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified'))::int all_nonterminal,
     count(l.id) FILTER(WHERE l.status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified') AND ${capacityScope.outcomeCase}='IN_KAY_SCOPE')::int kay_scope_nonterminal,
    count(l.id) FILTER(WHERE l.status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified') AND l.updated_at>=NOW()-interval '30 days')::int touched30,
    count(l.id) FILTER(WHERE l.status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified') AND l.updated_at>=NOW()-interval '60 days')::int touched60,
    count(l.id) FILTER(WHERE l.status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified') AND l.updated_at>=NOW()-interval '90 days')::int touched90
    FROM users u LEFT JOIN crm_leads l ON l.assigned_to=u.id AND ($1::text IS NULL OR l.notes=$1) WHERE u.role='sub_agent'
    AND ($1::text IS NULL OR u.username LIKE $1||':%')
     GROUP BY u.id,u.username ORDER BY u.username`, [scope?.marker || null, config.config.cutoffAt])).rows;
}

export async function getLegacyCapacitySensitivity(scope?: E22TestScope) {
  return withKayReadonlyAnalysis(client => readLegacyCapacitySensitivity(scope, client));
}

export async function previewLegacyBaselineInitialization(limit = 500, scope?: E22TestScope) {
  requireTestScope(scope);
  return withKayReadonlyAnalysis(async client => {
    const r = await client.query(`SELECT l.id,l.status,
      (SELECT h.status=l.status FROM kay_lead_status_history h WHERE h.lead_id=l.id ORDER BY h.entered_at DESC,h.id DESC LIMIT 1) trusted,
      EXISTS(SELECT 1 FROM kay_legacy_rescue_baselines b WHERE b.lead_id=l.id AND b.observed_status=l.status AND b.state='ACTIVE') existing
      FROM crm_leads l WHERE l.status=ANY($1::text[]) AND ($3::text IS NULL OR l.notes=$3) ORDER BY l.id LIMIT $2`, [LEGACY_STATUSES, Math.min(1000, Math.max(1, limit)), scope?.marker || null]);
    const candidates = r.rows.map((x: any) => ({ id: Number(x.id), status: String(x.status), trusted: x.trusted === true, existing: x.existing === true }));
    const fingerprint = createHash("sha256").update(JSON.stringify(candidates)).digest("hex");
    return { inspected: r.rows.length, eligible: candidates.filter(x => !x.trusted && !x.existing).length, fingerprint, limit, candidates,
      counts: { inspected: r.rows.length, created: 0, skippedTrusted: r.rows.filter((x: any) => x.trusted).length, skippedChanged: 0, skippedInvalid: 0, skippedExisting: r.rows.filter((x: any) => x.existing).length } };
  });
}

export async function initializeLegacyBaselines(adminId: number, token: string, limit = 500, expectedFingerprint?: string, snapshot?: Array<{id:number;status:string;trusted:boolean;existing:boolean}>, scope?: E22TestScope, options?: { failAuditInsertForTest?: boolean; expiresAt?: number; nowForTest?: number; afterAdminLockForTest?: (info:{backendPid:number;token:string}) => void | Promise<void>; beforeLeadLocksForTest?: (info:{backendPid:number;token:string}) => void | Promise<void> }) {
  requireTestScope(scope);
  if (scope?.marker.startsWith("KAY_E22:") && process.env.KAY_E22_POSTGRES_TESTS === "true") {
    assertSafeKayMutationTestDatabase("initializeLegacyBaselines");
  } else {
    await denyKayWrite("crm.write", adminId, "legacy_baseline", "E.2.2");
  }
  if (options?.failAuditInsertForTest && process.env.KAY_E22_POSTGRES_TESTS !== "true") throw new Error("E.2.2 test hook is disabled");
  if (options?.expiresAt !== undefined && (process.env.KAY_E22_POSTGRES_TESTS !== "true" || options.expiresAt < (options.nowForTest ?? Date.now()))) throw Object.assign(new Error("Preview confirmation expired."), { status: 409 });
  if (!token || token.length < 20) throw Object.assign(new Error("A valid confirmation token is required."), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const admin = await client.query(`SELECT 1 FROM users WHERE id=$1 AND is_admin=true AND is_active=true FOR UPDATE`, [adminId]);
    if (!admin.rows[0]) throw Object.assign(new Error("Kay Admin required."), { status: 403 });
    if (options?.afterAdminLockForTest || options?.beforeLeadLocksForTest) {
      if (process.env.KAY_E22_POSTGRES_TESTS !== "true") throw new Error("E.2.2 test hook is disabled");
      const backendPid = Number((await client.query(`SELECT pg_backend_pid() pid`)).rows[0].pid);
      await options.afterAdminLockForTest?.({backendPid,token});
      await options.beforeLeadLocksForTest?.({backendPid,token});
    }
    const original = (snapshot || []).slice(0, Math.min(1000, Math.max(1, limit)));
    if (!original.length || (expectedFingerprint && expectedFingerprint !== createHash("sha256").update(JSON.stringify(original)).digest("hex"))) {
      throw Object.assign(new Error("Invalid preview snapshot."), { status: 409 });
    }
    const leads = await client.query(`SELECT id,status FROM crm_leads WHERE id=ANY($1::int[]) AND ($2::text IS NULL OR notes=$2) ORDER BY id FOR UPDATE`, [original.map(x => x.id), scope?.marker || null]);
    const live = new Map(leads.rows.map((x: any) => [Number(x.id), x]));
    const counts = { inspected: original.length, created: 0, skippedTrusted: 0, skippedChanged: 0, skippedInvalid: 0, skippedExisting: 0 };
    for (const prior of original) {
      const lead: any = live.get(prior.id);
      if (!lead || lead.status !== prior.status || !LEGACY_STATUSES.includes(lead.status)) { counts.skippedChanged++; continue; }
      const trusted = await client.query(`SELECT 1 FROM kay_lead_status_history h WHERE h.lead_id=$1
        AND h.status=$2 AND h.id=(SELECT h2.id FROM kay_lead_status_history h2 WHERE h2.lead_id=$1 ORDER BY h2.entered_at DESC,h2.id DESC LIMIT 1)`, [lead.id, lead.status]);
      if (trusted.rows[0]) { counts.skippedTrusted++; continue; }
      if (!LEGACY_STATUSES.includes(lead.status)) { counts.skippedInvalid++; continue; }
      const existing = await client.query(`SELECT 1 FROM kay_legacy_rescue_baselines WHERE lead_id=$1 AND observed_status=$2 AND state='ACTIVE' LIMIT 1`, [lead.id, lead.status]);
      if (existing.rows[0]) { counts.skippedExisting++; continue; }
      const inserted = await client.query(`INSERT INTO kay_legacy_rescue_baselines
        (lead_id,observed_status,source,trusted_entry_time,state,continuity_event_key)
        VALUES($1,$2,'LEGACY_BASELINE',false,'ACTIVE',$3)
        ON CONFLICT DO NOTHING RETURNING id`, [lead.id, lead.status, `legacy:${lead.id}:${lead.status}`]);
      if (inserted.rows[0]) counts.created++; else counts.skippedExisting++;
    }
    if (options?.failAuditInsertForTest) throw new Error("SYNTHETIC_AUDIT_INSERT_FAILURE");
    await client.query(`INSERT INTO kay_legacy_baseline_init_runs(admin_id,confirmation_token,inspected,created,skipped_trusted,skipped_changed,skipped_invalid,skipped_existing)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [adminId, token, counts.inspected, counts.created, counts.skippedTrusted, counts.skippedChanged, counts.skippedInvalid, counts.skippedExisting]);
    await client.query("COMMIT");
    return counts;
  } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
}

// Explicit names used by the Admin control surface and integration harnesses.
export const initializeLegacyRescueBaselines = initializeLegacyBaselines;
export const previewLegacyRescueBaselines = previewLegacyBaselineInitialization;