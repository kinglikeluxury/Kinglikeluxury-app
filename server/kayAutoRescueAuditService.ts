import { pool } from "./db";
import { defaultRescueSettings, rescueSettingsSchema } from "./kayService";
import { evaluateRescueWindow, recommendRescueEmployee, simulateDailyLimits, rescueAttemptPredicate, type RescueBlocker } from "./kayAutoRescuePlanner";

type Queryable = { query(sql: string, values?: unknown[]): Promise<{ rows: any[] }> };
const terminalStatuses = ["lost", "converted", "purchased", "sold_by_kinglike_luxury", "junk_lead", "not_qualified"];
const safeTable = /^[a-z_]+$/;
const n = (v: unknown) => Number(v || 0);
const increment = (record: Record<string, number>, key: string) => record[key] = (record[key] || 0) + 1;
export const COMMUNICATION_FINGERPRINT_COLUMNS = ["status","state","sent_at","delivered_at","read_at","updated_at","created_at","type","channel","direction","failed_at"] as const;
export const CANARY_THRESHOLDS = { maxVolume: 3, maxBlockerRate: .5, maxComplexHistoryRate: .5, maxReceiverShare: .6 } as const;

export function selectCanaryCandidate(loads: Array<{employeeId:number;employee:string;currentCapacity:number;projectedCapacity:number;availability:string;wouldLose:number}>,
  metrics: Record<number,{relevant:number;blocked:number;complex:number}>, receiverCounts: Record<number,number>) {
  const totalReceived=Object.values(receiverCounts).reduce((a,b)=>a+b,0);
  const maxShare=totalReceived>1 ? Math.max(0,...Object.values(receiverCounts))/totalReceived : 0;
  const evaluated=loads.map(load=>{
    const m=metrics[load.employeeId]||{relevant:0,blocked:0,complex:0};
    const blockerRate=m.relevant?m.blocked/m.relevant:0, complexHistoryRate=m.relevant?m.complex/m.relevant:0;
    const riskFlags:string[]=[];
    if(load.availability!=="AVAILABLE") riskFlags.push("OWNER_UNAVAILABLE");
    if(load.wouldLose>CANARY_THRESHOLDS.maxVolume) riskFlags.push("HIGH_VOLUME");
    if(blockerRate>CANARY_THRESHOLDS.maxBlockerRate) riskFlags.push("HIGH_BLOCKER_RATE");
    if(complexHistoryRate>CANARY_THRESHOLDS.maxComplexHistoryRate) riskFlags.push("COMPLEX_ASSIGNMENT_HISTORY");
    if(maxShare>CANARY_THRESHOLDS.maxReceiverShare) riskFlags.push("LOAD_CONCENTRATION_RISK");
    return {...load,relevantVolume:m.relevant,estimatedRescueVolume:load.wouldLose,blockerRate,complexHistoryRate,receivingConcentration:maxShare,riskFlags};
  });
  const safe=evaluated.filter(x=>x.estimatedRescueVolume>=1&&x.riskFlags.length===0)
    .sort((a,b)=>a.estimatedRescueVolume-b.estimatedRescueVolume||a.blockerRate-b.blockerRate||a.complexHistoryRate-b.complexHistoryRate||a.projectedCapacity-b.projectedCapacity||a.employeeId-b.employeeId)[0];
  return {safe,evaluated};
}

/** This intentionally contains only operational aggregates, employee names and masked lead ids. */
export type KayE21AuditReport = {
  asOf: string; readOnly: true; fullPopulation: Record<string, number>;
  simulations: Record<string, Record<string, number>>; blockerAnalysis: Record<string, number>; noEligibleReasons: Record<string, number>;
  employeeLoad: Array<{ employeeId: number; employee: string; currentActive: number; currentCapacity: number; wouldLose: number; wouldReceive: number; projectedCapacity: number; availability: string }>;
  transferMatrix: Record<string, number>; pingPongPrevented: number; attempts: Record<string, number>;
  dailyLimitSimulation: { rawEligible: number; executable: number; deferredGlobal: number; deferredEmployee: number; managerReview: number };
  protectedLeadAudit: Record<string, number>; availabilityAudit: Record<string, number>;
  historicalReplay: { status: "INSUFFICIENT_RELIABLE_HISTORY"; reasons: string[] };
  canary: { employee: string | null; reason: string; estimatedRescueVolume: number; receivingEmployees: string[]; riskFlags: string[]; metrics: {relevantVolume:number;blockerRate:number;complexHistoryRate:number;currentCapacity:number;projectedCapacity:number;receivingConcentration:number}|null };
  examples: Array<{ lead: string; status: string; elapsedMinutes: number; currentOwner: string; outcome: string; blocker: string | null; recommendedTarget: string | null }>;
  integrity: { before: Record<string, { count: number; fingerprint: string }>; after: Record<string, { count: number; fingerprint: string }>; deltas: Record<string, number>; changed: Record<string, boolean>; externalConcurrentChanges:Record<string,boolean>; integrityFailed: boolean; ownershipWrites: number; crmStatusWrites: number; crmTaskWrites: number; promiseWrites: number; commitmentWrites: number; customerCommunicationWrites: number; customerCommunicationEvidence:string; notifications: number; queueExecutedWrites: number; auditPathCommunicationCalls: 0; readOnlyWriteRejectionProven?: boolean; automaticHistoryTotal: number };
  safetyState: { mode: string; autoNoAnswer1: "ENABLED" | "DISABLED"; autoNoAnswer2: "ENABLED" | "DISABLED"; killSwitch: "ON" | "OFF"; canaryEmployeeCount: number; realAutomaticReassignments: number };
};

async function fingerprints(q: Queryable) {
  const wanted = ["crm_leads", "crm_tasks", "kay_promises", "kay_commitments", "user_notifications", "kay_auto_rescue_queue"];
  const found = await q.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
    AND (table_name = ANY($1::text[]) OR table_name ILIKE '%communication%' OR table_name ILIKE '%conversation%' OR table_name ILIKE '%message%')`, [wanted]);
  const output: Record<string, { count: number; fingerprint: string }> = {};
  for (const r of found.rows) {
    const table = String(r.table_name); if (!safeTable.test(table)) continue;
    // Canonical mutable-field signatures detect a mutation even when row ids
    // and counts do not change. Customer text/contact columns are never read.
    let canonical = ({
      crm_leads: `id::text||'|'||COALESCE(assigned_to::text,'')||'|'||status||'|'||COALESCE(updated_at::text,'')`,
      crm_tasks: `id::text||'|'||lead_id||'|'||COALESCE(completed_at::text,'')||'|'||COALESCE(due_date,'')||'|'||COALESCE(due_time,'')`,
      kay_promises: `id::text||'|'||lead_id||'|'||status||'|'||COALESCE(due_at::text,'')||'|'||COALESCE(owner_review_required_at::text,'')`,
      kay_commitments: `id::text||'|'||lead_id||'|'||status||'|'||due_at::text||'|'||COALESCE(stale_at::text,'')`,
      user_notifications: `id::text||'|'||user_id||'|'||type||'|'||is_read::text||'|'||COALESCE(created_at::text,'')`,
      kay_auto_rescue_queue: `id::text||'|'||COALESCE(lead_id::text,'')||'|'||status||'|'||COALESCE(execution_id::text,'')||'|'||COALESCE(target_employee_id::text,'')`,
    } as Record<string,string>)[table];
    if (!canonical && /communication|conversation|message/.test(table)) {
      const columns=await q.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=ANY($2::text[]) ORDER BY ordinal_position`,[table,COMMUNICATION_FINGERPRINT_COLUMNS]);
      const selected=columns.rows.map(x=>String(x.column_name)).filter(x=>safeTable.test(x));
      if (!selected.length) continue; // explicitly not observable; never hash a body/contact field
      canonical=selected.map(column=>`COALESCE("${column}"::text,'')`).join(`||'|'||`);
    }
    canonical ||= `id::text`;
    const x = await q.query(`SELECT count(*)::int count, COALESCE(max(id),0)::text max_id,
      COALESCE(sum(hashtext(${canonical})),0)::text checksum FROM "${table}"`);
    output[table] = { count: n(x.rows[0]?.count), fingerprint: `${x.rows[0]?.max_id}:${x.rows[0]?.checksum}` };
  }
  return output;
}

export async function runKayE21ReadonlyAudit(options: { verifyWriteRejectionForTest?: boolean } = {}): Promise<KayE21AuditReport> {
  const externalBefore=await fingerprints(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tx = await client.query("SHOW transaction_read_only");
    if (String(tx.rows[0]?.transaction_read_only).toLowerCase() !== "on") throw new Error("Database does not support enforced read-only transactions");
    let readOnlyWriteRejectionProven: boolean | undefined;
    if (options.verifyWriteRejectionForTest) {
      await client.query("SAVEPOINT e21_readonly_probe");
      try { await client.query(`UPDATE kay_settings SET updated_at=updated_at WHERE false`); } catch (error: any) { readOnlyWriteRejectionProven = error?.code === "25006"; }
      await client.query("ROLLBACK TO SAVEPOINT e21_readonly_probe");
      if (!readOnlyWriteRejectionProven) throw new Error("Read-only transaction failed to reject UPDATE");
    }
    const asOf = new Date((await client.query("SELECT clock_timestamp() AS now")).rows[0].now);
    const before = await fingerprints(client);
    const settingsRow = await client.query(`SELECT value FROM kay_settings WHERE key='rescue_rules'`);
    const parsed = rescueSettingsSchema.safeParse(settingsRow.rows[0]?.value);
    const settings = parsed.success ? parsed.data : defaultRescueSettings;
    const safety = await client.query(`SELECT key,value FROM kay_settings WHERE key IN ('mode','rescue_rules')`);
    const safetySettings = Object.fromEntries(safety.rows.map(r => [r.key, r.value]));
    const totals = (await client.query(`SELECT count(*)::int total,
      count(*) FILTER (WHERE status <> ALL($1::text[]))::int active,
      count(*) FILTER (WHERE status<>ALL($1::text[]) AND assigned_to IN (SELECT id FROM users WHERE role='sub_agent' AND is_active=true))::int active_sales,
      count(*) FILTER (WHERE status='no_answer_1')::int no_answer_1,
      count(*) FILTER (WHERE status='no_answer_2')::int no_answer_2,
      count(*) FILTER (WHERE status='no_answer_3')::int no_answer_3,
      count(*) FILTER (WHERE status='no_answer_4')::int no_answer_4,
      count(*) FILTER (WHERE status LIKE 'no_answer_%' AND status NOT IN ('no_answer_1','no_answer_2','no_answer_3','no_answer_4'))::int unknown_review FROM crm_leads`, [terminalStatuses])).rows[0];
    const peopleRows = await client.query(`SELECT u.id,u.username,u.is_active,u.role,COALESCE(a.value->>'availability','AVAILABLE') availability,
      count(DISTINCT l.id) FILTER (WHERE l.status <> ALL($1::text[]))::int active,
      count(DISTINCT t.id) FILTER (WHERE t.completed_at IS NULL AND t.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND t.due_date::date < $2::date)::int overdue
      FROM users u LEFT JOIN kay_settings a ON a.key='phase_c_availability:'||u.id::text
      LEFT JOIN crm_leads l ON l.assigned_to=u.id LEFT JOIN crm_tasks t ON t.lead_id=l.id
      GROUP BY u.id,u.username,u.is_active,u.role,a.value`, [terminalStatuses, asOf.toISOString().slice(0, 10)]);
    const people = peopleRows.rows.map(r => ({ id:n(r.id), name:String(r.username), activeLeadCount:n(r.active), overdueTaskCount:n(r.overdue), availability:String(r.availability), valid:r.role === "sub_agent" && r.is_active === true && r.availability === "AVAILABLE" }));
    const ownerStats: Record<number, { lose: number; receive: number }> = {};
    const ownerMetrics: Record<number,{relevant:number;blocked:number;complex:number}> = {};
    for (const p of people) ownerStats[p.id] = { lose: 0, receive: 0 };
    const simulations: Record<string, Record<string, number>> = { no_answer_1: {}, no_answer_2: {} };
    const blockers: Record<string, number> = { taskBlockers: 0, futureFollowups: 0, overdueTasks: 0, undatedTasks: 0, ambiguousTaskBlockers: 0, protected: 0, other: 0, oneFutureBlocker: 0, FOLLOWUP_PATTERN_REVIEW: 0 };
    const attempts = { "0": 0, "1": 0, "2+": 0 }; const availability: Record<string, number> = {};
    const matrix: Record<string, number> = {}; const noEligibleReasons: Record<string,number> = {}; const raw: Array<{ ownerId: number; status: string; targetId: number }> = [];
    const examples: KayE21AuditReport["examples"] = []; let pingPongPrevented = 0; let evaluated = 0;
    for (const status of ["no_answer_1", "no_answer_2"]) {
      let last = 0;
      for (;;) {
        const page = await client.query(`SELECT l.id,l.status,l.assigned_to,owner.username owner_name,owner.role owner_role,owner.is_active owner_active,
          COALESCE(oa.value->>'availability','AVAILABLE') owner_availability,h.entered_at,p.id protection_id,p.protected_at,
          COALESCE(task.open_count,0)::int open_tasks,COALESCE(task.future_count,0)::int future_tasks,COALESCE(task.overdue_count,0)::int overdue_tasks,COALESCE(task.undated_count,0)::int undated_tasks,
          COALESCE(att.n,0)::int attempts,COALESCE(hist.n,0)::int recent_assignment_count,COALESCE(pr.review,false) promise_review
          FROM crm_leads l LEFT JOIN users owner ON owner.id=l.assigned_to LEFT JOIN kay_settings oa ON oa.key='phase_c_availability:'||l.assigned_to::text
          LEFT JOIN LATERAL (SELECT entered_at FROM kay_lead_status_history WHERE lead_id=l.id AND status=l.status ORDER BY entered_at DESC,id DESC LIMIT 1) h ON true
          LEFT JOIN kay_lead_protection p ON p.lead_id=l.id AND p.removed_at IS NULL
          LEFT JOIN LATERAL (SELECT count(*) FILTER(WHERE completed_at IS NULL)::int open_count,count(*) FILTER(WHERE completed_at IS NULL AND due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND due_date::date >= $1::date)::int future_count,count(*) FILTER(WHERE completed_at IS NULL AND due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND due_date::date < $1::date)::int overdue_count,count(*) FILTER(WHERE completed_at IS NULL AND (due_date IS NULL OR due_date='' OR due_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))::int undated_count FROM crm_tasks WHERE lead_id=l.id) task ON true
          LEFT JOIN LATERAL (SELECT count(*)::int n FROM lead_assignment_history WHERE lead_id=l.id AND ${rescueAttemptPredicate}) att ON true
          LEFT JOIN LATERAL (SELECT count(*)::int n FROM lead_assignment_history WHERE lead_id=l.id AND assigned_at>$4::timestamp - interval '30 days') hist ON true
          LEFT JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM kay_promises WHERE lead_id=l.id AND owner_review_required_at IS NOT NULL AND status=ANY(ARRAY['PENDING','DUE_SOON','OVERDUE','OPEN'])) review) pr ON true
          WHERE l.status=$2 AND l.id>$3 ORDER BY l.id LIMIT 250`, [asOf.toISOString().slice(0, 10), status, last, asOf]);
        if (!page.rows.length) break; last = n(page.rows.at(-1).id);
        // Set-based ping-pong loader for the entire keyset page; do not issue
        // one history query per candidate/employee pair.
        const pageIds = page.rows.map(row => n(row.id));
        const priorOwners = await client.query(`SELECT DISTINCT h.lead_id,h.from_user_id FROM lead_assignment_history h
          JOIN crm_leads current_lead ON current_lead.id=h.lead_id AND current_lead.assigned_to=h.to_user_id
          WHERE h.lead_id=ANY($1::int[]) AND h.from_user_id=ANY($2::int[]) AND h.assigned_at>$3::timestamp - interval '30 days'`,
          [pageIds, people.filter(p => p.valid).map(p => p.id), asOf]);
        const pingPong = new Set(priorOwners.rows.map(row => `${n(row.lead_id)}:${n(row.from_user_id)}`));
        const recentOwnersRows = await client.query(`SELECT DISTINCT lead_id,from_user_id FROM lead_assignment_history
          WHERE lead_id=ANY($1::int[]) AND from_user_id=ANY($2::int[]) AND assigned_at>$3::timestamp - interval '30 days'`,
          [pageIds, people.filter(p => p.valid).map(p => p.id), asOf]);
        const recentOwners = new Set(recentOwnersRows.rows.map(row => `${n(row.lead_id)}:${n(row.from_user_id)}`));
        for (const l of page.rows) {
          evaluated++; const ownerAvailability = !l.assigned_to ? "UNASSIGNED" : !l.owner_active ? "INACTIVE" : l.owner_role !== "sub_agent" ? "INVALID_ROLE" : String(l.owner_availability); increment(availability, ownerAvailability);
          const prior = n(l.attempts); increment(attempts, prior >= 2 ? "2+" : String(prior));
          const bs: RescueBlocker[] = []; if (l.protection_id) { bs.push("PROTECTED_LEAD"); blockers.protected++; } if (n(l.open_tasks)) { bs.push(n(l.future_tasks) ? "FOLLOWUP_SCHEDULED" : "ACTIVE_TASK"); blockers.taskBlockers++; blockers.futureFollowups += n(l.future_tasks) > 0 ? 1 : 0; blockers.overdueTasks += n(l.overdue_tasks) > 0 ? 1 : 0; blockers.undatedTasks += n(l.undated_tasks) > 0 ? 1 : 0; blockers.ambiguousTaskBlockers++; if (n(l.future_tasks) === 1) blockers.oneFutureBlocker++; }
          const metric=ownerMetrics[n(l.assigned_to)]??={relevant:0,blocked:0,complex:0}; metric.relevant++; if(bs.length||l.promise_review) metric.blocked++; if(n(l.recent_assignment_count)>1) metric.complex++;
          if (l.promise_review) blockers.other++;
          const decision = evaluateRescueWindow({ status, statusEnteredAt:l.entered_at ? new Date(l.entered_at) : null, now:asOf, thresholdHours:status==="no_answer_1"?settings.no_answer_1_threshold_hours:settings.no_answer_2_threshold_hours, blockers:bs, rescueAttempts:prior, maxAttempts:settings.max_human_rescue_attempts });
          let outcome = decision.state === "ACTIVE" ? "WOULD_RESCUE" : decision.state === "BLOCKED" ? (l.protection_id ? "BLOCKED_PROTECTED" : "BLOCKED_TASK") : decision.state || "UNKNOWN_INVALID";
          let target: any = null;
          if (decision.eligible && !l.promise_review) {
            const eligiblePeople = people.filter(p => p.valid);
            const candidates = eligiblePeople.map(p => ({ ...p, pingPongPrevented: pingPong.has(`${n(l.id)}:${p.id}`), recentPreviousOwner: recentOwners.has(`${n(l.id)}:${p.id}`) }));
            target = recommendRescueEmployee(candidates, l.assigned_to);
            if (!target.candidate) {
              outcome="NO_ELIGIBLE_EMPLOYEE";
              const alternatives=eligiblePeople.filter(p=>p.id!==n(l.assigned_to));
              const reason=!alternatives.length ? "ONLY_CURRENT_OWNER_ELIGIBLE" : alternatives.every(p=>pingPong.has(`${n(l.id)}:${p.id}`)) ? "PING_PONG_PREVENTED" : "OTHER_DETERMINISTIC_RULE";
              increment(noEligibleReasons,reason); if(reason==="PING_PONG_PREVENTED") pingPongPrevented++;
            }
            else { raw.push({ownerId:n(l.assigned_to),status,targetId:target.candidate.id}); ownerStats[n(l.assigned_to)] ??= {lose:0,receive:0}; ownerStats[n(l.assigned_to)].lose++; ownerStats[target.candidate.id].receive++; increment(matrix, `${l.owner_name || "UNASSIGNED"} → ${target.candidate.name}`); }
          } else if (l.promise_review && decision.eligible) outcome="MANAGER_REVIEW";
          increment(simulations[status], outcome);
          if (examples.length < 10) examples.push({lead:`Lead #••${String(l.id).slice(-2).padStart(2,"•")}`,status,elapsedMinutes:decision.elapsedMinutes,currentOwner:String(l.owner_name || "UNASSIGNED"),outcome,blocker:bs[0] || null,recommendedTarget:target?.candidate?.name || null});
        }
      }
    }
    const day = asOf.toLocaleDateString("en-CA", { timeZone:"Asia/Tbilisi" });
    const usage = (await client.query(`SELECT count(*)::int total FROM lead_assignment_history WHERE reason='kay_rescue_automatic' AND metadata->>'businessDate'=$1`,[day])).rows[0];
    const usageByOwnerRows = await client.query(`SELECT from_user_id,count(*)::int n FROM lead_assignment_history WHERE reason='kay_rescue_automatic' AND metadata->>'businessDate'=$1 GROUP BY from_user_id`,[day]);
    const usageByOwner = new Map<number,number>(usageByOwnerRows.rows.filter(row=>row.from_user_id != null).map(row=>[n(row.from_user_id),n(row.n)]));
    const daily = simulateDailyLimits(raw, settings.auto_rescue_daily_limit, settings.auto_rescue_per_employee_daily_limit, n(usage.total), usageByOwner);
    const protectedAudit = (await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE protected_at < $1::timestamp - interval '7 days')::int over7,count(*) FILTER(WHERE protected_at < $1::timestamp - ($2::text||' days')::interval)::int review_due,count(*) FILTER(WHERE l.status IN ('no_answer_1','no_answer_2'))::int relevant FROM kay_lead_protection p JOIN crm_leads l ON l.id=p.lead_id WHERE p.removed_at IS NULL`,[asOf,settings.protected_review_after_days])).rows[0];
    const reliability = (await client.query(`SELECT count(*) FILTER(WHERE entered_at >= $1::timestamp - interval '7 days')::int windows,
      count(*) FILTER(WHERE entered_at >= $1::timestamp - interval '7 days' AND NOT EXISTS(SELECT 1 FROM lead_assignment_history a WHERE a.lead_id=h.lead_id AND a.assigned_at<=h.entered_at))::int assignment_gaps
      FROM kay_lead_status_history h WHERE status IN ('no_answer_1','no_answer_2')`, [asOf])).rows[0];
    const replayReasons = [
      `status windows in range: ${n(reliability.windows)}`,
      `assignment reconstruction gaps: ${n(reliability.assignment_gaps)}`,
      "availability, protection and task snapshots at historical windows are not immutable",
    ];
    const after = await fingerprints(client); const deltas: Record<string,number> = {}; for (const key of Array.from(new Set([...Object.keys(before),...Object.keys(after)]))) deltas[key] = (after[key]?.count||0)-(before[key]?.count||0);
    const automaticHistoryTotal = n((await client.query(`SELECT count(*)::int n FROM lead_assignment_history WHERE reason='kay_rescue_automatic'`)).rows[0].n);
    await client.query("COMMIT");
    const externalAfter=await fingerprints(pool);
    const employeeLoad = people.filter(p=>p.valid).map(p=>({employeeId:p.id,employee:p.name,currentActive:p.activeLeadCount,currentCapacity:p.activeLeadCount+2*p.overdueTaskCount,wouldLose:ownerStats[p.id]?.lose||0,wouldReceive:ownerStats[p.id]?.receive||0,projectedCapacity:p.activeLeadCount+2*p.overdueTaskCount+(ownerStats[p.id]?.receive||0)-(ownerStats[p.id]?.lose||0),availability:p.availability}));
    const canaryEvaluation=selectCanaryCandidate(employeeLoad,ownerMetrics,Object.fromEntries(Object.entries(ownerStats).map(([id,value])=>[id,value.receive])));
    const canaryOwner=canaryEvaluation.safe;
    const canaryMetrics=canaryOwner?{relevantVolume:canaryOwner.relevantVolume,blockerRate:canaryOwner.blockerRate,complexHistoryRate:canaryOwner.complexHistoryRate,currentCapacity:canaryOwner.currentCapacity,projectedCapacity:canaryOwner.projectedCapacity,receivingConcentration:canaryOwner.receivingConcentration}:null;
    const changed = Object.fromEntries(Object.keys(deltas).map(key => [key, deltas[key] !== 0 || before[key]?.fingerprint !== after[key]?.fingerprint]));
    const externalConcurrentChanges=Object.fromEntries(Array.from(new Set([...Object.keys(externalBefore),...Object.keys(externalAfter)])).map(key=>[key,externalBefore[key]?.count!==externalAfter[key]?.count||externalBefore[key]?.fingerprint!==externalAfter[key]?.fingerprint]));
    const rules: any = safetySettings.rescue_rules || {};
    const safetyState = { mode: String((safetySettings.mode as any)?.mode || "unknown").toUpperCase(), autoNoAnswer1: rules.auto_rescue_no_answer_1_enabled ? "ENABLED" as const : "DISABLED" as const, autoNoAnswer2: rules.auto_rescue_no_answer_2_enabled ? "ENABLED" as const : "DISABLED" as const, killSwitch: rules.auto_rescue_kill_switch ? "ON" as const : "OFF" as const, canaryEmployeeCount: Array.isArray(rules.auto_rescue_canary_employee_ids) ? rules.auto_rescue_canary_employee_ids.length : 0, realAutomaticReassignments: automaticHistoryTotal };
    const changedTable = (table: string) => changed[table] ? 1 : 0;
    const communicationKeys=Object.keys(changed).filter(key=>/communication|conversation|message/.test(key)); const communicationChanged=communicationKeys.some(key=>changed[key]);
    const communicationEvidence=communicationKeys.length?`Observed non-PII state columns in ${communicationKeys.length} communication table(s).`:"No reliable communication state table was discoverable; audit dependency path contains zero communication calls and the transaction is read-only.";
    const canaryRejectedRisks=Array.from(new Set(canaryEvaluation.evaluated.flatMap(x=>x.riskFlags)));
    return { asOf:asOf.toISOString(),readOnly:true,fullPopulation:{totalCrmLeads:n(totals.total),activeStatusLeads:n(totals.active),activeSalesLeads:n(totals.active_sales),noAnswer1:n(totals.no_answer_1),noAnswer2:n(totals.no_answer_2),noAnswer3Compatibility:n(totals.no_answer_3),noAnswer4:n(totals.no_answer_4),unknownReview:n(totals.unknown_review),relevantEvaluated:evaluated},simulations,blockerAnalysis:blockers,noEligibleReasons,employeeLoad,transferMatrix:matrix,pingPongPrevented,attempts,dailyLimitSimulation:{rawEligible:raw.length,executable:daily.executable.length,deferredGlobal:daily.deferredGlobal,deferredEmployee:daily.deferredEmployee,managerReview:daily.deferredGlobal+daily.deferredEmployee},protectedLeadAudit:{total:n(protectedAudit.total),over7Days:n(protectedAudit.over7),reviewDue:n(protectedAudit.review_due),relevant:n(protectedAudit.relevant)},availabilityAudit:availability,historicalReplay:{status:"INSUFFICIENT_RELIABLE_HISTORY",reasons:replayReasons},canary:canaryOwner?{employee:canaryOwner.employee,reason:`volume=${canaryOwner.estimatedRescueVolume}, blockerRate=${canaryOwner.blockerRate.toFixed(2)}, complexHistoryRate=${canaryOwner.complexHistoryRate.toFixed(2)}, projectedCapacity=${canaryOwner.projectedCapacity}, receiverShare=${canaryOwner.receivingConcentration.toFixed(2)}`,estimatedRescueVolume:canaryOwner.wouldLose,receivingEmployees:employeeLoad.filter(x=>x.wouldReceive>0).map(x=>x.employee),riskFlags:canaryOwner.riskFlags,metrics:canaryMetrics}:{employee:null,reason:"NO MEANINGFUL CANARY CANDIDATE CURRENTLY EXISTS",estimatedRescueVolume:0,receivingEmployees:[],riskFlags:canaryRejectedRisks,metrics:null},examples,integrity:{before,after,deltas,changed,externalConcurrentChanges,integrityFailed:Object.values(changed).some(Boolean),ownershipWrites:changedTable("crm_leads"),crmStatusWrites:changedTable("crm_leads"),crmTaskWrites:changedTable("crm_tasks"),promiseWrites:changedTable("kay_promises"),commitmentWrites:changedTable("kay_commitments"),customerCommunicationWrites:communicationChanged?1:0,customerCommunicationEvidence:communicationEvidence,notifications:changedTable("user_notifications"),queueExecutedWrites:changedTable("kay_auto_rescue_queue"),auditPathCommunicationCalls:0,readOnlyWriteRejectionProven,automaticHistoryTotal},safetyState };
  } catch (error) { await client.query("ROLLBACK").catch(()=>{}); throw error; } finally { client.release(); }
}