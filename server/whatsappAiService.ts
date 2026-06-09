import OpenAI from "openai";
import { db } from "./db";
import { eq, asc } from "drizzle-orm";
import {
  whatsappAiConversations,
  whatsappAiMessages,
  whatsappAiAgentReports,
  crmLeads,
} from "@shared/schema";

const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
const openai: OpenAI | null = apiKey ? new OpenAI({ apiKey }) : null;

// ── System prompt for WhatsApp qualification AI ───────────────────────────────
const WHATSAPP_SYSTEM_PROMPT = `أنت خالد — مستشار واتساب محترف من فريق Kinglike Luxury للعقارات الفاخرة.
مهمتك: استقبال العملاء الجدد بطريقة دافئة ومهنية، وجمع معلومات التأهيل تدريجياً دون أي ضغط.

القواعد الصارمة:
- تكلّم بالعربية الفصحى المعاصرة (راقية وطبيعية، ليست مترجمة).
- سؤال واحد فقط في كل رسالة.
- رسائل قصيرة وطبيعية (لا تتجاوز 3 أسطر).
- لا تذكر أسعاراً أو ضمانات أو عوائد استثمارية أو نسب ربح.
- لا تفضّل دولة على أخرى، ولا مشروعاً على آخر، ولا مدينة على أخرى.
- لا تعطِ نصائح قانونية أو ضريبية.
- إذا سأل العميل عن تفاصيل قانونية أو ضمانات: "سيوضح لك المستشار المختص هذه التفاصيل بالكامل."
- إذا طلب العميل التحدث مع شخص حقيقي: أبلغه بأنك ستحيله فوراً لمستشار.
- إذا كان العميل غير مهذب أو غاضباً: ابقَ هادئاً ومحترماً دائماً.
  مثال: "ولا يهمك أستاذي، أنا موجود لمساعدتك فقط. إذا تحب، أقدر أسجل اهتمامك وأطلب من أحد المستشارين التواصل معك بالوقت المناسب."
- لا ترسل روابط خارجية أو روابط مشاريع أو روابط مطورين إطلاقاً.
- إذا سُئلت عن أفضل خيار: "الاختيار الأنسب يعتمد على هدفك وميزانيتك وتفضيلاتك، ومستشار Kinglike Luxury سيوضح لك الخيارات المناسبة."`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildClientName(data: {
  fullName?: string | null;
  firstName?: string | null;
}): string {
  return data.fullName?.trim() || data.firstName?.trim() || "";
}

function getDefaultOpeningMessage(clientName: string): string {
  const greeting = clientName
    ? `السلام عليكم ${clientName}،`
    : "السلام عليكم،";
  return (
    `${greeting}\n` +
    `معك خالد من فريق Kinglike Luxury للعقارات الفاخرة 🏡\n` +
    `يسعدنا تواصلك معنا — في أي دولة تفضل الاستثمار أو الإقامة؟`
  );
}

function buildInitialSummary(
  clientName: string,
  data: {
    country?: string | null;
    city?: string | null;
    budget?: string | null;
    projectInterest?: string | null;
  }
): string {
  const parts: string[] = [];
  if (clientName) parts.push(`Client: ${clientName}.`);
  if (data.projectInterest) parts.push(`Interested in: ${data.projectInterest}.`);
  if (data.country) parts.push(`Country: ${data.country}.`);
  if (data.city) parts.push(`City: ${data.city}.`);
  if (data.budget) parts.push(`Budget: ${data.budget}.`);
  parts.push("Initial qualification not yet started — draft conversation created from Meta form data.");
  return parts.join(" ");
}

// ── initConversationForLead ───────────────────────────────────────────────────
/**
 * Called after a new CRM lead is created from Meta (webhook or pull sync).
 * Creates draft conversation, generates opening message via OpenAI (or fallback),
 * stores it as the first AI message, and creates an initial agent report.
 * NEVER sends any real WhatsApp message — Phase 1 is internal only.
 */
export async function initConversationForLead(
  leadId: number,
  leadData: {
    fullName?: string | null;
    firstName?: string | null;
    phone?: string | null;
    country?: string | null;
    city?: string | null;
    budget?: string | null;
    projectInterest?: string | null;
    assignedTo?: number | null;
  }
): Promise<void> {
  try {
    // Idempotency check — skip if conversation already exists
    const [existing] = await db
      .select({ id: whatsappAiConversations.id })
      .from(whatsappAiConversations)
      .where(eq(whatsappAiConversations.leadId, leadId))
      .limit(1);

    if (existing) {
      console.log(`[WhatsAppAI] Conversation already exists leadId=${leadId}`);
      return;
    }

    // Step 1: Create draft conversation
    const [conv] = await db
      .insert(whatsappAiConversations)
      .values({
        leadId,
        clientPhone: leadData.phone ?? null,
        status: "draft",
        language: "ar",
      })
      .returning();

    console.log(`[WhatsAppAI] Draft conversation created leadId=${leadId}`);

    // Step 2: Generate opening message
    const clientName = buildClientName(leadData);
    let openingMessage = getDefaultOpeningMessage(clientName);

    if (openai) {
      try {
        const userPrompt =
          `أنشئ رسالة واتساب ترحيبية أولى للعميل الجديد` +
          (clientName ? ` "${clientName}"` : "") +
          `.\n` +
          `المعلومات المتوفرة من النموذج:\n` +
          (leadData.country ? `- الدولة المذكورة: ${leadData.country}\n` : "") +
          (leadData.projectInterest ? `- اهتمامه المذكور: ${leadData.projectInterest}\n` : "") +
          `\n` +
          `المطلوب: رسالة دافئة ومهنية (جملتان إلى ثلاث)، تُرحّب بالعميل، تُعرّفه بنفسك باختصار، وتسأله سؤالاً طبيعياً واحداً عن الدولة التي يهتم بالاستثمار أو الإقامة فيها.`;

        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: WHATSAPP_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 200,
          temperature: 0.7,
        });

        const aiText = response.choices[0]?.message?.content?.trim();
        if (aiText) openingMessage = aiText;
      } catch (err: any) {
        console.warn(
          `[WhatsAppAI] OpenAI call failed, using default opening message leadId=${leadId}: ${err.message}`
        );
      }
    }

    // Step 3: Store opening message
    await db.insert(whatsappAiMessages).values({
      conversationId: conv.id,
      sender: "ai",
      messageText: openingMessage,
    });

    console.log(`[WhatsAppAI] Opening message generated leadId=${leadId}`);

    // Step 4: Update conversation last_message_at
    await db
      .update(whatsappAiConversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(whatsappAiConversations.id, conv.id));

    // Step 5: Create initial agent report from form data (no AI needed)
    await db.insert(whatsappAiAgentReports).values({
      leadId,
      assignedAgentId: leadData.assignedTo ?? null,
      summaryText: buildInitialSummary(clientName, leadData),
      clientInterest: leadData.projectInterest ?? null,
      country: leadData.country ?? null,
      city: leadData.city ?? null,
      budget: leadData.budget ?? null,
      propertyType: null,
      paymentMethod: null,
      investmentGoal: null,
      buyingTimeframe: null,
      bestCallTime: null,
      priorityScore: "medium",
      recommendedNextAction:
        "Review draft AI opening message. Assign to an agent. Initiate WhatsApp conversation when ready (Phase 2).",
    });

    console.log(`[WhatsAppAI] Report generated leadId=${leadId}`);
    console.log(`[WhatsAppAI] No WhatsApp message sent in Phase 1`);
  } catch (err: any) {
    console.error(
      `[WhatsAppAI] initConversationForLead failed leadId=${leadId}:`,
      err.message
    );
  }
}

// ── generateAiReport ──────────────────────────────────────────────────────────
/**
 * Regenerates the agent report for a lead using the full conversation transcript.
 * Called by admin via "Generate/Refresh AI Report" button.
 */
export async function generateAiReport(
  leadId: number
): Promise<{ success: boolean; message: string }> {
  if (!openai) {
    return { success: false, message: "AI not available — OPENAI_API_KEY not set" };
  }

  try {
    const [lead] = await db
      .select()
      .from(crmLeads)
      .where(eq(crmLeads.id, leadId))
      .limit(1);
    if (!lead) return { success: false, message: "Lead not found" };

    const [conv] = await db
      .select()
      .from(whatsappAiConversations)
      .where(eq(whatsappAiConversations.leadId, leadId))
      .limit(1);
    if (!conv) return { success: false, message: "No conversation found for this lead" };

    const messages = await db
      .select()
      .from(whatsappAiMessages)
      .where(eq(whatsappAiMessages.conversationId, conv.id))
      .orderBy(asc(whatsappAiMessages.createdAt));

    const transcript = messages
      .map(
        (m) =>
          `[${m.sender.toUpperCase()}]: ${m.messageText}`
      )
      .join("\n");

    const clientName = buildClientName({ fullName: lead.fullName, firstName: lead.firstName });

    const prompt =
      `Generate a CRM qualification report in English for the Kinglike Luxury sales agent.\n\n` +
      `Client: ${clientName || "Unknown"}\n` +
      `Phone: ${lead.phone ? "[on file]" : "[not provided]"}\n` +
      `Meta form — Country: ${lead.country || "N/A"} | Budget: ${lead.budget || "N/A"} | Interest: ${lead.projectInterest || "N/A"}\n\n` +
      `Conversation transcript:\n` +
      (transcript || "(No messages yet — using form data only)") +
      `\n\nReturn ONLY a valid JSON object with these fields:\n` +
      `{\n` +
      `  "summary_text": "2-3 sentence professional summary",\n` +
      `  "client_interest": "what the client is most interested in",\n` +
      `  "country": "country of interest or null",\n` +
      `  "city": "city of interest or null",\n` +
      `  "budget": "budget range or null",\n` +
      `  "property_type": "apartment/villa/land/commercial or null",\n` +
      `  "payment_method": "cash/installments/unknown",\n` +
      `  "investment_goal": "investment/residence/both/unknown",\n` +
      `  "buying_timeframe": "timeframe or unknown",\n` +
      `  "best_call_time": "best time for call or unknown",\n` +
      `  "priority_score": "high/medium/low",\n` +
      `  "recommended_next_action": "specific actionable step for the agent"\n` +
      `}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a CRM qualification analyst for a luxury real estate company. Return only valid JSON, no markdown, no extra text.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 600,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    const now = new Date();

    // Upsert the report
    const [existing] = await db
      .select({ id: whatsappAiAgentReports.id })
      .from(whatsappAiAgentReports)
      .where(eq(whatsappAiAgentReports.leadId, leadId))
      .limit(1);

    const reportValues = {
      summaryText: parsed.summary_text ?? null,
      clientInterest: parsed.client_interest ?? null,
      country: parsed.country ?? null,
      city: parsed.city ?? null,
      budget: parsed.budget ?? null,
      propertyType: parsed.property_type ?? null,
      paymentMethod: parsed.payment_method ?? null,
      investmentGoal: parsed.investment_goal ?? null,
      buyingTimeframe: parsed.buying_timeframe ?? null,
      bestCallTime: parsed.best_call_time ?? null,
      priorityScore: parsed.priority_score ?? "medium",
      recommendedNextAction: parsed.recommended_next_action ?? null,
      updatedAt: now,
    };

    if (existing) {
      await db
        .update(whatsappAiAgentReports)
        .set(reportValues)
        .where(eq(whatsappAiAgentReports.id, existing.id));
    } else {
      await db.insert(whatsappAiAgentReports).values({
        leadId,
        assignedAgentId: lead.assignedTo ?? null,
        ...reportValues,
      });
    }

    return { success: true, message: "Report generated successfully" };
  } catch (err: any) {
    console.error(`[WhatsAppAI] generateAiReport failed leadId=${leadId}:`, err.message);
    return { success: false, message: err.message };
  }
}

// ── getConversationData ───────────────────────────────────────────────────────
/**
 * Fetches full conversation + messages + report for a lead.
 * Permission checking must be done at the route level before calling this.
 */
export async function getConversationData(leadId: number): Promise<{
  conversation: (typeof whatsappAiConversations.$inferSelect) | null;
  messages: (typeof whatsappAiMessages.$inferSelect)[];
  report: (typeof whatsappAiAgentReports.$inferSelect) | null;
}> {
  const [conversation = null] = await db
    .select()
    .from(whatsappAiConversations)
    .where(eq(whatsappAiConversations.leadId, leadId))
    .limit(1);

  if (!conversation) {
    return { conversation: null, messages: [], report: null };
  }

  const messages = await db
    .select()
    .from(whatsappAiMessages)
    .where(eq(whatsappAiMessages.conversationId, conversation.id))
    .orderBy(asc(whatsappAiMessages.createdAt));

  const [report = null] = await db
    .select()
    .from(whatsappAiAgentReports)
    .where(eq(whatsappAiAgentReports.leadId, leadId))
    .limit(1);

  return { conversation, messages, report };
}
