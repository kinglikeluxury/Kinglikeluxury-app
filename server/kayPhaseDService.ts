import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { crmLeads, kayCommitments, kayEvents, kayInternalBriefings, kayManagerReviews, kayMissions, kayPromises, kaySettings } from "@shared/schema";
import { getKayAvailability, getPhaseCSettings, isKayQuietHours } from "./kayMissionService";
import { getKayScopeConfiguration, getKayScopeForLead, kayScopeSql } from "./kayLeadScopeService";

const activeMission = ["NEW", "ACCEPTED", "IN_PROGRESS"];
const phaseDStyleSchema = z.enum(["FRIENDLY", "PROFESSIONAL", "DIRECT", "FIRM", "SALES_COACH", "EXECUTIVE"]);
const callStyleSchema = z.enum(["PROFESSIONAL", "FRIENDLY", "DIRECT", "COACHING"]);
const employeeAddressStyleSchema = z.enum(["FIRST_NAME", "FORMAL", "FRIENDLY"]);
const employeeProfileSchema = z.object({
  language: z.enum(["ar", "en"]),
  address: z.string().trim().min(1).max(80),
  style: phaseDStyleSchema,
  preferred_voice_name: z.string().trim().min(1).max(120).nullable().optional(),
}).strict();
export const phaseDSettingsSchema = z.object({
  enabled: z.boolean(), evaluation_interval_minutes: z.number().int().min(1).max(60),
  max_commitment_extensions: z.number().int().min(0).max(5), critical_bypass_quiet_hours: z.boolean(),
  reminder_minutes: z.number().int().min(1).max(1440).default(5),
  promise_escalation_minutes: z.number().int().min(1).max(10080).default(60),
  voice_enabled: z.boolean(), default_language: z.enum(["ar", "en"]), style: phaseDStyleSchema,
  directness_level: z.number().int().min(1).max(5), brief_length: z.enum(["SHORT", "NORMAL", "DETAILED"]),
  preferred_voice_name: z.string().trim().min(1).max(120).nullable(),
  speech_rate: z.number().min(0.5).max(2),
  speech_pitch: z.number().min(0.5).max(2),
  max_brief_seconds: z.number().int().min(5).max(180),
  call_style: callStyleSchema,
  owner_address: z.string().trim().min(1).max(80),
  employee_address_style: employeeAddressStyleSchema,
  personality_toggles: z.object({
    warm: z.boolean(),
    encouraging: z.boolean(),
    concise: z.boolean(),
    empathetic: z.boolean(),
  }).strict(),
  employee_profiles: z.record(z.string().regex(/^[1-9]\d*$/), employeeProfileSchema),
  trigger_types: z.array(z.enum(["CRITICAL_MISSION", "COMMITMENT_OVERDUE", "IMPORTANT_PROMISE_OVERDUE", "MANAGER_REVIEW"])).default(["CRITICAL_MISSION", "COMMITMENT_OVERDUE", "IMPORTANT_PROMISE_OVERDUE", "MANAGER_REVIEW"]),
}).strict();
export type PhaseDSettings = z.infer<typeof phaseDSettingsSchema>;
export const defaultPhaseDSettings: PhaseDSettings = { enabled: false, evaluation_interval_minutes: 5, max_commitment_extensions: 2, critical_bypass_quiet_hours: false, reminder_minutes: 5, promise_escalation_minutes: 60, voice_enabled: false, default_language: "en", style: "PROFESSIONAL", directness_level: 3, brief_length: "SHORT", preferred_voice_name: null, speech_rate: 1, speech_pitch: 1, max_brief_seconds: 30, call_style: "PROFESSIONAL", owner_address: "Owner", employee_address_style: "FIRST_NAME", personality_toggles: { warm: true, encouraging: true, concise: true, empathetic: true }, employee_profiles: {}, trigger_types: ["CRITICAL_MISSION", "COMMITMENT_OVERDUE", "IMPORTANT_PROMISE_OVERDUE", "MANAGER_REVIEW"] };
export const commitmentInput = z.object({ leadId: z.number().int().positive().nullable().optional(), missionId: z.number().int().positive().nullable().optional(), action: z.string().trim().min(2).max(300), dueAt: z.coerce.date(), idempotencyKey: z.string().min(8).max(160) }).strict();
export const promiseInput = z.object({ leadId: z.number().int().positive(), promiseText: z.string().trim().min(2).max(500), importance: z.enum(["NORMAL", "IMPORTANT"]).default("NORMAL"), dueAt: z.coerce.date(), idempotencyKey: z.string().min(8).max(160) }).strict();

export async function getPhaseDSettings() {
  const [row] = await db.select().from(kaySettings).where(eq(kaySettings.key, "phase_d_workflow")).limit(1);
  return phaseDSettingsSchema.safeParse(row?.value).data ?? defaultPhaseDSettings;
}
export async function getEmployeePhaseDVoiceSettings(employeeId: number) {
  const settings = await getPhaseDSettings();
  return employeeSafePhaseDSettings(settings, employeeId);
}
export function employeeSafePhaseDSettings(settings: PhaseDSettings, employeeId: number) {
  const profile = settings.employee_profiles[String(employeeId)] ?? null;
  return {
    voice_enabled: settings.voice_enabled,
    default_language: settings.default_language,
    style: settings.style,
    directness_level: settings.directness_level,
    brief_length: settings.brief_length,
    preferred_voice_name: profile?.preferred_voice_name ?? settings.preferred_voice_name,
    speech_rate: settings.speech_rate,
    speech_pitch: settings.speech_pitch,
    max_brief_seconds: settings.max_brief_seconds,
    call_style: settings.call_style,
    owner_address: settings.owner_address,
    employee_address_style: settings.employee_address_style,
    personality_toggles: settings.personality_toggles,
    profile,
  };
}
export async function setPhaseDSettings(value: unknown, actorId: number) {
  const parsed = phaseDSettingsSchema.parse(value);
  await db.transaction(async tx => {
    const [before] = await tx.select().from(kaySettings).where(eq(kaySettings.key, "phase_d_workflow")).for("update").limit(1);
    await tx.insert(kaySettings).values({ key: "phase_d_workflow", value: parsed, updatedBy: actorId, updatedAt: new Date() }).onConflictDoUpdate({ target: kaySettings.key, set: { value: parsed, updatedBy: actorId, updatedAt: new Date() } });
    await tx.insert(kayEvents).values({ userId: actorId, eventType: "phase_d_settings_changed", eventSource: "admin", previousValue: before?.value, newValue: parsed, metadata: { phase: "D", internalOnly: true }, kayGenerated: false });
  });
  return parsed;
}
async function ownsLead(employeeId: number, leadId: number | null | undefined) {
  if (!leadId) return true;
  const [lead] = await db.select({ id: crmLeads.id }).from(crmLeads).where(and(eq(crmLeads.id, leadId), eq(crmLeads.assignedTo, employeeId))).limit(1);
  return !!lead;
}
export async function createCommitment(input: unknown, employeeId: number, admin = false) {
  const data = commitmentInput.parse(input);
  if (data.leadId) {
    const scope = await getKayScopeForLead(pool, data.leadId);
    if (scope.outcome !== "IN_KAY_SCOPE") { const e: any = new Error("New Kay commitments require an in-scope lead."); e.status = 409; e.code = `KAY_SCOPE_${scope.outcome}`; throw e; }
  }
  const settings = await getPhaseDSettings();
  return db.transaction(async tx => {
    // A mission is locked with its lead before a commitment can be created.
    // This prevents a stale UI from binding one employee's commitment to a
    // reassigned mission/lead.
    let leadId = data.leadId ?? null;
    if (data.missionId) {
      const locked = await tx.execute(sql`SELECT m.lead_id,m.employee_id,l.assigned_to FROM kay_missions m LEFT JOIN crm_leads l ON l.id=m.lead_id WHERE m.id=${data.missionId} FOR UPDATE OF m,l`);
      const mission: any = locked.rows[0];
      if (!mission || (!admin && (mission.employee_id !== employeeId || mission.assigned_to !== employeeId)) || (leadId !== null && leadId !== mission.lead_id)) {
        const e: any = new Error("Mission is not currently available to this employee."); e.status = 403; throw e;
      }
      leadId = mission.lead_id;
    }
    if (leadId) {
      const scope = await getKayScopeForLead(pool, leadId);
      if (scope.outcome !== "IN_KAY_SCOPE") { const e: any = new Error("New Kay commitments require an in-scope lead."); e.status = 409; e.code = `KAY_SCOPE_${scope.outcome}`; throw e; }
    }
    if (!admin && leadId) {
      const ownership = await tx.execute(sql`SELECT id FROM crm_leads WHERE id=${leadId} AND assigned_to=${employeeId} FOR UPDATE`);
      if (!ownership.rows[0]) { const e: any = new Error("Lead is no longer assigned to you."); e.status = 403; throw e; }
    }
    const scopedKey = `${employeeId}:${data.idempotencyKey}`;
    const inserted = await tx.insert(kayCommitments).values({ ...data, leadId, employeeId, idempotencyKey: scopedKey, maxExtensions: settings.max_commitment_extensions, details: { internalOnly: true } }).onConflictDoNothing().returning();
    const row = inserted[0] ?? (await tx.select().from(kayCommitments).where(eq(kayCommitments.idempotencyKey, scopedKey)).limit(1))[0];
    if (!row || row.employeeId !== employeeId || row.action !== data.action || row.missionId !== (data.missionId ?? null) || row.leadId !== leadId || row.dueAt.getTime() !== data.dueAt.getTime()) { const e: any = new Error("Idempotency key was already used for a different commitment."); e.status = 409; throw e; }
    if (inserted[0]) await tx.insert(kayEvents).values({ leadId, employeeId, userId: employeeId, eventType: "commitment_created", eventSource: admin ? "admin" : "employee", metadata: { commitmentId: row.id, actorId: employeeId, internalOnly: true }, kayGenerated: false });
    return row;
  });
}
export async function createPromise(input: unknown, employeeId: number, admin = false) {
  const data = promiseInput.parse(input);
  const scope = await getKayScopeForLead(pool, data.leadId);
  if (scope.outcome !== "IN_KAY_SCOPE") { const e: any = new Error("New Kay promises require an in-scope lead."); e.status = 409; e.code = `KAY_SCOPE_${scope.outcome}`; throw e; }
  return db.transaction(async tx => {
    if (!admin) {
      const owned = await tx.execute(sql`SELECT id FROM crm_leads WHERE id=${data.leadId} AND assigned_to=${employeeId} FOR UPDATE`);
      if (!owned.rows[0]) { const e: any = new Error("Lead is no longer assigned to you."); e.status = 403; throw e; }
    }
    const scopedKey = `${employeeId}:${data.idempotencyKey}`;
    const inserted = await tx.insert(kayPromises).values({ ...data, employeeId, idempotencyKey: scopedKey, details: { internalOnly: true } }).onConflictDoNothing().returning();
    const row = inserted[0] ?? (await tx.select().from(kayPromises).where(eq(kayPromises.idempotencyKey, scopedKey)).limit(1))[0];
    if (!row || row.employeeId !== employeeId || row.promiseText !== data.promiseText || row.importance !== data.importance || row.leadId !== data.leadId || row.dueAt.getTime() !== data.dueAt.getTime()) { const e: any = new Error("Idempotency key was already used for a different promise."); e.status = 409; throw e; }
    if (inserted[0]) await tx.insert(kayEvents).values({ leadId: data.leadId, employeeId, userId: employeeId, eventType: "promise_created", eventSource: admin ? "admin" : "employee", metadata: { promiseId: row.id, actorId: employeeId, internalOnly: true }, kayGenerated: false });
    return row;
  });
}
export async function listCommitments(employeeId: number, admin: boolean) {
  const result = await db.execute(sql`SELECT c.* FROM kay_commitments c WHERE (${admin} OR (c.employee_id=${employeeId} AND (c.lead_id IS NULL OR EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=c.lead_id AND l.assigned_to=${employeeId})))) ORDER BY c.created_at DESC LIMIT 100`);
  return result.rows;
}
export async function listPromises(employeeId: number, admin: boolean) {
  const result = await db.execute(sql`SELECT p.* FROM kay_promises p WHERE (${admin} OR (p.employee_id=${employeeId} AND EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=p.lead_id AND l.assigned_to=${employeeId}))) ORDER BY p.created_at DESC LIMIT 100`);
  return result.rows;
}
export async function completeCommitment(id: number, employeeId: number, admin: boolean) {
  const rows = await db.execute(sql`UPDATE kay_commitments c SET status='COMPLETED',completed_at=NOW(),updated_at=NOW() WHERE c.id=${id} AND c.status IN ('PENDING','ACCEPTED','EXTENDED','OVERDUE','ACTIVE') AND (${admin} OR (c.employee_id=${employeeId} AND (c.lead_id IS NULL OR EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=c.lead_id AND l.assigned_to=${employeeId})))) RETURNING c.*`);
  if (!rows.rows[0]) { const e: any = new Error("Commitment not found or no longer available."); e.status = 404; throw e; }
  const c: any = rows.rows[0]; await db.insert(kayEvents).values({ leadId: c.lead_id, employeeId: c.employee_id, userId: employeeId, eventType: "commitment_completed", eventSource: admin ? "admin" : "employee", metadata: { commitmentId: id, actorId: employeeId, internalOnly: true }, kayGenerated: false }); return c;
}
export async function acceptCommitment(id: number, employeeId: number, admin: boolean) {
  const rows = await db.execute(sql`UPDATE kay_commitments c SET status='ACCEPTED',updated_at=NOW() WHERE c.id=${id} AND c.status IN ('PENDING','ACTIVE') AND (${admin} OR (c.employee_id=${employeeId} AND (c.lead_id IS NULL OR EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=c.lead_id AND l.assigned_to=${employeeId})))) RETURNING c.*`);
  if (!rows.rows[0]) { const e: any = new Error("Commitment cannot be accepted."); e.status = 409; throw e; } const c: any = rows.rows[0];
  await db.insert(kayEvents).values({ leadId: c.lead_id, employeeId: c.employee_id, userId: employeeId, eventType: "commitment_accepted", eventSource: admin ? "admin" : "employee", metadata: { commitmentId: id, actorId: employeeId, internalOnly: true }, kayGenerated: false }); return c;
}
export async function cancelCommitment(id: number, employeeId: number, admin: boolean) {
  const rows = await db.execute(sql`UPDATE kay_commitments c SET status='CANCELLED',updated_at=NOW() WHERE c.id=${id} AND c.status IN ('PENDING','ACCEPTED','EXTENDED','OVERDUE','ACTIVE') AND (${admin} OR (c.employee_id=${employeeId} AND (c.lead_id IS NULL OR EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=c.lead_id AND l.assigned_to=${employeeId})))) RETURNING c.*`);
  if (!rows.rows[0]) { const e: any = new Error("Commitment cannot be cancelled."); e.status =409; throw e; } const c: any = rows.rows[0];
  await db.insert(kayEvents).values({ leadId: c.lead_id, employeeId: c.employee_id, userId: employeeId, eventType: "commitment_cancelled", eventSource: admin ? "admin" : "employee", metadata: { commitmentId: id, actorId: employeeId, internalOnly: true }, kayGenerated: false }); return c;
}
export async function extendCommitment(id: number, employeeId: number, admin: boolean, dueAt: Date) {
  if (dueAt.getTime() <= Date.now()) { const e: any = new Error("Extension deadline must be in the future."); e.status = 400; throw e; }
  const rows = await db.execute(sql`UPDATE kay_commitments c SET status='EXTENDED',due_at=${dueAt},extension_count=extension_count+1,reminder_version=0,last_reminder_at=NULL,updated_at=NOW()
    WHERE c.id=${id} AND c.status IN ('PENDING','ACCEPTED','EXTENDED','OVERDUE','ACTIVE') AND c.extension_count<c.max_extensions AND (${admin} OR (c.employee_id=${employeeId} AND (c.lead_id IS NULL OR EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=c.lead_id AND l.assigned_to=${employeeId})))) RETURNING c.*`);
  if (!rows.rows[0]) { const e: any = new Error("Commitment cannot be extended."); e.status = 409; throw e; }
  const c: any = rows.rows[0]; await db.insert(kayEvents).values({ leadId: c.lead_id, employeeId: c.employee_id, userId: employeeId, eventType: "commitment_extended", eventSource: admin ? "admin" : "employee", metadata: { commitmentId: id, actorId: employeeId, internalOnly: true }, kayGenerated: false }); return c;
}
export async function completePromise(id: number, employeeId: number, admin: boolean) {
  const rows = await db.execute(sql`UPDATE kay_promises p SET status='COMPLETED',completed_at=NOW(),updated_at=NOW() WHERE p.id=${id} AND p.status IN ('PENDING','DUE_SOON','OVERDUE','OPEN') AND (${admin} OR (p.employee_id=${employeeId} AND EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=p.lead_id AND l.assigned_to=${employeeId}))) RETURNING p.*`);
  if (!rows.rows[0]) { const e: any = new Error("Promise not found or no longer available."); e.status = 404; throw e; } const p: any = rows.rows[0];
  await db.insert(kayEvents).values({ leadId: p.lead_id, employeeId: p.employee_id, userId: employeeId, eventType: "promise_completed", eventSource: admin ? "admin" : "employee", metadata: { promiseId: id, actorId: employeeId, internalOnly: true }, kayGenerated: false }); return p;
}
export async function cancelPromise(id: number, employeeId: number, admin: boolean) {
  const rows = await db.execute(sql`UPDATE kay_promises p SET status='CANCELLED',cancelled_at=NOW(),updated_at=NOW() WHERE p.id=${id} AND p.status IN ('PENDING','DUE_SOON','OVERDUE','OPEN') AND (${admin} OR (p.employee_id=${employeeId} AND EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=p.lead_id AND l.assigned_to=${employeeId}))) RETURNING p.*`);
  if (!rows.rows[0]) { const e: any = new Error("Promise cannot be cancelled."); e.status = 409; throw e; } const p: any = rows.rows[0];
  await db.insert(kayEvents).values({ leadId: p.lead_id, employeeId: p.employee_id, userId: employeeId, eventType: "promise_cancelled", eventSource: admin ? "admin" : "employee", metadata: { promiseId: id, actorId: employeeId, internalOnly: true }, kayGenerated: false }); return p;
}
export async function createManagerReview(reason: string, fields: { leadId?: number | null; missionId?: number | null; commitmentId?: number | null; promiseId?: number | null; employeeId?: number | null }, key: string) {
  const [row] = await db.insert(kayManagerReviews).values({ ...fields, reason, idempotencyKey: key, details: { internalOnly: true } }).onConflictDoNothing().returning();
  return row ?? (await db.select().from(kayManagerReviews).where(eq(kayManagerReviews.idempotencyKey, key)).limit(1))[0];
}
export async function listBriefings(employeeId: number, admin: boolean) {
  return db.select().from(kayInternalBriefings).where(admin ? undefined : eq(kayInternalBriefings.employeeId, employeeId)).orderBy(desc(kayInternalBriefings.createdAt)).limit(100);
}
export async function acknowledgeBriefing(id: number, employeeId: number, admin: boolean) {
  const rows = await db.update(kayInternalBriefings).set({ acknowledgedAt: new Date(), updatedAt: new Date() }).where(and(eq(kayInternalBriefings.id, id), ...(admin ? [] : [eq(kayInternalBriefings.employeeId, employeeId)]))).returning();
  if (!rows[0]) { const e: any = new Error("Briefing not found."); e.status = 404; throw e; } return rows[0];
}
export function formatBriefing(facts: { name: string; reason: string; leadName?: string | null; action: string; dueAt?: Date | null }, language: "ar" | "en", settings: Pick<PhaseDSettings, "style" | "directness_level" | "brief_length" | "call_style" | "personality_toggles" | "max_brief_seconds"> = defaultPhaseDSettings) {
  const lead = facts.leadName ? (language === "ar" ? ` العميل ${facts.leadName}` : ` Lead ${facts.leadName}`) : "";
  const templates = language === "ar"
    ? { PROFESSIONAL: "", FRIENDLY: "تذكير ودي: ", DIRECT: "إجراء مطلوب الآن: ", COACHING: "خطوتك التالية: " }
    : { PROFESSIONAL: "", FRIENDLY: "Friendly reminder: ", DIRECT: "Action required now: ", COACHING: "Next step coaching: " };
  const prefix = settings.call_style === "DIRECT" || settings.style === "DIRECT" || settings.directness_level >= 4
    ? templates.DIRECT : templates[settings.call_style];
  const due = facts.dueAt ? (language === "ar" ? ` قبل ${facts.dueAt.toISOString()}` : ` by ${facts.dueAt.toISOString()}`) : "";
  const full = language === "ar" ? `${prefix}${facts.name}، ${facts.reason}.${lead} الإجراء المطلوب: ${facts.action}${due}.` : `${prefix}${facts.name}, ${facts.reason}.${lead} Recommended action: ${facts.action}${due}.`;
  const phrases = language === "ar"
    ? { warm: "شكرًا لمتابعتك.", encouraging: "يمكنك إتمام الخطوة الآن.", empathetic: "نتفهم تغيّر الأولويات.", detailed: "هذا تنبيه داخلي للمساءلة فقط." }
    : { warm: "Thank you for keeping this moving.", encouraging: "You can complete this next step now.", empathetic: "We understand priorities can shift.", detailed: "This is an internal accountability reminder only." };
  const extras = [
    settings.personality_toggles.warm ? phrases.warm : "",
    settings.personality_toggles.encouraging ? phrases.encouraging : "",
    settings.personality_toggles.empathetic ? phrases.empathetic : "",
    !settings.personality_toggles.concise && settings.brief_length !== "SHORT" ? phrases.detailed : "",
  ].filter(Boolean);
  // max_brief_seconds is an approximate spoken-word cap (2.5 words/second).
  // The complete action is in `full`, so the cap only removes optional phrases.
  const maxWords = settings.max_brief_seconds * 2.5;
  let result = full;
  for (const phrase of extras) {
    const candidate = `${result} ${phrase}`;
    if (candidate.trim().split(/\s+/).length <= maxWords) result = candidate;
  }
  return result;
}
function employeeBriefingContext(settings: PhaseDSettings, employeeId: number) {
  const profile = settings.employee_profiles[String(employeeId)];
  return {
    language: profile?.language ?? settings.default_language,
    address: profile?.address ?? (settings.employee_address_style === "FORMAL" ? "Team member" : "Colleague"),
    formatting: profile ? { ...settings, style: profile.style } : settings,
  };
}
async function createBriefing(employeeId: number, triggerType: string, severity: string, text: string, key: string, refs: any, executor: any = db) {
  const [row] = await executor.insert(kayInternalBriefings).values({ employeeId, triggerType, severity, text, idempotencyKey: key, deepLink: refs.missionId ? `/admin/kay/my-sales?mission=${refs.missionId}` : "/admin/kay/my-sales", ...refs }).onConflictDoNothing().returning();
  return !!row;
}
class PhaseDLeaseLostError extends Error {
  constructor() { super("Phase D evaluator lease ownership was lost."); }
}
async function fencedEvaluatorWrite<T>(token: string, write: (tx: any) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    const [lease] = await tx.select({ value: kaySettings.value }).from(kaySettings)
      .where(eq(kaySettings.key, "phase_d_evaluator_lease")).for("update").limit(1);
    const value: any = lease?.value;
    const expiry = typeof value?.locked_until === "string" ? Date.parse(value.locked_until) : NaN;
    if (value?.token !== token || !Number.isFinite(expiry) || expiry <= Date.now()) throw new PhaseDLeaseLostError();
    return write(tx);
  });
}
async function createManagerReviewWith(executor: any, reason: string, fields: any, key: string) {
  const [row] = await executor.insert(kayManagerReviews).values({ ...fields, reason, idempotencyKey: key, details: { internalOnly: true } }).onConflictDoNothing().returning();
  return row ?? (await executor.select().from(kayManagerReviews).where(eq(kayManagerReviews.idempotencyKey, key)).limit(1))[0];
}
export async function evaluatePhaseD(token: string, limit = 100) {
  const settings = await getPhaseDSettings(); if (!settings.enabled) return { checked: 0, briefings: 0, reviews: 0, disabled: true };
  const scopeConfiguration = await getKayScopeConfiguration();
  if (scopeConfiguration.status !== "OK") {
    await db.insert(kaySettings).values({ key: "phase_d_health", value: { halted: true, halted_reason: scopeConfiguration.status, last_error: new Date().toISOString() } }).onConflictDoUpdate({ target: kaySettings.key, set: { value: { halted: true, halted_reason: scopeConfiguration.status, last_error: new Date().toISOString() }, updatedAt: new Date() } });
    return { checked: 0, briefings: 0, reviews: 0, disabled: true, halted: scopeConfiguration.status };
  }
  const phaseC = await getPhaseCSettings();
  const cutoff = scopeConfiguration.config!.cutoffAt;
  const leadScope = kayScopeSql("l", "su", `'${cutoff.toISOString()}'`);
  let briefings = 0, reviews = 0;
  try {
    // Promises are retained through reconciliation; owner changes request
    // manager review instead of deletion.
    await fencedEvaluatorWrite(token, async tx => {
      // Preservation reconciliation is intentionally independent of current
      // Kay scope: existing obligations survive ownership changes and are
      // marked for human resolution, never routine automatic progression.
      await tx.execute(sql`UPDATE kay_commitments c SET status='STALE',stale_at=COALESCE(stale_at,NOW()),updated_at=NOW()
        WHERE c.status IN ('PENDING','ACCEPTED','EXTENDED','OVERDUE','ACTIVE') AND c.lead_id IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=c.lead_id AND l.assigned_to=c.employee_id)`);
      const preservedOwnerChanges = await tx.execute(sql`UPDATE kay_promises p SET owner_review_required_at=COALESCE(owner_review_required_at,NOW()),updated_at=NOW()
        WHERE p.status IN ('PENDING','DUE_SOON','OVERDUE','OPEN')
          AND NOT EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=p.lead_id AND l.assigned_to=p.employee_id) RETURNING p.*`);
      for (const p of preservedOwnerChanges.rows as any[]) {
        if (await createManagerReviewWith(tx, "PROMISE_OWNER_REVIEW_REQUIRED", { promiseId: p.id, leadId: p.lead_id, employeeId: p.employee_id }, `review:promise-owner:${p.id}`)) reviews++;
      }
      await tx.execute(sql`UPDATE kay_commitments c SET status='STALE',stale_at=NOW(),updated_at=NOW()
         WHERE c.status IN ('PENDING','ACCEPTED','EXTENDED','OVERDUE','ACTIVE') AND c.lead_id IS NOT NULL AND EXISTS(SELECT 1 FROM crm_leads l JOIN users su ON su.id=l.assigned_to WHERE l.id=c.lead_id AND l.assigned_to=c.employee_id AND ${sql.raw(leadScope.ownerEligible)} AND ${sql.raw(leadScope.inScope)}) AND (NOT EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=c.lead_id AND l.assigned_to=c.employee_id)
          OR EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=c.lead_id AND l.status IN ('converted','lost','purchased','sold_by_kinglike_luxury','lost_competition','not_qualified','junk_lead')))`);
      const ownerChanged = await tx.execute(sql`UPDATE kay_promises p SET owner_review_required_at=COALESCE(owner_review_required_at,NOW()),updated_at=NOW()
         WHERE p.status IN ('PENDING','DUE_SOON','OVERDUE','OPEN') AND EXISTS(SELECT 1 FROM crm_leads l JOIN users su ON su.id=l.assigned_to WHERE l.id=p.lead_id AND l.assigned_to=p.employee_id AND ${sql.raw(leadScope.ownerEligible)} AND ${sql.raw(leadScope.inScope)}) AND (NOT EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=p.lead_id AND l.assigned_to=p.employee_id)
          OR EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=p.lead_id AND l.status IN ('converted','lost','purchased','sold_by_kinglike_luxury','lost_competition','not_qualified','junk_lead'))) RETURNING p.*`);
      for (const p of ownerChanged.rows as any[]) {
        if (await createManagerReviewWith(tx, "PROMISE_OWNER_REVIEW_REQUIRED", { promiseId: p.id, leadId: p.lead_id, employeeId: p.employee_id }, `review:promise-owner:${p.id}`)) reviews++;
      }
       await tx.execute(sql`UPDATE kay_commitments c SET status='OVERDUE',updated_at=NOW() WHERE status IN ('PENDING','ACCEPTED','EXTENDED','ACTIVE') AND due_at<NOW() AND EXISTS(SELECT 1 FROM crm_leads l JOIN users su ON su.id=l.assigned_to WHERE l.id=c.lead_id AND l.assigned_to=c.employee_id AND ${sql.raw(leadScope.ownerEligible)} AND ${sql.raw(leadScope.ownerEligible)} AND ${sql.raw(leadScope.inScope)})`);
       await tx.execute(sql`UPDATE kay_promises p SET status=CASE WHEN due_at<NOW() THEN 'OVERDUE' ELSE 'DUE_SOON' END,updated_at=NOW() WHERE status IN ('PENDING','OPEN') AND due_at<=NOW()+(${settings.reminder_minutes} * interval '1 minute') AND EXISTS(SELECT 1 FROM crm_leads l JOIN users su ON su.id=l.assigned_to WHERE l.id=p.lead_id AND l.assigned_to=p.employee_id AND ${sql.raw(leadScope.ownerEligible)} AND ${sql.raw(leadScope.ownerEligible)} AND ${sql.raw(leadScope.inScope)})`);
    });
  const overdueCommitments = await db.select().from(kayCommitments).where(and(eq(kayCommitments.status, "OVERDUE"), sql`${kayCommitments.dueAt} < NOW()`)).limit(limit);
  for (const c of overdueCommitments) {
    if (c.leadId && (await getKayScopeForLead(pool, c.leadId)).outcome !== "IN_KAY_SCOPE") continue;
    if (!settings.trigger_types.includes("COMMITMENT_OVERDUE") || (c.lastReminderAt && Date.now() - c.lastReminderAt.getTime() < settings.reminder_minutes * 60_000)) continue;
    const availability = await getKayAvailability(c.employeeId); if (availability.availability !== "AVAILABLE" || isKayQuietHours(phaseC, new Date())) continue;
    const key = `commitment-overdue:${c.id}:v${c.reminderVersion + 1}`;
    const context = employeeBriefingContext(settings, c.employeeId);
    await fencedEvaluatorWrite(token, async tx => {
      const sent = await createBriefing(c.employeeId, "COMMITMENT_OVERDUE", "HIGH", formatBriefing({ name: context.address, reason: "an internal commitment is overdue", action: "complete it or request time", dueAt: c.dueAt }, context.language, context.formatting), key, { commitmentId: c.id, leadId: c.leadId }, tx);
      if (sent) { briefings++; await tx.update(kayCommitments).set({ reminderVersion: c.reminderVersion + 1, lastReminderAt: new Date(), updatedAt: new Date() }).where(and(eq(kayCommitments.id, c.id), eq(kayCommitments.reminderVersion, c.reminderVersion))); }
      if (c.extensionCount >= c.maxExtensions && await createManagerReviewWith(tx, "COMMITMENT_EXTENSIONS_EXHAUSTED", { commitmentId: c.id, leadId: c.leadId, employeeId: c.employeeId }, `review:commitment:${c.id}`)) reviews++;
    });
  }
  const promises = await db.select().from(kayPromises).where(and(eq(kayPromises.status, "OVERDUE"), eq(kayPromises.importance, "IMPORTANT"), sql`${kayPromises.dueAt} < NOW()`)).limit(limit);
  for (const p of promises) {
    if ((await getKayScopeForLead(pool, p.leadId)).outcome !== "IN_KAY_SCOPE") continue;
    if (!settings.trigger_types.includes("IMPORTANT_PROMISE_OVERDUE") || (p.lastReminderAt && Date.now() - p.lastReminderAt.getTime() < settings.promise_escalation_minutes * 60_000)) continue;
    const availability = await getKayAvailability(p.employeeId); if (availability.availability !== "AVAILABLE" || isKayQuietHours(phaseC, new Date())) continue;
    const key = `important-promise-overdue:${p.id}:v${p.reminderVersion + 1}`;
    const context = employeeBriefingContext(settings, p.employeeId);
    await fencedEvaluatorWrite(token, async tx => {
      const sent = await createBriefing(p.employeeId, "IMPORTANT_PROMISE_OVERDUE", "HIGH", formatBriefing({ name: context.address, reason: "an important customer promise is overdue", action: "review and complete the promise", dueAt: p.dueAt }, context.language, context.formatting), key, { promiseId: p.id, leadId: p.leadId }, tx);
      if (sent) { briefings++; await tx.update(kayPromises).set({ reminderVersion: p.reminderVersion + 1, lastReminderAt: new Date(), updatedAt: new Date() }).where(and(eq(kayPromises.id, p.id), eq(kayPromises.reminderVersion, p.reminderVersion))); }
      if (await createManagerReviewWith(tx, "IMPORTANT_PROMISE_OVERDUE", { promiseId: p.id, leadId: p.leadId, employeeId: p.employeeId }, `review:promise:${p.id}`)) reviews++;
    });
  }
  if (settings.trigger_types.includes("CRITICAL_MISSION")) {
    const critical = await db.select().from(kayMissions).where(and(inArray(kayMissions.status, activeMission), eq(kayMissions.priority, "CRITICAL"))).limit(limit);
    for (const mission of critical) {
      if (mission.leadId && (await getKayScopeForLead(pool, mission.leadId)).outcome !== "IN_KAY_SCOPE") continue;
      const availability = await getKayAvailability(mission.employeeId!);
      if (availability.availability !== "AVAILABLE" || (isKayQuietHours(phaseC, new Date()) && !settings.critical_bypass_quiet_hours)) continue;
      const context = employeeBriefingContext(settings, mission.employeeId!);
      await fencedEvaluatorWrite(token, async tx => { if (await createBriefing(mission.employeeId!, "CRITICAL_MISSION", "CRITICAL", formatBriefing({ name: context.address, reason: "a critical internal mission needs attention", action: mission.suggestedAction, dueAt: mission.dueAt }, context.language, context.formatting), `critical-mission:${mission.id}`, { missionId: mission.id, leadId: mission.leadId }, tx)) briefings++; });
    }
  }
  if (settings.trigger_types.includes("MANAGER_REVIEW")) {
    const openReviews = await db.select().from(kayManagerReviews).where(eq(kayManagerReviews.status, "OPEN")).limit(limit);
    for (const review of openReviews) if (review.employeeId && (await getKayAvailability(review.employeeId)).availability === "AVAILABLE" && !isKayQuietHours(phaseC, new Date())) {
      const context = employeeBriefingContext(settings, review.employeeId);
      await fencedEvaluatorWrite(token, async tx => { if (await createBriefing(review.employeeId!, "MANAGER_REVIEW", "HIGH", formatBriefing({ name: context.address, reason: "a manager review is open", action: "review the manager request" }, context.language, context.formatting), `manager-review:${review.id}`, { missionId: review.missionId, commitmentId: review.commitmentId, promiseId: review.promiseId, leadId: review.leadId }, tx)) briefings++; });
    }
  }
  return { checked: overdueCommitments.length + promises.length, briefings, reviews, disabled: false };
  } catch (error) {
    if (error instanceof PhaseDLeaseLostError) return { checked: 0, briefings, reviews, disabled: false, aborted: "lease_lost" };
    throw error;
  }
}
export async function getOwnerBrief() {
  const settings = await getPhaseDSettings();
  const result = await db.execute(sql`SELECT
    (SELECT count(*)::int FROM kay_missions WHERE status IN ('NEW','ACCEPTED','IN_PROGRESS') AND priority='CRITICAL') critical_missions,
    (SELECT count(*)::int FROM kay_manager_reviews WHERE status='OPEN') manager_reviews,
    (SELECT count(*)::int FROM kay_promises WHERE status='OVERDUE' OR (status IN ('PENDING','DUE_SOON','OPEN') AND due_at<NOW())) overdue_promises,
    (SELECT count(*)::int FROM kay_promises WHERE status='DUE_SOON' OR (status IN ('PENDING','OPEN') AND due_at BETWEEN NOW() AND NOW()+interval '5 minutes')) due_soon_promises,
    (SELECT count(*)::int FROM kay_commitments WHERE status='OVERDUE' OR (status IN ('PENDING','ACCEPTED','EXTENDED','ACTIVE') AND due_at<NOW())) overdue_commitments,
    (SELECT count(*)::int FROM kay_commitments WHERE status IN ('PENDING','ACCEPTED','EXTENDED','ACTIVE')) active_commitments`);
  const facts: any = result.rows[0]; return { ...facts, text: `${settings.owner_address}: ${facts.critical_missions} critical missions, ${facts.overdue_promises} overdue promises, ${facts.overdue_commitments} overdue commitments, and ${facts.manager_reviews} open manager reviews.` };
}
export async function resolveManagerReview(id: number, actorId: number, note: string) {
  const [row] = await db.update(kayManagerReviews).set({ status: "RESOLVED", resolutionNote: note, resolvedBy: actorId, resolvedAt: new Date(), updatedAt: new Date() }).where(and(eq(kayManagerReviews.id, id), eq(kayManagerReviews.status, "OPEN"))).returning();
  if (!row) { const e: any = new Error("Open manager review not found."); e.status = 404; throw e; }
  await db.insert(kayEvents).values({ userId: actorId, leadId: row.leadId, employeeId: row.employeeId, eventType: "manager_review_resolved", eventSource: "admin", metadata: { reviewId: id, internalOnly: true }, kayGenerated: false });
  return row;
}
export async function acquirePhaseDLease() {
  const token = `${process.pid}:${Date.now()}:${Math.random()}`; await db.insert(kaySettings).values({ key: "phase_d_evaluator_lease", value: { released: true } }).onConflictDoNothing();
  const rows = await db.update(kaySettings).set({ value: { token, locked_until: new Date(Date.now() + 10 * 60_000).toISOString() }, updatedAt: new Date() }).where(and(eq(kaySettings.key, "phase_d_evaluator_lease"), sql`CASE WHEN (${kaySettings.value}->>'locked_until') ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$' THEN (${kaySettings.value}->>'locked_until')::timestamptz ELSE to_timestamp(0) END < NOW()`)).returning(); return rows[0] ? token : null;
}
export async function renewPhaseDLease(token: string): Promise<boolean> {
  const rows = await db.update(kaySettings).set({ value: { token, locked_until: new Date(Date.now() + 10 * 60_000).toISOString() }, updatedAt: new Date() }).where(and(eq(kaySettings.key, "phase_d_evaluator_lease"), sql`${kaySettings.value}->>'token'=${token}`)).returning();
  return rows.length === 1;
}
export async function releasePhaseDLease(token: string): Promise<boolean> {
  const rows = await db.update(kaySettings).set({ value: { released: true, released_at: new Date().toISOString() }, updatedAt: new Date() }).where(and(eq(kaySettings.key, "phase_d_evaluator_lease"), sql`${kaySettings.value}->>'token'=${token}`)).returning();
  return rows.length === 1;
}
export async function ownsPhaseDLease(token: string): Promise<boolean> {
  const [row] = await db.select({ value: kaySettings.value }).from(kaySettings).where(eq(kaySettings.key, "phase_d_evaluator_lease")).limit(1);
  return (row?.value as any)?.token === token;
}
export async function runPhaseDEvaluator() {
  const token = await acquirePhaseDLease(); if (!token) return { skipped: "lease_busy" };
  let leaseLost = false;
  const heartbeat = setInterval(() => { void renewPhaseDLease(token).then(ok => { if (!ok) leaseLost = true; }).catch(() => { leaseLost = true; }); }, 2 * 60_000); heartbeat.unref();
  const assertLease = async () => !leaseLost && await ownsPhaseDLease(token);
  try {
    const result = await evaluatePhaseD(token, 100);
    if ((result as any).halted) return result;
    if ((result as any).aborted || !(await assertLease())) return { ...result, aborted: "lease_lost" };
    const now = new Date().toISOString();
    await fencedEvaluatorWrite(token, async tx => {
      await tx.insert(kaySettings).values({ key: "phase_d_health", value: { last_successful_cycle: now, next_expected_run: new Date(Date.now() + (await getPhaseDSettings()).evaluation_interval_minutes * 60_000).toISOString(), errors: 0, degraded: false, lease_token: token, ...result } }).onConflictDoUpdate({ target: kaySettings.key, set: { value: { last_successful_cycle: now, errors: 0, degraded: false, lease_token: token, ...result }, updatedAt: new Date() } });
    });
    return result;
  }
  catch (error) {
    if (error instanceof PhaseDLeaseLostError || !(await assertLease())) return { aborted: "lease_lost" };
    await fencedEvaluatorWrite(token, async tx => {
      await tx.insert(kaySettings).values({ key: "phase_d_health", value: { last_error: new Date().toISOString(), lease_token: token } }).onConflictDoUpdate({ target: kaySettings.key, set: { value: { last_error: new Date().toISOString(), lease_token: token }, updatedAt: new Date() } });
    });
    throw error;
  }
  finally { clearInterval(heartbeat); await releasePhaseDLease(token); }
}
/** Best-effort internal worker. It is disabled by default and never blocks boot. */
export function startPhaseDEvaluator(): void {
  const cycle = async () => {
    try {
      const settings = await getPhaseDSettings();
       if (settings.enabled) {
         const result: any = await runPhaseDEvaluator();
         if (result?.halted) return;
       }
      const delay = (await getPhaseDSettings()).evaluation_interval_minutes * 60_000;
      const timer = setTimeout(cycle, delay); timer.unref();
    } catch {
      // Failure isolation: persist health in runPhaseDEvaluator and retry later.
      const timer = setTimeout(cycle, 5 * 60_000); timer.unref();
    }
  };
  const timer = setTimeout(cycle, 15_000); timer.unref();
}