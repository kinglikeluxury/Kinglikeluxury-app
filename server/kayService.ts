import { z } from "zod";
import { db, pool } from "./db";
import { kayDecisions, kayEvents, kaySettings, kayLeadProtection } from "@shared/schema";
import { desc, eq, and, isNull, sql } from "drizzle-orm";

/**
 * These are names reserved for later explicitly-approved phases.  They are
 * intentionally not operational values in Phase A.
 */
export const kayApprovedModeSchema = z.enum([
  "shadow",
  "assisted",
  "controlled_automation",
  "full_approved_automation",
]);
export type KayApprovedMode = z.infer<typeof kayApprovedModeSchema>;

/** Phase A's sole operational mode. */
export const kayModeSchema = z.literal("shadow");
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
    : { ok: false, message: "Kay Phase A only permits shadow mode." };
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
  const [setting] = await db.select().from(kaySettings).where(eq(kaySettings.key, "mode")).limit(1);
  return resolveKayMode(setting?.value);
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
  await db.transaction(async (tx) => {
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
    return db.transaction(async (tx) => {
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
      const mode = await dependencies.getMode();
      await dependencies.persistLeadCreated(lead, userId, mode);
    } catch (error) {
      // No throw by design: Kay is an optional observer, not a CRM dependency.
      dependencies.warn(`[Kay] Lead-created observation skipped: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  };
}

export const safelyObserveLeadCreated = createKayLeadCreatedObserver();

export const KAY_RESCUE_STATUSES = ["no_answer_1", "no_answer_2"] as const;
export type RescueState = "ACTIVE" | "BLOCKED" | "STALE" | "SIMULATED_LIMIT_REACHED";
export type RescueBlocker = "PROTECTED_LEAD" | "FOLLOWUP_SCHEDULED" | "ACTIVE_TASK" | "OWNER_UNAVAILABLE";
export type RescueCandidate = { id: number; name: string; activeLeadCount: number; overdueTaskCount: number; recentPreviousOwner?: boolean };
export function recommendRescueEmployee(candidates: RescueCandidate[], currentOwnerId: number | null | undefined) {
  const eligible = candidates.filter(candidate => candidate.id !== currentOwnerId);
  if (!eligible.length) return { candidate: null, managerReview: true, explanation: "NO_ELIGIBLE_EMPLOYEE", capacityScore: null };
  // Capacity is documented and deterministic: active leads + 2 × overdue tasks.
  // A recent prior owner receives 1,000 points, so is avoided whenever an
  // alternative exists without inventing availability or performance signals.
  const ranked = eligible.map(candidate => ({ candidate, capacityScore: candidate.activeLeadCount + 2 * candidate.overdueTaskCount + (candidate.recentPreviousOwner ? 1000 : 0) }))
    .sort((a, b) => a.capacityScore - b.capacityScore || a.candidate.id - b.candidate.id);
  const winner = ranked[0];
  return { candidate: winner.candidate, managerReview: false, capacityScore: winner.capacityScore,
    explanation: `Lower fair workload selected: ${winner.candidate.activeLeadCount} active leads + 2×${winner.candidate.overdueTaskCount} overdue tasks${winner.candidate.recentPreviousOwner ? "; prior-owner penalty applied because no lower alternative exists" : ""}.` };
}

/** Pure, duration-safe eligibility evaluation. Dates are UTC instants; display may use Asia/Tbilisi. */
export function evaluateRescueWindow(input: {
  status: string; statusEnteredAt: Date | null; now: Date; thresholdHours: number;
  blockers?: RescueBlocker[]; rescueAttempts?: number; maxAttempts?: number;
}): { eligible: boolean; state: RescueState | null; elapsedMinutes: number; blockers: RescueBlocker[] } {
  const blockers = input.blockers ?? [];
  const elapsedMinutes = input.statusEnteredAt
    ? Math.max(0, Math.floor((input.now.getTime() - input.statusEnteredAt.getTime()) / 60_000)) : 0;
  if (!KAY_RESCUE_STATUSES.includes(input.status as typeof KAY_RESCUE_STATUSES[number]) || !input.statusEnteredAt) {
    return { eligible: false, state: null, elapsedMinutes, blockers };
  }
  if ((input.rescueAttempts ?? 0) >= (input.maxAttempts ?? 2)) {
    return { eligible: false, state: "SIMULATED_LIMIT_REACHED", elapsedMinutes, blockers };
  }
  if (elapsedMinutes < input.thresholdHours * 60) return { eligible: false, state: null, elapsedMinutes, blockers };
  return blockers.length
    ? { eligible: false, state: "BLOCKED", elapsedMinutes, blockers }
    : { eligible: true, state: "ACTIVE", elapsedMinutes, blockers };
}

export const rescueSettingsSchema = z.object({
  no_answer_1_threshold_hours: z.number().int().min(1).max(168),
  no_answer_2_threshold_hours: z.number().int().min(1).max(168),
  max_human_rescue_attempts: z.number().int().min(0).max(10),
  rescue_warning_minutes: z.number().int().min(0).max(10_080),
  // Phase B parses only the permanently safe operational value.
  rescue_enabled: z.literal(false),
}).strict();
export type RescueSettings = z.infer<typeof rescueSettingsSchema>;
export const defaultRescueSettings: RescueSettings = { no_answer_1_threshold_hours: 24, no_answer_2_threshold_hours: 24, max_human_rescue_attempts: 2, rescue_warning_minutes: 30, rescue_enabled: false };

export async function getRescueSettings(): Promise<RescueSettings> {
  const [setting] = await db.select().from(kaySettings).where(eq(kaySettings.key, "rescue_rules")).limit(1);
  const parsed = rescueSettingsSchema.safeParse(setting?.value);
  return parsed.success ? parsed.data : defaultRescueSettings;
}

/** Post-commit only. It records each actual status-entry window without changing CRM state. */
export async function observeLeadStatusAfterCommit(lead: { id: number; status: string; assignedTo?: number | null }, userId?: number): Promise<void> {
  try {
    const now = new Date();
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"kay-status:" + lead.id}))`);
      const latest = await tx.execute(sql`SELECT status FROM kay_lead_status_history WHERE lead_id=${lead.id} ORDER BY entered_at DESC, id DESC LIMIT 1`);
      // A retry or an unrelated CRM PATCH must never reset this timer. A
      // status flap is intentionally different because the latest status differs.
      if ((latest.rows[0] as { status?: string } | undefined)?.status === lead.status) return;
      const key = `status_entry:${lead.id}:${lead.status}:${now.getTime()}`;
      await tx.insert(kayEvents).values({
        idempotencyKey: key, leadId: lead.id, userId: userId ?? null, employeeId: lead.assignedTo ?? null,
        eventType: "lead_status_entered", eventSource: "crm", newValue: sanitizeKayJson({ status: lead.status }),
        metadata: { observation: "phase_b", mode: "shadow" }, kayGenerated: false, createdAt: now,
      }).onConflictDoNothing();
      await tx.execute(sql`
        INSERT INTO kay_lead_status_history (lead_id, status, entered_at, observed_by, event_key)
        VALUES (${lead.id}, ${lead.status}, ${now}, ${userId ?? null}, ${key})
        ON CONFLICT (event_key) DO NOTHING`);
    });
  } catch (error) { console.warn(`[Kay] Status observation skipped: ${error instanceof Error ? error.message : "unknown error"}`); }
}

/** Additive future-only ownership audit; this function never performs the transfer. */
export async function observeLeadAssignmentAfterCommit(leadId: number, fromUserId: number | null, toUserId: number | null, userId?: number): Promise<void> {
  if (fromUserId === toUserId) return;
  try {
    const now = new Date();
    await db.execute(sql`
      INSERT INTO lead_assignment_history (lead_id, from_user_id, to_user_id, reason, automatic, assigned_at)
      SELECT ${leadId}, ${fromUserId}, ${toUserId}, 'crm_assignment', false, ${now}
      WHERE NOT EXISTS (SELECT 1 FROM lead_assignment_history WHERE lead_id=${leadId}
        AND from_user_id IS NOT DISTINCT FROM ${fromUserId} AND to_user_id IS NOT DISTINCT FROM ${toUserId}
        AND assigned_at > ${new Date(now.getTime() - 1000)})`);
    await db.insert(kayEvents).values({ idempotencyKey: `assignment_observed:${leadId}:${now.getTime()}`, leadId, userId: userId ?? null,
      employeeId: toUserId, eventType: "lead_assignment_observed", eventSource: "crm",
      previousValue: { assignedTo: fromUserId }, newValue: { assignedTo: toUserId }, metadata: { observation: "phase_b" } }).onConflictDoNothing();
  } catch (error) { console.warn(`[Kay] Assignment observation skipped: ${error instanceof Error ? error.message : "unknown error"}`); }
}

export async function setLeadProtection(leadId: number, reason: string, note: string | null, userId: number, protect: boolean) {
  const cleanReason = reason.trim().slice(0, 120);
  if (protect && !cleanReason) throw new Error("Protection reason is required");
  const now = new Date();
  await db.transaction(async tx => {
    if (protect) await tx.insert(kayLeadProtection).values({ leadId, reason: cleanReason, note: note?.trim().slice(0, 1000) || null, protectedBy: userId, protectedAt: now })
      .onConflictDoUpdate({ target: kayLeadProtection.leadId, set: { reason: cleanReason, note: note?.trim().slice(0, 1000) || null, protectedBy: userId, protectedAt: now, removedAt: null, removedBy: null } });
    else await tx.update(kayLeadProtection).set({ removedAt: now, removedBy: userId }).where(and(eq(kayLeadProtection.leadId, leadId), isNull(kayLeadProtection.removedAt)));
    if (protect) {
      await tx.execute(sql`UPDATE kay_decisions SET payload=jsonb_set(
        jsonb_set(payload, '{state}', '"BLOCKED"'::jsonb, true),
        '{blockers}',
        CASE WHEN COALESCE(payload->'blockers', '[]'::jsonb) ? 'PROTECTED_LEAD'
          THEN COALESCE(payload->'blockers', '[]'::jsonb)
          ELSE COALESCE(payload->'blockers', '[]'::jsonb) || '["PROTECTED_LEAD"]'::jsonb END,
        true)
        WHERE lead_id=${leadId}
          AND event_id IN (SELECT id FROM kay_events WHERE event_type='shadow_rescue_evaluated')
          AND payload->>'state' IN ('ACTIVE','BLOCKED')`);
    } else {
      // Conservative until the next read-only evaluation recalculates every
      // blocker: never expose the previously blocked decision as actionable.
      await tx.execute(sql`UPDATE kay_decisions SET payload=jsonb_set(payload, '{state}', '"STALE"'::jsonb, true)
        WHERE lead_id=${leadId}
          AND event_id IN (SELECT id FROM kay_events WHERE event_type='shadow_rescue_evaluated')
          AND payload->>'state'='BLOCKED'`);
    }
    await tx.insert(kayEvents).values({ idempotencyKey: `protection:${leadId}:${protect}:${now.getTime()}`, leadId, userId,
      eventType: protect ? "lead_protected" : "lead_unprotected", eventSource: "admin", metadata: sanitizeKayJson({ reason: cleanReason, note: note?.slice(0, 1000) }), kayGenerated: false });
  });
}

type QueueLead = { id: number; lead_id: number | null };
/** Database claim protocol; SKIP LOCKED makes multiple Autoscale instances safe. */
export async function claimKayEvaluationQueue(limit = 50): Promise<QueueLead[]> {
  const client = await pool.connect();
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
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; } finally { client.release(); }
}

/** Enqueues existing leads with a stable UTC 15-minute scan key; it never writes CRM rows. */
export async function enqueueKayEvaluationScan(): Promise<void> {
  await db.execute(sql`INSERT INTO kay_evaluator_queue (queue_key, lead_id)
    SELECT 'scan:' || id || ':' || to_char(date_trunc('hour', NOW()) + floor(date_part('minute', NOW()) / 15) * interval '15 minutes', 'YYYY-MM-DD"T"HH24:MI'), id FROM crm_leads
    ON CONFLICT (queue_key) DO NOTHING`);
}

export async function runKayShadowEvaluator(): Promise<{ checked: number; eligible: number; blocked: number; stale: number }> {
  const claimed = await claimKayEvaluationQueue();
  let eligible = 0; let blocked = 0; let stale = 0;
  for (const job of claimed) {
    try {
      if (!job.lead_id) {
        await db.execute(sql`UPDATE kay_evaluator_queue SET status='completed', updated_at=NOW() WHERE id=${job.id} AND status='processing'`);
        continue;
      }
      const result = await db.execute(sql`
        SELECT l.id, l.status, l.assigned_to, owner.role AS owner_role, h.entered_at, p.id AS protection_id,
          (SELECT COUNT(*)::int FROM lead_assignment_history ah WHERE ah.lead_id=l.id AND ah.automatic=true AND ah.reason='kay_rescue') AS rescue_attempts,
          EXISTS(SELECT 1 FROM crm_tasks t WHERE t.lead_id=l.id AND t.completed_at IS NULL) AS active_task,
          EXISTS(SELECT 1 FROM crm_tasks t WHERE t.lead_id=l.id AND t.completed_at IS NULL AND t.due_date <> '' AND t.due_date >= to_char(CURRENT_DATE, 'YYYY-MM-DD')) AS future_task,
          COALESCE((SELECT t.id::text || ':' || COALESCE(t.completed_at::text, 'open')
            FROM crm_tasks t WHERE t.lead_id=l.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1), 'none') AS action_marker
        FROM crm_leads l LEFT JOIN users owner ON owner.id=l.assigned_to LEFT JOIN LATERAL (
          SELECT entered_at FROM kay_lead_status_history WHERE lead_id=l.id AND status=l.status
          ORDER BY entered_at DESC LIMIT 1) h ON true
        LEFT JOIN kay_lead_protection p ON p.lead_id=l.id AND p.removed_at IS NULL WHERE l.id=${job.lead_id}`);
      const lead: any = result.rows[0];
      if (!lead) { await db.execute(sql`UPDATE kay_evaluator_queue SET status='completed', updated_at=NOW() WHERE id=${job.id} AND status='processing'`); continue; }
      const settings = await getRescueSettings();
      const threshold = lead.status === "no_answer_2" ? settings.no_answer_2_threshold_hours : settings.no_answer_1_threshold_hours;
      const blockers: RescueBlocker[] = [];
      if (lead.protection_id) blockers.push("PROTECTED_LEAD");
      if (lead.future_task) blockers.push("FOLLOWUP_SCHEDULED");
      else if (lead.active_task) blockers.push("ACTIVE_TASK");
      if (!lead.assigned_to || lead.owner_role !== "sub_agent") blockers.push("OWNER_UNAVAILABLE");
      const candidatesResult = await db.execute(sql`
        SELECT u.id, u.username AS name,
          COUNT(DISTINCT l.id) FILTER (WHERE l.status NOT IN ('lost','converted','purchased','sold_by_kinglike_luxury','junk_lead','not_qualified'))::int AS active_lead_count,
          COUNT(DISTINCT t.id) FILTER (WHERE t.completed_at IS NULL AND t.due_date <> '' AND t.due_date < to_char(CURRENT_DATE, 'YYYY-MM-DD'))::int AS overdue_task_count,
          EXISTS(SELECT 1 FROM lead_assignment_history ah WHERE ah.lead_id=${lead.id} AND ah.from_user_id=u.id AND ah.assigned_at > NOW() - interval '30 days') AS recent_previous_owner
        FROM users u LEFT JOIN crm_leads l ON l.assigned_to=u.id
        LEFT JOIN crm_tasks t ON t.lead_id=l.id
        WHERE u.role='sub_agent' GROUP BY u.id, u.username`);
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
      const staleRescues = await db.execute(sql`UPDATE kay_decisions SET payload=jsonb_set(payload, '{state}', '"STALE"'::jsonb, true)
        WHERE lead_id=${lead.id} AND event_id IN (SELECT id FROM kay_events WHERE event_type='shadow_rescue_evaluated') AND payload->>'state' IN ('ACTIVE','BLOCKED')
          AND (payload->>'status' IS DISTINCT FROM ${lead.status} OR payload->>'status_entered_at' IS DISTINCT FROM ${lead.entered_at ? new Date(lead.entered_at).toISOString() : null})`);
      stale += staleRescues.rowCount ?? 0;
      if (lead.active_task || ["lost", "converted", "purchased", "sold_by_kinglike_luxury", "junk_lead", "not_qualified"].includes(lead.status)) {
        const staleOrphans = await db.execute(sql`UPDATE kay_decisions SET payload=jsonb_set(payload, '{state}', '"STALE"'::jsonb, true)
          WHERE lead_id=${lead.id} AND decision_type='unprotected_opportunity' AND payload->>'state'='ACTIVE'`);
        stale += staleOrphans.rowCount ?? 0;
      }
      if (decision.state === "ACTIVE") eligible++; if (decision.state === "BLOCKED") blocked++;
      if (decision.state) {
        const windowKey = `rescue:${lead.id}:${lead.status}:${new Date(lead.entered_at).toISOString()}`;
        const inserted = await db.insert(kayEvents).values({ idempotencyKey: windowKey, leadId: lead.id, employeeId: lead.assigned_to,
          eventType: "shadow_rescue_evaluated", eventSource: "kay", metadata: sanitizeKayJson({ state: decision.state }), kayGenerated: true }).onConflictDoNothing().returning({ id: kayEvents.id });
        const eventId = inserted[0]?.id ?? (await db.select({ id: kayEvents.id }).from(kayEvents).where(eq(kayEvents.idempotencyKey, windowKey)).limit(1))[0]?.id;
        if (eventId) {
          const decisionType = decision.state === "SIMULATED_LIMIT_REACHED" || recommendation.managerReview ? "manager_review" : `${lead.status}_rescue_eligible`;
          const payload = sanitizeKayJson({ state: decision.state, status: lead.status, status_entered_at: lead.entered_at, elapsed_minutes: decision.elapsedMinutes, threshold_minutes: threshold * 60, rescue_attempts: Number(lead.rescue_attempts ?? 0), max_rescue_attempts: settings.max_human_rescue_attempts, blockers: decision.blockers, recommended_employee_id: recommendation.candidate?.id ?? null, recommended_employee_name: recommendation.candidate?.name ?? null, capacity_score: recommendation.capacityScore, capacity_score_inputs: recommendation.candidate ? { activeLeadCount: recommendation.candidate.activeLeadCount, overdueTaskCount: recommendation.candidate.overdueTaskCount, formula: "activeLeadCount + 2*overdueTaskCount (+1000 recent previous owner penalty)" } : null, employee_selection_explanation: recommendation.explanation, manager_review: recommendation.managerReview, shadow: true });
          await db.insert(kayDecisions).values({
            leadId: lead.id, eventId, decisionType, mode: "shadow",
            rationale: "Deterministic Phase B shadow evaluation; no transfer is performed.", payload,
          }).onConflictDoUpdate({
            target: kayDecisions.eventId,
            set: { decisionType, rationale: "Deterministic Phase B shadow evaluation; no transfer is performed.", payload },
          });
        }
      }
      // The CRM has tasks but no separate callback/meeting table. An open,
      // non-terminal lead without an active task is an observable orphan only.
      const terminal = ["lost", "converted", "purchased", "sold_by_kinglike_luxury", "junk_lead", "not_qualified"];
      if (!terminal.includes(lead.status) && !lead.active_task) {
        const orphanKey = `orphan:${lead.id}:${lead.status}:${lead.action_marker}`;
        const orphanEvent = await db.insert(kayEvents).values({ idempotencyKey: orphanKey, leadId: lead.id, employeeId: lead.assigned_to,
          eventType: "unprotected_opportunity_observed", eventSource: "kay", metadata: { status: lead.status }, kayGenerated: true }).onConflictDoNothing().returning({ id: kayEvents.id });
        if (orphanEvent[0]) await db.insert(kayDecisions).values({ leadId: lead.id, eventId: orphanEvent[0].id, decisionType: "unprotected_opportunity",
          mode: "shadow", rationale: "No active CRM task and no terminal CRM status were found; Kay did not create a task.", payload: { state: "ACTIVE", status: lead.status, shadow: true } });
      }
      await db.execute(sql`UPDATE kay_evaluator_queue SET status='completed', updated_at=NOW() WHERE id=${job.id} AND status='processing'`);
    } catch (error) {
      console.warn(`[Kay] evaluator job failed id=${job.id}: ${error instanceof Error ? error.message : "unknown"}`);
      await db.execute(sql`UPDATE kay_evaluator_queue SET status=CASE WHEN attempts >= 2 THEN 'failed' ELSE 'pending' END, attempts=attempts+1, available_at=NOW() + interval '5 minutes', updated_at=NOW() WHERE id=${job.id} AND status='processing'`).catch(() => {});
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
  const [mode, events, decisions] = await Promise.all([
    getKayMode(),
    db.select().from(kayEvents).orderBy(desc(kayEvents.createdAt), desc(kayEvents.id)).limit(30),
    db.select().from(kayDecisions).orderBy(desc(kayDecisions.createdAt), desc(kayDecisions.id)).limit(30),
  ]);
  const [settings, protections] = await Promise.all([
    getRescueSettings(),
    db.select().from(kayLeadProtection).where(isNull(kayLeadProtection.removedAt)).limit(100),
  ]);
  return {
    mode,
    rescueSettings: settings,
    protectedLeads: protections.map(item => sanitizeKayJson(item)),
    events: events.map((event) => sanitizeKayJson(event)),
    decisions: decisions.map((decision) => sanitizeKayJson(decision)),
  };
}