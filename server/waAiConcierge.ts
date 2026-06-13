/**
 * WhatsApp AI Sales Concierge
 *
 * Replaces the rigid Q1–Q7 questionnaire with a natural, luxury, human-like
 * Arabic real estate conversation powered by OpenAI function calling.
 *
 * Integrates with the existing waQualService session / scoring / CRM infrastructure.
 * All extracted answers are saved to wa_qual_answers using the same keys as the
 * legacy questionnaire so scoring and CRM summaries remain fully compatible.
 *
 * DB additions (idempotent at startup):
 *   wa_qual_sessions.conversation_history  JSONB  DEFAULT '[]'
 *   wa_qual_sessions.turn_count            INT    DEFAULT 0
 */

import OpenAI from "openai";
import { pool } from "./db";
import { sendQualTextMessage } from "./interactiveMessageHelper";
import {
  Session,
  updateSession,
  saveAnswer,
  getAnswers,
  finishQualification,
} from "./waQualService";

// ── OpenAI client ─────────────────────────────────────────────────────────────

const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
const openai: OpenAI | null = apiKey ? new OpenAI({ apiKey }) : null;

const MAX_TURNS = 10; // safety cap — force completion after 10 user messages

// ── DB setup ─────────────────────────────────────────────────────────────────

export async function ensureAiConciergeColumns(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE wa_qual_sessions
        ADD COLUMN IF NOT EXISTS conversation_history JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS turn_count           INTEGER DEFAULT 0
    `);
    console.log("[AiConcierge] Columns ensured ✓");
  } catch (e: any) {
    console.warn("[AiConcierge] Column setup warn:", e.message);
  } finally {
    client.release();
  }
}

// Run once on module load (and guarded inside entry points for safety)
let _columnsReady = false;
ensureAiConciergeColumns()
  .then(() => { _columnsReady = true; })
  .catch(() => {});

async function guardColumns(): Promise<void> {
  if (_columnsReady) return;
  await ensureAiConciergeColumns();
  _columnsReady = true;
}

// ── Conversation history helpers ──────────────────────────────────────────────

interface ConvMessage {
  role: "user" | "assistant";
  content: string;
}

async function loadHistory(sessionId: number): Promise<ConvMessage[]> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT COALESCE(conversation_history, '[]'::jsonb) AS history
       FROM wa_qual_sessions WHERE id = $1`,
      [sessionId]
    );
    const raw = r.rows[0]?.history;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [];
  } finally {
    client.release();
  }
}

async function appendAndIncrementTurn(
  sessionId: number,
  userMsg: ConvMessage,
  assistantMsg: ConvMessage,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE wa_qual_sessions
      SET conversation_history = COALESCE(conversation_history, '[]'::jsonb) || $1::jsonb,
          turn_count = COALESCE(turn_count, 0) + 1
      WHERE id = $2
    `, [JSON.stringify([userMsg, assistantMsg]), sessionId]);
  } finally {
    client.release();
  }
}

async function appendAssistantOnly(sessionId: number, msg: ConvMessage): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE wa_qual_sessions
      SET conversation_history = COALESCE(conversation_history, '[]'::jsonb) || $1::jsonb
      WHERE id = $2
    `, [JSON.stringify([msg]), sessionId]);
  } finally {
    client.release();
  }
}

async function getTurnCount(sessionId: number): Promise<number> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT COALESCE(turn_count, 0) AS turn_count FROM wa_qual_sessions WHERE id = $1`,
      [sessionId]
    );
    return Number(r.rows[0]?.turn_count ?? 0);
  } finally {
    client.release();
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `أنت مستشار عقاري من شركة Kinglike Luxury للعقارات الفاخرة.
اسمك مها. تتواصل مع العملاء عبر واتساب.

أسلوبك: دافئ، راقٍ، واثق، طبيعي — كصديق خبير، لا كبوت مبيعات.

مهمتك الأساسية:
أجب على سؤال العميل أولاً بشكل طبيعي، ثم اجمع هذه البيانات بشكل تدريجي خلال المحادثة:
  • الميزانية التقريبية (بالدولار)
  • هدف الشراء: استثمار / سكن / كلاهما
  • الجدول الزمني للشراء
  • المدينة أو البلد المفضل
  • الوقت المفضل للتواصل

قواعد صارمة:
1. سؤال واحد فقط في كل رسالة — لا أكثر.
2. أجب على سؤال العميل أولاً قبل طرح أي سؤال.
3. ردود قصيرة مناسبة لواتساب (3-4 أسطر كحد أقصى).
4. لا تذكر أسعاراً محددة أو نسب عوائد استثمارية أو ضمانات.
5. لا تعطِ نصائح قانونية أو ضريبية أو تأشيرة أو إقامة.
6. لا ترسل روابط.
7. إيموجي واحد أو اثنان كحد أقصى في الرسالة الواحدة.
8. لا تضغط على العميل ولا تُلح.
9. إذا سأل عن مشروع أو منطقة: أجب بإيجاز وأضف سؤالاً واحداً يخدم فهم احتياجه.
10. إذا قال "أريد التحدث مع شخص حقيقي" أو ما شابه: أبلغه أن المستشار سيتواصل معه مباشرة.
11. إذا سُئلت عن ضمانات الإقامة أو الجنسية أو التأشيرة: "التفاصيل القانونية يوضحها مستشارنا المختص."

سياق الشركة:
- Kinglike Luxury للعقارات الفاخرة — جورجيا (تبليسي، باتومي، غوداوري، أنانوري).
- شقق، فلل، أراضٍ، مشاريع قيد الإنشاء.
- خيارات تقسيط مرنة مع المطورين — التفاصيل عبر المستشار.
- الإقامة الجورجية ممكنة للمستثمرين الأجانب — التفاصيل عبر المستشار.

عند الإنهاء:
إذا جمعت على الأقل: الميزانية + الهدف + وقت التواصل — أبلغ العميل أن مستشاراً متخصصاً سيتواصل معه قريباً، واضبط is_ready_to_close على true.`;

// ── OpenAI tool definition ────────────────────────────────────────────────────

const CONCIERGE_TOOL = {
  type: "function" as const,
  function: {
    name: "send_reply_and_update",
    description:
      "Send a WhatsApp reply to the client and update any qualification data just extracted from their message.",
    parameters: {
      type: "object",
      properties: {
        arabic_reply: {
          type: "string",
          description: "The Arabic reply to send (short, elegant, max 4 lines)",
        },
        extracted: {
          type: "object",
          description: "Qualification fields extracted or confirmed in this turn (only include fields you are confident about)",
          properties: {
            budget: {
              type: "string",
              description:
                "Budget in USD. Use standard IDs: budget_lt50 | budget_50_80 | budget_80_100 | budget_100_150 | budget_150_200 | budget_gt200. If unsure, use a plain text description.",
            },
            goal: {
              type: "string",
              enum: ["goal_invest", "goal_reside", "goal_both"],
              description: "Purchase goal",
            },
            timeline: {
              type: "string",
              enum: ["timeline_1m", "timeline_3m", "timeline_6m+"],
              description: "Purchase timeline",
            },
            city_country: {
              type: "string",
              description: "Preferred city or country the client mentioned",
            },
            contact_time: {
              type: "string",
              enum: ["contact_morning", "contact_afternoon", "contact_evening", "contact_anytime"],
              description: "Preferred contact time",
            },
            project_interest: {
              type: "string",
              description: "Specific project name mentioned by the client",
            },
          },
          additionalProperties: false,
        },
        is_ready_to_close: {
          type: "boolean",
          description:
            "Set to true only when you have confirmed at least: budget + goal + contact_time. Then send a warm closing message and set this to true.",
        },
      },
      required: ["arabic_reply", "is_ready_to_close"],
    },
  },
};

// ── AI generation ─────────────────────────────────────────────────────────────

interface AiTurnResult {
  reply: string;
  extracted: {
    budget?: string;
    goal?: string;
    timeline?: string;
    city_country?: string;
    contact_time?: string;
    project_interest?: string;
  };
  isReadyToClose: boolean;
}

async function generateConciergeReply(
  sessionId: number,
  firstName: string | null,
  userMessage: string,
  existingAnswers: Record<string, string>,
): Promise<AiTurnResult> {
  const history = await loadHistory(sessionId);

  // Build context about what we already know to prevent re-asking
  const known: string[] = [];
  if (existingAnswers.budget)       known.push(`الميزانية: ${existingAnswers.budget}`);
  if (existingAnswers.goal)         known.push(`الهدف: ${existingAnswers.goal}`);
  if (existingAnswers.timeline)     known.push(`التوقيت: ${existingAnswers.timeline}`);
  if (existingAnswers.city_country) known.push(`المدينة/البلد: ${existingAnswers.city_country}`);
  if (existingAnswers.contact_time) known.push(`وقت التواصل: ${existingAnswers.contact_time}`);

  const systemPrompt =
    BASE_SYSTEM_PROMPT +
    (firstName ? `\n\nاسم العميل: ${firstName}` : "") +
    (known.length > 0
      ? `\n\nمعلومات مجمّعة بالفعل (لا تسأل عنها مجدداً):\n${known.join("\n")}`
      : "");

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  if (!openai) {
    console.warn("[AiConcierge] OpenAI not available — using fallback reply");
    return {
      reply:
        "شكراً على تواصلك معنا! 🌟\nسيتواصل معك أحد مستشارينا المتخصصين قريباً.",
      extracted: {},
      isReadyToClose: false,
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: [CONCIERGE_TOOL],
      tool_choice: { type: "function", function: { name: "send_reply_and_update" } },
      max_tokens: 400,
      temperature: 0.7,
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("No tool call arguments returned");
    }

    const args = JSON.parse(toolCall.function.arguments);

    return {
      reply:         args.arabic_reply ?? "شكراً! سيتواصل معك فريقنا قريباً. 🌟",
      extracted:     args.extracted ?? {},
      isReadyToClose: args.is_ready_to_close ?? false,
    };
  } catch (err: any) {
    console.error(`[AiConcierge] OpenAI error sessionId=${sessionId}:`, err.message);
    return {
      reply:
        "عذراً، حدث خطأ تقني مؤقت. 🙏\nسيتواصل معك أحد مستشارينا مباشرة.",
      extracted: {},
      isReadyToClose: false,
    };
  }
}

// ── Budget normaliser ─────────────────────────────────────────────────────────

function normalizeBudget(raw: string): string {
  if (!raw) return raw;
  // Already a known ID?
  const KNOWN_IDS = [
    "budget_lt50", "budget_50_80", "budget_80_100",
    "budget_100_150", "budget_150_200", "budget_gt200",
  ];
  if (KNOWN_IDS.includes(raw)) return raw;

  const lower = raw.toLowerCase();
  const nums  = (raw.match(/\d+/g) ?? []).map(Number);
  const max   = nums.length ? Math.max(...nums) : 0;
  const min   = nums.length ? Math.min(...nums) : 0;

  if (lower.includes(">200") || lower.includes("gt200") || max >= 200)                return "budget_gt200";
  if ((min >= 150 && min < 200) || (max >= 150 && max < 200))                         return "budget_150_200";
  if ((min >= 100 && min < 150) || (max >= 100 && max < 150))                         return "budget_100_150";
  if ((min >= 80  && min < 100) || (max >= 80  && max < 100))                         return "budget_80_100";
  if ((min >= 50  && min < 80)  || (max >= 50  && max < 80))                          return "budget_50_80";
  if (lower.includes("<50") || lower.includes("lt50") || (max > 0 && max < 50))       return "budget_lt50";
  return raw; // keep free-text for display; scoring will use 0 points
}

// ── Public: start AI concierge after QUAL_YES ─────────────────────────────────

export async function startConciergeConversation(
  session: Session,
  firstName: string | null,
): Promise<void> {
  await guardColumns();
  const name     = firstName?.trim() || "";
  const greeting = name ? `أهلاً ${name}! 🌟` : "أهلاً! 🌟";

  const openingMessage =
    `${greeting}\n` +
    `أنا مها من فريق *Kinglike Luxury* للعقارات الفاخرة.\n\n` +
    `يسعدني مساعدتك في إيجاد ما يناسبك تماماً. ✨\n\n` +
    `ما الذي يشغل فكرك — الاستثمار، السكن، أم شيء آخر؟`;

  const result = await sendQualTextMessage(session.phone, openingMessage);

  // Persist opening message + set status to ai_concierge_active
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE wa_qual_sessions
      SET conversation_history = $1::jsonb,
          turn_count            = 0,
          status                = 'ai_concierge_active',
          current_question      = 'ai_concierge',
          last_message_at       = NOW(),
          last_outbound_wamid   = $2,
          invalid_input_count   = 0
      WHERE id = $3
    `, [
      JSON.stringify([{ role: "assistant", content: openingMessage }]),
      result.wamid ?? null,
      session.id,
    ]);
  } finally {
    client.release();
  }

  console.log(
    `[AiConcierge] Started sessionId=${session.id} phone=${session.phone} ` +
    `firstName="${name || "—"}"`
  );
}

// ── Public: handle each inbound message while AI is active ───────────────────

export async function handleConciergeMessage(
  session: Session,
  opts: {
    phone:    string;
    bodyText: string;
    wamid?:   string;
    buttonId?: string;
    listId?:   string;
  },
): Promise<void> {
  await guardColumns();
  const rawText  = opts.bodyText.trim();
  const turnCount = await getTurnCount(session.id);

  // ── Fetch first name ─────────────────────────────────────────────────────
  const dbClient = await pool.connect();
  let firstName: string | null = null;
  try {
    const r = await dbClient.query(
      `SELECT first_name FROM crm_leads WHERE id = $1`,
      [session.lead_id]
    );
    firstName = r.rows[0]?.first_name ?? null;
  } finally {
    dbClient.release();
  }

  // ── Already have enough info or hit turn cap? ────────────────────────────
  if (turnCount >= MAX_TURNS) {
    console.log(
      `[AiConcierge] Max turns reached sessionId=${session.id} — forcing completion`
    );
    const closingMsg =
      `شكراً جزيلاً على وقتك! 🙏\n\n` +
      `سيتواصل معك أحد مستشارينا المتخصصين قريباً لمساعدتك بشكل كامل.\n\n` +
      `*Kinglike Luxury — الفخامة في كل تفصيلة.*`;

    await sendQualTextMessage(session.phone, closingMsg);
    await finishQualification(session);
    return;
  }

  // ── Load existing answers and generate AI reply ──────────────────────────
  const existingAnswers = await getAnswers(session.id);

  const { reply, extracted, isReadyToClose } = await generateConciergeReply(
    session.id,
    firstName,
    rawText,
    existingAnswers,
  );

  // ── Persist extracted fields ─────────────────────────────────────────────
  if (extracted.budget) {
    const norm = normalizeBudget(extracted.budget);
    await saveAnswer(session.id, "budget", extracted.budget, norm, "text");
  }

  if (extracted.goal && ["goal_invest", "goal_reside", "goal_both"].includes(extracted.goal)) {
    await saveAnswer(session.id, "goal", extracted.goal, extracted.goal, "text");
  }

  if (extracted.timeline && ["timeline_1m", "timeline_3m", "timeline_6m+"].includes(extracted.timeline)) {
    await saveAnswer(session.id, "timeline", extracted.timeline, extracted.timeline, "text");
  }

  if (extracted.city_country) {
    await saveAnswer(session.id, "city_country", extracted.city_country, extracted.city_country, "text");
    // Also write city to crm_leads so it appears in the qualification summary
    const cityClient = await pool.connect();
    try {
      await cityClient.query(
        `UPDATE crm_leads SET city = $1 WHERE id = $2 AND (city IS NULL OR city = '')`,
        [extracted.city_country, session.lead_id]
      );
    } finally {
      cityClient.release();
    }
  }

  if (
    extracted.contact_time &&
    ["contact_morning", "contact_afternoon", "contact_evening", "contact_anytime"].includes(
      extracted.contact_time
    )
  ) {
    await saveAnswer(session.id, "contact_time", extracted.contact_time, extracted.contact_time, "text");
  }

  if (extracted.project_interest) {
    await saveAnswer(session.id, "project_name", extracted.project_interest, extracted.project_interest, "text");
    await saveAnswer(session.id, "has_project",   "proj_yes",                "proj_yes",                "text");
  }

  // ── Send reply ───────────────────────────────────────────────────────────
  const sendResult = await sendQualTextMessage(session.phone, reply);

  // ── Update conversation history and session ──────────────────────────────
  await appendAndIncrementTurn(
    session.id,
    { role: "user",      content: rawText },
    { role: "assistant", content: reply   },
  );

  await updateSession(session.id, {
    last_message_at:     new Date(),
    last_outbound_wamid: sendResult.wamid ?? null,
    invalid_input_count: 0,
  });

  // ── Finish if AI is done ─────────────────────────────────────────────────
  if (isReadyToClose) {
    console.log(
      `[AiConcierge] Closing session sessionId=${session.id} leadId=${session.lead_id}`
    );
    await finishQualification(session);
  }
}
