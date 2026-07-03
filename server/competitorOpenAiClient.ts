// ── Shared OpenAI client for Competitor Intelligence Phase 2 ────────────────
// Read-only text-generation usage only (explanations, strategies, summaries).
// No writes to any external system live here.

import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
let client: OpenAI | null = null;
if (apiKey) {
  client = new OpenAI({ apiKey });
} else {
  console.warn("[CompetitorIntelligence Phase 2] OPENAI_API_KEY not set — AI features disabled");
}

export function getOpenAiClient(): OpenAI | null {
  return client;
}
