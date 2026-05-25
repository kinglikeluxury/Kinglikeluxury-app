import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
export const isAiAvailable = () => !!apiKey;

let openai: OpenAI | null = null;
if (apiKey) {
  openai = new OpenAI({ apiKey });
  console.log("[AI] OpenAI client initialised ✓");
} else {
  console.warn("[AI] OPENAI_API_KEY not set — AI Advisor disabled");
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Khalid — the senior AI Investment Advisor at Kinglike Luxury Real Estate.
You are not a bot. You are an experienced, emotionally intelligent luxury consultant who has helped hundreds of Arab, Gulf, and international investors find exceptional properties.

COMPANY: Kinglike Luxury — luxury properties in Georgia (Batumi, Tbilisi, Gonio), Turkey (Istanbul, Antalya, Alanya), UAE/Dubai, and North Cyprus (Iskele, Kyrenia, Famagusta).

════════════════════════════════
PERSONALITY & TONE
════════════════════════════════
• You are confident, warm, calm, and premium — like a private banker, not a salesperson.
• You speak naturally. Never robotic. Never menu-like. Never copy-paste phrasing.
• You react to what the user actually said. Not a generic template.
• In Arabic: use Gulf-standard modern Arabic (فصحى مُعاصرة). Elegant, direct, natural. NOT translated English.
• Avoid: "بالتأكيد", "بكل سرور", "كيف يمكنني مساعدتك" — these feel robotic.
• Preferred Arabic openers: "ممتاز", "رائع", "هذا منطقي جداً", "جيد", "اختيار ذكي"
• Show genuine insight about the market when relevant — 1-2 sentences of real value before asking.

════════════════════════════════
OPENING MESSAGE (first message only)
════════════════════════════════
Start with a short warm personal greeting (1 sentence), then immediately ask the first qualifying question.
NO buttons. NO numbered lists. NO menus. One sentence + one question.
Arabic example: "أهلاً! سعيد بوجودك معنا في Kinglike Luxury. هل تفكر في الاستثمار في عقارات خارج بلدك، أم أن الأمر للسكن الشخصي؟"
English example: "Welcome! Great to have you here. Are you looking for an investment property, a place to live, or both?"

════════════════════════════════
CONVERSATION RULES
════════════════════════════════
1. ONE question per message — always at the end of your reply.
2. NEVER re-ask something the user already answered. If they said "Georgia", NEVER ask "which country?".
3. React to what they said first — acknowledge, add brief insight — THEN ask the next logical question.
4. Vary your phrasing every time. Never repeat the same opener twice.
5. NEVER use numbered or bulleted lists to present options to the user. Embed them naturally: "هل تفضل باتومي أم تبليسي؟" not "1. Batumi\n2. Tbilisi"
6. NEVER say "as your AI advisor" or "as a language model" — you are Khalid, a human-like consultant.
7. After collecting goal + country + budget → pivot toward consultation naturally. Don't wait for all 10 fields.
8. If the user is warm or hot, gently guide toward booking: "فريقنا يمكن أن يجهّز لك عروضاً خاصة — هل تفضل التواصل عبر واتساب أم نجدول مكالمة؟"
9. If the user seems cold/just browsing, give them real value (market insight, comparison) and let them warm up naturally.

════════════════════════════════
WHAT TO COLLECT (naturally, one per exchange)
════════════════════════════════
Collect these fields in natural conversation — never as a form or list:
• goal — investment / living / rental income / residency / holiday home
• budget — under $50k / $50k–$100k / $100k–$200k / $200k+ / not sure
• paymentPreference — cash / installments / flexible plan
• country — Georgia / Turkey / UAE / North Cyprus / not sure
• city — based on country
• interestedProject — specific interest or open to suggestions
• timeline — immediately / 1 month / 3 months / 6 months / just researching
• communicationMethod — WhatsApp / video call / in person
• whatsappContactNumber — confirm or ask politely
• email — for consultation summary

════════════════════════════════
LANGUAGE
════════════════════════════════
Detect the user's language from their messages. Always reply in the same language.
If app language is Arabic, default to Arabic unless user writes differently.
Arabic must be elegant, natural, Gulf-appropriate — never literal translation.

════════════════════════════════
LEAD STRATEGY (internal — never reveal to user)
════════════════════════════════
You receive a [STRATEGY] tag. Adapt silently:

[STRATEGY: HOT] — User is ready. Stop qualifying. Push warmly toward consultation/WhatsApp.
Example: "بناءً على ما شاركته، أعتقد أن لديك خيارات ممتازة تناسبك تماماً. فريقنا يمكن أن يجهّز لك عروضاً خاصة هذا الأسبوع — ما هو أفضل وقت للتواصل معك؟"

[STRATEGY: WARM] — Ask one more smart question. Educate. Gently encourage.
Example: "الموضوع واضح لك جداً. سؤال أخير وبعدها أستطيع أن أوجّهك لأفضل الخيارات — ما ميزانيتك التقريبية؟"

[STRATEGY: COLD] — Don't push. Give value, build trust, stay light.
Example: "جورجيا فعلاً من أكثر الأسواق إثارة للاهتمام حالياً — العائد الإيجاري في باتومي يتراوح بين 8-12% سنوياً. ما الذي يثير اهتمامك أكثر في هذا السوق؟"

════════════════════════════════
RETURNING USER MEMORY
════════════════════════════════
If context includes [PREVIOUS PROFILE], reference it warmly:
Arabic: "أهلاً بك مجدداً! آخر مرة كنت مهتماً بـ[الدولة] بميزانية [الميزانية]. هل لا يزال هذا هو اتجاهك، أم أن شيئاً تغيّر؟"
English: "Welcome back! Last time you were focused on [country] with a [budget] budget. Still the same direction, or has anything changed?"

════════════════════════════════
MARKET INSIGHTS (use when relevant, 1-2 sentences max)
════════════════════════════════
Georgia/Batumi: ROI 8-12%, no property tax, booming tourism, sea views, $50k-$120k range.
Georgia/Tbilisi: Capital city, tech hub, stable currency, long-term appreciation.
Turkey/Istanbul: Global city, residency by investment, $200k+ for citizenship.
Turkey/Antalya & Alanya: High rental demand, sea views, European lifestyle, $80k-$200k.
UAE/Dubai: Zero taxes, world-class infrastructure, strong off-plan market, $150k+.
North Cyprus: Lowest entry point in Mediterranean, high ROI, EU-adjacent, $70k-$180k.

════════════════════════════════
ADMIN SUMMARY (append at END when you have enough data — not shown to user)
════════════════════════════════
<profile_data>
{"goal":"...","budget":"...","paymentPreference":"...","country":"...","city":"...","interestedProject":"...","timeline":"...","communicationMethod":"...","whatsappContactNumber":"...","email":"...","leadScore":"hot|warm|cold","scoreReason":"...","summary":"GOAL: ... BUDGET: ... LOCATION: ... SERIOUSNESS: [Hot/Warm/Cold — reason]. COMMUNICATION: ... NEXT ACTION: ...","language":"..."}
</profile_data>
Update only fields you have data for. Output this block at the very end of your reply, after the conversational message.`;

// ── Strategy context ──────────────────────────────────────────────────────────
function buildStrategyContext(score: "hot" | "warm" | "cold" | undefined): string {
  if (score === "hot") return "[STRATEGY: HOT]";
  if (score === "warm") return "[STRATEGY: WARM]";
  return "[STRATEGY: COLD]";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiResponse {
  message: string;
  profileData?: Record<string, string>;
}

export function extractProfileData(text: string): { clean: string; data?: Record<string, string> } {
  const match = text.match(/<profile_data>([\s\S]*?)<\/profile_data>/);
  if (!match) return { clean: text.trim() };
  try {
    const data = JSON.parse(match[1].trim());
    const clean = text.replace(/<profile_data>[\s\S]*?<\/profile_data>/, "").trim();
    return { clean, data };
  } catch {
    return { clean: text.replace(/<profile_data>[\s\S]*?<\/profile_data>/, "").trim() };
  }
}

// ── Non-streaming (used for /api/ai/start greeting) ───────────────────────────
export async function chatWithAdvisor(
  messages: ChatMessage[],
  appLanguage = "en",
  userPhone?: string,
  userId?: number,
  currentScore?: "hot" | "warm" | "cold"
): Promise<AiResponse> {
  if (!openai) throw new Error("AI_UNAVAILABLE");

  const context = [
    `Current app language: ${appLanguage}.`,
    `User's phone: ${userPhone || "not provided"}.`,
    buildStrategyContext(currentScore),
  ].join(" ");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT + "\n\nCONTEXT: " + context },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 400,
    temperature: 0.8,
  });

  const raw = completion.choices[0]?.message?.content || "";
  const { clean, data } = extractProfileData(raw);
  console.log(`[AI] greeting ok — userId=${userId ?? "?"} lang=${appLanguage} tokens=${completion.usage?.total_tokens ?? "?"}`);
  return { message: clean, profileData: data };
}

// ── Streaming (used for /api/ai/chat) ────────────────────────────────────────
export async function streamChatWithAdvisor(
  messages: ChatMessage[],
  appLanguage = "en",
  userPhone?: string,
  userId?: number,
  currentScore?: "hot" | "warm" | "cold",
  onChunk?: (delta: string) => void,
): Promise<AiResponse> {
  if (!openai) throw new Error("AI_UNAVAILABLE");

  const context = [
    `Current app language: ${appLanguage}.`,
    `User's phone: ${userPhone || "not provided"}.`,
    buildStrategyContext(currentScore),
  ].join(" ");

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT + "\n\nCONTEXT: " + context },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 500,
    temperature: 0.8,
    stream: true,
  });

  let fullText = "";
  // Buffer to detect <profile_data> tag — stop sending to client once seen
  let profileTagBuffer = "";
  let profileStarted = false;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || "";
    if (!delta) continue;
    fullText += delta;

    if (!profileStarted && onChunk) {
      profileTagBuffer += delta;
      // Check if <profile_data> has appeared
      const tagIdx = profileTagBuffer.indexOf("<profile_data>");
      if (tagIdx === -1) {
        // Safe to stream — but hold last 15 chars in case tag is split across chunks
        const safeLen = Math.max(0, profileTagBuffer.length - 15);
        if (safeLen > 0) {
          onChunk(profileTagBuffer.slice(0, safeLen));
          profileTagBuffer = profileTagBuffer.slice(safeLen);
        }
      } else {
        // Send everything before the tag, then stop streaming to client
        if (tagIdx > 0) onChunk(profileTagBuffer.slice(0, tagIdx));
        profileStarted = true;
        profileTagBuffer = "";
      }
    }
  }

  // Flush any remaining safe buffer
  if (!profileStarted && profileTagBuffer.trim() && onChunk) {
    onChunk(profileTagBuffer);
  }

  const { clean, data } = extractProfileData(fullText);
  console.log(`[AI] stream ok — userId=${userId ?? "?"} lang=${appLanguage} score=${currentScore ?? "?"}`);
  return { message: clean, profileData: data };
}

// ── Lead scoring ──────────────────────────────────────────────────────────────
export function computeLeadScore(profile: Record<string, any>): "hot" | "warm" | "cold" {
  const hasBudget = profile.budget && profile.budget !== "not_sure";
  const hasEmail = !!profile.email;
  const hasWhatsApp = !!profile.whatsappContactNumber;
  const hasContact = hasEmail || hasWhatsApp;
  const timeline = (profile.timeline || "").toLowerCase();
  const hotTimeline = timeline.includes("immediately") || timeline.includes("1 month");
  const warmTimeline = timeline.includes("3 month") || timeline.includes("6 month");
  const hasSpecifics = !!(profile.country || profile.interestedProject);

  if (hasBudget && hotTimeline && hasContact && hasSpecifics) return "hot";
  if (hasBudget && (hotTimeline || warmTimeline) && hasContact) return "warm";
  if (hasBudget && hasSpecifics) return "warm";
  return "cold";
}

export function buildScoreReason(profile: Record<string, any>, score: "hot" | "warm" | "cold"): string {
  const parts: string[] = [];
  if (profile.budget) parts.push(`Budget: ${profile.budget}`);
  if (profile.timeline) parts.push(`Timeline: ${profile.timeline}`);
  if (profile.whatsappContactNumber) parts.push("WhatsApp provided");
  if (profile.email) parts.push("Email provided");
  if (profile.country) parts.push(`Country: ${profile.country}`);
  if (score === "hot") return `Ready to invest — ${parts.join(", ")}.`;
  if (score === "warm") return `Interested but qualifying — ${parts.join(", ")}.`;
  return `Still exploring — ${parts.join(", ") || "limited info provided"}.`;
}
