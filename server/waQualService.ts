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

// Q1 — Country (4 options → renders as list message automatically)
const Q_COUNTRY_OPTIONS = [
  { id: "country_georgia", title: "جورجيا" },
  { id: "country_turkey",  title: "تركيا" },
  { id: "country_cyprus",  title: "قبرص الشمالية" },
  { id: "country_dubai",   title: "دبي" },
];

// Q2 — Purchase goal (2 options → reply buttons)
const Q_PURPOSE_OPTIONS = [
  { id: "purpose_invest", title: "استثمار" },
  { id: "purpose_reside", title: "للسكن" },
];

// Q3 — Budget (3 options → reply buttons)
const Q_BUDGET_OPTIONS = [
  { id: "budget_70_100",  title: "ما بين 70 إلى 100 ألف دولار" },
  { id: "budget_110_150", title: "ما بين 110 إلى 150 ألف دولار" },
  { id: "budget_gt150",   title: "أكثر من 150 ألف دولار" },
];

// Q4 — Preferred contact time (3 options → reply buttons)
const Q_CONTACT_TIME_OPTIONS = [
  { id: "contact_morning", title: "في ساعات الصباح" },
  { id: "contact_noon",    title: "ظهراً" },
  { id: "contact_evening", title: "مساءً" },
];

// Q5 — Specific project interest (2 options → reply buttons)
const Q_PROJECT_INTEREST_OPTIONS = [
  { id: "project_yes", title: "نعم" },
  { id: "project_no",  title: "لا يوجد" },
];

// ── Human-readable Arabic labels for summary generation ─────────────────────

const COUNTRY_LABEL: Record<string, string> = {
  "country_georgia": "جورجيا",
  "country_turkey":  "تركيا",
  "country_cyprus":  "قبرص الشمالية",
  "country_dubai":   "دبي",
};
const PURPOSE_LABEL: Record<string, string> = {
  "purpose_invest": "استثمار",
  "purpose_reside": "للسكن",
};
const BUDGET_LABEL: Record<string, string> = {
  "budget_70_100":  "70 - 100 ألف دولار",
  "budget_110_150": "110 - 150 ألف دولار",
  "budget_gt150":   "أكثر من 150 ألف دولار",
};
const CONTACT_TIME_LABEL: Record<string, string> = {
  "contact_morning": "الصباح",
  "contact_noon":    "الظهر",
  "contact_evening": "المساء",
};
const PROJECT_INTEREST_LABEL: Record<string, string> = {
  "project_yes": "نعم",
  "project_no":  "لا يوجد",
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
  const budget = answers["budget_range"] ?? "";
  if (budget === "budget_gt150")   { points = 2; reasons.push("Budget >150k"); }
  else if (budget === "budget_110_150") { points = 1; reasons.push("Budget 110-150k"); }
  else if (budget === "budget_70_100")  { points = 0; reasons.push("Budget 70-100k"); }

  // Investment purpose bonus
  const purpose = answers["purpose"] ?? "";
  if (purpose === "purpose_invest") {
    points += 1;
    reasons.push("Investment purpose");
  }

  // Specific project interest bonus
  const projectInterest = answers["project_interest"] ?? "";
  if (projectInterest === "project_yes") {
    points += 1;
    reasons.push("Interested in specific project");
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

    const budgetLabel      = labelOf(BUDGET_LABEL,       answers["budget_range"]);
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
// Next:  any inbound reply → window opens → sendQ1Country (QUALIFICATION_STARTED)
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

async function sendQ1Country(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q1_sent", "country", () =>
    sendInteractiveMessage(
      session.phone,
      "ما هي الدولة التي تودون شراء العقار بها؟",
      Q_COUNTRY_OPTIONS,
    )
  );
}

async function sendQ2Purpose(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q2_sent", "purpose", () =>
    sendInteractiveMessage(
      session.phone,
      "ما هي الغاية من الشراء؟",
      Q_PURPOSE_OPTIONS,
    )
  );
}

async function sendQ3Budget(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q3_sent", "budget_range", () =>
    sendInteractiveMessage(
      session.phone,
      "ما هي الميزانية التقريبية؟",
      Q_BUDGET_OPTIONS,
    )
  );
}

async function sendQ4ContactTime(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q4_sent", "contact_time", () =>
    sendInteractiveMessage(
      session.phone,
      "هل يوجد وقت محدد مناسب للتواصل معكم؟",
      Q_CONTACT_TIME_OPTIONS,
    )
  );
}

async function sendQ5ProjectInterest(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q5_sent", "project_interest", () =>
    sendInteractiveMessage(
      session.phone,
      "هل يوجد مشروع معين مهتمين به؟",
      Q_PROJECT_INTEREST_OPTIONS,
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
    `شكراً لتزويدنا بالمعلومات، سيقوم أحد مستشارينا العقاريين بالتواصل معكم لتزويدكم بكافة التفاصيل.\n` +
    `نهاركم سعيد 🎖🌷\n\n` +
    `https://www.kinglikeluxury.app`;

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

  const summaryLines: string[] = [
    `الدولة: ${labelOf(COUNTRY_LABEL, answers["country"])}`,
    `الهدف: ${labelOf(PURPOSE_LABEL, answers["purpose"])}`,
    `المدينة: ${city ?? "—"}`,
    `الميزانية: ${labelOf(BUDGET_LABEL, answers["budget_range"])}`,
    `وقت التواصل: ${preferredContact}`,
    `مشروع محدد: ${labelOf(PROJECT_INTEREST_LABEL, answers["project_interest"])}`,
  ];
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

    // QUAL_YES button OR any free-text reply → window open, start button qualification flow
    console.log(`[WaQual][WINDOW_OPENED] sessionId=${session.id} phone=${digits} payload=${answerId ?? "free-text"}`);
    console.log(`[WaQual][QUAL_STARTED] sessionId=${session.id} phone=${digits}`);

    // Mark lead as Interested in CRM
    await updateWaStage(session.lead_id, 'interested');

    // Send welcome message then Q1 (Country)
    await sendQualTextMessage(
      session.phone,
      "أهلاً وسهلاً بكم في Kinglike Luxury للاستثمار والتطوير العقاري.\n" +
      "يرجى اختيار الإجابات من الأسئلة التالية لكي نقوم بتزويدكم بأفضل عقار مناسب لكم."
    );
    await sendQ1Country(session);
    return;
  }

  // ── Truly legacy states → upgrade to AI concierge ────────────────────────
  //
  // Sessions stuck in old free-text states (greeting_sent, q4b_sent, q6_sent,
  // q7_sent) or postponed are transparently handed to the AI concierge so the
  // client gets a coherent reply.  q1-q5 are intentionally excluded: they are
  // handled by the new button-only flow below.
  //
  const LEGACY_UPGRADE_STATES = new Set([
    "greeting_sent", "q4b_sent", "q6_sent", "q7_sent", "postponed",
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

  // ── Button qualification flow (q1–q5) ────────────────────────────────────

  if (state === "q1_sent") {
    const validIds = Q_COUNTRY_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "country", opts.bodyText, answerId, "list");
      await sendQ2Purpose(session);
    } else {
      await sendInvalidInput(session);
    }
    return;
  }

  if (state === "q2_sent") {
    const validIds = Q_PURPOSE_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "purpose", opts.bodyText, answerId, "button");
      await sendQ3Budget(session);
    } else {
      await sendInvalidInput(session);
    }
    return;
  }

  if (state === "q3_sent") {
    const validIds = Q_BUDGET_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "budget_range", opts.bodyText, answerId, "button");
      await sendQ4ContactTime(session);
    } else {
      await sendInvalidInput(session);
    }
    return;
  }

  if (state === "q4_sent") {
    const validIds = Q_CONTACT_TIME_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "contact_time", opts.bodyText, answerId, "button");
      await sendQ5ProjectInterest(session);
    } else {
      await sendInvalidInput(session);
    }
    return;
  }

  if (state === "q5_sent") {
    const validIds = Q_PROJECT_INTEREST_OPTIONS.map(o => o.id);
    if (answerId && validIds.includes(answerId)) {
      await saveAnswer(session.id, "project_interest", opts.bodyText, answerId, "button");
      await finishQualification(session);
    } else {
      await sendInvalidInput(session);
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
        'greeting_sent','q4b_sent','q6_sent','q7_sent','postponed'
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

