import { z } from "zod";
import { kayInternalDb, withKayInternalClient } from "./kayInternalDatabase";
import { kayDecisions, kayEvents, kaySettings, kayLeadProtection } from "@shared/schema";
import { desc, eq, and, isNull, sql } from "drizzle-orm";
import { getKayStatusIntelligence, isKayOrphanEligibleStatus, isKayRescueEvaluatedStatus, KAY_STATUS_INTELLIGENCE } from "./kayStatusClassification";
export { recommendRescueEmployee, evaluateRescueWindow } from "./kayAutoRescuePlanner";
import { recommendRescueEmployee, evaluateRescueWindow } from "./kayAutoRescuePlanner";
import type { RescueBlocker, RescueCandidate, RescueState } from "./kayAutoRescuePlanner";
import { denyKayWrite } from "./kayActionGateway";
import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";
import { assertKayInternalWriteAllowed } from "./kayInternalWriteGate";

/**
 * These are names reserved for later explicitly-approved phases.  They are
 * intentionally not operational values in Phase A.
 */
export const kayApprovedModeSchema = z.enum([
  "shadow",
  "assisted",
  "controlled_automation",
]);
export type KayApprovedMode = z.infer<typeof kayApprovedModeSchema>;

/** Phase A's sole operational mode. */
export const kayModeSchema = z.enum(["shadow", "assisted", "controlled_automation"]);
export type KayMode = z.infer<typeof kayModeSchema>;
export const kayModeUpdateSchema = z.object({ mode: kayModeSchema }).strict();

const modeValueSchema = z.object({ mode: kayModeSchema }).strict();

export function resolveKayMode(value: unknown): KayMode {
  const parsed = modeValueSchema.safeParse(value);
  return parsed.success ? parsed.data.mode : "shadow";
}

export function validateKayModeUpdate(value: unknown):
  | { ok: true; mode: KayMode }
  | { ok: false; message: string } {
  const parsed = kayModeUpdateSchema.safeParse(value);
  return parsed.success
    ? { ok: true, mode: parsed.data.mode }
    : { ok: false, message: "Kay only permits shadow, assisted, or controlled automation mode." };
}

/**
 * Removes credential-like fields recursively before a value can cross into a
 * Kay JSONB column (or leave the Kay inspection API).  JSON primitives are
 * preserved and unusual/cyclic values are reduced to safe strings.
 */
export function sanitizeKayJson(value: unknown): unknown {
  return sanitizeKayJsonValue(value, new WeakSet<object>(), 0);
}

function sanitizeKayJsonValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "object") return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (depth >= 20) return "[max_depth]";
  if (Array.isArray(value)) return value.map((item) => sanitizeKayJsonValue(item, seen, depth + 1));
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(secret|token|password|passphrase|otp|session|authorization|credential|api[_-]?key|private[_-]?key|cookie)/i.test(key)) continue;
    const sanitized = sanitizeKayJsonValue(item, seen, depth + 1);
    if (sanitized !== undefined) clean[key] = sanitized;
  }
  return clean;
}

export async function getKayMode(): Promise<KayMode> {
  return withKayReadonlyAnalysis(async client => {
    const result = await client.query("SELECT value FROM kay_settings WHERE key='mode' LIMIT 1");
    return resolveKayMode(result.rows[0]?.value);
  });
}

export type KayModeTransition = {
  previousMode: KayMode;
  newMode: KayMode;
  updatedBy: number;
  changedAt: Date;
};

export type KayModeTransactionRunner = (
  apply: (currentValue: unknown, persist: (transition: KayModeTransition) => Promise<void>) => Promise<void>,
) => Promise<void>;

const runKayModeTransaction: KayModeTransactionRunner = async (apply) => {
  await denyKayWrite("settings.update", undefined, "kay_setting", "mode");
  await kayInternalDb.transaction(async (tx) => {
    // Create the singleton before locking so fresh installations and
    // concurrent first updates serialize on the same row.
    await tx.insert(kaySettings).values({
      key: "mode", value: { mode: "shadow" },
    }).onConflictDoNothing();
    const [current] = await tx.select().from(kaySettings)
      .where(eq(kaySettings.key, "mode")).for("update").limit(1);
    await apply(current?.value, async ({ previousMode, newMode, updatedBy, changedAt }) => {
      await tx.update(kaySettings).set({
        value: sanitizeKayJson({ mode: newMode }),
        updatedBy,
        updatedAt: changedAt,
      }).where(eq(kaySettings.key, "mode"));
      const [event] = await tx.insert(kayEvents).values({
        userId: updatedBy,
        eventType: "kay_rule_changed",
        eventSource: "admin",
        previousValue: sanitizeKayJson({ mode: previousMode }),
        newValue: sanitizeKayJson({ mode: newMode }),
        metadata: sanitizeKayJson({ setting: "mode" }),
        kayGenerated: false,
        createdAt: changedAt,
      }).returning({ id: kayEvents.id });
      await tx.insert(kayDecisions).values({
        eventId: event.id,
        decisionType: "admin_mode_change",
        mode: newMode,
        rationale: "An administrator explicitly changed Kay's observation posture.",
        payload: sanitizeKayJson({ previousMode, newMode, action: "settings_only" }),
        createdAt: changedAt,
      });
    });
  });
};

export function createKayModeUpdater(
  runTransaction: KayModeTransactionRunner = runKayModeTransaction,
  now: () => Date = () => new Date(),
) {
  return async (mode: unknown, updatedBy: number): Promise<void> => {
    // Keep this guard at the persistence boundary as well as at the HTTP route.
    const newMode = kayModeSchema.parse(mode);
    await runTransaction(async (currentValue, persist) => {
      await persist({
        previousMode: resolveKayMode(currentValue),
        newMode,
        updatedBy,
        changedAt: now(),
      });
    });
  };
}

export const setKayMode = createKayModeUpdater();

export type KayLeadCreatedObservation = {
  id: number; assignedTo?: number | null; leadSource?: string | null; status?: string | null;
};

export type KayObserverDependencies = {
  getMode: () => Promise<KayMode>;
  persistLeadCreated: (lead: KayLeadCreatedObservation, userId: number | undefined, mode: KayMode) => Promise<boolean>;
  warn: (message: string) => void;
};

const defaultKayObserverDependencies: KayObserverDependencies = {
  getMode: getKayMode,
  async persistLeadCreated(lead, userId, mode) {
    await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_events" });
    await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_decisions" });
    return kayInternalDb.transaction(async (tx) => {
      // The partial unique index created with the Kay tables makes retries
      // idempotent without affecting any CRM write.
      const inserted = await tx.insert(kayEvents).values({
        idempotencyKey: `lead_created:${lead.id}`,
        leadId: lead.id,
        userId: userId ?? null,
        employeeId: lead.assignedTo ?? null,
        eventType: "lead_created",
        eventSource: "crm",
        newValue: sanitizeKayJson({ leadSource: lead.leadSource ?? "manual", status: lead.status ?? "new" }),
        metadata: sanitizeKayJson({ observation: "phase_a", mode }),
        kayGenerated: false,
      }).onConflictDoNothing().returning({ id: kayEvents.id });
      if (!inserted[0]) return false;
      await tx.insert(kayDecisions).values({
        leadId: lead.id,
        eventId: inserted[0].id,
        decisionType: "lead_created_observed",
        mode,
        rationale: "Phase A observes successful lead creation only; no CRM action is performed.",
        payload: sanitizeKayJson({ action: "none" }),
      });
      return true;
    });
  },
  warn(message) { console.warn(message); },
};

/** Best-effort only: this boundary must never interrupt a CRM request. */
export function createKayLeadCreatedObserver(dependencies: KayObserverDependencies = defaultKayObserverDependencies) {
  return async (lead: KayLeadCreatedObservation, userId?: number): Promise<void> => {
    try {
      if (dependencies === defaultKayObserverDependencies) {
        await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_events" });
        await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_decisions" });
      }
      const mode = await dependencies.getMode();
      await dependencies.persistLeadCreated(lead, userId, mode);
    } catch (error) {
      // No throw by design: Kay is an optional observer, not a CRM dependency.
      dependencies.warn(`[Kay] Lead-created observation skipped: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  };
}

export const safelyObserveLeadCreated = async (lead: KayLeadCreatedObservation, userId?: number): Promise<void> => {
  try {
    await denyKayWrite("crm.write", userId, "crm_lead", lead.id);
  } catch (error) {
    console.warn(`[Kay] Lead-created observation blocked: ${error instanceof Error ? error.message : "unknown error"}`);
  }
};

export const KAY_RESCUE_STATUSES = ["no_answer_1", "no_answer_2"] as const;
export type { RescueState, RescueBlocker, RescueCandidate };
/** OWNER_UNAVAILABLE is retained as an observation input for compatibility, but is an urgency flag, never a blocker. */

export const rescueSettingsSchema = z.object({
  no_answer_1_threshold_hours: z.number().int().min(1).max(168),
  no_answer_2_threshold_hours: z.number().int().min(1).max(168),
  max_human_rescue_attempts: z.number().int().min(0).max(10),
  rescue_warning_minutes: z.number().int().min(0).max(10_080),
  protected_review_after_days: z.number().int().min(1).max(365).default(7),
  assisted_rescue_undo_minutes: z.number().int().min(5).max(60).default(15),
  // E.2 is intentionally disarmed by defaults.  These fields are additive so
  // historical E.1 configuration remains valid after the one-time repair.
  auto_rescue_no_answer_1_enabled: z.boolean().default(false),
  auto_rescue_no_answer_2_enabled: z.boolean().default(false),
  auto_rescue_kill_switch: z.boolean().default(true),
  auto_rescue_canary_enabled: z.boolean().default(true),
  auto_rescue_canary_employee_ids: z.array(z.number().int().positive()).max(1000).default([]),
  auto_rescue_canary_daily_limit: z.number().int().min(1).max(5).default(1),
  auto_rescue_daily_limit: z.number().int().min(1).max(50).default(5),
  auto_rescue_per_employee_daily_limit: z.number().int().min(1).max(50).default(3),
  rescue_grace_minutes: z.number().int().min(10).max(60).default(30),
  rescue_grace_max_count: z.number().int().min(0).max(1).default(1),
  auto_rescue_rule_version: z.string().trim().min(1).max(80).default("phase_e2_v1"),
  // Phase B parses only the permanently safe operational value.
  rescue_enabled: z.literal(false),
}).strict();
export type RescueSettings = z.infer<typeof rescueSettingsSchema>;
export const defaultRescueSettings: RescueSettings = {
  no_answer_1_threshold_hours: 24, no_answer_2_threshold_hours: 24,
  max_human_rescue_attempts: 2, rescue_warning_minutes: 30,
  protected_review_after_days: 7, assisted_rescue_undo_minutes: 15,
  auto_rescue_no_answer_1_enabled: false, auto_rescue_no_answer_2_enabled: false,
  auto_rescue_kill_switch: true, auto_rescue_canary_enabled: true,
  auto_rescue_canary_employee_ids: [], auto_rescue_canary_daily_limit: 1, auto_rescue_daily_limit: 5,
  auto_rescue_per_employee_daily_limit: 3, rescue_grace_minutes: 30,
  rescue_grace_max_count: 1, auto_rescue_rule_version: "phase_e2_v1",
  rescue_enabled: false,
};

export async function getRescueSettings(): Promise<RescueSettings> {
  return withKayReadonlyAnalysis(async client => {
    const result = await client.query("SELECT value FROM kay_settings WHERE key='rescue_rules' LIMIT 1");
    const parsed = rescueSettingsSchema.safeParse(result.rows[0]?.value);
    return parsed.success ? parsed.data : defaultRescueSettings;
  });
}

/** Post-commit only. It records each actual status-entry window without changing CRM state. */
export async function observeLeadStatusAfterCommit(lead: { id: number; status: string; assignedTo?: number | null }, userId?: number): Promise<void> {
  try {
    await denyKayWrite("crm.write", userId, "crm_lead", lead.id);
  } catch (error) { console.warn(`[Kay] Status observation skipped: ${error instanceof Error ? error.message : "unknown error"}`); }
}

/** Additive future-only ownership audit; this function never performs the transfer. */
export async function observeLeadAssignmentAfterCommit(leadId: number, fromUserId: number | null, toUserId: number | null, userId?: number): Promise<void> {
  if (fromUserId === toUserId) return;
  try {
    await denyKayWrite("crm.write", userId, "crm_lead", leadId);
  } catch (error) { console.warn(`[Kay] Assignment observation skipped: ${error instanceof Error ? error.message : "unknown error"}`); }
}

export async function setLeadProtection(leadId: number, reason: string, note: string | null, userId: number, protect: boolean) {
  await denyKayWrite("protection.update", userId, "crm_lead", leadId);
}

type QueueLead = { id: number; lead_id: number | null };
/** Database claim protocol; SKIP LOCKED makes multiple Autoscale instances safe. */
export async function claimKayEvaluationQueue(limit = 50): Promise<QueueLead[]> {
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_evaluator_queue" });
  return withKayInternalClient(async client => {
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE kay_evaluator_queue SET status='pending', attempts=attempts+1, available_at=NOW(), updated_at=NOW()
        WHERE status='processing' AND claimed_at < NOW() - interval '20 minutes' AND attempts < 3`);
      await client.query(`UPDATE kay_evaluator_queue SET status='failed', updated_at=NOW()
        WHERE status='processing' AND claimed_at < NOW() - interval '20 minutes' AND attempts >= 3`);
      const result = await client.query(`
        WITH picked AS (SELECT id FROM kay_evaluator_queue
          WHERE status='pending' AND available_at <= NOW() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1)
        UPDATE kay_evaluator_queue q SET status='processing', claimed_at=NOW(), updated_at=NOW()
        FROM picked WHERE q.id=picked.id RETURNING q.id, q.lead_id`, [Math.min(Math.max(limit, 1), 100)]);
      await client.query("COMMIT");
      return result.rows.map((r: any) => ({ id: Number(r.id), lead_id: r.lead_id == null ? null : Number(r.lead_id) }));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

/** Enqueues existing leads with a stable UTC 15-minute scan key; it never writes CRM rows. */
export async function enqueueKayEvaluationScan(): Promise<void> {
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_evaluator_queue" });
  const leads = await withKayReadonlyAnalysis(async client => {
    const result = await client.query("SELECT id FROM crm_leads");
    return result.rows.map(row => Number(row.id));
  });
  await kayInternalDb.transaction(async tx => {
    const bucket = new Date();
    bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 15) * 15, 0, 0);
    const bucketKey = bucket.toISOString().slice(0, 16);
    for (const leadId of leads) {
      await tx.execute(sql`INSERT INTO kay_evaluator_queue (queue_key, lead_id)
        VALUES (${`scan:${leadId}:${bucketKey}`}, ${leadId})
        ON CONFLICT (queue_key) DO NOTHING`);
    }
  });
}

export async function recordImmutableRescueEvaluation(input: {
  leadId: number;
  employeeId: number | null;
  evaluationKey: string;
  decisionType: string;
  payload: Record<string, unknown>;
  fingerprint: string;
}): Promise<boolean> {
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_events" });
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_decisions" });
  const status = String(input.payload.status ?? "");
  const statusEnteredAt = String(input.payload.status_entered_at ?? "");
  if (!status || !statusEnteredAt) throw new Error("Rescue evaluation requires a status-entry window");
  return kayInternalDb.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`kay-rescue:${input.leadId}:${status}:${statusEnteredAt}`}))`);
    const inserted = await tx.insert(kayEvents).values({
      idempotencyKey: input.evaluationKey, leadId: input.leadId, employeeId: input.employeeId,
      eventType: "shadow_rescue_evaluated", eventSource: "kay",
      metadata: sanitizeKayJson({ state: input.payload.state, fingerprint: input.fingerprint }),
      kayGenerated: true,
    }).onConflictDoNothing().returning({ id: kayEvents.id });
    if (!inserted[0]) return false;
    // Only lifecycle state changes. Original evaluation_state, threshold and
    // settings_snapshot remain immutable historical evidence.
    await tx.execute(sql`
      UPDATE kay_decisions SET payload=jsonb_set(payload, '{state}', '"STALE"'::jsonb, true)
      WHERE lead_id=${input.leadId} AND event_id IN (SELECT id FROM kay_events WHERE event_type='shadow_rescue_evaluated')
        AND payload->>'status'=${status} AND payload->>'status_entered_at'=${statusEnteredAt}
        AND payload->>'state' IN ('ACTIVE','BLOCKED')`);
    await tx.insert(kayDecisions).values({
      leadId: input.leadId, eventId: inserted[0].id, decisionType: input.decisionType, mode: "shadow",
      rationale: "Deterministic Phase B.1 shadow evaluation; no transfer is performed.",
      payload: sanitizeKayJson(input.payload),
    });
    return true;
  });
}

export async function runKayShadowEvaluator(): Promise<{ checked: number; eligible: number; blocked: number; stale: number }> {
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_evaluator_queue" });
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_events" });
  await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_decisions" });
  const claimed = await claimKayEvaluationQueue();
  let eligible = 0; let blocked = 0; let stale = 0;
  for (const job of claimed) {
    try {
      if (!job.lead_id) {
        await kayInternalDb.execute(sql`UPDATE kay_evaluator_queue SET status='completed', updated_at=NOW() WHERE id=${job.id} AND status='processing'`);
        continue;
      }
      const result = await withKayReadonlyAnalysis(client => client.query(`
        SELECT l.id, l.status, l.assigned_to, owner.role AS owner_role, h.entered_at, p.id AS protection_id, p.protected_at,
           (SELECT COUNT(*)::int FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ah.reason='kay_rescue' AND (ah.automatic=true OR (ah.automatic=false AND ah.metadata->>'mode'='assisted'))) AS rescue_attempts,
          task.id AS incomplete_task_id, task.title AS incomplete_task_title, task.due_date AS incomplete_task_due_date,
          task.due_time AS incomplete_task_due_time, task.created_by AS incomplete_task_created_by,
          COALESCE((SELECT t.id::text || ':' || COALESCE(t.completed_at::text, 'open')
            FROM crm_tasks t WHERE t.lead_id=l.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1), 'none') AS action_marker
        FROM crm_leads l LEFT JOIN users owner ON owner.id=l.assigned_to LEFT JOIN LATERAL (
          SELECT entered_at FROM kay_lead_status_history WHERE lead_id=l.id AND status=l.status
          ORDER BY entered_at DESC LIMIT 1) h ON true
        LEFT JOIN kay_lead_protection p ON p.lead_id=l.id AND p.removed_at IS NULL
        LEFT JOIN LATERAL (
          SELECT t.id, t.title, t.due_date, t.due_time, t.created_by FROM crm_tasks t
          WHERE t.lead_id=l.id AND t.completed_at IS NULL
          ORDER BY NULLIF(t.due_date, '') ASC NULLS LAST, NULLIF(t.due_time, '') ASC NULLS LAST, t.created_at ASC, t.id ASC LIMIT 1
         ) task ON true WHERE l.id=$1`, [job.lead_id]));
      const lead: any = result.rows[0];
      if (!lead) { await kayInternalDb.execute(sql`UPDATE kay_evaluator_queue SET status='completed', updated_at=NOW() WHERE id=${job.id} AND status='processing'`); continue; }
      const settings = await getRescueSettings();
       const threshold = lead.status === "no_answer_2" ? settings.no_answer_2_threshold_hours : settings.no_answer_1_threshold_hours;
      const blockers: RescueBlocker[] = [];
      if (lead.protection_id) blockers.push("PROTECTED_LEAD");
       const hasIncompleteTask = lead.incomplete_task_id != null;
       const taskDueFuture = hasIncompleteTask && !!lead.incomplete_task_due_date && String(lead.incomplete_task_due_date) >= new Date().toISOString().slice(0, 10);
       if (taskDueFuture) blockers.push("FOLLOWUP_SCHEDULED");
       else if (hasIncompleteTask) blockers.push("ACTIVE_TASK");
       // Legacy audit marker: t.completed_at IS NULL) AS active_task
       // crm_tasks has only free-text title/description: it cannot distinguish
       // customer work from administration safely, so every open task blocks.
       const taskWhy = hasIncompleteTask ? {
         id: Number(lead.incomplete_task_id), title: String(lead.incomplete_task_title ?? "").slice(0, 500),
         dueDate: lead.incomplete_task_due_date ?? null, dueTime: lead.incomplete_task_due_time ?? null,
         createdBy: lead.incomplete_task_created_by == null ? null : Number(lead.incomplete_task_created_by),
         source: "crm_tasks", classification: "NEEDS_REVIEW", confidence: 0,
         rule: "schema_has_no_task_type",
       } : null;
       const ownerUnavailable = !lead.assigned_to || lead.owner_role !== "sub_agent";
       const candidatesResult = await withKayReadonlyAnalysis(client => client.query(`
        SELECT u.id, u.username AS name,
          COUNT(DISTINCT l.id) FILTER (WHERE l.status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified'))::int AS active_lead_count,
          COUNT(DISTINCT t.id) FILTER (WHERE t.completed_at IS NULL AND t.due_date <> '' AND t.due_date < to_char(CURRENT_DATE, 'YYYY-MM-DD'))::int AS overdue_task_count,
          EXISTS(SELECT 1 FROM lead_assignment_history ah WHERE ah.lead_id=$1 AND ah.from_user_id=u.id AND ah.assigned_at > NOW() - interval '30 days') AS recent_previous_owner
        FROM users u LEFT JOIN crm_leads l ON l.assigned_to=u.id
        LEFT JOIN crm_tasks t ON t.lead_id=l.id
         WHERE u.role='sub_agent' GROUP BY u.id, u.username`, [lead.id]));
      const recommendation = recommendRescueEmployee(candidatesResult.rows.map((row: any) => ({
        id: Number(row.id), name: String(row.name), activeLeadCount: Number(row.active_lead_count), overdueTaskCount: Number(row.overdue_task_count),
        recentPreviousOwner: row.recent_previous_owner === true,
      })), lead.assigned_to == null ? null : Number(lead.assigned_to));
      const decision = evaluateRescueWindow({
        status: lead.status,
        statusEnteredAt: lead.entered_at ? new Date(lead.entered_at) : null,
        now: new Date(),
        thresholdHours: threshold,
        blockers,
        rescueAttempts: Number(lead.rescue_attempts ?? 0),
        maxAttempts: settings.max_human_rescue_attempts,
      });
      // Preserve historical rows but make obsolete active states un-actionable.
       const staleRescues = await kayInternalDb.execute(sql`UPDATE kay_decisions SET payload=jsonb_set(payload, '{state}', '"STALE"'::jsonb, true)
        WHERE lead_id=${lead.id} AND event_id IN (SELECT id FROM kay_events WHERE event_type='shadow_rescue_evaluated') AND payload->>'state' IN ('ACTIVE','BLOCKED')
          AND (payload->>'status' IS DISTINCT FROM ${lead.status} OR payload->>'status_entered_at' IS DISTINCT FROM ${lead.entered_at ? new Date(lead.entered_at).toISOString() : null})`);
      stale += staleRescues.rowCount ?? 0;
       if (hasIncompleteTask || lead.protection_id || !isKayOrphanEligibleStatus(lead.status)) {
         const staleOrphans = await kayInternalDb.execute(sql`UPDATE kay_decisions SET payload=jsonb_set(payload, '{state}', '"STALE"'::jsonb, true)
          WHERE lead_id=${lead.id} AND decision_type='unprotected_opportunity' AND payload->>'state'='ACTIVE'`);
        stale += staleOrphans.rowCount ?? 0;
      }
      if (decision.state === "ACTIVE") eligible++; if (decision.state === "BLOCKED") blocked++;
      if (decision.state) {
        const statusEnteredAt = new Date(lead.entered_at).toISOString();
        const windowKey = `rescue:${lead.id}:${lead.status}:${statusEnteredAt}`;
        // Fingerprint only stable, decision-relevant observations. This makes a
        // settings change a new immutable evaluation while retries are no-ops.
        const fingerprint = Buffer.from(JSON.stringify({
          ruleVersion: "phase_b_1", thresholdMinutes: threshold * 60,
          maxAttempts: settings.max_human_rescue_attempts, blockers: [...decision.blockers].sort(),
          taskMarker: taskWhy ? { id: taskWhy.id, dueDate: taskWhy.dueDate, dueTime: taskWhy.dueTime } : null,
          protected: !!lead.protection_id, ownerUnavailable,
          recommendation: { id: recommendation.candidate?.id ?? null, managerReview: recommendation.managerReview, score: recommendation.capacityScore },
          evaluatedState: decision.state,
        })).toString("base64url");
        const evaluationKey = `${windowKey}:${fingerprint}`;
        const decisionType = decision.state === "SIMULATED_LIMIT_REACHED" || (decision.state === "ACTIVE" && recommendation.managerReview) ? "manager_review" : `${lead.status}_rescue_eligible`;
        const payload = sanitizeKayJson({ state: decision.state, evaluation_state: decision.state, status: lead.status, status_entered_at: statusEnteredAt, elapsed_minutes: decision.elapsedMinutes, threshold_minutes: threshold * 60, rescue_rule_version: "phase_b_1", settings_snapshot: settings, evaluation_fingerprint: fingerprint, rescue_attempts: Number(lead.rescue_attempts ?? 0), max_rescue_attempts: settings.max_human_rescue_attempts, blockers: decision.blockers, task_blocker: taskWhy, owner_unavailable: ownerUnavailable, recommended_employee_id: recommendation.candidate?.id ?? null, recommended_employee_name: recommendation.candidate?.name ?? null, capacity_score: recommendation.capacityScore, capacity_score_inputs: recommendation.candidate ? { activeLeadCount: recommendation.candidate.activeLeadCount, overdueTaskCount: recommendation.candidate.overdueTaskCount, formula: "activeLeadCount + 2*overdueTaskCount (+1000 recent previous owner penalty)" } : null, employee_selection_explanation: recommendation.explanation, manager_review: decision.state === "ACTIVE" && recommendation.managerReview, shadow: true });
        await recordImmutableRescueEvaluation({
          leadId: lead.id, employeeId: lead.assigned_to, evaluationKey, decisionType,
          payload: payload as Record<string, unknown>, fingerprint,
        });
      }
      // The CRM has tasks but no separate callback/meeting table. An open,
      // non-terminal lead without an active task is an observable orphan only.
        if (isKayOrphanEligibleStatus(lead.status) && !hasIncompleteTask && !lead.protection_id) {
        const orphanKey = `orphan:${lead.id}:${lead.status}:${lead.action_marker}`;
         const orphanEvent = await kayInternalDb.insert(kayEvents).values({ idempotencyKey: orphanKey, leadId: lead.id, employeeId: lead.assigned_to,
          eventType: "unprotected_opportunity_observed", eventSource: "kay", metadata: { status: lead.status }, kayGenerated: true }).onConflictDoNothing().returning({ id: kayEvents.id });
        if (orphanEvent[0]) await kayInternalDb.insert(kayDecisions).values({ leadId: lead.id, eventId: orphanEvent[0].id, decisionType: "unprotected_opportunity",
          mode: "shadow", rationale: "No active CRM task and no terminal CRM status were found; Kay did not create a task.", payload: { state: "ACTIVE", status: lead.status, shadow: true } });
      }
       const statusInfo = getKayStatusIntelligence(lead.status);
       if (!statusInfo.protectedCandidate || lead.protection_id) {
         await kayInternalDb.execute(sql`UPDATE kay_decisions SET payload=jsonb_set(payload, '{state}', '"STALE"'::jsonb, true)
           WHERE lead_id=${lead.id} AND decision_type='protection_recommended' AND payload->>'state'='ACTIVE'`);
       }
       if (statusInfo.protectedCandidate && !lead.protection_id) {
         const key = `protection-recommended:${lead.id}:${lead.status}`;
          const event = await kayInternalDb.insert(kayEvents).values({ idempotencyKey: key, leadId: lead.id, employeeId: lead.assigned_to,
           eventType: "protection_recommended", eventSource: "kay", metadata: { status: lead.status, shadow: true }, kayGenerated: true }).onConflictDoNothing().returning({ id: kayEvents.id });
          if (event[0]) await kayInternalDb.insert(kayDecisions).values({ leadId: lead.id, eventId: event[0].id, decisionType: "protection_recommended",
           mode: "shadow", rationale: "Commercially sensitive status merits an administrator protection review; Kay made no protection change.",
           payload: { state: "ACTIVE", status: lead.status, protected_candidate: true, shadow: true } });
       }
       if (lead.protection_id && lead.protected_at && new Date(lead.protected_at).getTime() <= Date.now() - settings.protected_review_after_days * 86_400_000) {
         const key = `protected-review:${lead.id}:${new Date(lead.protected_at).toISOString()}:${settings.protected_review_after_days}`;
          const event = await kayInternalDb.insert(kayEvents).values({ idempotencyKey: key, leadId: lead.id, employeeId: lead.assigned_to,
           eventType: "protected_lead_review_due", eventSource: "kay", metadata: { shadow: true }, kayGenerated: true }).onConflictDoNothing().returning({ id: kayEvents.id });
          if (event[0]) await kayInternalDb.insert(kayDecisions).values({ leadId: lead.id, eventId: event[0].id, decisionType: "protected_lead_review_due",
           mode: "shadow", rationale: "Protection has exceeded the informational review threshold; Kay did not remove it.",
           payload: { state: "ACTIVE", protected_at: lead.protected_at, protected_review_after_days: settings.protected_review_after_days, shadow: true } });
       }
       await kayInternalDb.execute(sql`UPDATE kay_evaluator_queue SET status='completed', updated_at=NOW() WHERE id=${job.id} AND status='processing'`);
    } catch (error) {
      console.warn(`[Kay] evaluator job failed id=${job.id}: ${error instanceof Error ? error.message : "unknown"}`);
       await kayInternalDb.execute(sql`UPDATE kay_evaluator_queue SET status=CASE WHEN attempts >= 2 THEN 'failed' ELSE 'pending' END, attempts=attempts+1, available_at=NOW() + interval '5 minutes', updated_at=NOW() WHERE id=${job.id} AND status='processing'`).catch(() => {});
    }
  }
  console.info(`[Kay] shadow evaluator checked=${claimed.length} eligible=${eligible} blocked=${blocked} stale=${stale}`);
  return { checked: claimed.length, eligible, blocked, stale };
}

export function startKayShadowEvaluator(): void {
  const run = createSafeKayEvaluatorRunner();
  run();
  setInterval(run, 15 * 60_000).unref();
}

export function createSafeKayEvaluatorRunner(dependencies: {
  enqueue: () => Promise<void>;
  evaluate: () => Promise<unknown>;
  warn: (message: string) => void;
} = {
  enqueue: enqueueKayEvaluationScan,
  evaluate: runKayShadowEvaluator,
  warn: (message) => console.warn(message),
}) {
  return async (): Promise<void> => {
    try {
      await dependencies.enqueue();
      await dependencies.evaluate();
    } catch (error) {
      dependencies.warn(`[Kay] shadow evaluator skipped: ${error instanceof Error ? error.message : "unknown"}`);
    }
  };
}

export async function getKayControlSnapshot() {
  const [mode, events, decisions, settings, protections] = await Promise.all([
    getKayMode(),
    kayInternalDb.select().from(kayEvents).orderBy(desc(kayEvents.createdAt), desc(kayEvents.id)).limit(30),
    kayInternalDb.select().from(kayDecisions).orderBy(desc(kayDecisions.createdAt), desc(kayDecisions.id)).limit(30),
    getRescueSettings(),
    withKayReadonlyAnalysis(async client => (await client.query("SELECT * FROM kay_lead_protection WHERE removed_at IS NULL LIMIT 100")).rows),
  ]);
  return {
    mode,
    rescueSettings: settings,
    statusIntelligence: Object.values(KAY_STATUS_INTELLIGENCE).slice(0, 100).map(item => sanitizeKayJson(item)),
    protectedLeads: protections.map(item => sanitizeKayJson(item)),
    events: events.map((event) => sanitizeKayJson(event)),
    decisions: decisions.map((decision) => sanitizeKayJson(decision)),
  };
}