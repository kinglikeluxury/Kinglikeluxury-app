import { createHash } from "node:crypto";
import { pool } from "./db";
import { getLegacyBaselineReadiness, getLegacyOwnerDiagnostics, getLegacyCapacitySensitivity } from "./kayLegacyBaselineService";
import { evaluateRescueWindow } from "./kayAutoRescuePlanner";
import { defaultRescueSettings, resolveKayMode } from "./kayService";
import { classifyKayLead, getKayScopeConfiguration, kayScopeSql } from "./kayLeadScopeService";

export const E23_SOURCE_POLICIES = ["SALES_ONLY", "SALES_AND_ADMIN_INTAKE", "ALL_NON_SYSTEM"] as const;
export type E23SourcePolicy = typeof E23_SOURCE_POLICIES[number];
export type E23OwnerClassification = "SALES_OWNER" | "ADMIN_OWNER_EXCLUDED" | "ADMIN_OWNER" | "INTAKE_OWNER" | "SYSTEM_OWNER" | "INACTIVE_OWNER" | "UNKNOWN_OWNER";
export const E23_RECOMMENDED_FORMULA = "recommended_operational_load = nonterminal_0_30 + 0.5*nonterminal_31_60 + 0.25*nonterminal_61_90 + 2*overdue_tasks + active_kay_missions + active_commitments + open_promises";
export const E23_SAFETY_STATE = {
  mode: "SHADOW", autoNoAnswer1: "DISABLED", autoNoAnswer2: "DISABLED",
  killSwitch: "ON", canaryEmployeeCount: 0, autoReassignments: 0,
} as const;
export type E23TestScope = { marker: string };
function requireE23Scope(scope?: E23TestScope) {
  if (scope && (process.env.KAY_E23_POSTGRES_TESTS !== "true" || !scope.marker.startsWith("KAY_E23:"))) {
    throw new Error("E.2.3 test scope is disabled");
  }
}

/** Kay-only classification. It deliberately never updates users.role. */
export function classifyE23Owner(owner: { username?: string | null; role?: string | null; isActive?: boolean | null; isAdmin?: boolean | null } | null | undefined): E23OwnerClassification {
  if (!owner) return "UNKNOWN_OWNER";
  if (owner.isActive === false) return "INACTIVE_OWNER";
  const name = String(owner.username || "").toLowerCase();
  if (name === "kinglike_admin" || owner.isAdmin === true) return "ADMIN_OWNER_EXCLUDED";
  if (owner.role === "sub_agent") return "SALES_OWNER";
  if (name === "system" || name === "automation" || owner.role === "system") return "SYSTEM_OWNER";
  if (!name) return "INTAKE_OWNER";
  return "UNKNOWN_OWNER";
}

export function isE23TargetEligible(candidate: { id: number; username?: string; active?: boolean; isAdmin?: boolean; role?: string; availability?: string; doNotAssign?: boolean; currentOwnerId?: number | null; operationalLoad?: number; receivedToday?: number; lastRescueAt?: string | null; priorOwnerIds?: number[] }, sourceOwnerId: number | null, limits: { maxLoad?: number; dailyLimit?: number; globalRemaining?: number; priorOwnerIds?: number[]; pingPong?: boolean } = {}) {
  return candidate.active === true && candidate.role === "sub_agent" && candidate.id !== sourceOwnerId &&
    candidate.isAdmin !== true && candidate.username !== "kinglike_admin" &&
    candidate.availability !== "LEAVE" && candidate.availability !== "DO_NOT_ASSIGN" &&
    candidate.doNotAssign !== true && limits.pingPong !== true && !(candidate.priorOwnerIds || limits.priorOwnerIds || []).includes(sourceOwnerId || 0) &&
    (limits.maxLoad === undefined || (candidate.operationalLoad ?? 0) < limits.maxLoad) &&
    (limits.dailyLimit === undefined || (candidate.receivedToday ?? 0) < limits.dailyLimit);
}
/** Pure target picker used by simulations; production routing remains unchanged. */
export function selectE23Target<T extends Parameters<typeof isE23TargetEligible>[0]>(candidates: T[], sourceOwnerId: number | null, limits: Parameters<typeof isE23TargetEligible>[2] = {}) {
  return candidates.filter(c => isE23TargetEligible(c, sourceOwnerId, limits))
    .sort((a, b) => (a.operationalLoad ?? 0) - (b.operationalLoad ?? 0) ||
      (a.receivedToday ?? 0) - (b.receivedToday ?? 0) ||
      new Date(a.lastRescueAt || 0).getTime() - new Date(b.lastRescueAt || 0).getTime() || a.id - b.id)[0] || null;
}

export function routeE23TenLeads<T extends { id?: number; active?: boolean; role?: string; availability?: string; username?: string }>(targets: Array<T & { operationalLoad: number; receivedToday: number; lastRescueAt?: string | null }>, count = 10, sourceOwnerId: number | null = null, limits: { maxLoad?: number; dailyLimit?: number; globalLimit?: number; globalUsed?: number } = {}) {
  const working = targets.map(x => ({ ...x }));
  const assignments: T[] = [];
  for (let i = 0; i < count; i++) {
    if ((limits.globalUsed || 0) + i >= (limits.globalLimit ?? Number.POSITIVE_INFINITY)) break;
    const pick = selectE23Target(working as any, sourceOwnerId, { ...limits, priorOwnerIds: undefined }) as typeof working[number] | null;
    if (!pick) break;
    assignments.push(pick);
    pick.operationalLoad++;
    pick.receivedToday++;
  }
  return { assignments, counts: Object.fromEntries(working.map(x => { const id = x.id; return [String(id), assignments.filter(a => a.id === id).length]; })), writes: 0 };
}

export function simulateE23SourcePolicy(rows: Array<{ classification: E23OwnerClassification; thresholdQualified: boolean; account?: string }>, policy: E23SourcePolicy) {
  return rows.filter(r => r.thresholdQualified && (policy === "SALES_ONLY" ? r.classification === "SALES_OWNER" :
    policy === "SALES_AND_ADMIN_INTAKE" ? false :
    r.classification === "SALES_OWNER")).length;
}

export function e23Fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
type E23Executor = { query: (sql: string, values?: any[]) => Promise<any> };
async function e23SideEffectSnapshot(executor: E23Executor) {
  const tables = ["crm_leads", "lead_assignment_history", "crm_tasks", "kay_missions", "kay_commitments", "kay_promises", "user_notifications", "kay_auto_rescue_queue", "kay_rescue_executions", "kay_settings"];
  const out: Record<string, string> = {};
  for (const table of tables) {
    const exists = await executor.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [table]);
    if (!exists.rows[0]) continue;
    const key = table === "kay_settings" ? "key" : "id";
    const rows = await executor.query(`SELECT * FROM "${table}" ORDER BY "${key}"`);
    out[table] = e23Fingerprint(rows.rows);
  }
  return out;
}

async function employees(executor: E23Executor = pool, scope?: E23TestScope, cutoff?: Date) {
  if (!cutoff) throw new Error("KAY_SCOPE_CONFIGURATION_MISSING");
  const leadScope = kayScopeSql("l", "lu", "$2");
  const taskScope = kayScopeSql("l", "lu", "$2");
  const missionScope = kayScopeSql("ml", "mu", "$2");
  const commitmentScope = kayScopeSql("cl", "cu", "$2");
  const promiseScope = kayScopeSql("pl", "pu", "$2");
  const r = await executor.query(`WITH lead_stats AS (
      SELECT l.assigned_to user_id, count(*)::int total,
        count(*) FILTER (WHERE status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified'))::int nonterminal,
         count(*) FILTER (WHERE status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified') AND updated_at>=NOW()-interval '30 days'
           AND (${leadScope.authoritativeDate})
             >= $2::timestamptz)::int active_operational,
         count(*) FILTER (WHERE (${leadScope.authoritativeDate})
             >= $2::timestamptz)::int in_scope,
         count(*) FILTER (WHERE (${leadScope.authoritativeDate})
             < $2::timestamptz)::int out_scope,
         count(*) FILTER (WHERE (${leadScope.authoritativeDate}) IS NULL)::int uncertain,
        count(*) FILTER (WHERE status IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified'))::int terminal,
        count(*) FILTER (WHERE status='no_answer_1')::int no_answer_1,count(*) FILTER (WHERE status='no_answer_2')::int no_answer_2,
        count(*) FILTER (WHERE status='no_answer_4')::int no_answer_4,count(*) FILTER (WHERE status='follow_up')::int follow_up,
        count(*) FILTER (WHERE status='interested')::int interested,count(*) FILTER (WHERE status='hot_buyer')::int hot_buyer,
        count(*) FILTER (WHERE status IN ('deposited','reserved'))::int deposited_reserved,
        count(*) FILTER (WHERE updated_at>=NOW()-interval '7 days')::int updated_7,
        count(*) FILTER (WHERE updated_at>=NOW()-interval '30 days')::int updated_30,
        count(*) FILTER (WHERE updated_at>=NOW()-interval '60 days')::int updated_60,
        count(*) FILTER (WHERE updated_at>=NOW()-interval '90 days')::int updated_90,
        count(*) FILTER (WHERE updated_at<NOW()-interval '90 days')::int older_90,
         count(*) FILTER (WHERE status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified') AND updated_at>=NOW()-interval '30 days' AND (${leadScope.authoritativeDate}) >= $2::timestamptz)::int recent_0_30,
         count(*) FILTER (WHERE status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified') AND updated_at< NOW()-interval '30 days' AND updated_at>=NOW()-interval '60 days' AND (${leadScope.authoritativeDate}) >= $2::timestamptz)::int recent_31_60,
         count(*) FILTER (WHERE status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified') AND updated_at< NOW()-interval '60 days' AND updated_at>=NOW()-interval '90 days' AND (${leadScope.authoritativeDate}) >= $2::timestamptz)::int recent_61_90,
        count(*) FILTER (WHERE status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified') AND updated_at<NOW()-interval '90 days')::int nonterminal_older_90,
        coalesce(sum(CASE WHEN status IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified') THEN 0 WHEN updated_at>=NOW()-interval '30 days' THEN 1 WHEN updated_at>=NOW()-interval '60 days' THEN .5 WHEN updated_at>=NOW()-interval '90 days' THEN .25 ELSE 0 END),0)::numeric recency_weight
       FROM crm_leads l LEFT JOIN users lu ON lu.id=l.assigned_to WHERE ($1::text IS NULL OR l.notes=$1) GROUP BY l.assigned_to
    ), task_stats AS (
      SELECT l.assigned_to user_id,count(*) FILTER (WHERE t.completed_at IS NULL)::int open_tasks,
        count(*) FILTER (WHERE t.completed_at IS NULL AND t.due_date~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND t.due_date::date<CURRENT_DATE)::int overdue_tasks,
        count(*) FILTER (WHERE t.completed_at IS NULL AND t.title~*'follow[ _-]?up' AND t.due_date~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND t.due_date::date<=CURRENT_DATE)::int due_followups
        FROM crm_tasks t JOIN crm_leads l ON l.id=t.lead_id JOIN users lu ON lu.id=l.assigned_to WHERE ($1::text IS NULL OR l.notes=$1)
          AND ${taskScope.outcomeCase}='IN_KAY_SCOPE' GROUP BY l.assigned_to
     ), mission_stats AS (SELECT m.employee_id,count(*) FILTER (WHERE m.status IN ('NEW','ACCEPTED','IN_PROGRESS'))::int active_missions FROM kay_missions m JOIN crm_leads ml ON ml.id=m.lead_id JOIN users mu ON mu.id=ml.assigned_to WHERE ${missionScope.outcomeCase}='IN_KAY_SCOPE' GROUP BY m.employee_id),
     commitment_stats AS (SELECT c.employee_id,count(*) FILTER (WHERE c.status IN ('PENDING','ACCEPTED','EXTENDED','OVERDUE'))::int active_commitments FROM kay_commitments c JOIN crm_leads cl ON cl.id=c.lead_id JOIN users cu ON cu.id=cl.assigned_to WHERE ${commitmentScope.outcomeCase}='IN_KAY_SCOPE' GROUP BY c.employee_id),
     promise_stats AS (SELECT p.employee_id,count(*) FILTER (WHERE p.status IN ('PENDING','DUE_SOON','OVERDUE'))::int open_promises FROM kay_promises p JOIN crm_leads pl ON pl.id=p.lead_id JOIN users pu ON pu.id=pl.assigned_to WHERE ${promiseScope.outcomeCase}='IN_KAY_SCOPE' GROUP BY p.employee_id)
    SELECT u.id,u.username,u.role,u.is_active,u.is_admin,COALESCE(a.value->>'availability','AVAILABLE') availability,
      COALESCE(ls.total,0)::int total_assigned,COALESCE(ls.nonterminal,0)::int nonterminal,COALESCE(ls.active_operational,0)::int active_operational,COALESCE(ls.terminal,0)::int terminal,
       COALESCE(ls.no_answer_1,0)::int no_answer_1,COALESCE(ls.no_answer_2,0)::int no_answer_2,COALESCE(ls.no_answer_4,0)::int no_answer_4,COALESCE(ls.follow_up,0)::int follow_up,COALESCE(ls.interested,0)::int interested,COALESCE(ls.hot_buyer,0)::int hot_buyer,COALESCE(ls.deposited_reserved,0)::int deposited_reserved,COALESCE(ls.in_scope,0)::int in_scope,COALESCE(ls.out_scope,0)::int out_scope,COALESCE(ls.uncertain,0)::int uncertain,
      COALESCE(ls.updated_7,0)::int updated_7,COALESCE(ls.updated_30,0)::int updated_30,COALESCE(ls.updated_60,0)::int updated_60,COALESCE(ls.updated_90,0)::int updated_90,COALESCE(ls.older_90,0)::int older_90,COALESCE(ls.recent_0_30,0)::int recent_0_30,COALESCE(ls.recent_31_60,0)::int recent_31_60,COALESCE(ls.recent_61_90,0)::int recent_61_90,COALESCE(ls.nonterminal_older_90,0)::int nonterminal_older_90,COALESCE(ls.recency_weight,0)::numeric recency_weight,
      COALESCE(ts.open_tasks,0)::int open_tasks,COALESCE(ts.overdue_tasks,0)::int overdue_tasks,COALESCE(ts.due_followups,0)::int due_followups,COALESCE(ms.active_missions,0)::int active_missions,COALESCE(cs.active_commitments,0)::int active_commitments,COALESCE(ps.open_promises,0)::int open_promises
     FROM users u LEFT JOIN kay_settings a ON a.key='phase_c_availability:'||u.id::text LEFT JOIN lead_stats ls ON ls.user_id=u.id LEFT JOIN task_stats ts ON ts.user_id=u.id LEFT JOIN mission_stats ms ON ms.employee_id=u.id LEFT JOIN commitment_stats cs ON cs.employee_id=u.id LEFT JOIN promise_stats ps ON ps.employee_id=u.id
      WHERE u.role='sub_agent' AND u.is_active=true AND u.is_admin=false AND lower(u.username)<>'kinglike_admin' AND ($1::text IS NULL OR u.username LIKE $1||':%') ORDER BY u.id`, [scope?.marker || null, cutoff]);
   return r.rows.map((x: any) => ({ ...x, classification: classifyE23Owner({ username: x.username, role: x.role, isActive: x.is_active, isAdmin: x.is_admin }), operationalLoad: Number(x.recent_0_30) + .5 * Number(x.recent_31_60) + .25 * Number(x.recent_61_90) + 2 * Number(x.overdue_tasks) + Number(x.active_missions) + Number(x.active_commitments) + Number(x.open_promises), actionableWorkLoad: Number(x.in_scope) + 2 * Number(x.overdue_tasks) + Number(x.active_missions) + Number(x.active_commitments) + Number(x.open_promises) }));
}

/** Aggregate-only diagnostic. No INSERT/UPDATE/DELETE is present in this path. */
export async function getKayPhaseE23Diagnostics(scope?: E23TestScope) {
  requireE23Scope(scope);
  const client = await pool.connect();
  let snapshotBefore: Record<string, string> = {};
  let snapshotAfter: Record<string, string> = {};
  try {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  snapshotBefore = await e23SideEffectSnapshot(client);
  const scopeConfiguration = await getKayScopeConfiguration(client);
  if (scopeConfiguration.status !== "OK") throw new Error(`KAY_SCOPE_${scopeConfiguration.status}`);
   const [owners, readiness, capacity, staff, settingsRow, modeRow] = await Promise.all([
    getLegacyOwnerDiagnostics(scope, client), getLegacyBaselineReadiness(scope, client), getLegacyCapacitySensitivity(scope, client), employees(client, scope, scopeConfiguration.config.cutoffAt),
    client.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`),
    client.query(`SELECT value FROM kay_settings WHERE key='mode'`),
  ]);
  const rules: any = settingsRow.rows[0]?.value || {};
  const rescueSettings: any = { ...defaultRescueSettings, ...rules };
  const mode = resolveKayMode(modeRow.rows[0]?.value);
   const noAnswer = await client.query(`SELECT l.id,l.status,l.assigned_to,l.created_at,l.business_received_at,l.business_received_at_source,l.lead_source,COALESCE(u.username,'UNASSIGNED') account,u.role,u.is_active,u.is_admin,
    (SELECT max(assigned_at) FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ah.to_user_id=l.assigned_to) latest_owner_assigned_at,
    CASE WHEN h.status=l.status AND h.entered_at >= COALESCE((SELECT max(assigned_at) FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ah.to_user_id=l.assigned_to), '-infinity'::timestamp) THEN h.entered_at
      WHEN b.observation_started_at IS NOT NULL AND b.observation_started_at >= COALESCE((SELECT max(assigned_at) FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ah.to_user_id=l.assigned_to), '-infinity'::timestamp) THEN b.observation_started_at END entered_at,
    CASE WHEN h.status=l.status AND h.entered_at >= COALESCE((SELECT max(assigned_at) FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ah.to_user_id=l.assigned_to), '-infinity'::timestamp) THEN 'STATUS_TRANSITION'
      WHEN b.observation_started_at IS NOT NULL AND b.observation_started_at >= COALESCE((SELECT max(assigned_at) FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ah.to_user_id=l.assigned_to), '-infinity'::timestamp) THEN 'LEGACY_BASELINE' ELSE NULL END window_source,
    EXISTS(SELECT 1 FROM crm_tasks t WHERE t.lead_id=l.id AND t.completed_at IS NULL) active_task,
    EXISTS(SELECT 1 FROM kay_lead_protection p WHERE p.lead_id=l.id AND p.removed_at IS NULL) protected,
    EXISTS(SELECT 1 FROM kay_promises p WHERE p.lead_id=l.id AND p.owner_review_required_at IS NOT NULL AND p.status IN ('PENDING','DUE_SOON','OVERDUE')) promise_review,
    (SELECT count(*) FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ah.reason IN ('kay_rescue','kay_rescue_assisted','kay_rescue_automatic') AND (ah.automatic=true OR ah.metadata->>'mode' IN ('assisted','automatic'))) attempts
    FROM crm_leads l LEFT JOIN users u ON u.id=l.assigned_to
    LEFT JOIN LATERAL (SELECT entered_at,status FROM kay_lead_status_history sh WHERE sh.lead_id=l.id ORDER BY sh.entered_at DESC,sh.id DESC LIMIT 1) h ON true
    LEFT JOIN LATERAL (SELECT observation_started_at FROM kay_legacy_rescue_baselines lb WHERE lb.lead_id=l.id AND lb.observed_status=l.status AND lb.state='ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM kay_lead_status_history newer WHERE newer.lead_id=lb.lead_id AND (newer.entered_at>lb.observation_started_at OR (newer.entered_at=lb.observation_started_at AND newer.status<>lb.observed_status))) ORDER BY lb.id DESC LIMIT 1) b ON true
     WHERE l.status IN ('no_answer_1','no_answer_2') AND ($1::text IS NULL OR l.notes=$1) ORDER BY l.id`, [scope?.marker || null]);
   const monitoringSql = kayScopeSql("l", "u", "$1");
   const monitoringScope = await client.query(`SELECT
      count(*)::int AS all_crm,
       count(*) FILTER (WHERE ${monitoringSql.outcomeCase}='EXCLUDED_OWNER')::int AS excluded_admin,
       count(*) FILTER (WHERE ${monitoringSql.outcomeCase}='OUT_OF_SCOPE_LEGACY')::int AS out_legacy,
       count(*) FILTER (WHERE ${monitoringSql.outcomeCase}='LEGACY_DATE_UNCERTAIN')::int AS uncertain,
       count(*) FILTER (WHERE ${monitoringSql.outcomeCase}='IN_KAY_SCOPE')::int AS in_scope
       FROM crm_leads l LEFT JOIN users u ON u.id=l.assigned_to
       WHERE ($2::text IS NULL OR l.notes=$2)`, [scopeConfiguration.config.cutoffAt, scope?.marker || null]);
  const now = new Date((await client.query(`SELECT clock_timestamp() AS now`)).rows[0].now);
  const sourceRows = noAnswer.rows.map((x: any) => {
    const classification = classifyE23Owner({ username: x.account === "UNASSIGNED" ? null : x.account, role: x.role, isActive: x.is_active, isAdmin: x.is_admin });
     const scopeOutcome = classifyKayLead({ createdAt: x.created_at, businessReceivedAt: x.business_received_at, businessReceivedAtSource: x.business_received_at_source, leadSource: x.lead_source, owner: { username: x.account === "UNASSIGNED" ? null : x.account, role: x.role, isActive: x.is_active, isAdmin: x.is_admin } }, scopeConfiguration.config);
     if (classification === "ADMIN_OWNER_EXCLUDED") return { ...x, classification, scopeOutcome, excludedOwner: true, thresholdQualified: false, eligibleAfterBlockers: false, state: "EXCLUDED_OWNER", blockers: [], baselineSource: x.window_source, historicalWarning: null };
    const thresholdHours = Number(x.status === "no_answer_2" ? rules.no_answer_2_threshold_hours : rules.no_answer_1_threshold_hours) || 24;
    const decision = evaluateRescueWindow({ status: x.status, statusEnteredAt: x.entered_at ? new Date(x.entered_at) : null, now, thresholdHours, rescueAttempts: Number(x.attempts), maxAttempts: Number(rules.max_human_rescue_attempts || 2), blockers: [x.active_task ? "ACTIVE_TASK" : null, x.protected ? "PROTECTED_LEAD" : null].filter(Boolean) as any });
     return { ...x, classification, scopeOutcome, thresholdHours, thresholdQualified: decision.state === "ACTIVE" || decision.state === "BLOCKED", eligibleAfterBlockers: decision.eligible && !x.promise_review && scopeOutcome === "IN_KAY_SCOPE", state: x.promise_review && decision.state === "ACTIVE" ? "BLOCKED" : decision.state, blockers: [...decision.blockers, ...(x.promise_review ? ["PROMISE_MANAGER_REVIEW"] : [])], baselineSource: x.window_source, historicalWarning: x.window_source === "LEGACY_BASELINE" ? "Actual historical status-entry time is unknown; eligibility is based on continuous observation since baseline." : null };
  });
   const noAnswerScope = {
     managed: sourceRows.filter((r: any) => r.scopeOutcome === "IN_KAY_SCOPE" && r.classification === "SALES_OWNER").length,
     adminOrOwnerExcluded: sourceRows.filter((r: any) => r.scopeOutcome === "EXCLUDED_OWNER").length,
     outOfScopeOld: sourceRows.filter((r: any) => r.scopeOutcome === "OUT_OF_SCOPE_LEGACY").length,
     dateUncertain: sourceRows.filter((r: any) => r.scopeOutcome === "LEGACY_DATE_UNCERTAIN").length,
   };
  const excludedAdminLegacyLeads = sourceRows.filter((r: any) => r.excludedOwner).map((r: any) => ({ status: r.status, account: r.account, classification: "EXCLUDED_FROM_KAY_RESCUE", baselineSource: r.baselineSource }));
   const kayManagedSalesLeads = sourceRows.filter((r: any) => !r.excludedOwner && r.classification === "SALES_OWNER" && r.scopeOutcome === "IN_KAY_SCOPE");
  const aggregateRows = (rows: any[]) => Object.values(rows.reduce((acc: any, row: any) => {
    const key = `${row.account}|${row.classification}|${row.status}`;
    const item = acc[key] ||= { account: row.account, classification: row.classification, status: row.status, count: 0, baselineCount: 0, thresholdQualified: 0, blocked: 0, wouldRescue: 0 };
    item.count++;
    if (row.baselineSource === "LEGACY_BASELINE") item.baselineCount++;
    if (row.thresholdQualified) item.thresholdQualified++;
    if (row.state === "BLOCKED") item.blocked++;
    if (row.eligibleAfterBlockers) item.wouldRescue++;
    return acc;
  }, {}));
  const managedDistribution = aggregateRows(kayManagedSalesLeads);
  const policies = Object.fromEntries(E23_SOURCE_POLICIES.map(p => {
    const accepted = sourceRows.filter((r: any) => r.thresholdQualified && r.classification === "SALES_OWNER");
    const afterBlockers = accepted.filter((r: any) => r.eligibleAfterBlockers);
    return [p, { policyStatus: p === "SALES_ONLY" ? "APPROVED" : "REJECTED_BY_POLICY", thresholdQualified: accepted.length, blockers: accepted.length - afterBlockers.length, afterBlockers: afterBlockers.length, managerReview: accepted.length - afterBlockers.length, targetAvailableWouldRescue: afterBlockers.length, byClassification: Object.fromEntries(["SALES_OWNER","ADMIN_OWNER_EXCLUDED","ADMIN_OWNER","INTAKE_OWNER","SYSTEM_OWNER","INACTIVE_OWNER","UNKNOWN_OWNER"].map(c => [c, accepted.filter((r: any) => r.classification === c).length])), delta: accepted.length - afterBlockers.length }];
  }));
  const targetHistory = await client.query(`SELECT u.id,
    count(h.id) FILTER (WHERE h.reason='kay_rescue_automatic' AND h.assigned_at>=CURRENT_DATE)::int received_today,
    max(h.assigned_at) FILTER (WHERE h.reason='kay_rescue_automatic') last_rescue_at
    FROM users u LEFT JOIN lead_assignment_history h ON h.to_user_id=u.id GROUP BY u.id`);
  const historyByTarget = new Map(targetHistory.rows.map((x: any) => [Number(x.id), x]));
  const usedToday = Number((await client.query(`SELECT count(*)::int n FROM lead_assignment_history WHERE reason='kay_rescue_automatic' AND assigned_at>=CURRENT_DATE`)).rows[0]?.n || 0);
  const hypotheticalSources = staff.filter((x: any) => x.classification === "SALES_OWNER").map((x: any) => ({ id: Number(x.id), name: String(x.username) }));
  const routeTargets = staff.filter((x: any) => x.is_active && !x.is_admin && x.availability === "AVAILABLE").map((x: any) => {
    const history: any = historyByTarget.get(Number(x.id)) || {};
    return { id: Number(x.id), username: x.username, active: true, role: x.role, availability: x.availability, operationalLoad: x.operationalLoad, receivedToday: Number(history.received_today || 0), lastRescueAt: history.last_rescue_at || null };
  });
  const simulationTargets = routeTargets.map((x:any)=>({...x}));
  const routed: any = { assignments: [], counts: {}, writes: 0 };
  for (let index=0; index<10; index++) {
    const source = hypotheticalSources[index % Math.max(1,hypotheticalSources.length)] ?? null;
    const one = routeE23TenLeads(simulationTargets, 1, source?.id ?? null, { dailyLimit: Number(rules.auto_rescue_per_employee_daily_limit || 3), globalLimit: Number(rules.auto_rescue_daily_limit || 5), globalUsed: usedToday + routed.assignments.length });
    if (!one.assignments.length) break;
    const targetId = Number(one.assignments[0].id);
    routed.assignments.push(targetId); routed.counts[String(targetId)] = (routed.counts[String(targetId)] || 0) + 1;
    const target = simulationTargets.find((x:any)=>x.id===targetId); if (target) { target.receivedToday++; target.operationalLoad++; }
  }
  const simulatedMax = Math.max(0, ...Object.values(routed.counts).map(Number));
  const concentrationThreshold = 6;
  const concentrationRisk = simulatedMax >= concentrationThreshold;
  const pingPongGuardPassed = !isE23TargetEligible({ id: 1, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 0, receivedToday: 0, priorOwnerIds: [2] }, 2);
  for (const scenario of Object.values(policies) as any[]) {
    const hasTarget = routeTargets.length > 1;
    scenario.targetAvailableWouldRescue = hasTarget ? scenario.afterBlockers : 0;
    scenario.managerReview += hasTarget ? 0 : scenario.afterBlockers;
  }
  const sortedLoads = staff.map((x: any) => Number(x.operationalLoad)).sort((a: number, b: number) => a - b);
  const percentile = (p: number) => sortedLoads.length ? sortedLoads[Math.ceil(sortedLoads.length * p) - 1] : 0;
  const p75 = percentile(.75), p90 = percentile(.90);
  const proposedCeiling = Math.ceil(Math.max(p90, p75 + 2) / 5) * 5;
  const admin = owners.find((x: any) => x.account === "kinglike_admin");
  const adminWorkflow = await client.query(`SELECT l.lead_source,count(*)::int count,
    count(*) FILTER (WHERE EXISTS(SELECT 1 FROM lead_assignment_history h WHERE h.lead_id=l.id))::int with_assignment_history
    FROM crm_leads l JOIN users u ON u.id=l.assigned_to
    WHERE u.username='kinglike_admin' AND ($1::text IS NULL OR l.notes=$1)
    GROUP BY l.lead_source ORDER BY l.lead_source`, [scope?.marker || null]);
  const futurePolicyRows = sourceRows.filter((r: any) => r.eligibleAfterBlockers &&
    (r.classification === "SALES_OWNER" || (r.classification === "ADMIN_OWNER" && r.account === "kinglike_admin")) &&
    routeTargets.some((target: any) => target.id !== Number(r.assigned_to)));
  const queueReadiness = await client.query(`SELECT
    count(*) FILTER (WHERE q.status IN ('WARNING','READY','PENDING') AND COALESCE(q.grace_count,0) < $2)::int grace_available,
    count(*) FILTER (WHERE COALESCE(q.grace_count,0) >= $2)::int grace_consumed,
    count(*) FILTER (WHERE q.status='MANAGER_REVIEW')::int manager_review,
    count(*) FILTER (WHERE q.warning_at IS NOT NULL)::int warned
    FROM kay_auto_rescue_queue q JOIN crm_leads l ON l.id=q.lead_id
    WHERE q.lead_id=ANY($1::int[]) AND q.rule_status=l.status
      AND (EXISTS (SELECT 1 FROM kay_lead_status_history h WHERE h.lead_id=q.lead_id AND h.status=l.status AND h.entered_at=q.status_window)
        OR EXISTS (SELECT 1 FROM kay_legacy_rescue_baselines b WHERE b.lead_id=q.lead_id AND b.observed_status=l.status AND b.state='ACTIVE' AND b.observation_started_at=q.status_window))`,
    [futurePolicyRows.map((r: any) => Number(r.id)), Number(rules.rescue_grace_max_count ?? 1)]);
  const automaticAssignments = await client.query(`SELECT count(*)::int n FROM lead_assignment_history
    WHERE reason='kay_rescue_automatic'`);
  const warningEligible = futurePolicyRows.filter((r: any) => {
    if (!r.entered_at) return false;
    const warningMs = Number(r.thresholdHours) * 3600000 - Number(rules.rescue_warning_minutes ?? 30) * 60000;
    return now.getTime() - new Date(r.entered_at).getTime() >= warningMs;
  }).length - Number(queueReadiness.rows[0]?.warned || 0);
  const canaryGroups = Array.from(new Set(sourceRows.filter((r: any) => r.classification === "SALES_OWNER").map((r: any) => String(r.account)))).map(account => {
    const rows = sourceRows.filter((r: any) => r.account === account && r.thresholdQualified);
    const rescuable = rows.filter((r: any) => r.eligibleAfterBlockers);
    const staffRow = staff.find((x: any) => x.username === account);
    return { account, rows, rescuable, blockerRate: rows.length ? (rows.length-rescuable.length)/rows.length : 1, load: Number(staffRow?.operationalLoad ?? Infinity), expectedTargets: routeTargets.filter((x: any) => x.id !== Number(rows[0]?.assigned_to)) };
  });
  const canary = canaryGroups.find(x => x.rescuable.length >= 1 && x.rescuable.length <= 10 && x.blockerRate <= .5 && x.load <= p90 && x.expectedTargets.length > 0);
  snapshotAfter = await e23SideEffectSnapshot(client);
  const automaticUnchanged = snapshotBefore.lead_assignment_history === snapshotAfter.lead_assignment_history;
  return {
     phase: "E.2.3", mode: String(mode).toUpperCase(), generatedAt: now.toISOString(),
     safety: { mode: String(mode).toUpperCase(), autoNoAnswer1: rescueSettings.auto_rescue_no_answer_1_enabled ? "ENABLED" : "DISABLED", autoNoAnswer2: rescueSettings.auto_rescue_no_answer_2_enabled ? "ENABLED" : "DISABLED", killSwitch: rescueSettings.auto_rescue_kill_switch ? "ON" : "OFF", canaryEmployeeCount: rescueSettings.auto_rescue_canary_employee_ids.length, autoReassignments: automaticUnchanged ? 0 : Number(automaticAssignments.rows[0]?.n || 0), historicalAutoReassignments: Number(automaticAssignments.rows[0]?.n || 0) }, workflowEvidence: {
       excelImportAliases: "server/routes.ts ADMIN_ALIAS_SLUGS: info/admin/kinglike_admin resolve to kinglike_admin; unmatched owner text is preserved rather than round-robin assigned.",
       metaAssignment: "server/routes.ts Meta creation: explicit owner is retained; otherwise leadAssignmentService performs deterministic round-robin.",
       manualCrmDistribution: "server/leadAssignmentService.ts: manual and bulk CRM reassignment use the existing assignment path; this audit never invokes it.",
       adminTakeover: "server/routes.ts CRM assignment authorization permits employee manual takeover while admin bulk/manual reassignment remains explicit.",
       backfill: "server/kayLegacyBaselineService.ts initializeLegacyBaselines: unassigned legacy rows receive observation baselines only; ownership is unchanged.",
       kinglikeAdminDatabaseEvidence: adminWorkflow.rows,
      currentSnapshot: `Observed owner rows: ${owners.length}; current no-answer rows: ${sourceRows.length}.`,
    },
     ownershipPolicy: { kinglike_admin: { classification: "ADMIN_OWNER_EXCLUDED", label: "ADMIN OWNER — EXCLUDED FROM KAY SALES AUTOMATION", canReceiveRescue: false, canBeRescuedFrom: false, includedInCapacity: false, includedInCanary: false, policy: "RESOLVED" } },
      monitoringScope: {
        ...monitoringScope.rows[0],
        launchAt: scopeConfiguration.config.launchAtIso,
        fixedCutoffAt: scopeConfiguration.config.cutoffAtIso,
        rollingWindow: false,
        partition: "final outcome precedence: EXCLUDED_OWNER, then LEGACY_DATE_UNCERTAIN, OUT_OF_SCOPE_LEGACY, IN_KAY_SCOPE; time cohort dimensions are reported separately.",
      },
      noAnswerScope,
      ownerClassification: owners, employeeOwnership: staff.map((x: any) => ({ employee: x.username, totalCrm: x.total_assigned, inScope: x.in_scope, outOfScopeLegacy: x.out_scope, uncertain: x.uncertain })),
      currentNoAnswerSourceDistribution: managedDistribution, kayManagedSalesLeads: managedDistribution, excludedAdminLegacyLeads: aggregateRows(excludedAdminLegacyLeads),
     excludedAdminLegacyReadiness: Object.fromEntries(["no_answer_1","no_answer_2"].map(status => [status, { count: excludedAdminLegacyLeads.filter((r: any) => r.status === status).length, baselineCount: excludedAdminLegacyLeads.filter((r: any) => r.status === status && r.baselineSource === "LEGACY_BASELINE").length, classification: "EXCLUDED_OWNER", excludedOwner: excludedAdminLegacyLeads.filter((r: any) => r.status === status).length }])),
    readiness, employeeDeepWorkloadAudit: staff, workloadModels: {
      A: "nonterminal",
      B: "nonterminal touched within 30 days",
      C: "1×(0-30d)+0.5×(31-60d)+0.25×(61-90d)+0×(>90d)",
      D: E23_RECOMMENDED_FORMULA,
    },
    recommendedCapacity: { formula: E23_RECOMMENDED_FORMULA, active: false, capacityIsPerformanceScore: false },
    capacityModelComparison: staff.map((x: any) => ({
      employee: x.username, currentModel: Number(x.nonterminal) + 2 * Number(x.overdue_tasks),
       thirtyDayModel: Number(x.recent_0_30), recencyWeightedModel: Number(x.recency_weight),
       recommendedOperationalLoad: Number(x.operationalLoad), actionableWorkModel: Number(x.actionableWorkLoad),
       oldLeadsReported: Number(x.nonterminal_older_90),
    })),
     futureCeiling: { name: "rescue_target_max_operational_load", active: false, p75, p90, proposed: proposedCeiling, excludedCurrentTargets: staff.filter((x: any) => Number(x.operationalLoad) >= proposedCeiling).length, recommendation: "rounded max(p90,p75+2); manager review when exceeded" },
       routingSimulation: { hypotheticalLeads: 10, source: "NEW_HYPOTHETICAL_CASES", sourceOwners: hypotheticalSources.map((x: {name:string})=>x.name), requested: 10, assigned: routed.assignments.length, deferred: 10-routed.assignments.length, deferredReasons: routed.assignments.length < 10 ? ["GLOBAL_OR_PER_TARGET_DAILY_LIMIT_OR_NO_ELIGIBLE_TARGET"] : [], startingCapacity: Object.fromEntries(routeTargets.map((x:any) => [x.username, x.operationalLoad])), projectedCapacity: Object.fromEntries(routeTargets.map((x:any) => [x.username, x.operationalLoad + (routed.counts[String(x.id)] || 0)])), receivingByEmployee: Object.fromEntries(routeTargets.map((x:any) => [x.username, routed.counts[String(x.id)] || 0])), writes: 0, pingPongProtection: { applied: pingPongGuardPassed, priorOwnerAssumption: "NONE_FOR_NEW_HYPOTHETICALS", syntheticPriorOwnerGuardPassed: pingPongGuardPassed }, tieBreakers: ["operational_load", "receivedToday", "lastRescueAt", "employeeId"], concentrationRisk: concentrationRisk ? "LOAD_CONCENTRATION_RISK" : "NO", concentrationThreshold, concentrationExplanation: concentrationRisk ? `One target would receive at least ${concentrationThreshold} of 10 hypothetical leads.` : "No target receives the concentration threshold share." },
     sourcePolicyScenarios: policies, blockers: { needsReviewTaskOnly: kayManagedSalesLeads.filter((x: any) => x.thresholdQualified && x.active_task && !x.protected && !x.promise_review).length, contract: "NEEDS_REVIEW means an incomplete crm_tasks row; sole means no protection or promise-review blocker.", promiseManagerReview: kayManagedSalesLeads.filter((x: any) => x.thresholdQualified && x.promise_review).length, preserved: true },
     warningGraceReadiness: { finalWarningEligible: Math.max(0, warningEligible), graceAvailable: Number(queueReadiness.rows[0]?.grace_available || 0), graceConsumed: Number(queueReadiness.rows[0]?.grace_consumed || 0), managerReviewRequired: Number(queueReadiness.rows[0]?.manager_review || 0) },
     firstCanary: canary ? { recommendation: canary.account, active: false, relevantLeads: canary.rows.length, wouldRescue: canary.rescuable.length, wouldBlock: canary.rows.length-canary.rescuable.length, blockerRate: canary.blockerRate, risk: canary.blockerRate ? "LOW_WITH_EXISTING_BLOCKERS" : "LOW", expectedReceivingEmployees: canary.expectedTargets.map((x: any) => x.username), exercises: { sourceOwner: true, targetSelection: true, warning: true, grace: true, transaction: true, promiseHandoff: canary.rows.some((r: any) => r.promise_review === true) }, reason: "Database-derived SALES_OWNER with 1-10 rescuable leads, blocker rate <=50%, load <=p90, and an eligible target." } : { recommendation: "NO SAFE CANARY CANDIDATE YET", active: false, relevantLeads: 0, wouldRescue: 0, wouldBlock: 0, risk: "NO_CANDIDATE_MET_ALL_DATA_GATES", expectedReceivingEmployees: [], exercises: { sourceOwner: false, targetSelection: false, warning: false, grace: false, transaction: false, promiseHandoff: false }, reason: "No SALES_OWNER met all volume, blocker-rate, workload, and target-availability gates." },
     integrity: (() => {
       const unchanged = e23Fingerprint(snapshotBefore) === e23Fingerprint(snapshotAfter);
       const changed = (table: string) => snapshotBefore[table] !== snapshotAfter[table];
       return { beforeFingerprint: e23Fingerprint(snapshotBefore), afterFingerprint: e23Fingerprint(snapshotAfter), unchanged,
         writes: unchanged ? 0 : 1, ownershipChanges: changed("crm_leads") || changed("lead_assignment_history"), statusChanges: changed("crm_leads"),
         missions: changed("kay_missions"), commitments: changed("kay_commitments"), promises: changed("kay_promises"),
         notifications: changed("user_notifications"), autoRescues: changed("kay_auto_rescue_queue") || changed("kay_rescue_executions") };
     })(),
  };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    // READ ONLY diagnostics must never leave an open transaction, even on a
    // query failure. ROLLBACK is intentional after a successful report too.
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}