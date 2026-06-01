/**
 * Preview test: extractLeadFromConversation() against real conversation #34.
 * Run with: npx tsx server/_test_extract_preview.ts
 * Delete after verification.
 */
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;
import OpenAI from "openai";

const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EXTRACTION_PROMPT = `You are a silent data extraction engine for a luxury real estate platform.
Read the conversation below and extract the following fields from what the USER said across ALL messages.
Return ONLY a valid JSON object — no explanation, no markdown, no extra text.

Fields to extract (use null if not mentioned anywhere in the conversation):
{
  "goal": "investment | personal_use | both | null",
  "budget": "numeric amount + currency as string, e.g. '100000 USD', or null",
  "paymentPreference": "cash | installments | null",
  "country": "country name in English or null",
  "city": "city name in English or null",
  "interestedProject": "project name or description or null",
  "timeline": "when they want to buy, e.g. 'immediately', '3 months', or null",
  "communicationMethod": "whatsapp | email | phone | null",
  "whatsappContactNumber": "digits only, no + or spaces, or null",
  "email": "email address or null",
  "language": "2-letter ISO code of the language the user is writing in"
}

Rules:
- Extract phone/WhatsApp numbers from any message — strip +, spaces, dashes
- Budget: extract numeric value + currency from any message
- Country/city: infer from project location if explicitly stated (e.g. 'Batumi' → city=Batumi, country=Georgia)
- If a field is not mentioned anywhere, set it to null
- Return ONLY the JSON object`;

async function extractLeadFromConversation(
  messages: { role: string; content: string }[]
): Promise<Record<string, string | null>> {
  const transcript = messages
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join("\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: `CONVERSATION:\n\n${transcript}` },
    ],
    max_tokens: 300,
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

function computeLeadScore(p: Record<string, string | null>): "hot" | "warm" | "cold" {
  const hasBudget   = !!(p.budget && p.budget !== "not_sure");
  const hasPhone    = !!(p.whatsappContactNumber);
  const hasLocation = !!(p.country || p.city || p.interestedProject);
  if (hasPhone && hasBudget && hasLocation) return "hot";
  if (hasPhone && (hasBudget || hasLocation)) return "warm";
  if (hasPhone) return "warm";
  return "cold";
}

async function main() {
  const db = await pool.connect();
  try {
    // Load real conversation #34 from DB
    const result = await db.query(
      "SELECT role, content FROM ai_messages WHERE conversation_id = 34 ORDER BY id ASC"
    );
    const messages = result.rows;

    console.log(`\n📂 Loaded conversation #34 — ${messages.length} messages`);
    console.log("─────────────────────────────────────────");
    messages.forEach((m, i) => {
      const snippet = m.content.replace(/\n/g, " ").slice(0, 80);
      console.log(`[${i}] ${m.role}: ${snippet}`);
    });

    console.log("\n⏳ Running extraction against full conversation history...");
    const extracted = await extractLeadFromConversation(messages);
    const score = computeLeadScore(extracted);

    console.log("\n✅ EXTRACTION RESULT");
    console.log("─────────────────────────────────────────");
    console.log("conversation_id     :", 34);
    console.log("country             :", extracted.country      ?? "— not found");
    console.log("city                :", extracted.city         ?? "— not found");
    console.log("budget              :", extracted.budget       ?? "— not found");
    console.log("interested_project  :", extracted.interestedProject ?? "— not found");
    console.log("whatsapp            :", extracted.whatsappContactNumber
      ? "✅ " + (extracted.whatsappContactNumber as string).replace(/(\d{3})\d{4}(\d{4})/, "$1****$2") + " (masked)"
      : "— not found");
    console.log("goal                :", extracted.goal         ?? "— not found");
    console.log("timeline            :", extracted.timeline     ?? "— not found");
    console.log("payment_preference  :", extracted.paymentPreference ?? "— not found");
    console.log("language            :", extracted.language     ?? "— not found");
    console.log("─────────────────────────────────────────");
    console.log("computed lead score :", score.toUpperCase());

    console.log("\n📋 Full raw JSON from extraction call:");
    console.log(JSON.stringify(extracted, null, 2));

    const hasPhone    = !!(extracted.whatsappContactNumber);
    const hasBudget   = !!(extracted.budget);
    const hasLocation = !!(extracted.country || extracted.city || extracted.interestedProject);
    console.log("\n🔍 Score reasoning:");
    console.log("  hasPhone    :", hasPhone,    "→", extracted.whatsappContactNumber ?? "null");
    console.log("  hasBudget   :", hasBudget,   "→", extracted.budget ?? "null");
    console.log("  hasLocation :", hasLocation, "→", [extracted.country, extracted.city, extracted.interestedProject].filter(Boolean).join(" / "));
    console.log("  → HOT =", hasPhone && hasBudget && hasLocation);

  } finally {
    db.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error("\n❌ Error:", e.message);
  process.exit(1);
});
