/**
 * WhatsApp Lead Qualification Service v2.1
 *
 * Interactive step-by-step qualification flow using Meta Cloud API
 * reply buttons and list messages.
 *
 * State machine:
 *   idle → template_sent → q1_sent → q2_sent → q3_sent → q4_sent
 *                       → [q4b_sent] → q5_sent → q6_sent → q7_sent → completed
 *                ↓
 *            postponed  (user tapped "⏳ لاحقاً" — excluded from all outbound)
 *
 *   template_sent : opener template sent; two quick-reply buttons.
 *                   QUAL_YES → window opens → Q1 immediately.
 *                   QUAL_LATER → status=postponed, no further messages.
 *   (greeting_sent kept for legacy/manual-restart paths)
 *
 * Terminal states: completed | timed_out | failed | opt_out | already_qualified
 *
 * Scoring tiers: COLD → WARM → HOT → VIP
 */

import { pool } from "./db";
import { sendInteractiveMessage, sendQualTextMessage, sendQualOpenerTemplate } from "./interactiveMessageHelper";

// ── Opt-out keywords ──────────────────────────────────────────────────────────
const OPT_OUT_KEYWORDS = new Set([
  "stop", "unsubscribe", "opt out", "opt-out", "cancel", "quit", "leave",
  "لا أريد", "إلغاء", "توقف", "إيقاف", "خروج", "اخرج", "لا شكرا", "لا شكراً",
  "انهاء", "إنهاء", "كفى", "بس", "اوقف",
]);

function isOptOut(text: string): boolean {
  const lower = text.trim().toLowerCase();
  for (const kw of OPT_OUT_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// ── Question definitions ──────────────────────────────────────────────────────

const Q_BUDGET_OPTIONS = [
  { id: "budget_lt50",     title: "أقل من $50,000" },
  { id: "budget_50_80",    title: "$50,000 - $80,000" },
  { id: "budget_80_100",   title: "$80,000 - $100,000" },
  { id: "budget_100_150",  title: "$100,000 - $150,000" },
  { id: "budget_150_200",  title: "$150,000 - $200,000" },
  { id: "budget_gt200",    title: "أكثر من $200,000" },
];

const Q_TIMELINE_OPTIONS = [
  { id: "timeline_1m",  title: "هذا الشهر" },
  { id: "timeline_3m",  title: "خلال 3 أشهر" },
  { id: "timeline_6m+", title: "6 أشهر أو أكثر" },
];

const Q_GOAL_OPTIONS = [
  { id: "goal_invest",   title: "استثمار فقط" },
  { id: "goal_reside",   title: "سكن فقط" },
  { id: "goal_both",     title: "استثمار وسكن" },
];

const Q_PROJECT_OPTIONS = [
  { id: "proj_yes", title: "نعم، لدي مشروع محدد" },
  { id: "proj_no",  title: "لا، أحتاج اقتراحات" },
];

const Q_VISIT_OPTIONS = [
  { id: "visit_1m",   title: "نعم، خلال شهر" },
  { id: "visit_later", title: "ربما لاحقاً" },
  { id: "visit_no",   title: "لا" },
];

const Q_CONTACT_TIME_OPTIONS = [
  { id: "contact_morning",   title: "بين 10 صباحاً و 1 ظهراً" },
  { id: "contact_afternoon", title: "بين 2 ظهراً و 5 عصراً" },
  { id: "contact_evening",   title: "بين 6 مساءً و 9 ليلاً" },
  { id: "contact_anytime",   title: "أي وقت مناسب" },
];

// ── Human-readable Arabic labels for summary generation ─────────────────────

const BUDGET_LABEL: Record<string, string> = {
  "budget_lt50":    "أقل من 50 ألف $",
  "budget_50_80":   "50 - 80 ألف $",
  "budget_80_100":  "80 - 100 ألف $",
  "budget_100_150": "100 - 150 ألف $",
  "budget_150_200": "150 - 200 ألف $",
  "budget_gt200":   "أكثر من 200 ألف $",
};
const TIMELINE_LABEL: Record<string, string> = {
  "timeline_1m":  "هذا الشهر",
  "timeline_3m":  "خلال 3 أشهر",
  "timeline_6m+": "6 أشهر أو أكثر",
};
const GOAL_LABEL: Record<string, string> = {
  "goal_invest": "استثمار",
  "goal_reside": "سكن",
  "goal_both":   "استثمار وسكن",
};
const VISIT_LABEL: Record<string, string> = {
  "visit_1m":    "خلال شهر",
  "visit_later": "ربما لاحقاً",
  "visit_no":    "لا",
};
const CONTACT_TIME_LABEL: Record<string, string> = {
  "contact_morning":   "10 صباحاً - 1 ظهراً",
  "contact_afternoon": "2 ظهراً - 5 عصراً",
  "contact_evening":   "6 مساءً - 9 ليلاً",
  "contact_anytime":   "أي وقت",
};

function labelOf(map: Record<string, string>, id: string | undefined): string {
  if (!id) return "—";
  return map[id] ?? id;
}

// ── wa_stage helper ───────────────────────────────────────────────────────────

async function updateWaStage(leadId: number, stage: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`UPDATE crm_leads SET wa_stage = $1 WHERE id = $2`, [stage, leadId]);
  } catch {
    // non-critical
  } finally {
    client.release();
  }
}

// ── Session helpers ───────────────────────────────────────────────────────────

export interface Session {
  id:                   number;
  lead_id:              number;
  phone:                string;
  status:               string;
  current_question:     string | null;
  last_message_at:      Date | null;
  last_outbound_wamid:  string | null;
  retry_count:          number;
  invalid_input_count:  number;
  created_at:           Date;
  completed_at:         Date | null;
}

async function getSession(sessionId: number): Promise<Session | null> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT * FROM wa_qual_sessions WHERE id = $1 LIMIT 1`,
      [sessionId]
    );
    return r.rows[0] ?? null;
  } finally {
    client.release();
  }
}

async function getSessionByPhone(phone: string): Promise<Session | null> {
  const digits = phone.replace(/[^0-9]/g, "");
  const client = await pool.connect();
  try {
    const r = await client.query(`
      SELECT s.*
      FROM wa_qual_sessions s
      WHERE s.phone = $1
        AND s.status NOT IN ('completed','timed_out','failed','opt_out','already_qualified')
      ORDER BY s.created_at DESC
      LIMIT 1
    `, [digits]);
    return r.rows[0] ?? null;
  } finally {
    client.release();
  }
}

async function getSessionByLeadId(leadId: number): Promise<Session | null> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT * FROM wa_qual_sessions WHERE lead_id = $1 LIMIT 1`,
      [leadId]
    );
    return r.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function updateSession(
  id: number,
  patch: Partial<Omit<Session, "id" | "created_at" | "lead_id" | "phone">>,
): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;
  for (const [key, val] of Object.entries(patch)) {
    const col = key.replace(/([A-Z])/g, c => `_${c.toLowerCase()}`);
    sets.push(`${col} = $${idx++}`);
    vals.push(val);
  }
  if (!sets.length) return;
  vals.push(id);
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE wa_qual_sessions SET ${sets.join(", ")} WHERE id = $${idx}`,
      vals
    );
  } finally {
    client.release();
  }
}

export async function saveAnswer(
  sessionId: number,
  questionKey: string,
  rawInput: string,
  normalisedValue: string,
  inputMethod: "button" | "list" | "text",
): Promise<void> {
  const client = await pool.connect();
  try {
    // Upsert by question key (last answer wins)
    await client.query(`
      INSERT INTO wa_qual_answers
        (session_id, question_key, raw_input, normalised_value, input_method, received_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (session_id, question_key) DO UPDATE SET
        raw_input        = EXCLUDED.raw_input,
        normalised_value = EXCLUDED.normalised_value,
        input_method     = EXCLUDED.input_method,
        received_at      = NOW()
    `, [sessionId, questionKey, rawInput, normalisedValue, inputMethod]);
  } finally {
    client.release();
  }
}

export async function getAnswers(sessionId: number): Promise<Record<string, string>> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT question_key, normalised_value FROM wa_qual_answers WHERE session_id = $1`,
      [sessionId]
    );
    const map: Record<string, string> = {};
    for (const row of r.rows) map[row.question_key] = row.normalised_value;
    return map;
  } finally {
    client.release();
  }
}

// ── Duplicate check ───────────────────────────────────────────────────────────

async function hasRecentCompletion(phone: string): Promise<boolean> {
  const digits = phone.replace(/[^0-9]/g, "");
  const client = await pool.connect();
  try {
    const r = await client.query(`
      SELECT 1
      FROM wa_qual_sessions
      WHERE phone = $1
        AND status = 'completed'
        AND completed_at > NOW() - INTERVAL '60 days'
      LIMIT 1
    `, [digits]);
    return r.rowCount > 0;
  } finally {
    client.release();
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

interface ScoreResult {
  score: "VIP" | "HOT" | "WARM" | "COLD";
  reason: string;
}

function computeScore(answers: Record<string, string>): ScoreResult {
  const TIERS = ["COLD", "WARM", "HOT", "VIP"] as const;
  const reasons: string[] = [];

  // Base score from budget
  let points = 0;
  const budget = answers["budget"] ?? "";
  if (budget === "budget_gt200")       { points = 3; reasons.push("Budget >$200k"); }
  else if (budget === "budget_150_200") { points = 2; reasons.push("Budget $150k-$200k"); }
  else if (budget === "budget_100_150") { points = 1; reasons.push("Budget $100k-$150k"); }
  else if (budget === "budget_80_100")  { points = 1; reasons.push("Budget $80k-$100k"); }
  else if (budget === "budget_50_80")   { points = 0; reasons.push("Budget $50k-$80k"); }
  else                                  { points = 0; reasons.push("Budget <$50k"); }

  // Timeline bonus
  const timeline = answers["timeline"] ?? "";
  if (timeline === "timeline_1m" || timeline === "timeline_3m") {
    points += 1;
    reasons.push("Short timeline");
  }

  // Specific project bonus
  const project = answers["has_project"] ?? "";
  if (project === "proj_yes") {
    points += 1;
    reasons.push("Has specific project");
  }

  // Dual goal bonus
  const goal = answers["goal"] ?? "";
  if (goal === "goal_both") {
    points += 1;
    reasons.push("Investment + residence goal");
  }

  // Site visit bonus
  const visit = answers["site_visit"] ?? "";
  if (visit === "visit_1m") {
    points += 1;
    reasons.push("Site visit within 1 month");
  }

  const idx   = Math.min(points, TIERS.length - 1);
  const score = TIERS[idx];

  return { score, reason: reasons.join("; ") || "No qualifying factors" };
}

// ── Lead CRM update helpers ───────────────────────────────────────────────────

async function updateCrmLeadScore(
  leadId: number,
  score: string,
  status: string,
  summary: string,
  preferredContactTime?: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    const mappedLeadScore =
      score === "VIP" || score === "HOT" ? "hot"
      : score === "WARM" ? "warm"
      : "cold";

    await client.query(`
      UPDATE crm_leads
      SET qualification_status   = $1,
          qualification_score    = $2,
          qualification_summary  = $3,
          qualified_at           = NOW(),
          lead_score             = $4,
          preferred_contact_time = COALESCE($6, preferred_contact_time),
          wa_stage               = 'qualified'
      WHERE id = $5
    `, [status, score, summary, mappedLeadScore, leadId, preferredContactTime ?? null]);
  } finally {
    client.release();
  }
}

async function createCrmNotification(
  leadId: number,
  score: string,
  answers: Record<string, string>,
  city: string | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    const lr = await client.query(
      `SELECT assigned_to, full_name, phone FROM crm_leads WHERE id = $1`,
      [leadId]
    );
    const lead = lr.rows[0];
    if (!lead || !lead.assigned_to) return;

    const scoreEmoji =
      score === "VIP" ? "⭐⭐⭐" :
      score === "HOT" ? "🔥" :
      score === "WARM" ? "♨️" : "❄️";

    const budgetLabel      = labelOf(BUDGET_LABEL,       answers["budget"]);
    const contactTimeLabel = labelOf(CONTACT_TIME_LABEL, answers["contact_time"]);

    const title   = `${scoreEmoji} Lead ${score} جديد`;
    const message =
      `الاسم: ${lead.full_name ?? "—"}\n` +
      `الهاتف: ${lead.phone ?? "—"}\n\n` +
      `المدينة: ${city ?? "—"}\n` +
      `الميزانية: ${budgetLabel}\n\n` +
      `وقت التواصل:\n${contactTimeLabel}`;

    await client.query(`
      INSERT INTO user_notifications
        (user_id, type, title, message, data, is_read, created_at)
      VALUES ($1, 'qualification_complete', $2, $3, $4, false, NOW())
    `, [
      lead.assigned_to,
      title,
      message,
      JSON.stringify({ leadId, score, type: "qualification_complete" }),
    ]);
  } catch {
    // non-critical
  } finally {
    client.release();
  }
}

// ── Chat History: log inbound message ────────────────────────────────────────

export async function logInboundQualMessage(
  phone: string,
  text: string,
  wamid?: string,
): Promise<void> {
  const digits = phone.replace(/[^0-9]/g, "");
  const client = await pool.connect();
  try {
    const convResult = await client.query(`
      INSERT INTO whatsapp_api_conversations
        (phone_number, last_message_at, last_message_preview, source, updated_at)
      VALUES ($1, NOW(), $2, 'qualification', NOW())
      ON CONFLICT (phone_number) DO UPDATE SET
        last_message_at      = NOW(),
        last_message_preview = EXCLUDED.last_message_preview,
        updated_at           = NOW()
      RETURNING id
    `, [digits, text.slice(0, 120)]);

    const convId = convResult.rows[0]?.id;
    if (!convId) return;

    await client.query(`
      INSERT INTO whatsapp_api_messages
        (conversation_id, direction, message_text, message_type,
         wamid, status, context_label, created_at)
      VALUES ($1, 'inbound', $2, 'text', $3, 'received', 'qualification', NOW())
    `, [convId, text, wamid ?? null]);
  } catch {
    // non-critical
  } finally {
    client.release();
  }
}

// ── Message senders ───────────────────────────────────────────────────────────

async function sendAndUpdateSession(
  session: Session,
  nextStatus: string,
  nextQuestion: string | null,
  sendFn: () => Promise<{ success: boolean; wamid?: string }>,
): Promise<void> {
  const result = await sendFn();
  await updateSession(session.id, {
    status:              nextStatus,
    current_question:    nextQuestion,
    last_message_at:     new Date(),
    last_outbound_wamid: result.wamid ?? null,
    invalid_input_count: 0,
  });
}

async function sendGreeting(session: Session, firstName: string | null): Promise<void> {
  const name = firstName?.trim() || "عزيزي العميل";
  const text =
    `أهلاً ${name}! 👋\n\n` +
    `أنا مساعدك من *Kinglike Luxury* للعقارات الفاخرة.\n` +
    `سأطرح عليك بعض الأسئلة السريعة لمساعدتك في إيجاد العقار المثالي. 🏠\n\n` +
    `هل تريد المتابعة؟`;

  await sendAndUpdateSession(session, "greeting_sent", "greeting", () =>
    sendInteractiveMessage(session.phone, text, [
      { id: "greet_yes", title: "نعم، هيا نبدأ! ✅" },
      { id: "greet_no",  title: "ليس الآن" },
    ])
  );
}

// ── First-contact: send approved template to open conversation window ─────────
//
// WhatsApp Cloud API rule: only approved templates may be sent as the first
// outbound message to a cold lead (outside 24-hour window).  Interactive and
// free-form messages require a customer-initiated reply first.
//
// State: idle → template_sent
// Next:  any inbound reply → window opens → sendQ1Budget (QUALIFICATION_STARTED)
async function sendQualOpener(session: Session): Promise<void> {
  console.log(`[WaQual][TEMPLATE_SENT] Sending opener template sessionId=${session.id} phone=${session.phone}`);

  const result = await sendQualOpenerTemplate(session.phone);

  await updateSession(session.id, {
    status:              "template_sent",
    current_question:    "opener_template",
    last_message_at:     new Date(),
    last_outbound_wamid: result.wamid ?? null,
    invalid_input_count: 0,
  });

  if (!result.success) {
    console.error(
      `[WaQual][TEMPLATE_SENT] FAILED sessionId=${session.id} phone=${session.phone} — ` +
      `${result.error ?? "unknown error"}. ` +
      `ACTION REQUIRED: Create template "kinglike_qual_opener" (UTILITY/ar) in Meta Business Suite.`
    );
  } else {
    console.log(
      `[WaQual][TEMPLATE_SENT] ✓ sessionId=${session.id} phone=${session.phone} wamid=${result.wamid}`
    );
  }
}

async function sendQ1Budget(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q1_sent", "budget", () =>
    sendInteractiveMessage(
      session.phone,
      "💰 ما هي ميزانيتك التقريبية للاستثمار؟\n(بالدولار الأمريكي)",
      Q_BUDGET_OPTIONS,
    )
  );
}

async function sendQ2Timeline(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q2_sent", "timeline", () =>
    sendInteractiveMessage(
      session.phone,
      "📅 متى تتوقع إتمام عملية الشراء؟",
      Q_TIMELINE_OPTIONS,
    )
  );
}

async function sendQ3Goal(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q3_sent", "goal", () =>
    sendInteractiveMessage(
      session.phone,
      "🎯 ما هو هدفك الرئيسي من هذا الاستثمار العقاري؟",
      Q_GOAL_OPTIONS,
    )
  );
}

async function sendQ4Project(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q4_sent", "has_project", () =>
    sendInteractiveMessage(
      session.phone,
      "🏢 هل لديك مشروع عقاري محدد في ذهنك؟",
      Q_PROJECT_OPTIONS,
    )
  );
}

async function sendQ4bProjectName(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q4b_sent", "project_name", () =>
    sendQualTextMessage(
      session.phone,
      "📝 رائع! ما اسم المشروع الذي يثير اهتمامك؟\n(اكتبه لنا بحرية)"
    )
  );
}

async function sendQ5Visit(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q5_sent", "site_visit", () =>
    sendInteractiveMessage(
      session.phone,
      "📍 هل أنت مهتم بجولة ميدانية خاصة لأبرز مشاريعنا الفاخرة خلال الشهر القادم؟",
      Q_VISIT_OPTIONS,
    )
  );
}

async function sendQ6Notes(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q6_sent", "notes", () =>
    sendQualTextMessage(
      session.phone,
      "✍️ هل لديك أي متطلبات خاصة أو ملاحظات إضافية؟\n\nاكتبها بحرية، أو أرسل \"لا\" للتخطي."
    )
  );
}

async function sendQ7ContactTime(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q7_sent", "contact_time", () =>
    sendInteractiveMessage(
      session.phone,
      "🕐 آخر سؤال!\n\nما هو الوقت المفضل لديك لاستقبال مكالمة من أحد مستشارينا المتخصصين؟",
      Q_CONTACT_TIME_OPTIONS,
    )
  );
}

async function sendCompletion(
  session: Session,
  firstName: string | null,
  score: string,
): Promise<void> {
  const name = firstName?.trim() || "عزيزي العميل";
  const scoreEmoji =
    score === "VIP" ? "⭐⭐⭐" :
    score === "HOT" ? "🔥" :
    score === "WARM" ? "♨️" : "❄️";

  const text =
    `شكراً ${name}! ${scoreEmoji}\n\n` +
    `تم حفظ بياناتك ومتطلباتك بنجاح ✅\n\n` +
    `سيتواصل معك أحد مستشارينا المتخصصين في العقارات الفاخرة قريباً، ` +
    `لمساعدتك في إيجاد العقار المثالي الذي يلائم تطلعاتك.\n\n` +
    `🏢 *Kinglike Luxury — الفخامة في كل تفصيلة.*`;

  const result = await sendQualTextMessage(session.phone, text);
  await updateSession(session.id, {
    status:              "completed",
    current_question:    null,
    last_message_at:     new Date(),
    last_outbound_wamid: result.wamid ?? null,
    completed_at:        new Date(),
  });
}

async function sendOptOutAck(session: Session): Promise<void> {
  const text =
    "نفهم تماماً ونحترم قرارك. 🙏\n\n" +
    "إذا احتجت مساعدة في أي وقت، لا تتردد في التواصل معنا.\n\n" +
    "🏢 *Kinglike Luxury — في خدمتك دائماً.*";

  const result = await sendQualTextMessage(session.phone, text);
  await updateSession(session.id, {
    status:           "opt_out",
    current_question: null,
    last_message_at:  new Date(),
    completed_at:     new Date(),
    last_outbound_wamid: result.wamid ?? null,
  });
}

async function sendInvalidInput(session: Session): Promise<void> {
  await sendQualTextMessage(
    session.phone,
    "عذراً، لم أفهم ردك. يرجى اختيار أحد الخيارات المتاحة. 🙏"
  );
  await updateSession(session.id, {
    invalid_input_count: (session.invalid_input_count ?? 0) + 1,
    last_message_at:     new Date(),
  });
}

// ── Finish qualification ──────────────────────────────────────────────────────

export async function finishQualification(session: Session): Promise<void> {
  const answers   = await getAnswers(session.id);
  const { score, reason } = computeScore(answers);

  // Fetch lead info (first name + city for summary and notification)
  const client = await pool.connect();
  let firstName: string | null = null;
  let city:      string | null = null;
  try {
    const lr = await client.query(
      `SELECT first_name, city FROM crm_leads WHERE id = $1`,
      [session.lead_id]
    );
    firstName = lr.rows[0]?.first_name ?? null;
    city      = lr.rows[0]?.city      ?? null;
  } finally {
    client.release();
  }

  // ── Arabic qualification summary ─────────────────────────────────────────
  const contactTimeId    = answers["contact_time"];
  const preferredContact = labelOf(CONTACT_TIME_LABEL, contactTimeId);

  const hasProject    = answers["has_project"] === "proj_yes";
  const projectLine   = hasProject ? (answers["project_name"] ?? "نعم") : "لا";
  const noteValue     = answers["notes"];
  const hasNotes      = noteValue && noteValue !== "لا";

  const summaryLines: string[] = [
    `الهدف: ${labelOf(GOAL_LABEL, answers["goal"])}`,
    `المدينة: ${city ?? "—"}`,
    `الميزانية: ${labelOf(BUDGET_LABEL, answers["budget"])}`,
    `مشروع محدد: ${projectLine}`,
    `موعد الزيارة: ${labelOf(VISIT_LABEL, answers["site_visit"])}`,
    `وقت التواصل: ${preferredContact}`,
  ];
  if (hasNotes) summaryLines.push(`ملاحظات: ${noteValue}`);
  summaryLines.push(``, `Lead Score: ${score}`);

  const summaryText = summaryLines.join("\n");

  // Send completion message to customer
  await sendCompletion(session, firstName, score);

  // Save to wa_qual_summaries
  const c2 = await pool.connect();
  try {
    await c2.query(`
      INSERT INTO wa_qual_summaries
        (session_id, qual_score, score_reason, summary_text, generated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (session_id) DO UPDATE SET
        qual_score   = EXCLUDED.qual_score,
        score_reason = EXCLUDED.score_reason,
        summary_text = EXCLUDED.summary_text,
        generated_at = NOW()
    `, [session.id, score, reason, summaryText]);
  } finally {
    c2.release();
  }

  // Update CRM lead (includes preferred_contact_time)
  await updateCrmLeadScore(
    session.lead_id, score, "completed", summaryText,
    contactTimeId ?? undefined,
  );

  // Create internal CRM notification for assigned agent
  await createCrmNotification(session.lead_id, score, answers, city);

  console.log(`[WaQual] Session ${session.id} completed — leadId=${session.lead_id} score=${score}`);
}

// ── Public: check duplicate and trigger flow ──────────────────────────────────

export async function checkAndTrigger(
  leadId: number,
  phone: string | null,
  firstName: string | null = null,
): Promise<void> {
  if (!phone) return;

  const digits = phone.replace(/[^0-9]/g, "");
  if (!digits) return;

  // Check for existing session for this lead
  const existing = await getSessionByLeadId(leadId);
  if (existing) return; // already initialised

  // Check 60-day duplicate
  if (await hasRecentCompletion(digits)) {
    console.log(`[WaQual] Skipping leadId=${leadId} — recently qualified phone`);
    // Create session with already_qualified status
    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO wa_qual_sessions
          (lead_id, phone, status, created_at, completed_at)
        VALUES ($1, $2, 'already_qualified', NOW(), NOW())
        ON CONFLICT (lead_id) DO NOTHING
      `, [leadId, digits]);
      await client.query(`
        UPDATE crm_leads SET qualification_status = 'already_qualified' WHERE id = $1
      `, [leadId]);
    } finally {
      client.release();
    }
    return;
  }

  // Create session in idle state
  const client = await pool.connect();
  let sessionId: number;
  try {
    const r = await client.query(`
      INSERT INTO wa_qual_sessions
        (lead_id, phone, status, created_at, last_message_at)
      VALUES ($1, $2, 'idle', NOW(), NOW())
      ON CONFLICT (lead_id) DO NOTHING
      RETURNING id
    `, [leadId, digits]);

    if (!r.rows[0]) return; // conflict — session already exists
    sessionId = r.rows[0].id;
    await client.query(`
      UPDATE crm_leads SET qualification_status = 'in_progress' WHERE id = $1
    `, [leadId]);
  } finally {
    client.release();
  }

  // Small delay to avoid race with lead creation
  await new Promise(resolve => setTimeout(resolve, 2000));

  const session = await getSession(sessionId);
  if (!session) return;

  // Send opener template (compliant first-contact for cold leads)
  await sendQualOpener(session).catch(err =>
    console.error(`[WaQual] sendQualOpener failed sessionId=${sessionId}:`, err.message)
  );
}

// ── Public: handle inbound WhatsApp message ───────────────────────────────────

export async function handleInboundMessage(opts: {
  phone:    string;
  bodyText: string;
  wamid?:   string;
  buttonId?: string;  // from button_reply
  listId?:   string;  // from list_reply
}): Promise<void> {
  const digits = opts.phone.replace(/[^0-9]/g, "");

  // Always log to Chat History
  await logInboundQualMessage(digits, opts.bodyText, opts.wamid);

  // Find active session
  const session = await getSessionByPhone(digits);

  if (!session) {
    // No active session — just log (nothing to act on)
    return;
  }

  // The effective answer ID (prefer button/list ID over raw text)
  const answerId = opts.buttonId ?? opts.listId ?? null;
  const rawText  = opts.bodyText.trim();

  // Check opt-out
  if (isOptOut(rawText)) {
    await sendOptOutAck(session);
    const c = await pool.connect();
    try {
      await c.query(`
        UPDATE crm_leads SET qualification_status = 'opt_out', opt_out_wa = TRUE WHERE id = $1
      `, [session.lead_id]);
    } finally {
      c.release();
    }
    return;
  }

  const state = session.status;

  // ── Dispatch by current state ─────────────────────────────────────────────

  // ── ai_concierge_active: hand off to AI concierge ────────────────────────
  if (state === "ai_concierge_active") {
    const { handleConciergeMessage } = await import("./waAiConcierge");
    await handleConciergeMessage(session, opts);
    return;
  }

  // ── template_sent: button-gated opener ───────────────────────────────────
  if (state === "template_sent") {
    // Log exact payload received from Meta for every reply to this template
    console.log(
      `[WaQual][TEMPLATE_REPLY] sessionId=${session.id} phone=${digits} ` +
      `buttonPayload=${answerId ?? "—"} text="${rawText.slice(0, 60)}"`
    );

    // Match "yes" — payload QUAL_YES OR button text "نعم، أود المتابعة" as payload OR free-text
    const isYes = answerId === "QUAL_YES"
               || answerId === "نعم، أود المتابعة"
               || rawText.match(/^(نعم|yes|اه|ايه|أيوا|يلا|هيا|ابدأ|اوك|ok|sure|✅)/i) !== null;

    // Match "later" — payload QUAL_LATER OR button text "لاحقاً" as payload
    const isLater = answerId === "QUAL_LATER"
                 || answerId === "لاحقاً";

    if (isLater) {
      // User chose "لاحقاً" — postpone; no further outbound messages
      const now = new Date();
      await updateSession(session.id, {
        status:          "postponed",
        last_message_at: now,
        completed_at:    now,   // serves as postponed_at timestamp
      });
      console.log(
        `[WaQual][QUALIFICATION_POSTPONED] sessionId=${session.id} phone=${digits} postponed_at=${now.toISOString()}`
      );
      return;
    }

    // QUAL_YES button OR any free-text reply → window open, start AI concierge
    console.log(`[WaQual][WINDOW_OPENED] sessionId=${session.id} phone=${digits} payload=${answerId ?? "free-text"}`);
    console.log(`[WaQual][CONCIERGE_STARTED] sessionId=${session.id} phone=${digits}`);

    // Mark lead as Interested in CRM
    await updateWaStage(session.lead_id, 'interested');

    // Fetch first name for personalised greeting
    const leadNameClient = await pool.connect();
    let conciergeFirstName: string | null = null;
    try {
      const nr = await leadNameClient.query(
        `SELECT first_name FROM crm_leads WHERE id = $1`,
        [session.lead_id]
      );
      conciergeFirstName = nr.rows[0]?.first_name ?? null;
    } finally {
      leadNameClient.release();
    }

    // Hand off to AI concierge
    const { startConciergeConversation } = await import("./waAiConcierge");
    await startConciergeConversation(session, conciergeFirstName);
    return;
  }

  // ── Legacy Q-flow states → upgrade to AI concierge immediately ───────────
  //
  // All sessions that are still in the old button-driven qualification states
  // are transparently upgraded to ai_concierge_active on first contact so the
  // client receives a natural AI advisor reply instead of "عذراً، لم أفهم ردك".
  //
  // This covers:
  //   greeting_sent, q1_sent, q2_sent, q3_sent, q4_sent, q4b_sent,
  //   q5_sent, q6_sent, q7_sent, postponed
  //
  // The legacy handlers below are kept only as emergency dead code — they are
  // never reached under normal operation.
  //
  const LEGACY_UPGRADE_STATES = new Set([
    "greeting_sent", "q1_sent", "q2_sent", "q3_sent", "q4_sent",
    "q4b_sent", "q5_sent", "q6_sent", "q7_sent", "postponed",
  ]);

  if (LEGACY_UPGRADE_STATES.has(state)) {
    console.log(
      `[WaQual][LEGACY_UPGRADE] sessionId=${session.id} phone=${digits} ` +
      `state=${state} → ai_concierge_active`
    );
    // Upgrade session status in DB before passing to AI
    await updateSession(session.id, {
      status:           "ai_concierge_active",
      current_question: "ai_concierge",
      last_message_at:  new Date(),
    });
    // Route current message to AI concierge with the upgraded session
    const { handleConciergeMessage } = await import("./waAiConcierge");
    await handleConciergeMessage({ ...session, status: "ai_concierge_active" }, opts);
    return;
  }

  // ── EMERGENCY FALLBACK ONLY — never reached under normal operation ────────
  // The blocks below are preserved for situations where the AI concierge is
  // explicitly disabled or OpenAI is unavailable.  In normal operation every
  // session is either ai_concierge_active or template_sent.

  if (state === "greeting_sent") {
    if (answerId === "greet_yes" || rawText.match(/^(نعم|yes|اه|ايه|أيوا|يلا|هيا|ابدأ|اوك|ok|sure)/i)) {
      await sendQ1Budget(session);
    } else if (answerId === "greet_no" || isOptOut(rawText)) {
      await sendOptOutAck(session);
    } else {
      // Any other reply treated as "yes"
      await sendQ1Budget(session);
    }
    return;
  }

  if (state === "q1_sent") {
    const validIds = Q_BUDGET_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "budget", opts.bodyText, answerId, answerId ? "list" : "text");
      await sendQ2Timeline(session);
    } else {
      // Try to map free text
      const mapped = mapBudgetText(rawText);
      if (mapped) {
        await saveAnswer(session.id, "budget", rawText, mapped, "text");
        await sendQ2Timeline(session);
      } else {
        await sendInvalidInput(session);
        if ((session.invalid_input_count ?? 0) >= 2) await sendQ1Budget(session);
      }
    }
    return;
  }

  if (state === "q2_sent") {
    const validIds = Q_TIMELINE_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "timeline", opts.bodyText, answerId, "button");
      await sendQ3Goal(session);
    } else {
      const mapped = mapTimelineText(rawText);
      if (mapped) {
        await saveAnswer(session.id, "timeline", rawText, mapped, "text");
        await sendQ3Goal(session);
      } else {
        await sendInvalidInput(session);
        if ((session.invalid_input_count ?? 0) >= 2) await sendQ2Timeline(session);
      }
    }
    return;
  }

  if (state === "q3_sent") {
    const validIds = Q_GOAL_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "goal", opts.bodyText, answerId, "button");
      await sendQ4Project(session);
    } else {
      const mapped = mapGoalText(rawText);
      if (mapped) {
        await saveAnswer(session.id, "goal", rawText, mapped, "text");
        await sendQ4Project(session);
      } else {
        await sendInvalidInput(session);
        if ((session.invalid_input_count ?? 0) >= 2) await sendQ3Goal(session);
      }
    }
    return;
  }

  if (state === "q4_sent") {
    const validIds = Q_PROJECT_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "has_project", opts.bodyText, answerId, "button");
      if (answerId === "proj_yes") {
        await sendQ4bProjectName(session);
      } else {
        await sendQ5Visit(session);
      }
    } else {
      const mapped = mapYesNo(rawText);
      if (mapped !== null) {
        const normId = mapped ? "proj_yes" : "proj_no";
        await saveAnswer(session.id, "has_project", rawText, normId, "text");
        if (mapped) {
          await sendQ4bProjectName(session);
        } else {
          await sendQ5Visit(session);
        }
      } else {
        await sendInvalidInput(session);
        if ((session.invalid_input_count ?? 0) >= 2) await sendQ4Project(session);
      }
    }
    return;
  }

  if (state === "q4b_sent") {
    // Free-text project name
    await saveAnswer(session.id, "project_name", rawText, rawText, "text");
    await sendQ5Visit(session);
    return;
  }

  if (state === "q5_sent") {
    const validIds = Q_VISIT_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "site_visit", opts.bodyText, answerId, "button");
      await sendQ6Notes(session);
    } else {
      const mapped = mapVisitText(rawText);
      if (mapped) {
        await saveAnswer(session.id, "site_visit", rawText, mapped, "text");
        await sendQ6Notes(session);
      } else {
        await sendInvalidInput(session);
        if ((session.invalid_input_count ?? 0) >= 2) await sendQ5Visit(session);
      }
    }
    return;
  }

  if (state === "q6_sent") {
    // Free-text notes (always accepted)
    const normalised = rawText.match(/^(لا|no|نا|لأ)$/i) ? "لا" : rawText;
    await saveAnswer(session.id, "notes", rawText, normalised, "text");
    await sendQ7ContactTime(session);
    return;
  }

  if (state === "q7_sent") {
    const validIds = Q_CONTACT_TIME_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "contact_time", opts.bodyText, answerId, "button");
      await finishQualification(session);
    } else {
      // Accept any non-empty free text as "any time"
      const fallback = rawText.length > 0 ? rawText : "contact_anytime";
      await saveAnswer(session.id, "contact_time", rawText, fallback, "text");
      await finishQualification(session);
    }
    return;
  }

  // For completed/terminal sessions: log handled above; no reply needed
}

// ── Public: nudge handler (called by scheduler) ───────────────────────────────

export async function handleNudge(
  sessionId: number,
  phone: string,
  currentRetryCount: number,
  sessionStatus?: string,
): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  const ELIGIBLE = [
    "greeting_sent","q1_sent","q2_sent","q3_sent","q4_sent",
    "q4b_sent","q5_sent","q6_sent","q7_sent","ai_concierge_active",
  ];
  if (!ELIGIBLE.includes(session.status)) return;

  await updateSession(sessionId, { retry_count: currentRetryCount + 1 });

  const isAiSession = (sessionStatus ?? session.status) === "ai_concierge_active";

  if (currentRetryCount === 0) {
    // Nudge 1 — 2 h silence — same for both AI and legacy
    await sendQualTextMessage(
      phone,
      isAiSession
        ? "مرحباً! 👋\n\nهل ما زلتم مهتمين بالحصول على خيارات تناسب احتياجاتكم؟\nأنا هنا إذا أردتم مواصلة الحوار. 🌟"
        : "مرحباً! 👋\n\nنودّ متابعة اهتمامكم بالعقارات الفاخرة مع *Kinglike Luxury*.\nهل أنتم متاحون؟"
    );
  } else {
    // Nudge 2 — 24 h silence
    await sendQualTextMessage(
      phone,
      isAiSession
        ? "مرحباً مجدداً 👋\n\nوجدنا بعض الفرص الجديدة التي قد تناسب ما تحدثنا عنه سابقاً.\nهل يمكننا إكمال الحوار؟ 🌟"
        : "مرحباً! 👋\n\nلا تزال لدينا فرص عقارية فاخرة قد تناسبكم.\nهل تودّون المتابعة مع *Kinglike Luxury*؟"
    );
  }
}

// ── Public: one-time migration — legacy sessions → ai_concierge_active ────────
//
// Runs on startup (idempotent).  Any session stuck in an old Q-flow state is
// upgraded so the next inbound message is handled by the AI concierge instead
// of the legacy button-driven handlers.
//
// Safe: does NOT touch leads, CRM data, answers, conversations, or messages.
//
export async function migrateLegacySessionsToAiConcierge(): Promise<void> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE wa_qual_sessions
      SET status            = 'ai_concierge_active',
          current_question  = 'ai_concierge',
          conversation_history = COALESCE(conversation_history, '[]'::jsonb)
      WHERE status IN (
        'greeting_sent','q1_sent','q2_sent','q3_sent','q4_sent',
        'q4b_sent','q5_sent','q6_sent','q7_sent','postponed'
      )
      RETURNING id
    `);
    const n = result.rowCount ?? 0;
    if (n > 0) {
      console.log(`[WaQual][MIGRATION] Upgraded ${n} legacy session(s) → ai_concierge_active`);
    } else {
      console.log("[WaQual][MIGRATION] No legacy sessions to migrate ✓");
    }
  } catch (err: any) {
    console.warn("[WaQual][MIGRATION] Migration warn:", err.message);
  } finally {
    client.release();
  }
}

// ── Public: admin API helpers ─────────────────────────────────────────────────

export async function getQualSessionForLead(leadId: number): Promise<any> {
  const client = await pool.connect();
  try {
    const r = await client.query(`
      SELECT s.*, sm.qual_score, sm.score_reason, sm.summary_text
      FROM wa_qual_sessions s
      LEFT JOIN wa_qual_summaries sm ON sm.session_id = s.id
      WHERE s.lead_id = $1
      LIMIT 1
    `, [leadId]);
    if (!r.rows[0]) return null;

    const session = r.rows[0];
    const answers = await getAnswers(session.id);
    return { session, answers };
  } finally {
    client.release();
  }
}

// Statuses where an active flow is in progress — restart is blocked
const ACTIVE_STATUSES = new Set([
  "idle", "template_sent", "greeting_sent",
  "q1_sent", "q2_sent", "q3_sent", "q4_sent", "q4b_sent",
  "q5_sent", "q6_sent", "q7_sent",
  "ai_concierge_active",
]);

export interface RestartResult {
  success:       boolean;
  wamid?:        string;
  error?:        string;
  sessionId?:    number;
  alreadyActive?: boolean;
}

/**
 * Admin-triggered re-qualification.
 *
 * — Blocks if an active (in-progress) session already exists.
 * — Resets any terminal session (timed_out / failed / opt_out / completed /
 *   already_qualified / postponed / expired / stopped / cancelled) in-place
 *   (clearing old answers + summaries) so the unique lead_id constraint is
 *   not violated.
 * — Sends `kinglike_qual_opener` template and returns the Meta API result
 *   (success, wamid, or exact error) to the caller.
 */
export async function restartQualification(leadId: number): Promise<RestartResult> {
  // ── 1. Fetch lead phone + any existing session ────────────────────────────
  const c1 = await pool.connect();
  let phone: string | null = null;
  let existingId: number | null = null;
  let existingStatus: string | null = null;
  try {
    const lr = await c1.query(
      `SELECT phone FROM crm_leads WHERE id = $1`,
      [leadId]
    );
    if (!lr.rows[0]) return { success: false, error: "Lead not found" };
    phone = lr.rows[0].phone ?? null;

    const sr = await c1.query(
      `SELECT id, status FROM wa_qual_sessions WHERE lead_id = $1 LIMIT 1`,
      [leadId]
    );
    if (sr.rows[0]) {
      existingId     = sr.rows[0].id;
      existingStatus = sr.rows[0].status;
    }
  } finally {
    c1.release();
  }

  if (!phone) return { success: false, error: "Lead has no phone number" };
  const digits = phone.replace(/[^0-9]/g, "");
  if (!digits) return { success: false, error: "Invalid phone number" };

  // ── 2. Block if an active session is running ──────────────────────────────
  if (existingId !== null && existingStatus !== null && ACTIVE_STATUSES.has(existingStatus)) {
    console.log(
      `[WaQual][RESTART] Blocked — leadId=${leadId} sessionId=${existingId} ` +
      `status=${existingStatus} is active`
    );
    return {
      success: false,
      alreadyActive: true,
      error: "Active WhatsApp qualification session already exists",
    };
  }

  // ── 3. Reset or create session ────────────────────────────────────────────
  const c2 = await pool.connect();
  let sessionId: number;
  try {
    if (existingId !== null) {
      // Clear old answers and summaries so history is clean
      await c2.query(`DELETE FROM wa_qual_answers  WHERE session_id = $1`, [existingId]);
      await c2.query(`DELETE FROM wa_qual_summaries WHERE session_id = $1`, [existingId]);

      // Reset session row in-place (preserves unique lead_id constraint)
      const resetR = await c2.query(`
        UPDATE wa_qual_sessions SET
          status               = 'idle',
          current_question     = NULL,
          last_message_at      = NOW(),
          last_outbound_wamid  = NULL,
          retry_count          = 0,
          invalid_input_count  = 0,
          completed_at         = NULL,
          created_at           = NOW()
        WHERE id = $1
        RETURNING id
      `, [existingId]);
      sessionId = resetR.rows[0].id;
      console.log(
        `[WaQual][RESTART] Reset session ${sessionId} from ${existingStatus} → idle leadId=${leadId}`
      );
    } else {
      // No session yet — create fresh
      const insertR = await c2.query(`
        INSERT INTO wa_qual_sessions
          (lead_id, phone, status, created_at, last_message_at)
        VALUES ($1, $2, 'idle', NOW(), NOW())
        RETURNING id
      `, [leadId, digits]);
      sessionId = insertR.rows[0].id;
      console.log(`[WaQual][RESTART] New session ${sessionId} created leadId=${leadId}`);
    }

    await c2.query(
      `UPDATE crm_leads SET qualification_status = 'in_progress' WHERE id = $1`,
      [leadId]
    );
  } finally {
    c2.release();
  }

  // ── 4. Send opener template — capture Meta API result ─────────────────────
  console.log(
    `[WaQual][RESTART] Sending kinglike_qual_opener to phone=${digits} ` +
    `sessionId=${sessionId} leadId=${leadId}`
  );
  const sendResult = await sendQualOpenerTemplate(digits);

  // Update session to reflect outcome
  await updateSession(sessionId, {
    status:              sendResult.success ? "template_sent" : "failed",
    current_question:    sendResult.success ? "opener_template" : null,
    last_message_at:     new Date(),
    last_outbound_wamid: sendResult.wamid ?? null,
    invalid_input_count: 0,
  });

  if (sendResult.success) {
    console.log(
      `[WaQual][RESTART] ✓ Template sent leadId=${leadId} sessionId=${sessionId} ` +
      `wamid=${sendResult.wamid}`
    );
  } else {
    console.error(
      `[WaQual][RESTART] ✗ Template failed leadId=${leadId} sessionId=${sessionId} ` +
      `error="${sendResult.error}"`
    );
    // Mark lead as failed so agents know
    const c3 = await pool.connect();
    try {
      await c3.query(
        `UPDATE crm_leads SET qualification_status = 'failed' WHERE id = $1`,
        [leadId]
      );
    } finally { c3.release(); }
  }

  return {
    success:   sendResult.success,
    wamid:     sendResult.wamid,
    error:     sendResult.error,
    sessionId,
  };
}

// ── Text mapping helpers ──────────────────────────────────────────────────────

function mapBudgetText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("200") || t.includes("٢٠٠"))        return "budget_gt200";
  if (t.includes("150") || t.includes("١٥٠"))        return "budget_150_200";
  if (t.includes("100") || t.includes("١٠٠"))        return "budget_100_150";
  if (t.includes("80")  || t.includes("٨٠"))         return "budget_80_100";
  if (t.includes("50")  || t.includes("٥٠"))         return "budget_50_80";
  if (t.includes("أقل") || t.includes("اقل") || t.includes("less")) return "budget_lt50";
  return null;
}

function mapTimelineText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.match(/هذا الشهر|this month|الآن|now|فوري/))   return "timeline_1m";
  if (t.match(/3|ثلاث|3 أشهر|three/))                  return "timeline_3m";
  if (t.match(/6|ست|سنة|year|later|لاحق/))             return "timeline_6m+";
  return null;
}

function mapGoalText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.match(/استثمار وسكن|both|كلاهما|invest.*reside|reside.*invest/)) return "goal_both";
  if (t.match(/استثمار|invest/))                                          return "goal_invest";
  if (t.match(/سكن|reside|live/))                                         return "goal_reside";
  return null;
}

function mapYesNo(text: string): boolean | null {
  const t = text.toLowerCase().trim();
  if (t.match(/^(نعم|yes|اه|ايه|أيوا|يلا|اوك|ok|sure|بالتأكيد|طبعا)/)) return true;
  if (t.match(/^(لا|no|لأ|نا|ما)/))                                      return false;
  return null;
}

function mapVisitText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.match(/نعم.*شهر|خلال شهر|yes.*month|within month|visit_1m/)) return "visit_1m";
  if (t.match(/ربما|maybe|لاحق|later/))                               return "visit_later";
  if (t.match(/^لا$|^no$/))                                           return "visit_no";
  return null;
}
