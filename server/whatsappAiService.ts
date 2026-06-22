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
const WHATSAPP_SYSTEM_PROMPT = `أنت خالد — عضو في فريق Kinglike Luxury للعقارات الفاخرة.
أسلوبك: إنساني، دافئ، محترف، صبور، طبيعي — كأنك صديق خبير يتحدث عبر واتساب.

ترتيب الأسئلة (سؤال واحد فقط في كل رسالة):
1. الهدف: استثمار / سكن / عطلات
2. الدولة المفضلة
3. المدينة أو المنطقة
4. نوع العقار
5. الميزانية
6. طريقة الدفع
7. الإطار الزمني للشراء
8. أفضل وقت للتواصل

القواعد الصارمة:
- العربية الفصحى المعاصرة (راقية وطبيعية، ليست مترجمة).
- لا تسأل عن الدولة أو الميزانية أو المدينة في الرسالة الأولى.
- السؤال الأول دائماً: الاستثمار أم السكن أم قضاء العطلات.
- لا تقل "أنا مستشارك" أو "خبير استثماري" أو "مستشار قانوني".
- لا تذكر أسعاراً أو ضمانات أو عوائد استثمارية أو نسب ربح.
- لا تفضّل دولة على أخرى، ولا مشروعاً على آخر، ولا مدينة على أخرى.
- لا تعطِ نصائح قانونية أو ضريبية أو هجرة أو إقامة أو جنسية.
- لا ترسل روابط خارجية أو روابط مشاريع أو روابط مطورين إطلاقاً.
- إذا سأل عن تفاصيل قانونية أو ضمانات: "سيوضح لك المستشار المختص هذه التفاصيل بالكامل."
- إذا طلب التحدث مع شخص حقيقي: أبلغه أنك ستحيله فوراً لمستشار.
- إذا كان غير مهذب أو غاضباً: ابقَ هادئاً ومحترماً دائماً.
- إذا سُئلت عن أفضل خيار: "الاختيار الأنسب يعتمد على هدفك وميزانيتك، والمستشار سيوضح لك الخيارات."
- رسائل قصيرة ومناسبة لواتساب (لا تتجاوز 4 أسطر).`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildClientName(data: {
  fullName?: string | null;
  firstName?: string | null;
}): string {
  return data.fullName?.trim() || data.firstName?.trim() || "";
}

function getDefaultOpeningMessage(firstName: string | null | undefined): string {
  const greeting = firstName?.trim()
    ? `مرحباً أستاذ ${firstName.trim()} 🌷`
    : `مرحباً أستاذي 🌷`;
  return (
    `${greeting}\n\n` +
    `أشكرك على اهتمامك بالعقارات معنا في Kinglike Luxury.\n\n` +
    `أنا خالد من فريق Kinglike Luxury، وسأساعدك في العثور على الخيارات المناسبة حسب هدفك وميزانيتك.\n\n` +
    `بدايةً، هل تبحث عن عقار بهدف الاستثمار أم السكن أم قضاء العطلات؟`
  );
}

function getDefaultRecoveryMessage(
  firstName: string | null | undefined,
  data: { country?: string | null; city?: string | null; projectInterest?: string | null }
): string {
  const greeting = firstName?.trim()
    ? `مرحباً أستاذ ${firstName.trim()} 🌷`
    : `مرحباً أستاذي 🌷`;

  // Smart personalization: mention known interest naturally
  let personalLine = "";
  if (data.city?.trim()) {
    personalLine = `\n\nلاحظت أنك كنت مهتماً سابقاً بالعقارات في ${data.city.trim()}، وأردت فقط أن أتأكد إن كنت ما زلت مهتماً بذلك أو بفرص أخرى.`;
  } else if (data.country?.trim()) {
    personalLine = `\n\nلاحظت أنك كنت مهتماً سابقاً بالعقارات في ${data.country.trim()}، وأردت فقط أن أتأكد إن كنت ما زلت مهتماً بذلك أو بفرص أخرى.`;
  } else if (data.projectInterest?.trim()) {
    personalLine = `\n\nلاحظت أنك كنت مهتماً سابقاً بـ${data.projectInterest.trim()}، وأردت فقط أن أتأكد إن كنت ما زلت مهتماً بذلك.`;
  } else {
    personalLine = `\n\nأردت فقط أن أتأكد إن كنت ما زلت مهتماً بالعقارات أو الفرص الاستثمارية التي سجلت اهتمامك بها.`;
  }

  return (
    `${greeting}\n\n` +
    `حاول فريقنا التواصل معك سابقاً، ويبدو أن الوقت لم يكن مناسباً.` +
    personalLine +
    `\n\nإذا كان الوقت غير مناسب حالياً، فقط أخبرني بالوقت الأفضل للتواصل معك، وسنرتب ذلك بكل سرور.` +
    `\n\nوإذا تغير اهتمامك فلا يوجد أي إزعاج، فقط أخبرني بذلك 😊`
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
    const firstName = leadData.firstName?.trim() || null;
    let openingMessage = getDefaultOpeningMessage(firstName);

    if (openai) {
      try {
        const greeting = firstName ? `مرحباً أستاذ ${firstName} 🌷` : `مرحباً أستاذي 🌷`;
        const userPrompt =
          `أنشئ رسالة واتساب ترحيبية أولى للعميل الجديد.\n\n` +
          `معلومات متوفرة (للسياق فقط — لا تذكرها مباشرة):\n` +
          (leadData.country ? `- الدولة: ${leadData.country}\n` : "") +
          (leadData.projectInterest ? `- اهتمامه: ${leadData.projectInterest}\n` : "") +
          `\n` +
          `الرسالة يجب أن:\n` +
          `- تبدأ بـ: "${greeting}"\n` +
          `- تشكره على اهتمامه بالعقارات مع Kinglike Luxury.\n` +
          `- تعرّف بنفسك باختصار: أنا خالد من فريق Kinglike Luxury (لا تقل "مستشار" أو "خبير").\n` +
          `- تنهي بالسؤال الأول الإلزامي: هل تبحث عن عقار بهدف الاستثمار أم السكن أم قضاء العطلات؟\n` +
          `- لا تسأل عن الدولة أو الميزانية أو المدينة في هذه الرسالة.\n` +
          `- قصيرة ومناسبة لواتساب (4-5 أسطر كحد أقصى).`;

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

// ── triggerNoAnswer3Recovery ──────────────────────────────────────────────────
/**
 * Called when a CRM lead status changes to "no_answer_3".
 * Ensures a conversation exists, then appends an Arabic recovery draft message.
 * Updates qualification_json with recovery_reason + recovery_triggered_at.
 * NEVER sends any real WhatsApp message — Phase 1 is internal only.
 */
export async function triggerNoAnswer3Recovery(
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
    console.log(`[WhatsAppAI][Recovery] No Answer 3 detected leadId=${leadId}`);

    // Step 1: Ensure conversation exists
    let [conv] = await db
      .select()
      .from(whatsappAiConversations)
      .where(eq(whatsappAiConversations.leadId, leadId))
      .limit(1);

    if (!conv) {
      await initConversationForLead(leadId, leadData);
      const [fresh] = await db
        .select()
        .from(whatsappAiConversations)
        .where(eq(whatsappAiConversations.leadId, leadId))
        .limit(1);
      if (!fresh) {
        console.error(`[WhatsAppAI][Recovery] Failed to create conversation leadId=${leadId}`);
        return;
      }
      conv = fresh;
    }

    // Step 2: Idempotency — skip if a recovery message already exists
    const { sql } = await import("drizzle-orm");
    const [existing] = await db
      .select({ id: whatsappAiMessages.id })
      .from(whatsappAiMessages)
      .where(
        sql`${whatsappAiMessages.conversationId} = ${conv.id}
          AND ${whatsappAiMessages.rawPayloadJson}->>'messageType' = 'no_answer_3_recovery'`
      )
      .limit(1);

    if (existing) {
      console.log(`[WhatsAppAI][Recovery] Recovery message already exists leadId=${leadId} — skipping`);
      return;
    }

    // Step 3: Generate Arabic recovery message
    const clientName = buildClientName(leadData);
    const firstName = leadData.firstName?.trim() || null;
    const recoveryDefault = getDefaultRecoveryMessage(firstName, {
      country: leadData.country,
      city: leadData.city,
      projectInterest: leadData.projectInterest,
    });

    let recoveryMessage = recoveryDefault;

    if (openai) {
      try {
        const greeting = firstName ? `مرحباً أستاذ ${firstName} 🌷` : `مرحباً أستاذي 🌷`;

        // Build smart personalization hint for AI
        let personalizationHint = "";
        if (leadData.city?.trim()) {
          personalizationHint = `- اذكر بشكل طبيعي أنه كان مهتماً سابقاً بالعقارات في ${leadData.city.trim()} (بدون ضغط).\n`;
        } else if (leadData.country?.trim()) {
          personalizationHint = `- اذكر بشكل طبيعي أنه كان مهتماً سابقاً بالعقارات في ${leadData.country.trim()} (بدون ضغط).\n`;
        } else if (leadData.projectInterest?.trim()) {
          personalizationHint = `- اذكر بشكل طبيعي اهتمامه السابق بـ${leadData.projectInterest.trim()} (بدون ضغط).\n`;
        }

        const userPrompt =
          `أنشئ رسالة واتساب لاسترداد العلاقة مع العميل` +
          (clientName ? ` "${clientName}"` : "") +
          ` الذي لم يتمكن من الرد على فريق Kinglike Luxury.\n\n` +
          `الرسالة يجب أن:\n` +
          `- تبدأ بـ: "${greeting}"\n` +
          `- تشير بلطف إلى أن الفريق حاول التواصل، ويبدو أن الوقت لم يكن مناسباً.\n` +
          (personalizationHint || `- تذكّره باهتمامه العام بالعقارات والفرص الاستثمارية.\n`) +
          `- تسأله عن أفضل وقت للتواصل، أو تؤكد له أنه يمكنه التواصل متى شاء.\n` +
          `- تنهي بجملة إنسانية دافئة تجعله يشعر أنه غير مُلزَم بشيء.\n\n` +
          `القواعد الصارمة:\n` +
          `- لا تقل أبداً: "اتصلنا بك 3 مرات" أو "لم ترد علينا".\n` +
          `- لا تضغط على العميل ولا تُشعره بالذنب.\n` +
          `- لا تبدو كبوت مبيعات — كن إنسانياً وصادقاً.\n` +
          `- لا تفضّل دولة أو مدينة أو مشروعاً بعينه.\n` +
          `- لا تعطِ وعوداً قانونية أو مالية أو ضريبية.\n` +
          `- لا ترسل روابط.\n` +
          `- قصيرة ومناسبة لواتساب (5-6 أسطر كحد أقصى).`;

        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: WHATSAPP_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 250,
          temperature: 0.6,
        });

        const aiText = response.choices[0]?.message?.content?.trim();
        if (aiText) recoveryMessage = aiText;
      } catch (err: any) {
        console.warn(
          `[WhatsAppAI][Recovery] OpenAI failed, using default recovery message leadId=${leadId}: ${err.message}`
        );
      }
    }

    // Step 4: Store recovery message
    const triggeredAt = new Date().toISOString();
    await db.insert(whatsappAiMessages).values({
      conversationId: conv.id,
      sender: "ai",
      messageText: recoveryMessage,
      rawPayloadJson: {
        messageType: "no_answer_3_recovery",
        triggeredAt,
      },
    });

    console.log(`[WhatsAppAI][Recovery] Draft message created leadId=${leadId}`);

    // Step 5: Update qualification_json with recovery metadata
    const existingJson = (conv.qualificationJson as Record<string, unknown>) ?? {};
    await db
      .update(whatsappAiConversations)
      .set({
        qualificationJson: {
          ...existingJson,
          recovery_reason: "no_answer_3",
          recovery_triggered_at: triggeredAt,
        },
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(whatsappAiConversations.id, conv.id));

    console.log(`[WhatsAppAI][Recovery] No WhatsApp message sent in Phase 1`);
  } catch (err: any) {
    console.error(
      `[WhatsAppAI][Recovery] triggerNoAnswer3Recovery failed leadId=${leadId}:`,
      err.message
    );
  }
}

// ── triggerNoAnswer2Recovery ──────────────────────────────────────────────────
/**
 * Called when a CRM lead status changes to "no_answer_2".
 * Sends the fixed Arabic follow-up message via WhatsApp.
 * If the 24-hour messaging window is open → free-form text.
 * If the window is closed → falls back to the approved opener template.
 * If the template is also unavailable → logs ACTION REQUIRED and does not crash.
 * Idempotent: skips silently if recovery already sent for this lead.
 * Completely isolated from triggerNoAnswer3Recovery.
 */
export async function triggerNoAnswer2Recovery(
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
    console.log(`[WhatsAppAI][Recovery][NA2] No Answer 2 detected leadId=${leadId}`);

    const rawPhone = leadData.phone?.trim() ?? "";
    const digits   = rawPhone.replace(/[^0-9]/g, "");
    if (!digits) {
      console.log(`[WhatsAppAI][Recovery][NA2] No phone for leadId=${leadId} — skipping`);
      return;
    }

    // Step 1: Ensure conversation record exists (mirrors NA3 pattern)
    let [conv] = await db
      .select()
      .from(whatsappAiConversations)
      .where(eq(whatsappAiConversations.leadId, leadId))
      .limit(1);

    if (!conv) {
      await initConversationForLead(leadId, leadData);
      const [fresh] = await db
        .select()
        .from(whatsappAiConversations)
        .where(eq(whatsappAiConversations.leadId, leadId))
        .limit(1);
      if (!fresh) {
        console.error(`[WhatsAppAI][Recovery][NA2] Failed to create conversation leadId=${leadId}`);
        return;
      }
      conv = fresh;
    }

    // Step 2: Idempotency — skip if a no_answer_2_recovery message already exists
    const { sql: drizzleSql } = await import("drizzle-orm");
    const [existing] = await db
      .select({ id: whatsappAiMessages.id })
      .from(whatsappAiMessages)
      .where(
        drizzleSql`${whatsappAiMessages.conversationId} = ${conv.id}
          AND ${whatsappAiMessages.rawPayloadJson}->>'messageType' = 'no_answer_2_recovery'`
      )
      .limit(1);

    if (existing) {
      console.log(`[WhatsAppAI][Recovery][NA2] Already sent leadId=${leadId} — skipping`);
      return;
    }

    // Step 3: Fixed Arabic follow-up message (exact text specified)
    const noAnswer2Message =
      `ما الذي يحصل عليه عملاء Kinglike Luxury؟\n\n` +
      `في Kinglike Luxury، نرافقك في كل مرحلة من رحلتك الاستثمارية. إليك ما يحصل عليه عملاؤنا:\n\n` +
      `🏘️\n` +
      `مساعدة في اختيار المشروع\n` +
      `نستعرض معك الخيارات المتاحة ونساعدك على تقييمها وفق أهدافك وميزانيتك.\n\n` +
      `🤝\n` +
      `دعم عملية الشراء\n` +
      `نساعدك على فهم الوثائق المتاحة والتنسيق مع الأطراف ذات الصلة عند الحاجة.\n\n` +
      `🏗️\n` +
      `تحديثات البناء\n` +
      `نبقيك على اطلاع منتظم بمراحل تقدم مشروعك حتى التسليم.\n\n` +
      `🏠\n` +
      `مساعدة في الإيجار\n` +
      `عند رغبتك في تأجير عقارك، نساعدك بشبكة دعم متكاملة.\n\n` +
      `📊\n` +
      `دعم إعادة البيع\n` +
      `عندما يحين وقت البيع، نوفر لك شبكة مشترين وخبرة ميدانية.\n\n` +
      `👑\n` +
      `خدمة VIP\n` +
      `رعاية شخصية ومستشار مخصص لكل عميل طوال رحلته الاستثمارية.\n\n` +
      `جميع الخدمات المذكورة مجانية للمشتري — لا عمولات ولا رسوم خفية.`;

    // Step 4: Check 24-hour window via wa_qual_sessions
    const { pool } = await import("./db");
    const waClient = await pool.connect();
    let withinWindow = false;
    try {
      const r = await waClient.query(
        `SELECT 1 FROM wa_qual_sessions
         WHERE phone = $1
           AND last_message_at > NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [digits]
      );
      withinWindow = (r.rowCount ?? 0) > 0;
    } finally {
      waClient.release();
    }

    // Step 5: Send — free-form if window open, template otherwise
    const { sendQualTextMessage, sendQualOpenerTemplate } = await import("./interactiveMessageHelper");
    let sent = false;
    const triggeredAt = new Date().toISOString();

    if (withinWindow) {
      try {
        const result = await sendQualTextMessage(digits, noAnswer2Message);
        if (result.wamid) {
          sent = true;
          console.log(`[WhatsAppAI][Recovery][NA2] Free-form sent leadId=${leadId} wamid=${result.wamid}`);
        } else {
          console.warn(`[WhatsAppAI][Recovery][NA2] Free-form returned no wamid leadId=${leadId} — trying template`);
        }
      } catch (sendErr: any) {
        console.warn(`[WhatsAppAI][Recovery][NA2] Free-form send error leadId=${leadId}: ${sendErr.message} — trying template`);
      }
    }

    if (!sent) {
      try {
        const result = await sendQualOpenerTemplate(digits);
        if (result.success) {
          sent = true;
          console.log(`[WhatsAppAI][Recovery][NA2] Opener template sent leadId=${leadId} wamid=${result.wamid ?? "—"}`);
        } else {
          console.error(
            `[WhatsAppAI][Recovery][NA2] Template send failed leadId=${leadId} — ` +
            `ACTION REQUIRED: Ensure template "kinglike_qual_opener" (UTILITY/ar) is approved in Meta Business Suite. ` +
            `Error: ${result.error ?? "unknown"}`
          );
        }
      } catch (tplErr: any) {
        console.error(
          `[WhatsAppAI][Recovery][NA2] Template error leadId=${leadId} — ` +
          `ACTION REQUIRED: Ensure template "kinglike_qual_opener" (UTILITY/ar) is approved in Meta Business Suite. ` +
          `Error: ${tplErr.message}`
        );
      }
    }

    // Step 6: Record for idempotency (always, sent or not)
    await db.insert(whatsappAiMessages).values({
      conversationId: conv.id,
      sender:         "ai",
      messageText:    noAnswer2Message,
      rawPayloadJson: { messageType: "no_answer_2_recovery", triggeredAt, sent },
    });

    // Step 7: Update conversation metadata
    const existingJson = (conv.qualificationJson as Record<string, unknown>) ?? {};
    await db
      .update(whatsappAiConversations)
      .set({
        qualificationJson: {
          ...existingJson,
          no_answer_2_recovery_triggered_at: triggeredAt,
          no_answer_2_recovery_sent:         sent,
        },
        lastMessageAt: new Date(),
        updatedAt:     new Date(),
      })
      .where(eq(whatsappAiConversations.id, conv.id));

    console.log(`[WhatsAppAI][Recovery][NA2] Done leadId=${leadId} sent=${sent}`);
  } catch (err: any) {
    console.error(
      `[WhatsAppAI][Recovery] triggerNoAnswer2Recovery failed leadId=${leadId}:`,
      err.message
    );
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
