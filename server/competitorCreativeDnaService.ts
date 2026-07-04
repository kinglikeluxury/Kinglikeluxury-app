// ── Competitor Creative DNA Foundation (Phase 28, SAFE MODE) ────────────────
//
// Safety contract (do not violate):
//   - The ONLY table this file ever writes to is competitor_creative_dna
//     (new, additive-only table created by this file). No other table is
//     touched — competitor_ad_media, competitor_ai_analysis, and every other
//     table owned by other services remain untouched.
//   - Analysis is generated ONLY when explicitly requested (admin clicks
//     "Analyze Creative DNA") for a single, already-cached creative — never
//     in bulk, never on a schedule, never automatically.
//   - Every analysis is stored as a new version row. Prior DNA rows for the
//     same media item are NEVER updated or deleted — fully append-only/
//     versioned history.
//   - OpenAI vision is called ONLY against the cached Cloudinary URL for the
//     media item — never against the original third-party (Meta CDN) URL.
//   - Video creatives are not supported in this phase.
//   - This file makes zero calls into CRM, WhatsApp, Email, Auth,
//     Permissions, KQS, AI Marketing Director, Meta Intelligence, Lead
//     Assignment, or Meta's write APIs. It only reads from
//     competitorCreativeMediaService.ts (getMediaById) for cache status.

import OpenAI from "openai";
import { pool } from "./db";
import { getMediaById } from "./competitorCreativeMediaService";

const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
let openai: OpenAI | null = null;
if (apiKey) {
  openai = new OpenAI({ apiKey });
} else {
  console.warn("[CompetitorCreativeDna] OPENAI_API_KEY not set — creative DNA analysis disabled");
}

// ── Table bootstrap (additive only, new table) ──────────────────────────────

export async function ensureCompetitorCreativeDnaTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS competitor_creative_dna (
        id                          SERIAL PRIMARY KEY,
        media_id                    INTEGER NOT NULL REFERENCES competitor_ad_media(id) ON DELETE CASCADE,
        version                     INTEGER NOT NULL,
        luxury_score                INTEGER,
        trust_score                 INTEGER,
        investment_appeal_score     INTEGER,
        emotional_score             INTEGER,
        family_appeal_score         INTEGER,
        urgency_score               INTEGER,
        scarcity_score              INTEGER,
        visual_quality_score        INTEGER,
        brand_quality_score         INTEGER,
        expected_conversion_score   INTEGER,
        detected_objects            JSONB,
        scene_type                  TEXT,
        colors                      JSONB,
        brightness                  TEXT,
        composition_notes           TEXT,
        visible_text_ocr            TEXT,
        likely_target_audience      TEXT,
        strengths                   TEXT,
        weaknesses                  TEXT,
        kinglike_better_angle       TEXT,
        ai_explanation              TEXT,
        confidence_percent          INTEGER,
        created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS competitor_creative_dna_media_version_idx
        ON competitor_creative_dna(media_id, version)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS competitor_creative_dna_media_idx
        ON competitor_creative_dna(media_id)
    `);
    console.log("[DB] ensureCompetitorCreativeDnaTable \u2713 (additive, new table only)");
  } finally {
    client.release();
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface CreativeDna {
  id: number;
  mediaId: number;
  version: number;
  luxuryScore: number | null;
  trustScore: number | null;
  investmentAppealScore: number | null;
  emotionalScore: number | null;
  familyAppealScore: number | null;
  urgencyScore: number | null;
  scarcityScore: number | null;
  visualQualityScore: number | null;
  brandQualityScore: number | null;
  expectedConversionScore: number | null;
  detectedObjects: string[];
  sceneType: string;
  colors: string[];
  brightness: string;
  compositionNotes: string;
  visibleTextOcr: string;
  likelyTargetAudience: string;
  strengths: string;
  weaknesses: string;
  kinglikeBetterAngle: string;
  aiExplanation: string;
  confidencePercent: number | null;
  createdAt: string;
}

function rowToDna(row: any): CreativeDna {
  return {
    id: row.id,
    mediaId: row.media_id,
    version: row.version,
    luxuryScore: row.luxury_score,
    trustScore: row.trust_score,
    investmentAppealScore: row.investment_appeal_score,
    emotionalScore: row.emotional_score,
    familyAppealScore: row.family_appeal_score,
    urgencyScore: row.urgency_score,
    scarcityScore: row.scarcity_score,
    visualQualityScore: row.visual_quality_score,
    brandQualityScore: row.brand_quality_score,
    expectedConversionScore: row.expected_conversion_score,
    detectedObjects: Array.isArray(row.detected_objects) ? row.detected_objects : [],
    sceneType: row.scene_type || "",
    colors: Array.isArray(row.colors) ? row.colors : [],
    brightness: row.brightness || "",
    compositionNotes: row.composition_notes || "",
    visibleTextOcr: row.visible_text_ocr || "",
    likelyTargetAudience: row.likely_target_audience || "",
    strengths: row.strengths || "",
    weaknesses: row.weaknesses || "",
    kinglikeBetterAngle: row.kinglike_better_angle || "",
    aiExplanation: row.ai_explanation || "",
    confidencePercent: row.confidence_percent,
    createdAt: row.created_at,
  };
}

// ── Read helpers ─────────────────────────────────────────────────────────────

export async function getLatestCreativeDna(mediaId: number): Promise<CreativeDna | null> {
  const res = await pool.query(
    `SELECT * FROM competitor_creative_dna WHERE media_id = $1 ORDER BY version DESC LIMIT 1`,
    [mediaId],
  );
  return res.rows[0] ? rowToDna(res.rows[0]) : null;
}

export async function getCreativeDnaHistory(mediaId: number): Promise<CreativeDna[]> {
  const res = await pool.query(
    `SELECT * FROM competitor_creative_dna WHERE media_id = $1 ORDER BY version DESC`,
    [mediaId],
  );
  return res.rows.map(rowToDna);
}

// ── AI prompt ────────────────────────────────────────────────────────────────

const DNA_SYSTEM_PROMPT =
  "You are a luxury real estate advertising analyst working for Kinglike Luxury. You will be shown a single " +
  "competitor ad creative image (sourced from the public Meta Ad Library). Respond ONLY with a JSON object with " +
  "these exact keys: luxury_score, trust_score, investment_appeal_score, emotional_score, family_appeal_score, " +
  "urgency_score, scarcity_score, visual_quality_score, brand_quality_score, expected_conversion_score, " +
  "detected_objects, scene_type, colors, brightness, composition_notes, visible_text_ocr, " +
  "likely_target_audience, strengths, weaknesses, kinglike_better_angle, ai_explanation, confidence_percent. " +
  "All *_score fields (including expected_conversion_score and confidence_percent) must be integers from 0 to 100. " +
  "detected_objects must be a JSON array of short strings naming the visual objects/elements you see " +
  "(e.g. ['skyline', 'pool', 'family', 'sunset']). " +
  "scene_type: a short label for the setting (e.g. 'interior', 'exterior skyline', 'lifestyle/family', 'aerial'). " +
  "colors must be a JSON array of the dominant color names in the image (e.g. ['navy', 'gold', 'white']). " +
  "brightness: one of 'dark', 'balanced', or 'bright'. " +
  "composition_notes: 1-2 sentences on framing/composition choices. " +
  "visible_text_ocr: any text visible in the image, transcribed as plainly as possible (or empty string if none). " +
  "likely_target_audience: who this creative is most likely targeting. " +
  "strengths: the strongest aspect of this creative in 1-2 sentences. " +
  "weaknesses: the biggest missed opportunity or weak point in 1-2 sentences. " +
  "kinglike_better_angle: one concrete, specific way Kinglike Luxury could produce a stronger creative than this. " +
  "ai_explanation: a short paragraph (2-4 sentences) explaining your overall reasoning behind the scores above.";

// ── On-demand analysis (never bulk, never scheduled) ────────────────────────

export async function analyzeCreativeDna(mediaId: number): Promise<{
  ok: boolean;
  dna?: CreativeDna;
  error?: string;
}> {
  const media = await getMediaById(mediaId);
  if (!media) return { ok: false, error: "Media item not found" };

  if (!media.cached || !media.cloudinary_url) {
    return { ok: false, error: "Cache this creative first." };
  }

  if (media.media_type === "video") {
    return { ok: false, error: "Creative DNA currently supports images only (video not supported in this phase)" };
  }

  if (!openai) {
    return { ok: false, error: "AI analysis is not configured" };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DNA_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this competitor ad creative and produce its Creative DNA." },
            { type: "image_url", image_url: { url: media.cloudinary_url } },
          ] as any,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return { ok: false, error: "AI returned no content" };
    const parsed = JSON.parse(raw);

    const client = await pool.connect();
    let insertedRow: any;
    try {
      const versionRes = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM competitor_creative_dna WHERE media_id = $1`,
        [mediaId],
      );
      const nextVersion = versionRes.rows[0].next_version;

      const insertRes = await client.query(
        `INSERT INTO competitor_creative_dna (
           media_id, version, luxury_score, trust_score, investment_appeal_score, emotional_score,
           family_appeal_score, urgency_score, scarcity_score, visual_quality_score, brand_quality_score,
           expected_conversion_score, detected_objects, scene_type, colors, brightness, composition_notes,
           visible_text_ocr, likely_target_audience, strengths, weaknesses, kinglike_better_angle,
           ai_explanation, confidence_percent
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
         ) RETURNING *`,
        [
          mediaId,
          nextVersion,
          parsed.luxury_score ?? null,
          parsed.trust_score ?? null,
          parsed.investment_appeal_score ?? null,
          parsed.emotional_score ?? null,
          parsed.family_appeal_score ?? null,
          parsed.urgency_score ?? null,
          parsed.scarcity_score ?? null,
          parsed.visual_quality_score ?? null,
          parsed.brand_quality_score ?? null,
          parsed.expected_conversion_score ?? null,
          JSON.stringify(Array.isArray(parsed.detected_objects) ? parsed.detected_objects : []),
          parsed.scene_type || "",
          JSON.stringify(Array.isArray(parsed.colors) ? parsed.colors : []),
          parsed.brightness || "",
          parsed.composition_notes || "",
          parsed.visible_text_ocr || "",
          parsed.likely_target_audience || "",
          parsed.strengths || "",
          parsed.weaknesses || "",
          parsed.kinglike_better_angle || "",
          parsed.ai_explanation || "",
          parsed.confidence_percent ?? null,
        ],
      );
      insertedRow = insertRes.rows[0];
    } finally {
      client.release();
    }

    return { ok: true, dna: rowToDna(insertedRow) };
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error(`[CompetitorCreativeDna] Failed to analyze media ${mediaId}:`, message);
    return { ok: false, error: message };
  }
}
