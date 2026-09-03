import { z } from "zod";
import { db } from "./db";
import { kayDecisions, kayEvents, kaySettings } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

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

export async function getKayControlSnapshot() {
  const [mode, events, decisions] = await Promise.all([
    getKayMode(),
    db.select().from(kayEvents).orderBy(desc(kayEvents.createdAt), desc(kayEvents.id)).limit(30),
    db.select().from(kayDecisions).orderBy(desc(kayDecisions.createdAt), desc(kayDecisions.id)).limit(30),
  ]);
  return {
    mode,
    events: events.map((event) => sanitizeKayJson(event)),
    decisions: decisions.map((decision) => sanitizeKayJson(decision)),
  };
}