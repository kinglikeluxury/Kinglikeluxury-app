import { z } from "zod";
import { kayInternalDb } from "./kayInternalDatabase";
import { kayEvents, kayMissions, kaySettings, userNotifications } from "@shared/schema";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getKayStatusIntelligence } from "./kayStatusClassification";
import { sanitizeKayJson } from "./kayService";
import { getKayMissionScope, getKayScopeConfiguration } from "./kayLeadScopeReadService";
import { assertKayProductionEntry } from "./kaySyntheticSafety";
import { denyKayWrite } from "./kayActionGateway";
import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";
import { assertKayInternalWriteAllowed } from "./kayInternalWriteGate";
import { assertSafeKayMutationTestDatabase } from "./kayTestDatabaseSafety";

const db = kayInternalDb;

export const PHASE_C_PRIORITY_FORMULA_VERSION = "phase_c_v1" as const;
export const missionStatusSchema = z.enum(["NEW", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "DISMISSED", "STALE"]);
export const missionTypeSchema = z.enum(["FOLLOW_UP_DUE", "RESCUE_RISK", "RESCUE_ELIGIBLE", "UNPROTECTED_LEAD", "PROTECTED_LEAD_REVIEW", "CLOSING_ATTENTION", "MANAGER_REVIEW_REQUIRED", "RESCUE_LEAD_ASSIGNED"]);
export const missionPrioritySchema = z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]);
export const completionResultSchema = z.enum(["INTERESTED", "HOT", "FOLLOW_UP_NEEDED", "NO_ANSWER", "PRICE_ISSUE", "PAYMENT_PLAN_ISSUE", "DELIVERY_ISSUE", "NOT_INTERESTED", "CONTACTED_OTHER"]);
export const dismissalReasonSchema = z.enum(["CUSTOMER_ALREADY_CONTACTED", "DUPLICATE", "WRONG_LEAD_STATE", "NEED_MANAGER_REVIEW", "NOT_AVAILABLE", "OTHER"]);
export const phaseCSettingsSchema = z.object({
  max_next_60_minutes_items: z.number().int().min(1).max(8),
  priority_formula_version: z.literal(PHASE_C_PRIORITY_FORMULA_VERSION),
  mission_notifications_enabled: z.boolean(),
  mission_generation_interval_minutes: z.number().int().min(1).max(60).default(5),
  quiet_hours_enabled: z.boolean().default(false),
  quiet_hours_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  quiet_hours_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
}).strict();
export type PhaseCSettings = z.infer<typeof phaseCSettingsSchema>;
export const defaultPhaseCSettings: PhaseCSettings = { max_next_60_minutes_items: 6, priority_formula_version: PHASE_C_PRIORITY_FORMULA_VERSION, mission_notifications_enabled: true, mission_generation_interval_minutes: 5, quiet_hours_enabled: false, quiet_hours_start: null, quiet_hours_end: null };
export const kayAvailabilitySchema = z.enum(["AVAILABLE", "BUSY", "DO_NOT_ASSIGN", "LEAVE"]);

export function calculateMissionPriority(signals: { protected?: boolean; closing?: boolean; hot?: boolean; overdueTask?: boolean; rescueEligible?: boolean; rescueRisk?: boolean; unprotected?: boolean; dueWithin60?: boolean }) {
  const factors = [
    ["protected", "Protected lead", signals.protected, 25],
    ["closing", "Closing-stage lead", signals.closing, 25],
    ["hot", "Hot or interested lead", signals.hot, 20],
    ["overdue_task", "Follow-up task is overdue", signals.overdueTask, 25],
    ["rescue_eligible", "Eligible for Rescue review", signals.rescueEligible, 30],
    ["rescue_risk", "Approaching Rescue review", signals.rescueRisk, 20],
    ["unprotected", "No future action is recorded", signals.unprotected, 15],
    ["due_within_60", "Due within 60 minutes", signals.dueWithin60, 15],
  ].filter(([, , enabled]) => enabled).map(([code, label, , points]) => ({ code, label, points: Number(points) }));
  const score = Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0));
  return { version: PHASE_C_PRIORITY_FORMULA_VERSION, score, priority: score >= 70 ? "CRITICAL" : score >= 45 ? "HIGH" : score >= 20 ? "NORMAL" : "LOW", factors };
}

export async function getPhaseCSettings(): Promise<PhaseCSettings> {
  const [row] = await db.select().from(kaySettings).where(eq(kaySettings.key, "phase_c_workflow")).limit(1);
  const parsed = phaseCSettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : defaultPhaseCSettings;
}

export async function setPhaseCSettings(value: unknown, userId: number): Promise<PhaseCSettings> {
  await denyKayWrite("settings.update", userId, "kay_setting", "phase_c");
  throw new Error("KAY settings writes are permanently disabled.");
}

export async function getKayAvailability(employeeId: number) {
  const result = await db.execute(sql`SELECT value,updated_at FROM kay_runtime_state WHERE key=${`phase_c_availability:${employeeId}`} LIMIT 1`);
  const row: any = result.rows[0];
  const availability = kayAvailabilitySchema.safeParse((row?.value as any)?.availability);
  return { availability: availability.success ? availability.data : "AVAILABLE", updatedAt: row?.updated_at ?? null };
}
export async function setKayAvailability(employeeId: number, availability: unknown, actorId: number, adminOverride = false) {
  await denyKayWrite("settings.update", actorId, "kay_availability", employeeId);
  const parsed = kayAvailabilitySchema.parse(availability);
  await kayInternalDb.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('kay:e24-control'))`);
    const key = `phase_c_availability:${employeeId}`;
    const before = (await tx.execute(sql`SELECT value FROM kay_runtime_state WHERE key=${key} FOR UPDATE`)).rows[0] as any;
    await tx.execute(sql`INSERT INTO kay_runtime_state(key,value,updated_at)
      VALUES(${key},${JSON.stringify({availability:parsed})}::jsonb,NOW())
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`);
    await tx.execute(sql`INSERT INTO kay_events(user_id,employee_id,event_type,event_source,previous_value,new_value,metadata,kay_generated)
      VALUES(${actorId},${employeeId},'mission_availability_changed',${adminOverride ? "admin" : "employee"},
        ${JSON.stringify(sanitizeKayJson(before?.value ?? null))}::jsonb,
        ${JSON.stringify({availability:parsed})}::jsonb,
        ${JSON.stringify({adminOverride,shadow:true})}::jsonb,false)`);
  });
  return getKayAvailability(employeeId);
}

export async function getKayOperationsHealth() {
  const healthResult = await db.execute(sql`SELECT value FROM kay_runtime_state WHERE key='phase_c_generator_health' LIMIT 1`);
  const health: any = (healthResult.rows[0] as any)?.value || {};
  const settings = await getPhaseCSettings();
  const lastSuccess = health.last_successful_cycle ? new Date(health.last_successful_cycle).getTime() : 0;
  const stale = process.env.ENABLE_BACKGROUND_SCHEDULERS === "true" && (!lastSuccess || Date.now() - lastSuccess > settings.mission_generation_interval_minutes * 3 * 60_000);
  const pending = await db.execute(sql`SELECT COUNT(*)::int AS count FROM kay_missions WHERE status='NEW' AND priority IN ('HIGH','CRITICAL')`);
  return { scheduler: process.env.ENABLE_BACKGROUND_SCHEDULERS === "true" ? (health.degraded ? "DEGRADED" : "RUNNING") : "DISABLED", stale, warning: stale ? "KAY MISSION GENERATOR MAY BE STALE." : null, lastGeneration: health.last_generation ?? null, lastSuccessfulCycle: health.last_successful_cycle ?? null, lastAutomaticRun: health.last_automatic_run ?? null, lastManualRun: health.last_manual_run ?? null, nextExpectedRun: health.next_expected_run ?? null, checked: health.checked ?? 0, created: health.created ?? 0, staled: health.staled ?? 0, errors: health.errors ?? 0, consecutiveFailures: health.consecutive_failures ?? 0, circuitOpenUntil: health.circuit_open_until ?? null, leaseState: health.lease_state ?? "unknown", notifications: settings.mission_notifications_enabled ? "ENABLED" : "DISABLED", pendingHighCritical: pending.rows[0]?.count ?? 0 };
}

async function persistGeneratorHealth(patch: Record<string, unknown>) {
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_runtime_state" });
  await db.execute(sql`INSERT INTO kay_runtime_state(key,value,updated_at)
    VALUES('phase_c_generator_health',${JSON.stringify(patch)}::jsonb,NOW())
    ON CONFLICT(key) DO UPDATE SET value=kay_runtime_state.value || EXCLUDED.value,updated_at=NOW()`);
}

type Candidate = { lead_id: number; employee_id: number; status: string; name: string | null; protected: boolean; due_date: string | null; due_time: string | null; task_id: number | null; entered_at: Date | null; decision_id: number | null; decision_type: string | null; decision_payload: any };
const activeStatuses = ["NEW", "ACCEPTED", "IN_PROGRESS"];

async function holdsKayMissionScopeFence(tx: any, leadId: number, employeeId: number): Promise<boolean> {
  const result = await tx.execute(sql`SELECT public.kay_lock_mission_scope(${leadId}::integer,${employeeId}::integer) AS allowed`);
  return result.rows[0]?.allowed === true;
}

export async function acquireKayMissionGeneratorLease(): Promise<string | null> {
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_runtime_state" });
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;
  const lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
  const lease = await db.execute(sql`INSERT INTO kay_runtime_state(key,value,updated_at)
    VALUES('phase_c_generator_lease',jsonb_build_object(
      'token',${token}::text,
      'locked_until',${lockedUntil}::timestamptz
    ),NOW())
    ON CONFLICT(key) DO UPDATE SET value=jsonb_build_object(
        'token',${token}::text,
        'locked_until',${lockedUntil}::timestamptz
      ),updated_at=NOW()
      WHERE CASE
        WHEN pg_input_is_valid(kay_runtime_state.value->>'locked_until', 'timestamptz')
          THEN (kay_runtime_state.value->>'locked_until')::timestamptz
        ELSE to_timestamp(0)
      END < NOW()
    RETURNING key`);
  return lease.rows[0] ? token : null;
}

async function staleKayMissionIfStillScoped(
  missionId: number,
  now: Date,
  reason: "condition_obsolete" | "owner_status_or_scope_obsolete",
): Promise<boolean> {
  return db.transaction(async tx => {
    const candidate = await tx.execute(sql`SELECT id,lead_id,employee_id
      FROM kay_missions
      WHERE id=${missionId} AND status IN ('NEW','ACCEPTED','IN_PROGRESS')
      FOR UPDATE`);
    const mission: any = candidate.rows[0];
    if (!mission || !Number.isInteger(Number(mission.lead_id)) ||
        !Number.isInteger(Number(mission.employee_id))) return false;
    if (!await holdsKayMissionScopeFence(
      tx,
      Number(mission.lead_id),
      Number(mission.employee_id),
    )) return false;
    const changed = await tx.update(kayMissions).set({ status: "STALE", updatedAt: now })
      .where(and(eq(kayMissions.id, missionId), inArray(kayMissions.status, activeStatuses)))
      .returning({ id: kayMissions.id });
    if (!changed[0]) return false;
    await tx.insert(kayEvents).values({
      leadId: mission.lead_id,
      employeeId: mission.employee_id,
      eventType: "mission_staled",
      eventSource: "kay",
      metadata: { missionId, reason, shadow: true },
      kayGenerated: true,
    });
    return true;
  });
}

export async function staleKayMissionIfStillScopedForTest(
  missionId: number,
  reason: "condition_obsolete" | "owner_status_or_scope_obsolete" = "condition_obsolete",
) {
  assertSafeKayMutationTestDatabase("staleKayMissionIfStillScopedForTest");
  if (process.env.KAY_C1_POSTGRES_TESTS !== "true") {
    throw new Error("Mission STALE test helper is disabled");
  }
  return staleKayMissionIfStillScoped(missionId, new Date(), reason);
}

export async function renewKayMissionGeneratorLease(token: string): Promise<boolean> {
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_runtime_state" });
  const rows = await db.execute(sql`UPDATE kay_runtime_state SET value=jsonb_build_object(
      'token',${token}::text,
      'locked_until',${new Date(Date.now() + 15 * 60_000).toISOString()}::timestamptz
    ),updated_at=NOW()
    WHERE key='phase_c_generator_lease' AND value->>'token'=${token}::text RETURNING key`);
  return rows.rows.length === 1;
}

export async function releaseKayMissionGeneratorLease(token: string): Promise<boolean> {
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_runtime_state" });
  const rows = await db.execute(sql`UPDATE kay_runtime_state SET value=jsonb_build_object(
      'released',true,
      'released_at',${new Date().toISOString()}::timestamptz
    ),updated_at=NOW()
    WHERE key='phase_c_generator_lease' AND value->>'token'=${token}::text RETURNING key`);
  return rows.rows.length === 1;
}

/** Retryable, bounded in-app delivery. The marker and notification commit together. */
export async function deliverPendingKayMissionNotifications(settings?: PhaseCSettings, limit = 50): Promise<number> {
  if (process.env.KAY_C1_POSTGRES_TESTS === "true") {
    assertSafeKayMutationTestDatabase("deliverPendingKayMissionNotifications");
  } else {
    await denyKayWrite("tasks.create", undefined, "kay_notification", "pending");
    assertKayProductionEntry();
  }
  const effectiveSettings = settings ?? await getPhaseCSettings();
  if (!effectiveSettings.mission_notifications_enabled) return 0;
  const pending = await db.execute(sql`
    SELECT m.id, m.idempotency_key, m.lead_id, m.employee_id, m.priority, m.notification_version
    FROM kay_missions m
    WHERE m.status IN ('NEW','ACCEPTED','IN_PROGRESS')
      AND m.priority IN ('CRITICAL','HIGH')
      AND m.employee_id IS NOT NULL
      AND (m.notification_sent_at IS NULL OR m.notification_level IS DISTINCT FROM m.priority)
    ORDER BY m.priority_score DESC, m.created_at ASC, m.id ASC
    LIMIT ${Math.min(Math.max(limit, 1), 100)}`);
  let delivered = 0;
  for (const mission of pending.rows as any[]) {
    try {
      const candidateScope = await getKayMissionScope(Number(mission.lead_id), Number(mission.employee_id));
      if (candidateScope.outcome !== "IN_KAY_SCOPE") continue;
      const didDeliver = await db.transaction(async tx => {
        await tx.execute(sql`INSERT INTO kay_runtime_state(key,value,updated_at)
          VALUES(${`phase_c_availability:${mission.employee_id}`},'{"availability":"AVAILABLE"}'::jsonb,NOW())
          ON CONFLICT(key) DO NOTHING`);
        // Lock and re-read every policy input. The initial bounded query is
        // merely a candidate list and is never trusted for delivery.
        const locked = await tx.execute(sql`SELECT m.*,
          'Lead #' || m.lead_id::text AS safe_name,
          COALESCE(a.value->>'availability','AVAILABLE') AS availability
          FROM kay_missions m
          JOIN kay_runtime_state a ON a.key='phase_c_availability:' || m.employee_id::text
          WHERE m.id=${mission.id}
          FOR UPDATE OF m,a`);
        const current: any = locked.rows[0];
        if (process.env.KAY_C1_POSTGRES_TESTS !== "true") assertKayProductionEntry(current);
        if (!current || !["NEW","ACCEPTED","IN_PROGRESS"].includes(current.status) ||
            !["HIGH","CRITICAL"].includes(current.priority) ||
            (current.notification_sent_at && current.notification_level === current.priority)) return false;
        if (!await holdsKayMissionScopeFence(tx, Number(current.lead_id), Number(current.employee_id))) return false;
        const quiet = isKayQuietHours(effectiveSettings, new Date());
        const unavailable = current.availability !== "AVAILABLE";
        if (quiet || unavailable) {
          const reason = quiet ? "quiet_hours_utc" : `availability_${current.availability}`;
          await tx.insert(kayEvents).values({
            idempotencyKey: `mission_notification_deferred:${current.idempotency_key}:${current.priority}:${reason}`,
            leadId: current.lead_id, employeeId: current.employee_id,
            eventType: "mission_notification_deferred", eventSource: "kay",
            metadata: { missionId: current.id, reason, nextEligibleAttempt: new Date(Date.now() + effectiveSettings.mission_generation_interval_minutes * 60_000).toISOString(), shadow: true },
            kayGenerated: true,
          }).onConflictDoNothing();
          return false;
        }
        const version = Number(current.notification_version || 0) + 1;
        // Claim the version first. No event/notification can exist unless this
        // compare-and-set returned the locked mission.
        const claimed = await tx.update(kayMissions).set({ notificationSentAt: new Date(), notificationLevel: current.priority, notificationVersion: version, updatedAt: new Date() })
          .where(and(eq(kayMissions.id, current.id), sql`notification_version = ${Number(current.notification_version || 0)}`, sql`notification_level IS DISTINCT FROM ${current.priority}`))
          .returning({ id: kayMissions.id });
        if (!claimed[0]) return false;
        await tx.insert(kayEvents).values({
          idempotencyKey: `mission_notification:${current.idempotency_key}:v${version}`,
          leadId: current.lead_id,
          employeeId: current.employee_id,
          eventType: "mission_notification_created",
          eventSource: "kay",
          metadata: { missionId: current.id, notificationLevel: current.priority, notificationVersion: version, deepLink: `/admin/kay/my-sales?mission=${current.id}`, shadow: true },
          kayGenerated: true,
        });
        await tx.insert(userNotifications).values({
          userId: current.employee_id,
          type: "kay_mission",
          title: `Kay ${current.priority} mission`,
          message: `Kay: ${String(current.safe_name).slice(0, 40)} needs ${String(current.priority).toLowerCase()} attention — open mission.`,
          data: { missionId: current.id, deepLink: `/admin/kay/my-sales?mission=${current.id}`, shadow: true },
        });
        return true;
      });
      if (didDeliver) delivered++;
    } catch (error) {
      console.warn(`[Kay] in-app mission notification skipped: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  return delivered;
}

export function isKayQuietHours(settings: PhaseCSettings, now: Date): boolean {
  if (!settings.quiet_hours_enabled || !settings.quiet_hours_start || !settings.quiet_hours_end) return false;
  // No company timezone exists in current app settings; Kay quiet hours are
  // therefore explicitly interpreted as UTC rather than inventing policy.
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const parse = (time: string) => { const [hour, minutes] = time.split(":").map(Number); return hour * 60 + minutes; };
  const start = parse(settings.quiet_hours_start), end = parse(settings.quiet_hours_end);
  return start === end ? false : start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** Bounded, read-only CRM signal query. It only inserts/stales Kay-owned rows. */
export async function generateKayMissions(limit = 200, runType: "manual" | "automatic" = "manual", actorId: number | null = null): Promise<{ created: number; staled: number; checked: number }> {
  assertKayProductionEntry(undefined);
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_missions" });
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_events" });
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_runtime_state" });
  let leaseToken: string | null;
  try {
    leaseToken = await acquireKayMissionGeneratorLease();
  } catch (error) {
    const healthResult = await db.execute(sql`SELECT value FROM kay_runtime_state WHERE key='phase_c_generator_health' LIMIT 1`).catch(() => ({ rows: [] } as any));
    const old: any = (healthResult.rows[0] as any)?.value || {};
    const failures = Number(old.consecutive_failures || 0) + 1;
    const settings = await getPhaseCSettings().catch(() => defaultPhaseCSettings);
    await persistGeneratorHealth({ last_attempt: new Date().toISOString(), errors: Number(old.errors || 0) + 1, consecutive_failures: failures, degraded: failures >= 3, lease_state: "acquire_error", run_type: runType, ...(failures >= 3 ? { circuit_open_until: new Date(Date.now() + settings.mission_generation_interval_minutes * 3 * 60_000).toISOString() } : {}), ...(runType === "manual" ? { manual_actor_id: actorId } : {}) }).catch(() => {});
    if (error && typeof error === "object") (error as any).kayHealthCounted = true;
    throw error;
  }
  if (!leaseToken) {
    await persistGeneratorHealth({ last_attempt: new Date().toISOString(), lease_state: "busy", last_skipped_run: runType, ...(runType === "manual" ? { manual_actor_id: actorId, last_manual_skipped_at: new Date().toISOString() } : {}) });
    return { created: 0, staled: 0, checked: 0 };
  }
  const heartbeat = setInterval(() => renewKayMissionGeneratorLease(leaseToken).catch(() => false), 2 * 60_000);
  heartbeat.unref();
  try {
    const scopeConfiguration = await getKayScopeConfiguration();
    if (scopeConfiguration.status !== "OK") {
      await persistGeneratorHealth({ halted: true, last_scope_failure: scopeConfiguration.status, lease_state: "released" }).catch(() => {});
      throw new Error(`KAY_SCOPE_${scopeConfiguration.status}`);
    }
    await persistGeneratorHealth({ last_attempt: new Date().toISOString(), lease_state: "owned", lease_owner: leaseToken.split(":")[0], run_type: runType, ...(runType === "manual" ? { manual_actor_id: actorId } : {}) });
    const settings = await getPhaseCSettings();
    const rows = await withKayReadonlyAnalysis(client => client.query(`
    SELECT l.id lead_id, l.assigned_to employee_id, l.status, COALESCE(l.full_name, l.first_name, 'Lead') name,
      p.id IS NOT NULL protected, t.id task_id, t.due_date, t.due_time, h.entered_at,
      d.id decision_id, d.decision_type, d.payload decision_payload
    FROM crm_leads l JOIN users u ON u.id=l.assigned_to AND u.role='sub_agent'
    LEFT JOIN kay_lead_protection p ON p.lead_id=l.id AND p.removed_at IS NULL
    LEFT JOIN LATERAL (SELECT id,due_date,due_time FROM crm_tasks WHERE lead_id=l.id AND completed_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1) t ON true
    LEFT JOIN LATERAL (SELECT entered_at FROM kay_lead_status_history WHERE lead_id=l.id AND status=l.status ORDER BY entered_at DESC LIMIT 1) h ON true
    LEFT JOIN LATERAL (SELECT id,decision_type,payload FROM kay_decisions WHERE lead_id=l.id AND payload->>'state'='ACTIVE' ORDER BY created_at DESC,id DESC LIMIT 1) d ON true
    ORDER BY l.id ASC LIMIT $1`, [Math.min(Math.max(limit, 1), 500)]));
  let created = 0; let reconciled = 0; const current = new Map<number, string[]>(); const now = new Date();
  for (const row of rows.rows as unknown as Candidate[]) {
    assertKayProductionEntry(row);
    const scope = await getKayMissionScope(Number(row.lead_id), Number(row.employee_id));
    if (scope.outcome !== "IN_KAY_SCOPE") continue;
    const info = getKayStatusIntelligence(row.status);
    if (info.terminal || info.classification === "NON_SALES" || info.classification === "UNKNOWN_REVIEW") continue;
    current.set(row.lead_id, []);
    const due = row.due_date ? new Date(`${row.due_date}T${row.due_time || "00:00"}:00`) : null;
    const overdue = !!due && due.getTime() < now.getTime();
    const dueWithin60 = !!due && due.getTime() >= now.getTime() && due.getTime() <= now.getTime() + 3_600_000;
    const payload = row.decision_payload || {};
    const rescueRisk = info.rescueEvaluated && !!row.entered_at && payload.state !== "ACTIVE" && payload.state !== "BLOCKED" &&
      (now.getTime() - new Date(row.entered_at).getTime()) >= Math.max(0, (Number(payload.threshold_minutes || 0) - Number(payload.settings_snapshot?.rescue_warning_minutes || 30)) * 60_000);
    const specs: Array<{ type: z.infer<typeof missionTypeSchema>; condition: boolean; reason: string; dueAt?: Date | null }> = [
      { type: "FOLLOW_UP_DUE", condition: overdue, reason: "Incomplete overdue CRM task; task meaning needs review.", dueAt: due },
      { type: "RESCUE_RISK", condition: rescueRisk, reason: "Current no-answer status is approaching its existing Rescue review window.", dueAt: null },
      { type: "RESCUE_ELIGIBLE", condition: payload.state === "ACTIVE" && String(row.decision_type).includes("rescue_eligible"), reason: "This lead is eligible for Rescue review.", dueAt: null },
      { type: "UNPROTECTED_LEAD", condition: row.decision_type === "unprotected_opportunity" && payload.state === "ACTIVE", reason: "No future action is recorded.", dueAt: null },
      { type: "PROTECTED_LEAD_REVIEW", condition: row.decision_type === "protected_lead_review_due" && payload.state === "ACTIVE", reason: "Protected lead review is due.", dueAt: null },
      { type: "CLOSING_ATTENTION", condition: info.classification === "CLOSING" || info.classification === "INTERESTED" || (!!row.protected && (overdue || dueWithin60)), reason: "Closing, high-interest, or protected attention signal deserves attention.", dueAt: due },
      { type: "MANAGER_REVIEW_REQUIRED", condition: row.decision_type === "manager_review" && payload.state === "ACTIVE", reason: "Existing Rescue intelligence requests manager review.", dueAt: null },
    ];
    for (const spec of specs.filter(x => x.condition)) {
      const priority = calculateMissionPriority({ protected: row.protected, closing: info.classification === "CLOSING", hot: info.classification === "INTERESTED", overdueTask: overdue, rescueEligible: spec.type === "RESCUE_ELIGIBLE", rescueRisk: spec.type === "RESCUE_RISK", unprotected: spec.type === "UNPROTECTED_LEAD", dueWithin60 });
      const window = spec.type === "FOLLOW_UP_DUE" ? `${row.task_id}:${row.due_date}:${row.due_time}` : `${row.status}:${row.entered_at?.toISOString() || row.decision_id || "current"}`;
      const key = `phase-c:${row.lead_id}:${row.employee_id}:${spec.type}:${window}`;
      current.set(row.lead_id, [...(current.get(row.lead_id) ?? []), key]);
      const inserted = await db.transaction(async tx => {
        if (!await holdsKayMissionScopeFence(tx, Number(row.lead_id), Number(row.employee_id))) return null;
        const mission = await tx.insert(kayMissions).values({ leadId: row.lead_id, employeeId: row.employee_id, missionType: spec.type, priority: priority.priority, priorityScore: priority.score, priorityFormulaVersion: priority.version, reasonCode: spec.type, reasonDetails: sanitizeKayJson({ explanation: spec.reason, factors: priority.factors, task_classification: spec.type === "FOLLOW_UP_DUE" ? "NEEDS_REVIEW" : undefined, shadow: true }), objective: "Support the next appropriate employee action while keeping CRM status unchanged.", suggestedAction: "Open the existing CRM lead and use the established workflow.", dueAt: spec.dueAt ?? null, sourceDecisionId: row.decision_id, idempotencyKey: key }).onConflictDoNothing().returning({ id: kayMissions.id });
         if (!mission[0]) {
           // The same mission can gain stronger signals while remaining the
           // same idempotent work item. Increase only; never downgrade and
           // let severity-version notification logic deliver exactly once.
           await tx.update(kayMissions).set({ priority: priority.priority, priorityScore: priority.score, reasonDetails: sanitizeKayJson({ explanation: spec.reason, factors: priority.factors, shadow: true }), updatedAt: now })
             .where(and(eq(kayMissions.idempotencyKey, key), sql`${kayMissions.priorityScore} < ${priority.score}`));
           return null;
         }
        await tx.insert(kayEvents).values({ idempotencyKey:`mission_created:${key}`, leadId: row.lead_id, employeeId: row.employee_id, eventType: "mission_created", eventSource: "kay", metadata: { missionId: mission[0].id, missionType: spec.type, priority: priority.priority, shadow: true }, kayGenerated: true });
        return mission[0];
      });
      if (inserted) {
        created++;
      }
    }
  }
  // A status/decision/task window that disappeared is no longer employee work.
  // Preserve it as STALE rather than deleting its auditable history.
  for (const [leadId, keys] of Array.from(current.entries())) {
    const candidates = await db.select({ id: kayMissions.id }).from(kayMissions)
      .where(and(eq(kayMissions.leadId, leadId), inArray(kayMissions.status, activeStatuses),
        sql`${kayMissions.idempotencyKey} LIKE 'phase-c:%'`,
        ...(keys.length ? [notInArray(kayMissions.idempotencyKey, keys)] : [])));
    for (const mission of candidates) {
      if (await staleKayMissionIfStillScoped(mission.id, now, "condition_obsolete")) reconciled++;
    }
  }
  const staleCandidates = await withKayReadonlyAnalysis(client => client.query(`SELECT m.id,m.lead_id,m.employee_id,l.status
    FROM kay_missions m LEFT JOIN crm_leads l ON l.id=m.lead_id
    WHERE m.status IN ('NEW','ACCEPTED','IN_PROGRESS') AND m.idempotency_key LIKE 'phase-c:%'`));
  const staleIds: number[] = [];
  for (const mission of staleCandidates.rows as any[]) {
    const scope = await getKayMissionScope(Number(mission.lead_id), Number(mission.employee_id));
    if (scope.outcome !== "IN_KAY_SCOPE" ||
        ['purchased','converted','sold_by_kinglike_luxury','lost','lost_competition','no_answer_converted','not_qualified','junk_lead','broker','agency','second_hand','re_sale'].includes(String(mission.status))) {
      staleIds.push(Number(mission.id));
    }
  }
  let staleCount = 0;
  for (const missionId of staleIds) {
    if (await staleKayMissionIfStillScoped(missionId, now, "owner_status_or_scope_obsolete")) staleCount++;
  }
    // Shared user_notifications is EXTERNAL_SYSTEM and never a worker target.
    const result = { created, staled: reconciled + staleCount, checked: rows.rows.length };
    await persistGeneratorHealth({ last_generation: new Date().toISOString(), ...(runType === "automatic" ? { last_automatic_run: new Date().toISOString() } : { last_manual_run: new Date().toISOString() }), last_successful_cycle: new Date().toISOString(), checked: result.checked, created: result.created, staled: result.staled, errors: 0, consecutive_failures: 0, degraded: false, circuit_open_until: null, half_open: false, lease_state: "released" });
    return result;
  } finally {
    clearInterval(heartbeat);
    await releaseKayMissionGeneratorLease(leaseToken).catch(() => {});
  }
}

export async function getKayMission(id: number, actorId: number, admin: boolean) {
  return withKayReadonlyAnalysis(async client => {
    const result = await client.query(`SELECT m.* FROM kay_missions m
      LEFT JOIN crm_leads l ON l.id=m.lead_id LEFT JOIN users u ON u.id=m.employee_id
      WHERE m.id=$1 AND ($2 OR (m.employee_id=$3 AND l.assigned_to=$3 AND u.role='sub_agent')) LIMIT 1`, [id, admin, actorId]);
    const mission = result.rows[0] ?? null;
    if (!mission || admin) return mission;
    const scope = await getKayMissionScope(Number(mission.lead_id), Number(mission.employee_id), client);
    return scope.outcome === "IN_KAY_SCOPE" ? mission : null;
  });
}
export async function transitionKayMission(id: number, actorId: number, admin: boolean, action: "accept" | "start" | "complete" | "dismiss", details: unknown) {
  await denyKayWrite("workflow.transition", actorId, "kay_mission", id);
  const parsed: any = action === "complete" ? z.object({ resultCode: completionResultSchema, note: z.string().max(500).optional() }).strict().parse(details)
    : action === "dismiss" ? z.object({ reason: dismissalReasonSchema, note: z.string().max(500).optional() }).strict().parse(details) : {};
  const candidate = await withKayReadonlyAnalysis(client =>
    client.query(`SELECT lead_id,employee_id FROM kay_missions WHERE id=$1 LIMIT 1`, [id])
  );
  const candidateMission = candidate.rows[0];
  if (!candidateMission) throw Object.assign(new Error("Mission not found."), { status: 404 });
  const candidateScope = await getKayMissionScope(Number(candidateMission.lead_id), Number(candidateMission.employee_id));
  if (candidateScope.outcome !== "IN_KAY_SCOPE") {
    throw Object.assign(new Error("Mission is outside Kay operational scope."), { status: 409, code: `KAY_SCOPE_${candidateScope.outcome}` });
  }
  const allowed: Record<string, string[]> = { accept: ["NEW"], start: ["ACCEPTED"], complete: ["ACCEPTED", "IN_PROGRESS"], dismiss: ["NEW", "ACCEPTED", "IN_PROGRESS"] };
  const outcome = await db.transaction(async tx => {
    const locked = await tx.execute(sql`SELECT m.* FROM kay_missions m WHERE m.id=${id} FOR UPDATE OF m`);
    const mission: any = locked.rows[0];
    if (!mission || (!admin && mission.employee_id !== actorId)) {
      return null;
    }
    if (!await holdsKayMissionScopeFence(tx, Number(mission.lead_id), Number(mission.employee_id))) return null;
    if (!allowed[action].includes(mission.status)) { const error: any = new Error("Invalid mission transition."); error.status = 409; throw error; }
    const now = new Date(); const patch: any = { updatedAt: now, status: action === "accept" ? "ACCEPTED" : action === "start" ? "IN_PROGRESS" : action === "complete" ? "COMPLETED" : "DISMISSED" };
    if (action === "accept") patch.acceptedAt = now; if (action === "start") patch.startedAt = now;
    if (action === "complete") { patch.completedAt = now; patch.resultCode = parsed.resultCode; patch.resultDetails = sanitizeKayJson({ note: parsed.note || null, crm_status_unchanged: true }); }
    if (action === "dismiss") { patch.dismissedAt = now; patch.resultDetails = sanitizeKayJson({ dismissal_reason: parsed.reason, note: parsed.note || null }); }
    const [updated] = await tx.update(kayMissions).set(patch).where(and(eq(kayMissions.id, id), inArray(kayMissions.status, allowed[action] as any))).returning();
    if (!updated) { const error: any = new Error("Mission changed; refresh and try again."); error.status = 409; throw error; }
    await tx.insert(kayEvents).values({ leadId: updated.leadId, employeeId: updated.employeeId, userId: actorId, eventType: `mission_${action}`, eventSource: admin ? "admin" : "employee", metadata: sanitizeKayJson({ missionId: id, action, actorId, adminOverride: admin, beforeStatus: mission.status, afterStatus: updated.status, reason: parsed.reason, result: parsed.resultCode, shadow: true }), kayGenerated: false });
    return updated;
  });
  if (!outcome) { const error: any = new Error("Mission not found."); error.status = 404; throw error; }
  return outcome;
}

export async function listKayMissions(employeeId: number | null, admin: boolean, includeCompleted = false) {
  const filters: any[] = []; if (!admin) filters.push(eq(kayMissions.employeeId, employeeId!)); if (!includeCompleted) filters.push(inArray(kayMissions.status, activeStatuses));
  const missions = await db.select().from(kayMissions).where(filters.length ? and(...filters) : undefined).orderBy(desc(kayMissions.priorityScore), desc(kayMissions.dueAt), desc(kayMissions.id)).limit(100);
  const checked = await Promise.all(missions.map(async mission => ({
    mission,
    scope: mission.leadId == null ? "UNKNOWN_IDENTITY" : (await getKayMissionScope(Number(mission.leadId), mission.employeeId)).outcome,
  })));
  return checked
    .filter(({ mission, scope }) => !activeStatuses.includes(mission.status) || scope === "IN_KAY_SCOPE")
    .map(({ mission }) => mission);
}

/** Bounded operational counts, not a ranking or employee-performance score. */
export async function getKayEmployeeWorkflowSnapshot() {
  const result = await withKayReadonlyAnalysis(client => client.query(`
    SELECT u.id AS employee_id, u.username AS employee_name,
      COUNT(m.id)::int AS missions_total,
      COUNT(m.id) FILTER (WHERE m.status IN ('NEW','ACCEPTED','IN_PROGRESS'))::int AS active_missions,
      COUNT(m.id) FILTER (WHERE m.status IN ('NEW','ACCEPTED','IN_PROGRESS') AND m.priority='CRITICAL')::int AS active_critical,
      COUNT(m.id) FILTER (WHERE m.status='COMPLETED')::int AS completed,
      COUNT(m.id) FILTER (WHERE m.status='DISMISSED')::int AS dismissed,
      COUNT(m.id) FILTER (WHERE m.status='STALE')::int AS stale,
      COUNT(m.id) FILTER (WHERE m.mission_type='RESCUE_RISK' AND m.status IN ('NEW','ACCEPTED','IN_PROGRESS'))::int AS rescue_risk,
      COUNT(m.id) FILTER (WHERE m.mission_type='UNPROTECTED_LEAD' AND m.status IN ('NEW','ACCEPTED','IN_PROGRESS'))::int AS unprotected,
      COUNT(m.id) FILTER (WHERE m.mission_type IN ('CLOSING_ATTENTION','PROTECTED_LEAD_REVIEW') AND m.status IN ('NEW','ACCEPTED','IN_PROGRESS'))::int AS protected_attention,
       COUNT(m.id) FILTER (WHERE m.status='NEW' AND m.priority='CRITICAL')::int AS unacknowledged_critical,
       COUNT(m.id) FILTER (WHERE m.status='NEW' AND m.priority='HIGH')::int AS unacknowledged_high,
       MIN(m.created_at) FILTER (WHERE m.status IN ('NEW','ACCEPTED','IN_PROGRESS')) AS oldest_pending,
       (SELECT MAX(e.created_at) FROM kay_events e WHERE e.employee_id=u.id AND e.event_type LIKE 'mission_%') AS last_kay_activity,
       COALESCE((SELECT jsonb_object_agg(q.result_code, q.total) FROM (SELECT result_code, COUNT(*)::int AS total FROM kay_missions x WHERE x.employee_id=u.id AND x.result_code IS NOT NULL GROUP BY result_code) q), '{}'::jsonb) AS results
    FROM users u LEFT JOIN kay_missions m ON m.employee_id=u.id
    WHERE u.role='sub_agent'
     GROUP BY u.id,u.username LIMIT 100`));
  return result.rows;
}
export async function getKayMissionInspection() {
  return withKayReadonlyAnalysis(async client => {
    const result = await client.query(`SELECT m.id,m.mission_type,m.priority,m.status,m.reason_code,m.created_at,m.accepted_at,m.completed_at,m.result_code,
      m.lead_id,COALESCE(l.full_name,l.first_name,'Deleted lead') lead_name,m.employee_id,u.username employee_name
      FROM kay_missions m LEFT JOIN crm_leads l ON l.id=m.lead_id LEFT JOIN users u ON u.id=m.employee_id
      ORDER BY m.created_at DESC,m.id DESC LIMIT 50`);
    return result.rows;
  });
}

/** Best-effort worker; it is deliberately behind the same scheduler gate. */
export function startKayMissionGenerator(): void {
  let timer: NodeJS.Timeout | undefined;
  const schedule = async () => {
    const settings = await getPhaseCSettings().catch(() => defaultPhaseCSettings);
    const delay = settings.mission_generation_interval_minutes * 60_000;
    timer = setTimeout(run, delay); timer.unref();
  };
  const run = async () => {
    try {
      const health: any = await getKayOperationsHealth();
      if (health.circuitOpenUntil && new Date(health.circuitOpenUntil).getTime() > Date.now()) {
        await persistGeneratorHealth({ degraded: true, lease_state: "circuit_open" });
        return;
      }
      if (health.circuitOpenUntil) await persistGeneratorHealth({ half_open: true, lease_state: "half_open_probe" });
      const result = await generateKayMissions(200, "automatic");
      await persistGeneratorHealth({ last_automatic_run: new Date().toISOString(), next_expected_run: new Date(Date.now() + (await getPhaseCSettings()).mission_generation_interval_minutes * 60_000).toISOString(), ...result });
    } catch (error) {
      if ((error as any)?.kayHealthCounted) {
        console.warn(`[Kay] mission generator lease acquisition failed: ${error instanceof Error ? error.message : "unknown"}`);
        return;
      }
      const old: any = await getKayOperationsHealth().catch(() => ({ consecutiveFailures: 0, errors: 0 }));
      const failures = Number(old.consecutiveFailures || 0) + 1;
      const settings = await getPhaseCSettings().catch(() => defaultPhaseCSettings);
      await persistGeneratorHealth({ errors: Number(old.errors || 0) + 1, consecutive_failures: failures, degraded: failures >= 3, lease_state: "error", ...(failures >= 3 ? { circuit_open_until: new Date(Date.now() + settings.mission_generation_interval_minutes * 3 * 60_000).toISOString() } : {}) }).catch(() => {});
      console.warn(`[Kay] mission generator skipped: ${error instanceof Error ? error.message : "unknown"}`);
    } finally { await schedule(); }
  };
  // Delayed readiness start: never scan synchronously during application boot.
  setTimeout(run, 10_000).unref();
}