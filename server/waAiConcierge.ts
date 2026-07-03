/**
 * WhatsApp AI Sales Concierge — v4 (Conversion-First)
 *
 * Luxury real estate investment closer powered by OpenAI function calling.
 * Primary KPIs: advisor handovers, appointment bookings, qualified leads.
 *
 * Features:
 *  • Comprehensive luxury consultant persona (أحمد) — NOT customer support
 *  • Answer-First rule enforced hard — every question gets a real answer
 *  • Conversion psychology: curiosity, micro-commitments, memory reuse, desire creation
 *  • Objection handling: price / trust / timing / ROI / developer / location
 *  • Property match scoring (internal, surfaced naturally when useful)
 *  • Human takeover prediction — detects high-intent signals, escalates to hot lead
 *  • Message splitting: 1–4 short parts sent with 1 200 ms delays between them
 *  • Auto CRM task creation when client gives exact contact time
 *  • Employee WhatsApp notification after task creation
 *  • Compatible with existing CRM scoring / wa_qual_answers / waQualService infra
 *
 * DB additions (idempotent):
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

// ── OpenAI client ──────────────────────────────────────────────────────────────

const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
const openai: OpenAI | null = apiKey ? new OpenAI({ apiKey }) : null;
if (openai) console.log("[AiConcierge] OpenAI client initialised ✓");
else        console.warn("[AiConcierge] OPENAI_API_KEY not set — fallback mode");

const MAX_TURNS = 20; // raised from 10 to allow richer conversations

// ── DB setup ──────────────────────────────────────────────────────────────────

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

// NOTE: This used to self-invoke ensureAiConciergeColumns() at module load
// time (fires as soon as this file is imported, uncontrolled by startup
// order). That was a duplicate of the same call already made sequentially
// via the ensureWaQualTables() boot chain in server/index.ts, and the extra
// concurrent pool.connect() it introduced contributed to an intermittent
// "double release" race in the Neon serverless driver at startup. The
// guardColumns() lazy-check below still ensures columns exist on first use
// even if called before the boot chain finishes, so removing the eager
// auto-invoke changes no behavior — it only removes a redundant race source.
let _columnsReady = false;

async function guardColumns(): Promise<void> {
  if (_columnsReady) return;
  await ensureAiConciergeColumns();
  _columnsReady = true;
}

// ── Conversation history helpers ───────────────────────────────────────────────

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

// ── Message-splitting helper ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send up to 4 message parts with a 1 200 ms pause between each.
 * Returns the wamid of the last successfully sent part.
 */
async function sendMessageParts(
  phone: string,
  parts: string[],
): Promise<{ wamid?: string }> {
  const filtered = parts.map(p => p.trim()).filter(Boolean).slice(0, 4);
  let lastWamid: string | undefined;
  for (let i = 0; i < filtered.length; i++) {
    if (i > 0) await sleep(1200);
    const result = await sendQualTextMessage(phone, filtered[i]);
    if (result.wamid) lastWamid = result.wamid;
  }
  return { wamid: lastWamid };
}

// ── Hot-lead escalation ────────────────────────────────────────────────────────

async function escalateToHotLead(
  leadId: number,
  sessionId: number,
  escalationType: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    // Update lead score and wa_stage
    await client.query(`
      UPDATE crm_leads
      SET lead_score = 'hot',
          wa_stage   = 'hot_lead'
      WHERE id = $1
    `, [leadId]);

    // Fetch assigned advisor for notification
    const lr = await client.query(
      `SELECT assigned_to, full_name FROM crm_leads WHERE id = $1`,
      [leadId]
    );
    const lead = lr.rows[0];
    if (lead?.assigned_to) {
      const typeLabels: Record<string, string> = {
        site_visit:        "زيارة موقع",
        reservation:       "حجز وحدة",
        payment_plan:      "خطة دفع",
        unit_availability: "استفسار توفر وحدات",
        contract_question: "سؤال عن العقد",
        purchase_intent:   "نية شراء واضحة",
      };
      const label = typeLabels[escalationType] ?? escalationType;
      await client.query(`
        INSERT INTO user_notifications
          (user_id, type, title, message, data, is_read, created_at)
        VALUES ($1, 'hot_lead_escalation', $2, $3, $4, false, NOW())
      `, [
        lead.assigned_to,
        `🔥 عميل حار — ${label}`,
        `${lead.full_name ?? "عميل"} يطلب: ${label}.\nتواصل معه الآن عبر واتساب.`,
        JSON.stringify({ leadId, sessionId, escalationType, type: "hot_lead_escalation" }),
      ]);
    }

    console.log(
      `[AiConcierge] Hot escalation — leadId=${leadId} sessionId=${sessionId} type=${escalationType}`
    );
  } catch (e: any) {
    console.warn("[AiConcierge] Escalation warn:", e.message);
  } finally {
    client.release();
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `أنت أحمد — مستشار استثمار عقاري أول في شركة *Kinglike Luxury* للعقارات الفاخرة.

لستَ بوتاً. لستَ نظام دعم. لستَ استمارة تأهيل.

أنتَ مستشار عقاري فاخر متمرس، بأسلوب مصرفي خاص — هادئ، واثق، ذكي، إنساني.
تواصلك يكون عبر واتساب، ولهذا رسائلك قصيرة وطبيعية وتشعر بالدفء.

════════════════════════
هويتك والشركة
════════════════════════
Kinglike Luxury تأسست عام 2018 على يد القاضي طارق إمام.
نعمل في: جورجيا (باتومي، تبليسي، غوني، غوداوري، أنانوري) — تركيا (إسطنبول، أنطاليا، ألانيا) — الإمارات / دبي — قبرص الشمالية (إسكيلي، كيرينيا، فاماغوستا).
فريقنا يضم خبراء من خلفيات قانونية وهندسية وقضائية — مما يمنح العميل حماية استثنائية.

خدماتنا ما بعد البيع: تتبع تقدم البناء، تتبع الأقساط، حفظ المستندات، دعم إعادة البيع، مراجعة العقود قانونياً، جولات عقارية، وصول أولوي لأفضل الوحدات.

════════════════════════
مشاريعنا الحالية — تعرّف عليها جيداً
════════════════════════
عندما يذكر العميل أيّاً من هذه الأسماء، اعرف أنه يتحدث عن مشروع حقيقي لدينا وتعامل معه بثقة:
• Ambassadori / أمباسادوري — فندق وسكن فاخر في جورجيا
• Ambassadori Island Batumi / أمباسادوري آيلاند باتومي — مشروع جزيرة في باتومي
• Batumi Island / باتومي آيلاند — مشروع ساحلي راقٍ في باتومي
• Petra / بيترا — مشروع منتجعي فاخر في جورجيا
• Petra Resort / بيترا ريزورت — امتداد منتجع بيترا
• Silk Tower / Silk Towers / سيلك تاور — برج سكني فاخر في تبليسي
• FK — مشروع سكني متميز في جورجيا
• Alphica / ألفيكا — مشروع عقاري في جورجيا
• Lamborghini — مشروع فندقي-سكني راقٍ
• Panorama / بانوراما — مشروع بإطلالات استثنائية
• Swiss Hotel / سويس هوتيل — مشروع فندقي سكني

إذا ذكر العميل اسم مشروع، سجّل اسمه في project_interest فوراً.
إذا سأل عن مشروع لا تعرف تفاصيله الكاملة: "هذا المشروع متميز — مستشارنا سيعطيك كل التفاصيل والأسعار الحالية."

════════════════════════
أسلوبك
════════════════════════
• دافئ، واثق، هادئ — مثل خبير يتحدث مع صديق.
• تبدأ دائماً بالإجابة — لا بالسؤال.
• تتفاعل مع ما قاله العميل تحديداً — لا ردود عامة مكررة.
• تُنوّع في الافتتاحيات — ممتاز / رائع / هذا منطقي / اختيار ذكي / جيد
• تتجنب: "بالتأكيد" / "بكل سرور" / "كيف يمكنني مساعدتك" — تبدو آلية.
• لا تصف نفسك بأنك بوت أو نظام ذكاء اصطناعي.
• كل رسالة تشعر العميل بأنه يتلقى توجيهاً حصرياً من خبير حقيقي.

════════════════════════
قاعدة "أجب أولاً" — ملزمة دائماً
════════════════════════
إذا سأل العميل أي سؤال — أجب عليه أولاً بشكل مفيد وحقيقي.
لا تتجاهل السؤال أبداً. لا تنتقل للتأهيل قبل الإجابة.

مثال:
العميل: "هل باتومي لا تزال فرصة جيدة للاستثمار؟"
أحمد: "باتومي تشهد حالياً طلباً إيجارياً قوياً مدفوعاً بنمو السياحة الساحلية.
السوق لا يزال في مرحلة نمو — وهذا يعني إمكانية الدخول قبل اكتمال التسعير الكامل.

ما الذي يجذبكم إليها أكثر — العائد الإيجاري أم نمو القيمة على المدى البعيد؟"

════════════════════════
الميزانية المحدودة — نصيحة صريحة باحترام
════════════════════════
إذا ذكر العميل ميزانية في حدود 35,000 دولار أو أقل، وضّح بصدق ودون إحراج:
"بكل وضوح، ميزانية 35 ألف دولار تعتبر محدودة للحصول على خيار قوي للاستثمار العقاري في جورجيا.

إذا أمكن رفع الميزانية بشكل بسيط، يمكن الوصول إلى مشاريع أفضل من حيث الموقع، جودة البناء، وفرص إعادة البيع أو التأجير."

ثم اطرح سؤالاً واحداً طبيعياً للمتابعة. لا تُقفل الحديث. لا تُضغط على العميل.

════════════════════════
سيكولوجيا التحويل — الأهم
════════════════════════
هدفك ليس الإجابة فقط — بل زيادة وقت المحادثة وبناء الرغبة والتحويل إلى موعد.

استخدم:
1. الفضول: "هناك تفصيل مثير في هذا المشروع يناسب ما ذكرته — لكن أحتاج أن أفهم هدفكم أكثر أولاً."
2. التعهدات الصغيرة: "هل سبق لكم الاستثمار في عقارات خارج بلدكم؟" / "لو كنتم تستثمرون اليوم — العائد الإيجاري أم نمو رأس المال الأهم؟"
3. الذاكرة الفعّالة: استخدم دائماً ما ذكره العميل سابقاً: "بناءً على الميزانية التي ذكرتموها ($100k)، لديّ خيارين يبادران إلى الذهن."
4. خلق الرغبة قبل الإحالة: "أعتقد أن هذه الفرصة تستحق نظرة أعمق بناءً على ما شاركتموني إياه. هل تودّون أن أرتّب لكم جلسة مع مستشار متخصص؟"
5. الإحساس بالحصرية: "نتيح هذه التفاصيل عادةً للعملاء الجادين فقط."
6. بناء الثقة: شارك بمعلومة قيّمة حقيقية عن السوق قبل طرح أي سؤال.

════════════════════════
معالجة الاعتراضات — حسب النوع
════════════════════════

اعتراض السعر ("السعر مرتفع" / "غالي"):
لا تدافع ولا تجادل. قل: "يختلف السعر كثيراً بحسب المشروع والطابق وخطة الدفع. أحياناً يوجد خيار مرن يناسب أكثر — ما الميزانية التقريبية التي تفكرون فيها؟"

اعتراض الثقة ("لماذا Kinglike؟" / "لا أعرف الشركة"):
أجب بثقة وبدون دفاعية: "Kinglike تأسست عام 2018 وتضم فريقاً من المختصين القانونيين والهندسيين — كل عقد يمر بمراجعة قانونية قبل التوقيع. هذا يعطي العميل حماية لا توفرها أغلب وسائط البيع المباشر."

اعتراض التوقيت ("سأفكر لاحقاً" / "ليس الوقت المناسب"):
لا تضغط. قل: "هذا معقول تماماً. في السوق العقاري عادةً أفضل وقت هو قبل أن ترتفع الأسعار — لكن القرار الصحيح هو الذي يناسب ظروفكم. هل ثمة شيء معين يجعلكم غير متأكدين الآن؟"

اعتراض العائد ("ما نسبة العائد؟" / "هل الاستثمار مضمون؟"):
لا تعطِ أرقاماً أبداً. قل: "لا أذكر نسبة محددة لأن الأرقام تتغير بحسب المشروع والوحدة والوقت. ما أستطيع قوله أن هذا السوق يشهد طلباً إيجارياً قوياً — المستشار المختص يعطيكم الأرقام الحقيقية بناءً على المشروع الذي يناسبكم."

اعتراض المطور ("هل يمكنني الشراء مباشرة من المطور؟"):
لا تهاجم المطور. قل: "يمكنكم ذلك دائماً. الفرق الذي يوفره العمل معنا: مراجعة قانونية للعقد، دعم الأقساط، متابعة البناء، وأولوية الوصول لوحدات مختارة. كثير من عملائنا يرون القيمة بعد تجربة الفرق."

اعتراض الموقع ("هل جورجيا آمنة؟" / "لا أعرف السوق"):
قل: "جورجيا من أكثر الأسواق استقراراً للمستثمرين الأجانب — لا ضريبة سنوية على الممتلكات، وإجراءات تملك شفافة. في باتومي وتبليسي يوجد مستثمرون عرب من عدة سنوات وتجاربهم ممتازة."

════════════════════════
تنبؤ نية الشراء — الإحالة الحارة
════════════════════════
عندما يذكر العميل أياً مما يلي، يعني هذا نية شراء عالية:
- "أريد زيارة الموقع" / "هل يمكنني معاينة الوحدة"
- "كيف أحجز" / "أريد حجز وحدة"
- "ما خطة الدفع" / "كيف أقسّط"
- "هل توجد وحدات متاحة الآن"
- "ما إجراءات العقد" / "متى يمكن التوقيع"
- "أريد التواصل مع مستشار"

عند اكتشاف أي إشارة من هذه: اضبط escalation_needed = true مع النوع المناسب.
قبل الإحالة، أنشئ الرغبة أولاً:
"أعتقد أنكم وصلتم للمرحلة التي يستطيع فيها مستشارنا المختص تزويدكم بالتوفر الفعلي والخيارات الحالية.
هل تودّون أن أرتّب ذلك لكم؟"

════════════════════════
تقييم الملاءمة الداخلي
════════════════════════
قيّم داخلياً مدى ملاءمة العميل بناءً على: الميزانية + الهدف + الجدول الزمني + الموقع + الجدية.
عندما تكون الملاءمة عالية، اذكرها بشكل طبيعي:
"بناءً على ما شاركتموني إياه، هذه الفرصة تبدو متوافقة جداً مع أهدافكم."
لا تعطِ أرقاماً أو نسب مئوية.

════════════════════════
رؤى السوق — حقائق للاستخدام عند الملاءمة
════════════════════════
جورجيا/باتومي: طلب إيجاري قوي مدفوع بالسياحة الساحلية المتنامية. لا ضريبة سنوية على الممتلكات. نقطة دخول متاحة للمستثمر العربي لأول مرة.
جورجيا/تبليسي: عاصمة مستقرة، اقتصاد متنامٍ، مشهد تقني وافد متنامٍ. شعبية بين المستثمرين الأوروبيين والعرب للتقدير طويل الأمد.
تركيا/إسطنبول: مدينة عالمية، إقامة بالاستثمار، طلب إيجاري على مدار السنة.
تركيا/أنطاليا وألانيا: سياحة موسمية عالية، أسلوب حياة متوسطي، طلب قوي على الإيجار قصير الأمد.
الإمارات/دبي: لا ضرائب عقارية، بنية تحتية عالمية، سوق على الخارطة متطور بخطط دفع مرنة.
قبرص الشمالية: أحد أسهل الأسواق المتوسطية دخولاً. بنية سياحية متنامية واهتمام دولي متزايد.

لا تذكر أبداً نسبة عائد محددة. إذا سُئلت: "مستشارنا يملك الأرقام الحقيقية بناءً على مشروعكم المحدد."

════════════════════════
قواعد دقة استخراج البيانات — ملزمة
════════════════════════
أ. البلد / المدينة:
   لا تستنتج البلد من رقم هاتف العميل أبداً.
   مثال: رقم تركي لا يعني أن العميل مهتم بتركيا.
   سجّل فقط ما ذُكر في المحادثة. إذا تحدث العميل عن جورجيا أو باتومي أو تبليسي — سجّل جورجيا.
   لا تسجّل دولة لم تُذكر في المحادثة.

ب. الميزانية:
   استخدم التصنيف المحافظ دائماً.
   إذا قال العميل "حتى 150 ألف" أو "150,000" — سجّل budget_100_150 وليس budget_150_200.
   لا ترفع التصنيف إلى الفئة الأعلى.

ج. وقت التواصل:
   إذا ذكر العميل وقتاً محدداً مثل "11 صباحاً" أو "11 AM" أو "الساعة 11":
   - سجّل في contact_time_exact القيمة الدقيقة مثل: "11:00 AM"
   - الوقت المحدد يأخذ الأولوية على النطاق العام.

د. أمان الاستخراج:
   إذا لم تكن متأكداً من أي حقل — اتركه فارغاً.
   لا تخترع بيانات غير صريحة في المحادثة.

════════════════════════
قواعد المحادثة — ملزمة
════════════════════════
1. سؤال واحد فقط في نهاية كل رسالة.
2. لا تُعِد السؤال عن شيء ذكره العميل بالفعل.
3. تنوّع في الافتتاحيات — لا تكرر نفس الجملة مرتين.
4. لا قوائم مرقمة أو منقطة لعرض خيارات. اعرضها بشكل طبيعي.
5. لا تقل "كمستشار ذكاء اصطناعي" — أنت أحمد.
6. لا تكرر نفس دعوة الاتصال في رسالتين متتاليتين — مرة واحدة ثم تابع.
7. إذا كان العميل بارداً أو مجرد يتصفح: معلومة قيّمة + سؤال ذكي واحد. لا تُثقّل.
8. إذا طلب العميل التحدث مع شخص حقيقي: "بالتأكيد — سأنسق ذلك مباشرةً."
9. لا روابط. لا نسب عائد محددة. لا نصائح قانونية أو ضريبية أو تأشيرة.
10. بعد 15 رسالة: ابدأ بتشجيع طبيعي على التواصل المباشر. بعد 20 رسالة: ردود موجزة ومباشرة للتحويل.
11. لا تذكر العطلات أو السياحة أو السفر الترفيهي إلا إذا بادر العميل بذكرها صراحةً. هدفك الاستثمار والسكن فقط.
12. إذا ذكر العميل أي من الكلمات التالية في أي رسالة — استثمار، شراء، بيع، إعادة بيع، دخل إيجاري، عائد، تأجير، تقدير رأس المال، ربح — فقد أوضح هدفه. لا تسأله عن الهدف مجدداً. سجّل goal = goal_invest واستمر في المحادثة.
13. استخرج دائماً البيانات التالية من النص الحر حتى لو لم تُذكر بشكل رسمي: project_interest (اسم المشروع)، city_country (البلد أو المدينة)، goal (هدف الشراء)، budget (الميزانية)، timeline (الإطار الزمني). إذا ذُكر أي منها — سجّله فوراً في extracted حتى لو ذُكر عرضاً.

════════════════════════
تنسيق رسائل واتساب
════════════════════════
• كل جزء من message_parts: 2-4 أسطر كحد أقصى.
• استخدم message_parts بذكاء: الفكرة الأولى في الجزء الأول، السؤال في الجزء الأخير.
• يمكن تقسيم الرد إلى جزأين إذا كان الموضوع يحتاج ذلك — يشعر بالطبيعية.
• إيموجي واحد أو اثنان كحد أقصى في المجموعة كلها — وليس في كل جزء.
• لا رسائل طويلة تبدو كمقال أو تقرير.

════════════════════════
الإغلاق والتسليم للمستشار
════════════════════════
إذا جمعت: الميزانية + الهدف + وقت التواصل — يمكن الإغلاق وتسليم للمستشار.
لكن لا تُغلق الجلسة قبل خلق الرغبة:
"بناءً على ما شاركتموني إياه، أعتقد أن لديكم خيارات تناسبكم تماماً.
سيتواصل معكم مستشارنا المختص قريباً لتجهيز قائمة مخصصة لكم. 🌟"
ثم اضبط is_ready_to_close = true.`;

// ── OpenAI tool definition ─────────────────────────────────────────────────────

const CONCIERGE_TOOL = {
  type: "function" as const,
  function: {
    name: "send_reply_and_update",
    description:
      "Send 1-4 short WhatsApp message parts (with natural pauses between them) and update any qualification data extracted from the client's message.",
    parameters: {
      type: "object",
      properties: {
        message_parts: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of 1–4 short Arabic message parts to send in sequence with 1.2s pauses. Each part max 4 lines. Split naturally — first part answers/engages, last part asks the single question.",
          minItems: 1,
          maxItems: 4,
        },
        extracted: {
          type: "object",
          description: "Qualification fields extracted or confirmed this turn (only include confident fields)",
          properties: {
            budget: {
              type: "string",
              description:
                "Budget in USD. Use IDs: budget_lt50 | budget_50_80 | budget_80_100 | budget_100_150 | budget_150_200 | budget_gt200. Or plain text if unsure.",
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
              description: "Preferred contact time range",
            },
            contact_time_exact: {
              type: "string",
              description: "Exact contact time if client stated a specific time (e.g. '11:00 AM', '3:30 PM'). Takes priority over contact_time range. Only set when client gives a specific clock time.",
            },
            project_interest: {
              type: "string",
              description: "Specific project name mentioned by client",
            },
          },
          additionalProperties: false,
        },
        escalation_needed: {
          type: "boolean",
          description:
            "Set to true when client signals high purchase intent: site visit, reservation, unit availability, payment plan, contract question, or explicit advisor request. Creates urgent hot-lead notification.",
        },
        escalation_type: {
          type: "string",
          enum: ["site_visit", "reservation", "payment_plan", "unit_availability", "contract_question", "purchase_intent"],
          description: "Type of escalation trigger (required when escalation_needed is true)",
        },
        is_ready_to_close: {
          type: "boolean",
          description:
            "Set to true only when budget + goal + contact_time are all known AND you've sent a warm desire-creating closing message. Triggers advisor assignment.",
        },
      },
      required: ["message_parts", "is_ready_to_close"],
    },
  },
};

// ── AI generation ──────────────────────────────────────────────────────────────

interface AiTurnResult {
  parts: string[];
  extracted: {
    budget?: string;
    goal?: string;
    timeline?: string;
    city_country?: string;
    contact_time?: string;
    contact_time_exact?: string;
    project_interest?: string;
  };
  escalationNeeded: boolean;
  escalationType: string;
  isReadyToClose: boolean;
}

async function generateConciergeReply(
  sessionId: number,
  firstName: string | null,
  userMessage: string,
  existingAnswers: Record<string, string>,
  turnCount: number,
): Promise<AiTurnResult> {
  const history = await loadHistory(sessionId);

  // Build context about already-collected data (prevent re-asking)
  const known: string[] = [];
  if (existingAnswers.budget)       known.push(`الميزانية: ${existingAnswers.budget}`);
  if (existingAnswers.goal)         known.push(`الهدف: ${existingAnswers.goal}`);
  if (existingAnswers.timeline)     known.push(`التوقيت: ${existingAnswers.timeline}`);
  if (existingAnswers.city_country) known.push(`المدينة/البلد: ${existingAnswers.city_country}`);
  if (existingAnswers.contact_time) known.push(`وقت التواصل: ${existingAnswers.contact_time}`);
  if (existingAnswers.project_name) known.push(`المشروع المهتم به: ${existingAnswers.project_name}`);

  // Near-limit guidance tag
  const nearLimit = turnCount >= 15 ? "\n[تنبيه داخلي: اقتربنا من نهاية المحادثة — ابدئي بالتوجيه الطبيعي نحو التواصل المباشر مع المستشار بأسلوب ودّي.]" : "";

  const systemPrompt =
    BASE_SYSTEM_PROMPT +
    (firstName ? `\n\nاسم العميل: ${firstName}` : "") +
    (known.length > 0
      ? `\n\nبيانات مجمّعة بالفعل (لا تسأل عنها مجدداً — استخدميها بشكل طبيعي في ردودك):\n${known.join("\n")}`
      : "") +
    nearLimit;

  const messages: any[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  // ── Fallback when OpenAI is unavailable ──────────────────────────────────
  if (!openai) {
    console.warn("[AiConcierge] OpenAI not available — fallback reply");
    return {
      parts: ["شكراً على تواصلكم معنا! 🌟\nسيتواصل معكم أحد مستشارينا المتخصصين قريباً."],
      extracted: {},
      escalationNeeded: false,
      escalationType: "",
      isReadyToClose: false,
    };
  }

  try {
    const response = await openai.chat.completions.create({
      model:       "gpt-4o",
      messages,
      tools:       [CONCIERGE_TOOL],
      tool_choice: { type: "function", function: { name: "send_reply_and_update" } },
      max_tokens:  600,
      temperature: 0.75,
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("No tool call arguments returned");
    }

    const args = JSON.parse(toolCall.function.arguments);

    // Ensure message_parts is always a non-empty array
    let parts: string[] = args.message_parts;
    if (!Array.isArray(parts) || parts.length === 0) {
      // Fallback: if AI returned arabic_reply instead (shouldn't happen)
      const fallback = (args as any).arabic_reply;
      parts = fallback ? [fallback] : ["شكراً! سيتواصل معكم فريقنا قريباً. 🌟"];
    }

    return {
      parts,
      extracted:        args.extracted ?? {},
      escalationNeeded: args.escalation_needed ?? false,
      escalationType:   args.escalation_type  ?? "",
      isReadyToClose:   args.is_ready_to_close ?? false,
    };
  } catch (err: any) {
    console.error(`[AiConcierge] OpenAI error sessionId=${sessionId}:`, err.message);
    return {
      parts: [
        "عذراً، حدث خطأ تقني مؤقت. 🙏",
        "سيتواصل معكم أحد مستشارينا مباشرة.",
      ],
      extracted: {},
      escalationNeeded: false,
      escalationType: "",
      isReadyToClose: false,
    };
  }
}

// ── Budget normaliser ─────────────────────────────────────────────────────────

function normalizeBudget(raw: string): string {
  if (!raw) return raw;
  const KNOWN_IDS = [
    "budget_lt50", "budget_50_80", "budget_80_100",
    "budget_100_150", "budget_150_200", "budget_gt200",
  ];
  if (KNOWN_IDS.includes(raw)) return raw;

  const lower = raw.toLowerCase();
  const nums  = (raw.match(/\d+/g) ?? []).map(Number);
  const max   = nums.length ? Math.max(...nums) : 0;
  const min   = nums.length ? Math.min(...nums) : 0;

  if (lower.includes(">200") || lower.includes("gt200") || max >= 200)         return "budget_gt200";
  if ((min >= 150 && min < 200) || (max >= 150 && max < 200))                   return "budget_150_200";
  if ((min >= 100 && min < 150) || (max >= 100 && max < 150))                   return "budget_100_150";
  if ((min >= 80  && min < 100) || (max >= 80  && max < 100))                   return "budget_80_100";
  if ((min >= 50  && min < 80)  || (max >= 50  && max < 80))                    return "budget_50_80";
  if (lower.includes("<50") || lower.includes("lt50") || (max > 0 && max < 50)) return "budget_lt50";
  return raw;
}

// ── Employee phone map for WA task notifications ───────────────────────────────

const EMPLOYEE_PHONES: Record<string, string> = {
  samer: "+995511746491",
  fadi:  "+995591888863",
};

// ── CRM task creation + employee WhatsApp notification ─────────────────────────

async function createContactTask(
  leadId: number,
  sessionId: number,
  leadName: string,
  leadPhone: string,
  contactTimeExact: string,
  extractedSummary: string,
  isHot: boolean,
  assignedUserId: number | null,
  assigneeName: string | null,
): Promise<void> {
  const client = await pool.connect();
  try {
    const priority = isHot ? "high" : "normal";
    const dueDate  = new Date().toISOString().slice(0, 10); // today as placeholder

    // Duplicate check: same lead + same contact time
    const existing = await client.query(
      `SELECT id FROM crm_tasks
       WHERE lead_id = $1 AND due_time = $2
       LIMIT 1`,
      [leadId, contactTimeExact]
    );

    let taskId: number;
    if (existing.rows.length > 0) {
      // Update existing task description
      const upd = await client.query(
        `UPDATE crm_tasks
         SET description = $1, priority = $2
         WHERE id = $3
         RETURNING id`,
        [extractedSummary, priority, existing.rows[0].id]
      );
      taskId = upd.rows[0]?.id;
      console.log(`[AiConcierge] CRM task updated taskId=${taskId} leadId=${leadId}`);
    } else {
      const ins = await client.query(
        `INSERT INTO crm_tasks (lead_id, title, description, due_date, due_time, priority)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          leadId,
          `تواصل WhatsApp AI — ${leadName}`,
          extractedSummary,
          dueDate,
          contactTimeExact,
          priority,
        ]
      );
      taskId = ins.rows[0]?.id;
      console.log(`[AiConcierge] CRM task created taskId=${taskId} leadId=${leadId} time=${contactTimeExact}`);
    }

    // Notify assigned employee via WhatsApp
    if (assignedUserId && assigneeName) {
      await notifyEmployeeByWhatsApp(
        assigneeName,
        leadName,
        leadPhone,
        contactTimeExact,
        extractedSummary,
        isHot,
      );
    }
  } catch (e: any) {
    console.warn(`[AiConcierge] Task creation warn leadId=${leadId}:`, e.message);
  } finally {
    client.release();
  }
}

async function notifyEmployeeByWhatsApp(
  assigneeName: string,
  leadName: string,
  leadPhone: string,
  contactTime: string,
  summary: string,
  isHot: boolean,
): Promise<void> {
  const nameLower = assigneeName.toLowerCase();
  let employeePhone: string | undefined;
  for (const [key, phone] of Object.entries(EMPLOYEE_PHONES)) {
    if (nameLower.includes(key)) {
      employeePhone = phone;
      break;
    }
  }
  if (!employeePhone) {
    console.log(`[AiConcierge] No WA phone mapped for employee "${assigneeName}" — skipping notification`);
    return;
  }

  const hotLine  = isHot ? "🔥 *عميل حار*\n\n" : "";
  const message  =
    `${hotLine}مهمة تواصل جديدة من WhatsApp AI\n\n` +
    `العميل: ${leadName}\n` +
    `الهاتف: ${leadPhone}\n\n` +
    `وقت التواصل المطلوب:\n${contactTime}\n\n` +
    `ملخص الاهتمام:\n${summary}\n\n` +
    `يرجى التواصل مع العميل في الموعد المحدد.`;

  try {
    await sendQualTextMessage(employeePhone, message);
    console.log(`[AiConcierge] Employee notified — ${assigneeName} (${employeePhone})`);
  } catch (e: any) {
    console.warn(`[AiConcierge] Employee WA notification failed for ${assigneeName}:`, e.message);
  }
}

// ── Public: start AI concierge after QUAL_YES ──────────────────────────────────

export async function startConciergeConversation(
  session: Session,
  firstName: string | null,
): Promise<void> {
  await guardColumns();
  const name = firstName?.trim() || "";

  // Two-part opening: warm greeting then intro + goal question
  const part1 = name ? `أهلاً ${name}! 👋` : "أهلاً! 👋";
  const part2 =
    `معك أحمد المستشار العقاري من شركة Kinglike Luxury للتطوير والاستثمار العقاري.\n\n` +
    `أنا سعيد بالإجابة على كافة استفساراتكم بخصوص التملك العقاري.\n\n` +
    `ما هو الهدف من الشراء؟\n\n` +
    `🎖 السكن\n\n` +
    `🎖 الاستثمار`;

  const openResult = await sendMessageParts(session.phone, [part1, part2]);

  const openingText = `${part1}\n\n${part2}`;

  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE wa_qual_sessions
      SET conversation_history  = $1::jsonb,
          turn_count             = 0,
          status                 = 'ai_concierge_active',
          current_question       = 'ai_concierge',
          last_message_at        = NOW(),
          last_outbound_wamid    = $3,
          invalid_input_count    = 0
      WHERE id = $2
    `, [
      JSON.stringify([{ role: "assistant", content: openingText }]),
      session.id,
      openResult.wamid ?? null,
    ]);
  } finally {
    client.release();
  }

  console.log(
    `[AiConcierge] Started sessionId=${session.id} phone=${session.phone} firstName="${name || "—"}"`
  );
}

// ── Public: handle each inbound message while AI is active ─────────────────────

export async function handleConciergeMessage(
  session: Session,
  opts: {
    phone:     string;
    bodyText:  string;
    wamid?:    string;
    buttonId?: string;
    listId?:   string;
  },
): Promise<void> {
  await guardColumns();
  const rawText   = opts.bodyText.trim();
  const turnCount = await getTurnCount(session.id);

  // ── Fetch first name ──────────────────────────────────────────────────────
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

  // ── Safety cap ────────────────────────────────────────────────────────────
  if (turnCount >= MAX_TURNS) {
    console.log(`[AiConcierge] Max turns reached sessionId=${session.id} — forcing completion`);
    const closingParts = [
      "شكراً جزيلاً على وقتكم وثقتكم! 🙏",
      "لديكم بالفعل ما يكفي من المعلومات للخطوة التالية.\nسيتواصل معكم مستشارنا المختص قريباً لإكمال المسيرة معكم.\n\n*Kinglike Luxury — استثمر بثقة.*",
    ];
    await sendMessageParts(session.phone, closingParts);
    await finishQualification(session);
    return;
  }

  // ── Load existing answers ─────────────────────────────────────────────────
  const existingAnswers = await getAnswers(session.id);

  // ── Generate AI reply ─────────────────────────────────────────────────────
  const { parts, extracted, escalationNeeded, escalationType, isReadyToClose } =
    await generateConciergeReply(
      session.id,
      firstName,
      rawText,
      existingAnswers,
      turnCount,
    );

  // ── Persist extracted qualification fields ────────────────────────────────
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
    ["contact_morning", "contact_afternoon", "contact_evening", "contact_anytime"].includes(extracted.contact_time)
  ) {
    await saveAnswer(session.id, "contact_time", extracted.contact_time, extracted.contact_time, "text");
  }
  if (extracted.contact_time_exact) {
    await saveAnswer(session.id, "contact_time_exact", extracted.contact_time_exact, extracted.contact_time_exact, "text");
  }
  if (extracted.project_interest) {
    await saveAnswer(session.id, "project_name", extracted.project_interest, extracted.project_interest, "text");
    await saveAnswer(session.id, "has_project",   "proj_yes",               "proj_yes",               "text");
  }

  // ── Handle hot-lead escalation ────────────────────────────────────────────
  if (escalationNeeded && escalationType) {
    await escalateToHotLead(session.lead_id, session.id, escalationType);
  }

  // ── Auto CRM task when exact contact time is captured ─────────────────────
  if (extracted.contact_time_exact) {
    const taskClient = await pool.connect();
    try {
      const lr = await taskClient.query(
        `SELECT l.full_name, l.phone, l.lead_score, l.assigned_to, u.username AS assignee_name
         FROM crm_leads l
         LEFT JOIN users u ON u.id = l.assigned_to
         WHERE l.id = $1`,
        [session.lead_id]
      );
      const lead = lr.rows[0];
      if (lead) {
        const allAnswers = await getAnswers(session.id);
        const budgetLabel = allAnswers.budget || "—";
        const goalLabel   = allAnswers.goal    || "—";
        const cityLabel   = allAnswers.city_country || "—";
        const summary =
          `مصدر: WhatsApp AI\n` +
          `الهدف: ${goalLabel}\n` +
          `الميزانية: ${budgetLabel}\n` +
          `المدينة/البلد: ${cityLabel}\n` +
          `وقت التواصل المطلوب: ${extracted.contact_time_exact}`;
        const isHot = lead.lead_score === "hot";
        await createContactTask(
          session.lead_id,
          session.id,
          lead.full_name  ?? "عميل",
          lead.phone      ?? session.phone,
          extracted.contact_time_exact,
          summary,
          isHot,
          lead.assigned_to    ?? null,
          lead.assignee_name  ?? null,
        );
      }
    } finally {
      taskClient.release();
    }
  }

  // ── Send message parts ────────────────────────────────────────────────────
  const sendResult = await sendMessageParts(session.phone, parts);

  // ── Update conversation history ───────────────────────────────────────────
  const assistantContent = parts.join("\n\n");
  await appendAndIncrementTurn(
    session.id,
    { role: "user",      content: rawText          },
    { role: "assistant", content: assistantContent },
  );

  await updateSession(session.id, {
    last_message_at:     new Date(),
    last_outbound_wamid: sendResult.wamid ?? null,
    invalid_input_count: 0,
  });

  // ── Finish if AI signals ready ────────────────────────────────────────────
  if (isReadyToClose) {
    console.log(
      `[AiConcierge] Closing session sessionId=${session.id} leadId=${session.lead_id}`
    );
    await finishQualification(session);
  }
}

// ── Public: generate a personalised follow-up for timed-out sessions ──────────

export async function generateTimeoutFollowUp(
  phone: string,
  conversationHistory: any[],
): Promise<void> {
  if (!openai || conversationHistory.length === 0) {
    await sendQualTextMessage(
      phone,
      "مرحباً 👋\n\nأردنا فقط التحقق — هل لا تزالون مهتمين بالاطلاع على الفرص العقارية معنا؟\nيسعدني مساعدتكم في أي وقت. 🌟"
    );
    return;
  }

  try {
    const summaryPrompt = `أنت أحمد من Kinglike Luxury.
العميل توقف عن الرد منذ 72 ساعة. مهمتك إرسال رسالة متابعة شخصية ودية وقصيرة (جزأين: 2-3 أسطر لكل منهما).
الرسالة يجب أن:
- تُشير بشكل طبيعي لشيء ذكره العميل في المحادثة.
- تكون دافئة وغير مُلحّة.
- تُشجّع على العودة للمحادثة.
لا تذكر أنه مرت 72 ساعة. لا تبدو آلية. لا تكرر المقدمة نفسها.
أعِد الرسالتين كـ JSON: {"part1": "...", "part2": "..."}`;

    const lastMessages = conversationHistory.slice(-6);
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: summaryPrompt },
        ...lastMessages,
        { role: "user", content: "[اكتبي رسالة المتابعة الآن]" },
      ],
      max_tokens:  200,
      temperature: 0.8,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const part1 = parsed.part1 as string;
    const part2 = parsed.part2 as string;

    if (part1) {
      await sendMessageParts(phone, [part1, part2].filter(Boolean));
    } else {
      throw new Error("Empty follow-up parts");
    }
  } catch (err: any) {
    console.warn("[AiConcierge] Timeout follow-up generation failed:", err.message);
    await sendQualTextMessage(
      phone,
      "مرحباً 👋\n\nأردنا فقط التحقق — هل لا تزالون مهتمين بالاطلاع على الفرص العقارية معنا؟\nيسعدني مساعدتكم. 🌟"
    );
  }
}
