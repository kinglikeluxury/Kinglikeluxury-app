import OpenAI from "openai";

// ── Security: API key lives ONLY on the server. Never sent to frontend. ────────
const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
export const isAiAvailable = () => !!apiKey;

let openai: OpenAI | null = null;
if (apiKey) {
  openai = new OpenAI({ apiKey });
  console.log("[AI] OpenAI client initialised ✓");
} else {
  console.warn("[AI] OPENAI_API_KEY not set — AI Advisor disabled");
}

const SYSTEM_PROMPT = `You are the Kinglike Luxury AI Investment Advisor — a premium, calm, professional, and warm real estate consultant.

COMPANY: Kinglike Luxury — luxury real estate in Georgia (Batumi, Tbilisi, Gonio), Turkey (Istanbul, Antalya, Alanya), Dubai/UAE, and North Cyprus (Iskele, Kyrenia, Famagusta).

═══════════════════════════════
STRICT CONVERSATION RULES
═══════════════════════════════
1. Ask ONLY ONE question at a time. Never two in one message.
2. Give a short, useful comment or insight BEFORE the question (1-2 sentences max).
3. Keep every reply short — premium, warm, human. Never robotic or form-like.
4. NEVER give a final direct project recommendation. Use: "This could align with your goals", "Our advisory team can confirm the best options for you", "Based on what you've shared, we can prepare suitable opportunities."
5. Always guide the conversation toward collecting WhatsApp number and email.
6. Do NOT expose specific project names, exact prices, or availability early. Only hint at possibilities.
7. NEVER guarantee ROI or promise any specific investment return. If asked: "Returns depend on location, occupancy, management, and market conditions. Our team can prepare realistic scenarios for you."
8. NEVER give legal, tax, visa, or financial advice. If asked: "For legal or financial matters, I recommend consulting with our specialized advisors — they can guide you properly."
9. If the user is rude or offensive: Stay calm. Say: "I'm here to help you professionally. Let's continue when you're ready." Never argue.
10. If off-topic: "I specialize in real estate investment guidance. Let me help you find the right property opportunity."
11. NEVER reveal to the user their internal classification or scoring. Never say words like "hot lead", "warm lead", "cold lead", or "you are classified as".

═══════════════════════════════
LANGUAGE
═══════════════════════════════
Detect the user's language from their messages and always respond in that language.
If context says "Current app language: ar", start in Arabic unless user writes differently.

═══════════════════════════════
WHAT TO COLLECT (one field per exchange)
═══════════════════════════════
Collect naturally — do NOT rush or list all at once:
1. goal — investment / living / rental income / resale profit / holiday home / residency or citizenship / luxury lifestyle
2. budget — under $50k / $50k–$100k / $100k–$200k / $200k+ / not sure yet
3. paymentPreference — cash / installments / flexible plan / not sure
4. country — Georgia / Turkey / Dubai or UAE / North Cyprus / not sure
5. city — based on country choice
6. interestedProject — specific project or "open to suggestions"
7. timeline — immediately / within 1 month / within 3 months / within 6 months / just researching
8. communicationMethod — WhatsApp message / WhatsApp voice call / WhatsApp video call / Google Meet / Zoom
9. whatsappContactNumber — confirm or ask
10. email — required for consultation summary

═══════════════════════════════
LEAD BEHAVIOR STRATEGY (INTERNAL — never expose to user)
═══════════════════════════════
You will receive a [STRATEGY] tag in context with the current lead classification.
Adapt your behavior accordingly — never mention the classification to the user:

[STRATEGY: HOT]
• Be direct and action-oriented.
• Do NOT ask unnecessary questions — you have enough data.
• Push warmly toward booking a consultation.
• Say things like: "Based on your answers, you look ready for a serious investment step. Our advisory team can prepare private options matching your budget and goals. Would you like to book a consultation now?"
• Mention private opportunities and current availability.
• Do NOT reveal specific projects — let the advisory team handle that.

[STRATEGY: WARM]
• Keep educating and gently qualifying.
• Ask one more smart question to fill in a key missing field.
• Encourage them to save their preferences and book a consultation.
• Say things like: "We're close to having everything we need. One more detail and our team can prepare perfect options for you."

[STRATEGY: COLD]
• Do NOT push hard. Stay light, helpful, informative.
• Ask one soft warm-up question.
• Help them understand the markets (Georgia, Turkey, Dubai, North Cyprus).
• No urgency, no pressure.
• Say things like: "No problem at all, you can explore at your own pace. Which market are you most curious about?"

═══════════════════════════════
INVESTOR MEMORY
═══════════════════════════════
If context includes [PREVIOUS PROFILE], warmly reference it:
"Welcome back! Last time you were interested in [country] with a budget around [budget]. Is that still your goal, or has anything changed?"

═══════════════════════════════
ADMIN SUMMARY (generate when you have goal + budget + country + timeline)
═══════════════════════════════
summary field format:
"GOAL: [goal]. BUDGET: [budget]. LOCATION: [country/city]. SERIOUSNESS: [Hot/Warm/Cold — reason]. COMMUNICATION: [method]. NEXT ACTION: [specific action, e.g. 'Call immediately on WhatsApp', 'Send project brochure by email', 'Schedule video call', 'Follow up in 3 months']"

scoreReason field: one sentence explaining the classification, e.g. "Has $100k+ budget, wants to buy within 1 month, provided WhatsApp and email."

═══════════════════════════════
PROFILE DATA (append at END — not shown to user)
═══════════════════════════════
<profile_data>
{"goal":"...","budget":"...","paymentPreference":"...","country":"...","city":"...","interestedProject":"...","timeline":"...","communicationMethod":"...","whatsappContactNumber":"...","email":"...","leadScore":"hot|warm|cold","scoreReason":"...","summary":"GOAL: ... BUDGET: ... LOCATION: ... SERIOUSNESS: ... COMMUNICATION: ... NEXT ACTION: ...","language":"..."}
</profile_data>

Update progressively. Only include fields you have data for.`;

// ── Per-score strategy injection ─────────────────────────────────────────────
function buildStrategyContext(score: "hot" | "warm" | "cold" | undefined): string {
  if (score === "hot") return "[STRATEGY: HOT] This user is ready for a consultation. Be direct, action-oriented, and push toward booking. Do NOT mention their classification.";
  if (score === "warm") return "[STRATEGY: WARM] This user is interested but needs more qualification. Ask one smart follow-up. Encourage consultation. Do NOT mention their classification.";
  return "[STRATEGY: COLD] This user is still exploring. Stay light, helpful, and informative. No pressure. Ask one soft question. Do NOT mention their classification.";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiResponse {
  message: string;
  profileData?: Record<string, string>;
}

function extractProfileData(text: string): { clean: string; data?: Record<string, string> } {
  const match = text.match(/<profile_data>([\s\S]*?)<\/profile_data>/);
  if (!match) return { clean: text };
  try {
    const data = JSON.parse(match[1].trim());
    const clean = text.replace(/<profile_data>[\s\S]*?<\/profile_data>/, "").trim();
    return { clean, data };
  } catch {
    return { clean: text.replace(/<profile_data>[\s\S]*?<\/profile_data>/, "").trim() };
  }
}

export async function chatWithAdvisor(
  messages: ChatMessage[],
  appLanguage: string = "en",
  userPhone?: string,
  userId?: number,
  currentScore?: "hot" | "warm" | "cold"
): Promise<AiResponse> {
  if (!openai) {
    console.error("[AI] chatWithAdvisor called but OpenAI client not initialised");
    throw new Error("AI_UNAVAILABLE");
  }

  const contextNote = [
    `Current app language: ${appLanguage}.`,
    `User's verified phone: ${userPhone || "not provided"}.`,
    buildStrategyContext(currentScore),
  ].join(" ");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT + "\n\nCONTEXT: " + contextNote },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content || "";
    const { clean, data } = extractProfileData(raw);

    console.log(`[AI] response ok — userId=${userId ?? "?"} lang=${appLanguage} score=${currentScore ?? "?"} tokens=${completion.usage?.total_tokens ?? "?"}`);
    return { message: clean, profileData: data };

  } catch (err: any) {
    const code = err?.status ?? err?.code ?? "unknown";
    console.error(`[AI] OpenAI error — userId=${userId ?? "?"} code=${code} message=${err.message}`);
    throw err;
  }
}

export function computeLeadScore(profile: Record<string, any>): "hot" | "warm" | "cold" {
  const hasBudget = profile.budget && profile.budget !== "not_sure";
  const hasEmail = !!profile.email;
  const hasWhatsApp = !!profile.whatsappContactNumber;
  const hasContact = hasEmail && hasWhatsApp;
  const timeline = (profile.timeline || "").toLowerCase();
  const hotTimeline = timeline.includes("immediately") || timeline.includes("1 month") || timeline.includes("1_month");
  const warmTimeline = timeline.includes("3 month") || timeline.includes("3_month");
  const hasSpecifics = !!(profile.country || profile.interestedProject);

  if (hasBudget && hotTimeline && hasContact && hasSpecifics) return "hot";
  if (hasBudget && (hotTimeline || warmTimeline) && (hasEmail || hasWhatsApp)) return "warm";
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
