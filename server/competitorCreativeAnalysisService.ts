// ── Competitor Creative AI Analysis (Phase 27, SAFE MODE) ───────────────────
//
// Safety contract (do not violate):
//   - The ONLY column this file ever writes is competitor_ad_media.ai_analysis
//     / ai_analysis_generated_at, on the table owned by
//     competitorCreativeMediaService.ts. No other table is touched.
//   - Analysis is generated ONLY when explicitly requested for an already
//     cached creative (never in bulk, never on a schedule).
//   - Once generated, the result is cached and reused — never regenerated
//     automatically on subsequent views of the same creative.
//   - OpenAI usage here is read-only analysis generation (no external writes,
//     no calls to Meta, CRM, WhatsApp, Email, or any other system).

import OpenAI from "openai";
import { pool } from "./db";
import { getMediaById } from "./competitorCreativeMediaService";

const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
let openai: OpenAI | null = null;
if (apiKey) {
  openai = new OpenAI({ apiKey });
} else {
  console.warn("[CompetitorCreativeAnalysis] OPENAI_API_KEY not set — creative AI analysis disabled");
}

export interface CreativeAnalysis {
  whyChosen: string;
  luxuryCues: string;
  trustSignals: string;
  emotionalTriggers: string;
  weaknesses: string;
  kinglikeSuggestion: string;
}

const ANALYSIS_SYSTEM_PROMPT =
  "You are a luxury real estate advertising analyst working for Kinglike Luxury. You will be shown a single " +
  "competitor ad creative image (sourced from the public Meta Ad Library). Respond ONLY with a JSON object with " +
  "these exact keys: whyChosen, luxuryCues, trustSignals, emotionalTriggers, weaknesses, kinglikeSuggestion. " +
  "whyChosen: the likely reason the advertiser chose this specific visual/creative. " +
  "luxuryCues: visual cues that signal luxury/premium positioning (or 'none detected'). " +
  "trustSignals: visual elements that build buyer trust/credibility (or 'none detected'). " +
  "emotionalTriggers: the emotional appeal the image is designed to evoke. " +
  "weaknesses: the biggest missed opportunity or weak point in this creative. " +
  "kinglikeSuggestion: one concrete way Kinglike Luxury could produce a stronger creative than this. " +
  "Keep every field to 1-2 concise sentences.";

/**
 * Returns cached analysis if present, otherwise generates it (only ever
 * called against an already-cached, Cloudinary-hosted creative — never
 * against the original third-party URL, and never in bulk/background).
 */
export async function getOrGenerateCreativeAnalysis(mediaId: number): Promise<{
  ok: boolean;
  analysis?: CreativeAnalysis;
  error?: string;
}> {
  const media = await getMediaById(mediaId);
  if (!media) return { ok: false, error: "Media item not found" };

  if (media.ai_analysis) {
    return { ok: true, analysis: media.ai_analysis };
  }

  if (!media.cached || !media.cloudinary_url) {
    return { ok: false, error: "Creative must be cached before analysis can run" };
  }

  if (!openai) {
    return { ok: false, error: "AI analysis is not configured" };
  }

  if (media.media_type === "video") {
    return { ok: false, error: "AI analysis currently supports images and video posters only" };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this competitor ad creative." },
            { type: "image_url", image_url: { url: media.cloudinary_url } },
          ] as any,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return { ok: false, error: "AI returned no content" };
    const parsed = JSON.parse(raw);
    const analysis: CreativeAnalysis = {
      whyChosen: parsed.whyChosen || "",
      luxuryCues: parsed.luxuryCues || "",
      trustSignals: parsed.trustSignals || "",
      emotionalTriggers: parsed.emotionalTriggers || "",
      weaknesses: parsed.weaknesses || "",
      kinglikeSuggestion: parsed.kinglikeSuggestion || "",
    };

    await pool.query(
      `UPDATE competitor_ad_media SET ai_analysis = $1, ai_analysis_generated_at = NOW() WHERE id = $2`,
      [JSON.stringify(analysis), mediaId],
    );

    return { ok: true, analysis };
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error(`[CompetitorCreativeAnalysis] Failed to analyze media ${mediaId}:`, message);
    return { ok: false, error: message };
  }
}
