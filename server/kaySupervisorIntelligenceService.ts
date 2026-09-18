import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";
import { withKayInternalClient } from "./kayInternalDatabase";

export const KAY_SUPERVISION_TIME_ZONE = "Europe/Istanbul";
export const KAY_CALL_WINDOW_START = 16 * 60;
export const KAY_CALL_WINDOW_END = 21 * 60;
export const KAY_VOICE_SERVICE_URL = () => process.env.KAY_VOICE_SERVICE_URL || null;
export const KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED = () =>
  process.env.KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED === "true";

export async function getMeaningfulEmployeeActionItems(employeeId: number) {
  const snapshot = await getSupervisorSnapshot(employeeId);
  return snapshot.employees[0]?.meaningfulActionItems === true;
}

export type FollowUpConfidence = "EXACT" | "HIGH_CONFIDENCE" | "APPROXIMATE" | "AMBIGUOUS";
export type VisitorTiming = "TODAY" | "WITHIN_72H" | "WITHIN_7_DAYS" | "LATER_THIS_MONTH" | "APPROXIMATE_THIS_MONTH";
export type TaskClassification = "OVERDUE" | "DUE_TODAY" | "DUE_TOMORROW" | "UPCOMING" | "COMPLETED";

function zonedParts(value: Date, timeZone = KAY_SUPERVISION_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function dayKey(value: Date, timeZone = KAY_SUPERVISION_TIME_ZONE) {
  const p = zonedParts(value, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function isKayCallWindow(value: Date): boolean {
  const p = zonedParts(value);
  const minutes = p.hour * 60 + p.minute;
  return minutes >= KAY_CALL_WINDOW_START && minutes < KAY_CALL_WINDOW_END;
}

export function assertKayCallWindow(value: Date): void {
  if (!isKayCallWindow(value)) {
    const error = Object.assign(new Error("KAY_CALL_WINDOW_CLOSED"), { status: 423, code: "KAY_CALL_WINDOW_CLOSED" });
    throw error;
  }
}

export function isDailyBriefDue(value: Date): boolean {
  const p = zonedParts(value);
  return p.hour === 12 && p.minute === 0;
}

export function classifyTask(task: { dueAt?: Date | string | null; completedAt?: Date | string | null }, now: Date): TaskClassification {
  if (task.completedAt) return "COMPLETED";
  if (!task.dueAt) return "UPCOMING";
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return "UPCOMING";
  const current = dayKey(now), dueDay = dayKey(due);
  if (dueDay < current) return "OVERDUE";
  if (dueDay === current) return "DUE_TODAY";
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (dueDay === dayKey(tomorrow)) return "DUE_TOMORROW";
  return "UPCOMING";
}

function monthKey(value: Date) {
  const p = zonedParts(value);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function classifyVisitorTiming(input: {
  expectedPurchaseMonth?: string | null;
  timeline?: string | null;
  visitDate?: Date | string | null;
}, now: Date): { timing: VisitorTiming; date?: string; source: string } | null {
  const currentMonth = monthKey(now);
  let date: Date | null = input.visitDate ? new Date(input.visitDate) : null;
  if (date && Number.isNaN(date.getTime())) date = null;
  if (date && (monthKey(date) !== currentMonth || date.getTime() < now.getTime())) return null;
  if (date) {
    const delta = date.getTime() - now.getTime();
    const timing: VisitorTiming = dayKey(date) === dayKey(now) ? "TODAY"
      : delta <= 72 * 60 * 60 * 1000 ? "WITHIN_72H"
      : delta <= 7 * 24 * 60 * 60 * 1000 ? "WITHIN_7_DAYS"
      : "LATER_THIS_MONTH";
    return { timing, date: date.toISOString(), source: "visitDate" };
  }
  const text = `${input.expectedPurchaseMonth || ""} ${input.timeline || ""}`.toLowerCase();
  const monthNames = ["ar", "en"].map(locale =>
    new Intl.DateTimeFormat(locale, { timeZone: KAY_SUPERVISION_TIME_ZONE, month: "long" }).format(now).toLowerCase()
  );
  const monthNumber = String(zonedParts(now).month).padStart(2, "0");
  const year = String(zonedParts(now).year);
  const explicitMonth = new RegExp(`(^|\\D)${monthNumber}[\\/-]${year}(\\D|$)|(^|\\D)${year}[\\/-]${monthNumber}(\\D|$)`);
  if (!text || (!text.includes(currentMonth) && !explicitMonth.test(text) && !monthNames.some(name => text.includes(name)))) return null;
  return { timing: "APPROXIMATE_THIS_MONTH", source: input.expectedPurchaseMonth ? "expectedPurchaseMonth" : "timeline" };
}

function normalizedArabic(value: string) {
  return value.replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();
}

export function isExplicitCompletionNote(value: string): boolean {
  const text = normalizedArabic(value);
  if (/(لم|لن|ما)\s+(?:يتم|تتم|تم|تكتمل|يكتمل|نتمكن)/.test(text)) return false;
  return ["تمت المتابعه", "تم التواصل", "اكتملت المتابعه", "اكتمل التواصل"]
    .some(phrase => text.includes(phrase));
}

export function parseArabicFollowUp(note: { id?: number; leadId?: number; note: string; createdAt: Date | string }, now: Date) {
  const text = normalizedArabic(note.note);
  const sourceTimestamp = new Date(note.createdAt).toISOString();
  const base = { sourceNoteId: note.id ?? null, sourceTimestamp, leadId: note.leadId ?? null, text: note.note };
  const hasFollowUpIntent = /(اتصل|تابع|متابع|تواصل|رجعلي|موعدنا|جاي|زياره|مقابله)/.test(text);
  if (!hasFollowUpIntent) return null;
  const explicit = text.match(/(?:موعدنا|بتاريخ|يوم)\s+(\d{1,2})\/(\d{1,2})(?:\s+(?:الساعة|الساعه|ساعه)\s+(\d{1,2})(?::(\d{2}))?\s*(صباحا|مساء)?)?/);
  if (explicit) {
    const day = Number(explicit[1]), month = Number(explicit[2]);
    let hour = Number(explicit[3] || 9);
    const minute = Number(explicit[4] || 0);
    const period = explicit[5];
    if (explicit[3] && hour <= 7 && !period) {
      return { ...base, confidence: "AMBIGUOUS" as const, dueAt: null, action: "CLARIFICATION_REQUIRED" };
    }
    if (period === "مساء" && hour < 12) hour += 12;
    if (period === "صباحا" && hour === 12) hour = 0;
    const year = zonedParts(now).year;
    const dueAt = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`);
    const roundTrip = Number.isNaN(dueAt.getTime()) ? null : zonedParts(dueAt);
    if (!roundTrip || roundTrip.year !== year || roundTrip.month !== month || roundTrip.day !== day ||
        roundTrip.hour !== hour || roundTrip.minute !== minute) {
      return { ...base, confidence: "AMBIGUOUS" as const, dueAt: null, action: "CLARIFICATION_REQUIRED" };
    }
    return { ...base, confidence: "EXACT" as const, dueAt, action: "FOLLOW_UP" };
  }
  if (/(غدا|بكرا|بكره)/.test(text)) return { ...base, confidence: "HIGH_CONFIDENCE" as const, dueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), action: "FOLLOW_UP" };
  const after = text.match(/بعد\s+يومين/);
  if (after) return { ...base, confidence: "HIGH_CONFIDENCE" as const, dueAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), action: "FOLLOW_UP" };
  const weekdays: Record<string, number> = { "الاحد": 0, "الاثنين": 1, "الثلاثاء": 2, "الاربعاء": 3, "الخميس": 4, "الجمعه": 5, "السبت": 6 };
  const weekday = Object.entries(weekdays).find(([name]) => text.includes(name));
  if (weekday) {
    const currentDay = zonedParts(now).day;
    const currentDate = new Date(`${zonedParts(now).year}-${String(zonedParts(now).month).padStart(2, "0")}-${String(currentDay).padStart(2, "0")}T09:00:00+03:00`);
    const delta = (weekday[1] - currentDate.getUTCDay() + 7) % 7 || 7;
    return { ...base, confidence: "HIGH_CONFIDENCE" as const, dueAt: new Date(currentDate.getTime() + delta * 86400000), action: "FOLLOW_UP" };
  }
  if (/(الاسبوع الجاي|آخر الشهر|اخر الشهر)/.test(text)) return { ...base, confidence: "APPROXIMATE" as const, dueAt: null, action: "FOLLOW_UP" };
  if (/(اتصل|اتصل فيه|اتصل به|رجعلي|موعدنا|جاي)/.test(text)) return { ...base, confidence: "AMBIGUOUS" as const, dueAt: null, action: "CLARIFICATION_REQUIRED" };
  return null;
}

export function applyNewerNoteOverride(task: { id: number; createdAt: Date | string }, note: { id?: number; createdAt: Date | string }, followUp: { dueAt: Date | null }) {
  const taskDate = new Date(task.createdAt).getTime();
  const noteDate = new Date(note.createdAt).getTime();
  return noteDate > taskDate ? {
    dueAt: followUp.dueAt,
    sourceTaskId: task.id,
    sourceNoteId: note.id ?? null,
    sourceTimestamp: new Date(note.createdAt).toISOString(),
    internalOnly: true,
  } : null;
}

export function buildHumanCallBrief(input: {
  employeeName: string;
  topPriorities: string[];
  questions?: string[];
  commitmentFollowups?: string[];
}) {
  return {
    opening: `مساء الخير ${input.employeeName}، مناسب نحكي دقيقتين؟`,
    topPriorities: input.topPriorities.slice(0, 7),
    questions: (input.questions || []).slice(0, 5),
    commitmentFollowups: (input.commitmentFollowups || []).slice(0, 5),
    closing: "خلينا نثبت الخطوة التالية والموعد بوضوح.",
  };
}

export function callAntiSpamDecision(input: {
  now: Date;
  sessions: Array<{ status: string; reasonCode: string; createdAt: Date | string }>;
  meaningfulActionItems: boolean;
  materiallyOverdueSameDayCommitment?: boolean;
  reasonCode: string;
}) {
  if (!input.meaningfulActionItems) return { allowed: false, reason: "NO_MEANINGFUL_ACTION_ITEMS" };
  const reasonCode = input.reasonCode.trim().toUpperCase();
  const sameDay = input.sessions
    .filter(session => dayKey(new Date(session.createdAt)) === dayKey(input.now))
    .map(session => ({ ...session, reasonCode: session.reasonCode.trim().toUpperCase() }));
  const rejected = sameDay.filter(session => session.status === "REJECTED" && session.reasonCode === reasonCode);
  if (sameDay.some(session => session.reasonCode === reasonCode && session.status !== "REJECTED")) {
    return { allowed: false, reason: "DUPLICATE_REASON" };
  }
  if (rejected.length >= 2) return { allowed: false, reason: "REJECT_RETRY_LIMIT" };
  const followUpCall = reasonCode === "OVERDUE_SAME_DAY_COMMITMENT";
  if (followUpCall) {
    if (!input.materiallyOverdueSameDayCommitment) return { allowed: false, reason: "NO_MATERIAL_OVERDUE_COMMITMENT" };
    const followUps = sameDay.filter(session => session.reasonCode === "OVERDUE_SAME_DAY_COMMITMENT");
    if (followUps.length > 0 && !(followUps.length === 1 && rejected.length === 1)) {
      return { allowed: false, reason: "FOLLOW_UP_LIMIT" };
    }
  } else {
    const normal = sameDay.filter(session => session.reasonCode !== "OVERDUE_SAME_DAY_COMMITMENT");
    const exactRejectedRetry = normal.length === 1 && rejected.length === 1;
    if (normal.length >= 1 && !exactRejectedRetry) return { allowed: false, reason: "DAILY_NORMAL_LIMIT" };
  }
  return { allowed: true, reason: "ALLOWED" };
}

export function rescueRecommendation(leadName: string) {
  return `إذا ظل ${leadName} بدون تجاوب، رح أرفع للإدارة توصية بإعادة توزيعه لزميل آخر حتى نضمن الوصول للعميل.`;
}

export interface KayTextToSpeechProvider { speak(text: string, language?: string): Promise<void>; }
export interface KaySpeechToTextProvider { transcribe(audio: ArrayBuffer, language?: string): Promise<string>; }
export interface KayConversationProvider { summarize(input: string): Promise<string>; }
export type ConversationMatchState = "NO_MATCH" | "EXACT_ONE_MATCH" | "MULTIPLE_MATCHES" | "INVALID_PHONE";
export interface KayConversationEvidenceProvider {
  check(phone: string): Promise<{ providerAvailable: boolean; conversationExists: boolean; lastIncomingAt: string | null; lastOutgoingAt: string | null; employeeSentMessage: boolean; customerReplied: boolean; normalizedPhoneMatchStatus: ConversationMatchState }>;
}
export const unavailableConversationEvidenceProvider: KayConversationEvidenceProvider = {
  async check() {
    return { providerAvailable: false, conversationExists: false, lastIncomingAt: null, lastOutgoingAt: null, employeeSentMessage: false, customerReplied: false, normalizedPhoneMatchStatus: "NO_MATCH" };
  },
};

export function evidenceRecheckResult(input: { currentOwnerId: number | null; leadStatus: string; openTasks: number; matchingNotes: number; commitmentStatus: string; whatsappMatch: ConversationMatchState; explicitCompletionEvidence?: boolean }) {
  if (input.whatsappMatch === "MULTIPLE_MATCHES") return { outcome: "ASK_EMPLOYEE", reason: "MULTIPLE_MATCHES" };
  if (input.currentOwnerId === null) return { outcome: "ASK_EMPLOYEE", reason: "OWNER_UNASSIGNED" };
  if (input.commitmentStatus === "COMPLETED" || input.explicitCompletionEvidence ||
      ["CLOSED", "WON", "LOST", "CONVERTED"].includes(input.leadStatus.toUpperCase())) {
    return { outcome: "RESOLVE_INTERNAL_REMINDER", reason: "EXPLICIT_COMPLETION_EVIDENCE" };
  }
  if (input.whatsappMatch === "NO_MATCH" && input.matchingNotes === 0) return { outcome: "ASK_EMPLOYEE", reason: "EVIDENCE_UNCLEAR" };
  return { outcome: "KEEP_INTERNAL_REMINDER", reason: "EVIDENCE_PENDING" };
}

export async function recheckCommitmentEvidence(
  commitmentId: number,
  conversationEvidence: KayConversationEvidenceProvider = unavailableConversationEvidenceProvider,
) {
  const kay = await withKayInternalClient(client => client.query(
    `SELECT id,lead_id,employee_id,action,status,created_at FROM kay_commitments WHERE id=$1 LIMIT 1`, [commitmentId],
  ));
  const commitment = kay.rows[0];
  if (!commitment) return { outcome: "ASK_EMPLOYEE", reason: "COMMITMENT_NOT_FOUND" };
  const evidence = await withKayReadonlyAnalysis(async client => {
    const result = await client.query(`SELECT l.assigned_to,l.status,l.phone,
      (SELECT count(*)::int FROM crm_tasks t WHERE t.lead_id=$1 AND t.completed_at IS NULL) open_tasks,
      EXISTS(SELECT 1 FROM crm_tasks t WHERE t.lead_id=$1 AND t.completed_at IS NOT NULL
        AND t.completed_at >= $2
        AND (t.title ILIKE ('%' || replace($3,'_',' ') || '%')
          OR ($3='FOLLOW_UP' AND (t.title ILIKE '%follow%' OR t.title ILIKE '%متابع%' OR t.title ILIKE '%اتصل%')))) completed_task
      FROM crm_leads l WHERE l.id=$1 LIMIT 1`, [commitment.lead_id, commitment.created_at, commitment.action]);
    if (!result.rows[0]) return null;
    const notes = await client.query(
      `SELECT note FROM crm_notes WHERE lead_id=$1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 50`,
      [commitment.lead_id, commitment.created_at],
    );
    return { ...result.rows[0], completionNotes: notes.rows.map(row => String(row.note)) };
  });
  if (!evidence) return { outcome: "ASK_EMPLOYEE", reason: "COMMITMENT_NOT_FOUND" };
  if (Number(evidence.assigned_to) !== Number(commitment.employee_id)) {
    return { outcome: "ASK_EMPLOYEE", reason: "OWNER_CHANGED" };
  }
  const whatsapp = evidence.phone
    ? await conversationEvidence.check(String(evidence.phone))
    : await unavailableConversationEvidenceProvider.check("");
  const decision = evidenceRecheckResult({
    currentOwnerId: Number(evidence.assigned_to),
    leadStatus: String(evidence.status),
    openTasks: Number(evidence.open_tasks),
    matchingNotes: evidence.completionNotes.filter(isExplicitCompletionNote).length,
    commitmentStatus: String(commitment.status),
    whatsappMatch: whatsapp.normalizedPhoneMatchStatus,
    explicitCompletionEvidence: evidence.completed_task || evidence.completionNotes.some(isExplicitCompletionNote),
  });
  if (decision.outcome !== "RESOLVE_INTERNAL_REMINDER") return decision;
  if (String(commitment.status) === "COMPLETED") return decision;
  const updated = await withKayInternalClient(client => client.query(
    `UPDATE kay_commitments SET status='COMPLETED',completed_at=NOW(),updated_at=NOW() WHERE id=$1 AND employee_id=$2 AND status<> 'COMPLETED' RETURNING *`,
    [commitmentId, commitment.employee_id],
  ));
  return { ...decision, updated: updated.rows[0] || null };
}

export function createCallCommitmentPayload(input: { employeeId: number; leadRef?: number | null; actionType: string; dueAt: Date; sourceCallSessionId: number }) {
  const leadRef = input.leadRef ?? null;
  return {
    employeeId: input.employeeId, leadId: leadRef, action: input.actionType,
    dueAt: input.dueAt, status: "PENDING", details: { internalOnly: true, sourceCallSessionId: input.sourceCallSessionId },
    idempotencyKey: `call:${input.sourceCallSessionId}:${input.employeeId}:${leadRef ?? "none"}:${input.actionType}:${input.dueAt.toISOString()}`,
  };
}

export async function writeCallCommitment(input: Parameters<typeof createCallCommitmentPayload>[0]) {
  const payload = createCallCommitmentPayload(input);
  return withKayInternalClient(client => client.query(
    `INSERT INTO kay_commitments (lead_id,employee_id,action,status,due_at,idempotency_key,details)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [payload.leadId, payload.employeeId, payload.action, payload.status, payload.dueAt, payload.idempotencyKey, JSON.stringify(payload.details)],
  ));
}

export async function createCommitmentFromCallOutcome(input: Parameters<typeof createCallCommitmentPayload>[0]) {
  const verified = await withKayInternalClient(client => client.query(
    `SELECT id,target_user_id,status,answered_at FROM kay_internal_call_sessions WHERE id=$1 LIMIT 1`,
    [input.sourceCallSessionId],
  ));
  const call = verified.rows[0];
  if (!call) throw Object.assign(new Error("CALL_SESSION_NOT_FOUND"), { status: 404 });
  if (Number(call.target_user_id) !== input.employeeId) throw Object.assign(new Error("CALL_TARGET_EMPLOYEE_MISMATCH"), { status: 409 });
  if (String(call.status) !== "ACTIVE" && !(String(call.status) === "ENDED" && call.answered_at)) {
    throw Object.assign(new Error("CALL_OUTCOME_NOT_CONNECTED"), { status: 409 });
  }
  if (input.leadRef) {
    const ownership = await withKayReadonlyAnalysis(client => client.query(
      `SELECT id FROM crm_leads WHERE id=$1 AND assigned_to=$2 LIMIT 1`,
      [input.leadRef, input.employeeId],
    ));
    if (!ownership.rows[0]) throw Object.assign(new Error("CALL_COMMITMENT_LEAD_NOT_OWNED"), { status: 409 });
  }
  return writeCallCommitment(input);
}

export async function getSupervisorSnapshot(employeeId?: number, now = new Date()) {
  const employees = await withKayReadonlyAnalysis(client => client.query(
    `SELECT id,username FROM users WHERE is_active=true AND is_admin=false AND role='sub_agent' ${employeeId ? "AND id=$1" : ""} ORDER BY id`,
    employeeId ? [employeeId] : [],
  ));
  const rows = await Promise.all(employees.rows.map(async employee => {
    const [tasks, visitors, notes, commitments, leads, promises, noAnswerLeads, callHistory, dailyBrief] = await Promise.all([
      withKayReadonlyAnalysis(client => client.query(
        `SELECT t.id,t.lead_id,t.due_date,t.due_time,t.completed_at,t.created_at,t.title,
                l.full_name,l.last_contact_at
           FROM crm_tasks t JOIN crm_leads l ON l.id=t.lead_id
          WHERE l.assigned_to=$1 ORDER BY t.due_date NULLS LAST LIMIT 100`, [employee.id],
      )),
      withKayReadonlyAnalysis(client => client.query(
        `SELECT id,full_name,expected_purchase_month,description FROM crm_leads
          WHERE assigned_to=$1 AND (expected_purchase_month IS NOT NULL OR description IS NOT NULL)
          ORDER BY updated_at DESC LIMIT 100`, [employee.id],
      )),
      withKayReadonlyAnalysis(client => client.query(
        `SELECT n.id,n.lead_id,n.note,n.created_at FROM crm_notes n JOIN crm_leads l ON l.id=n.lead_id WHERE l.assigned_to=$1 ORDER BY n.created_at DESC LIMIT 100`, [employee.id],
      )),
      withKayInternalClient(client => client.query(
        `SELECT id,action,status,due_at FROM kay_commitments WHERE employee_id=$1 ORDER BY due_at LIMIT 100`, [employee.id],
      )),
      withKayReadonlyAnalysis(client => client.query(
        `SELECT id,full_name,status,created_at,business_received_at,last_contact_at FROM crm_leads WHERE assigned_to=$1
         AND COALESCE(business_received_at,created_at) >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul'
         ORDER BY COALESCE(business_received_at,created_at) DESC LIMIT 100`, [employee.id],
      )),
      withKayInternalClient(client => client.query(
        `SELECT id,promise_text,status,due_at,importance FROM kay_promises WHERE employee_id=$1 ORDER BY due_at LIMIT 100`, [employee.id],
      )),
      withKayReadonlyAnalysis(client => client.query(
        `SELECT id,full_name,status,updated_at FROM crm_leads WHERE assigned_to=$1
         AND status IN ('no_answer','no_answer_1','no_answer_2')
         AND updated_at >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul' - INTERVAL '1 day'
         AND updated_at < date_trunc('day', NOW() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul' LIMIT 100`, [employee.id],
      )),
      process.env.KAY_INTERNAL_CALLS_ENABLED === "true"
        ? withKayInternalClient(client => client.query(
            `SELECT id,status,reason_code,created_at,answered_at,ended_at
               FROM kay_internal_call_sessions WHERE target_user_id=$1
               ORDER BY created_at DESC LIMIT 20`, [employee.id],
          ))
        : Promise.resolve({ rows: [] }),
      withKayInternalClient(client => client.query(
        `SELECT EXISTS(SELECT 1 FROM kay_internal_briefings
          WHERE employee_id=$1 AND trigger_type='DAILY_BRIEF'
            AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date =
                (NOW() AT TIME ZONE 'Europe/Istanbul')::date) AS generated`,
        [employee.id],
      )),
    ]);
    const parsedNotes = notes.rows.map(note => parseArabicFollowUp({
      id: note.id,
      leadId: note.lead_id,
      note: note.note,
      createdAt: note.created_at,
    }, now)).filter(Boolean);
    const classifiedTasks = tasks.rows.map(task => {
      const dueAt = task.due_date ? `${task.due_date}${task.due_time ? `T${task.due_time}` : "T23:59"}+03:00` : null;
      const newerFollowUp = parsedNotes
        .filter((item: any) =>
          Number(item.leadId) === Number(task.lead_id) &&
          item.dueAt &&
          new Date(item.sourceTimestamp).getTime() > new Date(task.created_at).getTime()
        )
        .sort((a: any, b: any) => new Date(b.sourceTimestamp).getTime() - new Date(a.sourceTimestamp).getTime())[0] as any;
      const noteOverride = newerFollowUp
        ? applyNewerNoteOverride(
            { id: task.id, createdAt: task.created_at },
            { id: newerFollowUp.sourceNoteId, createdAt: newerFollowUp.sourceTimestamp },
            { dueAt: newerFollowUp.dueAt },
          )
        : null;
      const originalClassification = classifyTask({ dueAt, completedAt: task.completed_at }, now);
      return {
        ...task,
        originalClassification,
        classification: classifyTask({
          dueAt: noteOverride?.dueAt || dueAt,
          completedAt: task.completed_at,
        }, now),
        effectiveDueAt: noteOverride?.dueAt || dueAt,
        noteOverride,
      };
    });
    const approximateVisitors = visitors.rows
      .map(lead => ({ ...lead, timing: classifyVisitorTiming({ expectedPurchaseMonth: lead.expected_purchase_month, timeline: lead.description }, now) }))
      .filter(lead => lead.timing);
    const exactTaskVisitors = classifiedTasks
      .filter((task: any) => /(visit|appointment|زيار|معاين|مقابل)/i.test(String(task.title)))
      .map((task: any) => ({
        id: task.lead_id,
        full_name: task.full_name,
        sourceTaskId: task.id,
        timing: classifyVisitorTiming({
          visitDate: task.due_date ? `${task.due_date}${task.due_time ? `T${task.due_time}` : "T23:59"}+03:00` : null,
        }, now),
      }))
      .filter((lead: any) => lead.timing);
    const exactVisitorLeadIds = new Set(exactTaskVisitors.map((lead: any) => Number(lead.id)));
    const currentVisitors = [
      ...exactTaskVisitors,
      ...approximateVisitors.filter((lead: any) => !exactVisitorLeadIds.has(Number(lead.id))),
    ];
    const newLeadsToday = leads.rows;
    const touchedLeadIds = new Set([
      ...notes.rows.map((note: any) => Number(note.lead_id)),
      ...tasks.rows.map((task: any) => Number(task.lead_id)),
    ]);
    const firstMeaningfulFollowUpNeeded = newLeadsToday.filter((lead: any) =>
      !lead.last_contact_at && !touchedLeadIds.has(Number(lead.id))
    );
    const noteOverrides = classifiedTasks
      .filter((task: any) => task.noteOverride)
      .map((task: any) => ({ ...task.noteOverride, leadId: task.lead_id }));
    const tasksWithoutMeaningfulRecentFollowUp = classifiedTasks.filter((task: any) => {
      if (task.completed_at) return false;
      const taskCreatedAt = new Date(task.created_at).getTime();
      const contactedAfterTask = task.last_contact_at &&
        new Date(task.last_contact_at).getTime() >= taskCreatedAt;
      const actionableNoteAfterTask = parsedNotes.some((item: any) =>
        Number(item.leadId) === Number(task.lead_id) &&
        new Date(item.sourceTimestamp).getTime() >= taskCreatedAt
      );
      return !contactedAfterTask && !actionableNoteAfterTask;
    });
    const noteFollowUpsDueToday = parsedNotes.filter((item: any) => item?.dueAt && dayKey(item.dueAt) === dayKey(now));
    const ambiguousNotes = parsedNotes.filter((item: any) => item?.confidence === "AMBIGUOUS");
    const commitmentsDueToday = commitments.rows.filter((item: any) =>
      dayKey(new Date(item.due_at)) === dayKey(now) &&
      !["COMPLETED", "CANCELLED", "STALE"].includes(String(item.status))
    );
    const overdueCommitments = commitments.rows.filter((item: any) =>
      dayKey(new Date(item.due_at)) < dayKey(now) && !["COMPLETED", "CANCELLED", "STALE"].includes(String(item.status))
    );
    const promisesDueToday = promises.rows.filter((item: any) =>
      dayKey(new Date(item.due_at)) === dayKey(now) &&
      !["COMPLETED", "CANCELLED"].includes(String(item.status))
    );
    const importantPromises = promises.rows.filter((item: any) =>
      item.importance === "IMPORTANT" && ["DUE_SOON", "OVERDUE", "OPEN", "PENDING"].includes(String(item.status))
    );
    const taskCounts = Object.fromEntries(
      (["OVERDUE", "DUE_TODAY", "DUE_TOMORROW", "UPCOMING", "COMPLETED"] as TaskClassification[])
        .map(classification => [classification, classifiedTasks.filter((task: any) => task.classification === classification).length])
    );
    const topPriorities = [
      firstMeaningfulFollowUpNeeded.length ? `${firstMeaningfulFollowUpNeeded.length} new leads need first follow-up` : null,
      noAnswerLeads.rows.length ? `${noAnswerLeads.rows.length} leads were no-answer yesterday` : null,
      taskCounts.OVERDUE ? `${taskCounts.OVERDUE} CRM tasks are overdue` : null,
      taskCounts.DUE_TODAY ? `${taskCounts.DUE_TODAY} CRM tasks are due today` : null,
      tasksWithoutMeaningfulRecentFollowUp.length
        ? `${tasksWithoutMeaningfulRecentFollowUp.length} CRM tasks have no meaningful recent follow-up`
        : null,
      noteFollowUpsDueToday.length ? `${noteFollowUpsDueToday.length} note-derived follow-ups are due today` : null,
      currentVisitors.length ? `${currentVisitors.length} visitors are expected this month` : null,
      overdueCommitments.length ? `${overdueCommitments.length} commitments are overdue` : null,
      importantPromises.length ? `${importantPromises.length} important promises need attention` : null,
    ].filter((value): value is string => !!value);
    const questions = [
      ...ambiguousNotes.slice(0, 3).map((item: any) => `Clarify follow-up timing for lead ${item.leadId}.`),
      ...noAnswerLeads.rows.slice(0, 2).map((lead: any) => `What is the next step for ${lead.full_name || `Lead ${lead.id}`}?`),
    ];
    const meaningfulActionItems = topPriorities.length > 0;
    const callsEnabled = process.env.KAY_INTERNAL_CALLS_ENABLED === "true";
    const normalSessions = callHistory.rows.filter((session: any) =>
      dayKey(new Date(session.created_at)) === dayKey(now) &&
      String(session.reason_code).toUpperCase() !== "OVERDUE_SAME_DAY_COMMITMENT"
    );
    const retryableNormal = normalSessions.length === 1 && normalSessions[0]?.status === "REJECTED";
    const normalReasonCode = retryableNormal
      ? String(normalSessions[0].reason_code)
      : "DAILY_SUPERVISION";
    const materiallyOverdueSameDayCommitment = commitments.rows.some((item: any) =>
      dayKey(new Date(item.due_at)) === dayKey(now) &&
      new Date(item.due_at).getTime() < now.getTime() &&
      ["PENDING", "ACCEPTED", "EXTENDED", "OVERDUE"].includes(String(item.status))
    );
    const normalCallDecision = callAntiSpamDecision({
      now,
      sessions: callHistory.rows.map((session: any) => ({
        status: session.status,
        reasonCode: session.reason_code,
        createdAt: session.created_at,
      })),
      meaningfulActionItems,
      reasonCode: normalReasonCode,
    });
    const overdueFollowUpDecision = callAntiSpamDecision({
      now,
      sessions: callHistory.rows.map((session: any) => ({
        status: session.status,
        reasonCode: session.reason_code,
        createdAt: session.created_at,
      })),
      meaningfulActionItems,
      materiallyOverdueSameDayCommitment,
      reasonCode: "OVERDUE_SAME_DAY_COMMITMENT",
    });
    const windowOpen = isKayCallWindow(now);
    const callEligibleNow = callsEnabled && windowOpen &&
      (normalCallDecision.allowed || overdueFollowUpDecision.allowed);
    const callEligibilityReason = !callsEnabled
      ? "CALLS_DISABLED"
      : !windowOpen
        ? "CALL_WINDOW_CLOSED"
        : normalCallDecision.allowed
          ? "NORMAL_CALL_ALLOWED"
          : overdueFollowUpDecision.allowed
            ? "OVERDUE_FOLLOW_UP_ALLOWED"
            : normalCallDecision.reason;
    return {
      employeeId: employee.id,
      employeeName: employee.username,
      tasks: classifiedTasks,
      taskCounts,
      tasksWithoutMeaningfulRecentFollowUp,
      visitors: currentVisitors,
      noteFollowUps: parsedNotes,
      noteFollowUpsDueToday,
      ambiguousNotes,
      noteOverrides,
      commitments: commitments.rows,
      commitmentsDueToday,
      overdueCommitments,
      promises: promises.rows,
      promisesDueToday,
      importantPromises,
      newLeadsToday,
      firstMeaningfulFollowUpNeeded,
      yesterdayNoAnswer: noAnswerLeads.rows,
      callHistory: callHistory.rows,
      dailyBriefGeneratedToday: dailyBrief.rows[0]?.generated === true,
      meaningfulActionItems,
      plannedCallCandidate: meaningfulActionItems,
      callEligibleNow,
      callEligibilityReason,
      callEligibility: {
        featureEnabled: callsEnabled,
        windowOpen,
        normal: normalCallDecision,
        overdueFollowUp: overdueFollowUpDecision,
      },
      humanCallBrief: buildHumanCallBrief({
        employeeName: employee.username,
        topPriorities,
        questions,
        commitmentFollowups: overdueCommitments.slice(0, 5).map((item: any) => item.action),
      }),
      rescueRecommendations: noAnswerLeads.rows.map((lead: any) => ({
        leadId: lead.id,
        text: rescueRecommendation(lead.full_name || `Lead ${lead.id}`),
        recommendationOnly: true,
      })),
    };
  }));
  return { generatedAt: now.toISOString(), timeZone: KAY_SUPERVISION_TIME_ZONE, callWindowOpen: isKayCallWindow(now), dailyBriefDue: isDailyBriefDue(now), employees: rows };
}

export async function generateDailyBrief(employeeId?: number, now = new Date(), options: { manual?: boolean } = {}) {
  if (!options.manual && !isDailyBriefDue(now)) return { notDue: true, generatedAt: now.toISOString(), timeZone: KAY_SUPERVISION_TIME_ZONE, written: [] };
  const snapshot = await getSupervisorSnapshot(employeeId, now);
  const today = dayKey(now);
  const result = await withKayInternalClient(async client => {
    const written = [];
    for (const employee of snapshot.employees) {
      const text = JSON.stringify({
        categories: {
          newLeadsToday: employee.newLeadsToday, firstMeaningfulFollowUpNeeded: employee.firstMeaningfulFollowUpNeeded,
          yesterdayNoAnswer: employee.yesterdayNoAnswer, tasks: employee.tasks, visitors: employee.visitors,
          tasksWithoutMeaningfulRecentFollowUp: employee.tasksWithoutMeaningfulRecentFollowUp,
          noteFollowUps: employee.noteFollowUps,
          noteFollowUpsDueToday: employee.noteFollowUpsDueToday,
          ambiguousClarifications: employee.ambiguousNotes,
          newerNoteOverrides: employee.noteOverrides,
          commitments: employee.commitments,
          commitmentsDueToday: employee.commitmentsDueToday,
          overdueCommitments: employee.overdueCommitments,
          promises: employee.promises,
          promisesDueToday: employee.promisesDueToday,
          importantPromises: employee.importantPromises,
          callEligibility: {
            callWindowOpen: snapshot.callWindowOpen,
            meaningfulActionItems: employee.meaningfulActionItems,
            eligibleNow: employee.callEligibleNow,
          },
          plannedCandidates: employee.plannedCallCandidate ? [employee.humanCallBrief] : [],
          rescueRecommendations: employee.rescueRecommendations,
        }, generatedAt: snapshot.generatedAt,
      });
      const key = `daily-brief:${today}:${employee.employeeId}`;
      const row = await client.query(
        `INSERT INTO kay_internal_briefings(employee_id,trigger_type,severity,text,idempotency_key)
         VALUES($1,'DAILY_BRIEF','NORMAL',$2,$3) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
        [employee.employeeId, text, key],
      );
      written.push(row.rows[0] || { idempotencyKey: key, existing: true });
    }
    return written;
  });
  return { generatedAt: snapshot.generatedAt, timeZone: snapshot.timeZone, written: result };
}