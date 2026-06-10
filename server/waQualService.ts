/**
 * WhatsApp Lead Qualification Service v2.1
 *
 * Interactive step-by-step qualification flow using Meta Cloud API
 * reply buttons and list messages.
 *
 * State machine:
 *   idle → template_sent → q1_sent → q2_sent → q3_sent → q4_sent
 *                       → [q4b_sent] → q5_sent → q6_sent → completed
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

// ── Session helpers ───────────────────────────────────────────────────────────

interface Session {
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

async function updateSession(
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

async function saveAnswer(
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

async function getAnswers(sessionId: number): Promise<Record<string, string>> {
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
): Promise<void> {
  const client = await pool.connect();
  try {
    const mappedLeadScore =
      score === "VIP" || score === "HOT" ? "hot"
      : score === "WARM" ? "warm"
      : "cold";

    await client.query(`
      UPDATE crm_leads
      SET qualification_status  = $1,
          qualification_score   = $2,
          qualification_summary = $3,
          qualified_at          = NOW(),
          lead_score            = $4
      WHERE id = $5
    `, [status, score, summary, mappedLeadScore, leadId]);
  } finally {
    client.release();
  }
}

async function createCrmNotification(
  leadId: number,
  score: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    // Get assigned user for the lead
    const lr = await client.query(
      `SELECT assigned_to, full_name FROM crm_leads WHERE id = $1`,
      [leadId]
    );
    const lead = lr.rows[0];
    if (!lead || !lead.assigned_to) return;

    await client.query(`
      INSERT INTO user_notifications
        (user_id, type, title, message, data, is_read, created_at)
      VALUES ($1, 'qualification_complete', $2, $3, $4, false, NOW())
    `, [
      lead.assigned_to,
      `Lead Qualified: ${score}`,
      `${lead.full_name ?? "A lead"} completed WhatsApp qualification with score: ${score}`,
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
      "ما هي ميزانيتك التقريبية؟ (بالدولار الأمريكي) 💰",
      Q_BUDGET_OPTIONS,
    )
  );
}

async function sendQ2Timeline(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q2_sent", "timeline", () =>
    sendInteractiveMessage(
      session.phone,
      "متى تخطط للشراء؟ 📅",
      Q_TIMELINE_OPTIONS,
    )
  );
}

async function sendQ3Goal(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q3_sent", "goal", () =>
    sendInteractiveMessage(
      session.phone,
      "ما هو هدفك الرئيسي من الشراء؟ 🎯",
      Q_GOAL_OPTIONS,
    )
  );
}

async function sendQ4Project(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q4_sent", "has_project", () =>
    sendInteractiveMessage(
      session.phone,
      "هل لديك مشروع عقاري محدد في ذهنك؟ 🏢",
      Q_PROJECT_OPTIONS,
    )
  );
}

async function sendQ4bProjectName(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q4b_sent", "project_name", () =>
    sendQualTextMessage(
      session.phone,
      "رائع! ما اسم المشروع الذي تهتم به؟ (اكتب اسمه)"
    )
  );
}

async function sendQ5Visit(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q5_sent", "site_visit", () =>
    sendInteractiveMessage(
      session.phone,
      "هل تريد زيارة مشاريعنا خلال الشهر القادم؟ 📍",
      Q_VISIT_OPTIONS,
    )
  );
}

async function sendQ6Notes(session: Session): Promise<void> {
  await sendAndUpdateSession(session, "q6_sent", "notes", () =>
    sendQualTextMessage(
      session.phone,
      "شكراً! هل لديك أي ملاحظات أو متطلبات إضافية؟\n(اكتب ملاحظاتك أو أرسل \"لا\" للتخطي)"
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
    `تم حفظ تفضيلاتك بنجاح. سيتواصل معك أحد مستشارينا المتخصصين قريباً لمساعدتك في ` +
    `إيجاد عقار أحلامك. 🏠\n\n` +
    `*Kinglike Luxury* — جودة لا تُضاهى.`;

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
    "نفهم تماماً! إذا احتجت مساعدة في المستقبل، لا تتردد في التواصل معنا. 🙏\n" +
    "*Kinglike Luxury* — في خدمتك دائماً.";

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

async function finishQualification(session: Session): Promise<void> {
  const answers   = await getAnswers(session.id);
  const { score, reason } = computeScore(answers);

  const summaryLines: string[] = [
    `Score: ${score} (${reason})`,
    `Budget: ${answers["budget"] ?? "not given"}`,
    `Timeline: ${answers["timeline"] ?? "not given"}`,
    `Goal: ${answers["goal"] ?? "not given"}`,
    `Project: ${answers["has_project"] === "proj_yes" ? (answers["project_name"] ?? "specified") : "needs suggestions"}`,
    `Site visit: ${answers["site_visit"] ?? "not given"}`,
    `Notes: ${answers["notes"] && answers["notes"] !== "لا" ? answers["notes"] : "none"}`,
  ];
  const summaryText = summaryLines.join(" | ");

  // Get lead info for personalisation
  const client = await pool.connect();
  let firstName: string | null = null;
  try {
    const lr = await client.query(
      `SELECT first_name FROM crm_leads WHERE id = $1`,
      [session.lead_id]
    );
    firstName = lr.rows[0]?.first_name ?? null;
  } finally {
    client.release();
  }

  // Send completion message
  await sendCompletion(session, firstName, score);

  // Save summary
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

  // Update CRM lead
  await updateCrmLeadScore(session.lead_id, score, "completed", summaryText);

  // Create in-app notification for assigned agent
  await createCrmNotification(session.lead_id, score);

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

  // ── template_sent: button-gated opener ──────────────────────────────────
  if (state === "template_sent") {
    const isYes  = answerId === "QUAL_YES"
                || rawText.match(/^(نعم|yes|اه|ايه|أيوا|يلا|هيا|ابدأ|اوك|ok|sure|✅)/i) !== null;
    const isLater = answerId === "QUAL_LATER";

    if (isLater) {
      // User chose "⏳ لاحقاً" — postpone; no further outbound messages
      await updateSession(session.id, {
        status:           "postponed",
        last_message_at:  new Date(),
      });
      console.log(
        `[WaQual][QUALIFICATION_POSTPONED] sessionId=${session.id} phone=${digits}`
      );
      return;
    }

    // QUAL_YES button OR any free-text reply → window is open, start Q1
    console.log(`[WaQual][WINDOW_OPENED] sessionId=${session.id} phone=${digits} answerId=${answerId ?? "text"}`);
    console.log(`[WaQual][QUALIFICATION_STARTED] sessionId=${session.id} phone=${digits}`);
    await sendQ1Budget(session);
    console.log(`[WaQual][QUESTION_SENT] sessionId=${session.id} question=Q1_budget phone=${digits}`);
    return;
  }

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
    await finishQualification(session);
    return;
  }

  // For completed/terminal sessions: log handled above; no reply needed
}

// ── Public: nudge handler (called by scheduler) ───────────────────────────────

export async function handleNudge(
  sessionId: number,
  phone: string,
  currentRetryCount: number,
): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) return;
  if (!["greeting_sent","q1_sent","q2_sent","q3_sent","q4_sent","q4b_sent","q5_sent","q6_sent"].includes(session.status)) return;

  await updateSession(sessionId, { retry_count: currentRetryCount + 1 });

  await sendQualTextMessage(
    phone,
    "مرحباً! 👋 نودّ متابعة استفساركم عن العقارات الفاخرة. هل أنت مستعد للمتابعة؟"
  );
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

export async function restartQualification(leadId: number): Promise<void> {
  const client = await pool.connect();
  try {
    // Mark old session failed
    await client.query(`
      UPDATE wa_qual_sessions
      SET status = 'failed', completed_at = NOW()
      WHERE lead_id = $1 AND status NOT IN ('completed')
    `, [leadId]);

    // Get lead info
    const lr = await client.query(
      `SELECT phone, first_name FROM crm_leads WHERE id = $1`,
      [leadId]
    );
    const lead = lr.rows[0];
    if (!lead?.phone) return;

    await client.query(`
      UPDATE crm_leads SET qualification_status = 'in_progress' WHERE id = $1
    `, [leadId]);
  } finally {
    client.release();
  }

  const lr2 = await pool.connect();
  try {
    const r = await lr2.query(`SELECT phone, first_name FROM crm_leads WHERE id = $1`, [leadId]);
    const lead = r.rows[0];
    if (lead) await checkAndTrigger(leadId, lead.phone, lead.first_name);
  } finally {
    lr2.release();
  }
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
