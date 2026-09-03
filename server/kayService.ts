import { z } from "zod";
import { db } from "./db";
import { kayDecisions, kayEvents, kaySettings } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

/**
 * Phase A deliberately has no execution mode. Advisory remains read-only; it
 * exists only so an admin can explicitly label the operating posture. Neither
 * value can write to CRM data or contact customers.
 */
export const kayModeSchema = z.enum(["shadow", "advisory"]);
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
    : { ok: false, message: "Kay mode must be either shadow or advisory." };
}

export async function getKayMode(): Promise<KayMode> {
  const [setting] = await db.select().from(kaySettings).where(eq(kaySettings.key, "mode")).limit(1);
  return resolveKayMode(setting?.value);
}

export async function setKayMode(mode: KayMode, updatedBy: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(kaySettings).where(eq(kaySettings.key, "mode")).limit(1);
    const previousMode = resolveKayMode(current?.value);
    const changedAt = new Date();
    await tx.insert(kaySettings).values({
      key: "mode",
      value: { mode },
      updatedBy,
      updatedAt: changedAt,
    }).onConflictDoUpdate({
      target: kaySettings.key,
      set: { value: { mode }, updatedBy, updatedAt: changedAt },
    });
    const [event] = await tx.insert(kayEvents).values({
      userId: updatedBy,
      eventType: "kay_rule_changed",
      eventSource: "admin",
      previousValue: { mode: previousMode },
      newValue: { mode },
      metadata: { setting: "mode" },
      kayGenerated: false,
    }).returning({ id: kayEvents.id });
    await tx.insert(kayDecisions).values({
      eventId: event.id,
      decisionType: "admin_mode_change",
      mode,
      rationale: "An administrator explicitly changed Kay's observation posture.",
      payload: { previousMode, newMode: mode, action: "settings_only" },
    });
  });
}

/** Best-effort only: this boundary must never interrupt a CRM request. */
export async function safelyObserveLeadCreated(lead: {
  id: number; assignedTo?: number | null; leadSource?: string | null; status?: string | null;
}, userId?: number): Promise<void> {
  try {
    const mode = await getKayMode();
    const [event] = await db.insert(kayEvents).values({
      leadId: lead.id,
      userId: userId ?? null,
      employeeId: lead.assignedTo ?? null,
      eventType: "lead_created",
      eventSource: "crm",
      newValue: { leadSource: lead.leadSource ?? "manual", status: lead.status ?? "new" },
      metadata: { observation: "phase_a", mode },
      kayGenerated: false,
    }).returning({ id: kayEvents.id });
    await db.insert(kayDecisions).values({
      leadId: lead.id,
      eventId: event.id,
      decisionType: "lead_created_observed",
      mode,
      rationale: "Phase A observes successful lead creation only; no CRM action is performed.",
      payload: { action: "none" },
    });
  } catch (error) {
    // No throw by design: Kay is an optional observer, not a CRM dependency.
    console.warn("[Kay] Lead-created observation skipped:", error instanceof Error ? error.message : "unknown error");
  }
}

export async function getKayControlSnapshot() {
  const [mode, events, decisions] = await Promise.all([
    getKayMode(),
    db.select().from(kayEvents).orderBy(desc(kayEvents.createdAt), desc(kayEvents.id)).limit(30),
    db.select().from(kayDecisions).orderBy(desc(kayDecisions.createdAt), desc(kayDecisions.id)).limit(30),
  ]);
  return { mode, events, decisions };
}