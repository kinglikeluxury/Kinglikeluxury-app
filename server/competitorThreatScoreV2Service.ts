// ── Competitor Intelligence Phase 2 — Threat Score V2 (SAFE MODE, additive) ──
//
// Safety contract:
//   - Owns one NEW table only: competitor_threat_scores_v2.
//   - Append-only/versioned — every computation inserts a new row; the V1
//     table (competitor_threat_scores) is read-only here and never modified.
//   - AI usage is read-only text generation (explanations) — no external writes.
//   - Triggered only by the Phase 2 orchestrator (manual admin action).

import { pool } from "./db";
import { getOpenAiClient } from "./competitorOpenAiClient";

interface FactorDef {
  key: string;
  name: string;
  max: number;
}

const FACTORS: FactorDef[] = [
  { key: "creativeQuality", name: "Creative Quality", max: 25 },
  { key: "marketActivity", name: "Market Activity", max: 20 },
  { key: "campaignLongevity", name: "Campaign Longevity", max: 15 },
  { key: "creativeRefresh", name: "Creative Refresh", max: 10 },
  { key: "brandStrength", name: "Brand Strength", max: 10 },
  { key: "offerStrength", name: "Offer Strength", max: 10 },
  { key: "visibility", name: "Visibility", max: 5 },
  { key: "consistency", name: "Consistency", max: 5 },
];

function bandForScore(score: number): string {
  if (score >= 80) return "Critical";
  if (score >= 60) return "Strong";
  if (score >= 40) return "Medium";
  if (score >= 20) return "Weak";
  return "Low";
}

export async function ensureThreatScoreV2Table(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitor_threat_scores_v2 (
      id                  SERIAL PRIMARY KEY,
      competitor_id       INTEGER NOT NULL,
      score               INTEGER NOT NULL,
      band                TEXT NOT NULL,
      factors_json        JSONB NOT NULL,
      overall_explanation TEXT,
      computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS competitor_threat_scores_v2_competitor_idx
      ON competitor_threat_scores_v2(competitor_id, computed_at)
  `);
  console.log("[DB] ensureCompetitorThreatScoreV2Table \u2713");
}

async function computeRawFactors(competitorId: number) {
  const adsRes = await pool.query(
    `SELECT status, start_date, end_date, has_image, has_video, landing_url, platforms
     FROM competitor_ads WHERE competitor_id = $1`,
    [competitorId],
  );
  const ads = adsRes.rows;
  const totalAds = ads.length || 1;

  const analysisRes = await pool.query(
    `SELECT caa.offer, caa.positioning FROM competitor_ai_analysis caa
     JOIN competitor_ads ca ON ca.id = caa.ad_id WHERE ca.competitor_id = $1`,
    [competitorId],
  );
  const analyses = analysisRes.rows;

  const refreshRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM competitor_timeline_events
     WHERE competitor_id = $1 AND event_type IN ('creative_changed', 'new_creative')`,
    [competitorId],
  );
  const creativeChangeCount = refreshRes.rows[0]?.c || 0;

  const historySpanRes = await pool.query(
    `SELECT MIN(captured_at) AS first, MAX(captured_at) AS last FROM competitor_ad_history WHERE competitor_id = $1`,
    [competitorId],
  );
  const first = historySpanRes.rows[0]?.first;
  const last = historySpanRes.rows[0]?.last;
  const spanDays = first && last ? Math.max(0, (new Date(last).getTime() - new Date(first).getTime()) / 86400000) : 0;

  const runsSeenRes = await pool.query(
    `SELECT COUNT(DISTINCT run_id)::int AS c FROM competitor_ad_history WHERE competitor_id = $1`,
    [competitorId],
  );
  const runsSeen = runsSeenRes.rows[0]?.c || 0;

  const activeAds = ads.filter((a) => a.status === "Active").length;
  const withMedia = ads.filter((a) => a.has_image || a.has_video).length;
  const withLandingPage = ads.filter((a) => a.landing_url).length;
  const platformCoverage = new Set(ads.flatMap((a) => a.platforms || [])).size;
  const withOffer = analyses.filter((a) => a.offer && a.offer.trim().length > 0).length;
  const distinctPositioning = new Set(analyses.map((a) => (a.positioning || "").trim()).filter(Boolean)).size;

  const creativeQuality = Math.min(1, withMedia / totalAds) * FACTORS[0].max;
  const marketActivity = Math.min(1, (activeAds / totalAds) * 0.6 + Math.min(1, totalAds / 10) * 0.4) * FACTORS[1].max;
  const campaignLongevity = Math.min(1, spanDays / 90) * FACTORS[2].max;
  const creativeRefresh = Math.min(1, creativeChangeCount / 5) * FACTORS[3].max;
  const brandStrength = Math.min(1, distinctPositioning > 0 ? 1 / distinctPositioning + 0.3 : 0.3) * FACTORS[4].max;
  const offerStrength = Math.min(1, withOffer / totalAds) * FACTORS[5].max;
  const visibility = Math.min(1, platformCoverage / 4) * FACTORS[6].max;
  const consistency = Math.min(1, runsSeen / 3) * FACTORS[7].max;

  return {
    raw: {
      creativeQuality,
      marketActivity,
      campaignLongevity,
      creativeRefresh,
      brandStrength,
      offerStrength,
      visibility,
      consistency,
    },
    context: {
      totalAds,
      activeAds,
      withMedia,
      withLandingPage,
      platformCoverage,
      withOffer,
      distinctPositioning,
      creativeChangeCount,
      spanDays: Math.round(spanDays),
      runsSeen,
    },
  };
}

async function generateExplanations(
  pageName: string,
  factorScores: { name: string; raw: number; max: number }[],
  context: Record<string, any>,
): Promise<{ perFactor: Record<string, string>; overall: string }> {
  const openai = getOpenAiClient();
  const fallback = {
    perFactor: Object.fromEntries(
      factorScores.map((f) => [f.name, `Scored ${f.raw.toFixed(1)}/${f.max} based on observed ad data.`]),
    ),
    overall: `Overall threat score reflects ${pageName}'s combined creative, activity, and market-presence signals observed to date.`,
  };
  if (!openai) return fallback;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a competitive-intelligence analyst for a luxury real estate brand. " +
            "Given a competitor's threat-score factor breakdown and supporting context, respond ONLY with JSON: " +
            '{ "perFactor": { "<factor name>": "1 sentence reason" }, "overall": "2-3 sentence overall explanation" }. ' +
            "Be specific and reference the numbers given. Keep it concise and factual.",
        },
        {
          role: "user",
          content: `Competitor: ${pageName}\nFactors: ${JSON.stringify(factorScores)}\nContext: ${JSON.stringify(context)}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      perFactor: parsed.perFactor && typeof parsed.perFactor === "object" ? parsed.perFactor : fallback.perFactor,
      overall: parsed.overall || fallback.overall,
    };
  } catch (err) {
    console.error("[CompetitorThreatScoreV2] explanation generation failed:", err);
    return fallback;
  }
}

export async function computeAndStoreThreatScoreV2(competitorId: number): Promise<any> {
  const profileRes = await pool.query(`SELECT page_name FROM competitor_profiles WHERE id = $1`, [competitorId]);
  const pageName = profileRes.rows[0]?.page_name || "Unknown";

  const { raw, context } = await computeRawFactors(competitorId);

  const factorScores = FACTORS.map((f) => ({
    name: f.name,
    raw: Math.round((raw as any)[f.key] * 10) / 10,
    max: f.max,
    weight: f.max,
  }));

  const totalScore = Math.round(factorScores.reduce((sum, f) => sum + f.raw, 0));
  const score = Math.max(0, Math.min(100, totalScore));
  const band = bandForScore(score);

  const explanations = await generateExplanations(pageName, factorScores, context);

  const factorsWithExplanations = factorScores.map((f) => ({
    ...f,
    explanation: explanations.perFactor[f.name] || `Scored ${f.raw}/${f.max}.`,
  }));

  const insertRes = await pool.query(
    `INSERT INTO competitor_threat_scores_v2 (competitor_id, score, band, factors_json, overall_explanation)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [competitorId, score, band, JSON.stringify(factorsWithExplanations), explanations.overall],
  );

  return insertRes.rows[0];
}

export async function getLatestThreatScoreV2(competitorId: number) {
  const res = await pool.query(
    `SELECT * FROM competitor_threat_scores_v2 WHERE competitor_id = $1 ORDER BY computed_at DESC LIMIT 1`,
    [competitorId],
  );
  return res.rows[0] || null;
}

export async function getThreatScoreV2History(competitorId: number) {
  const res = await pool.query(
    `SELECT * FROM competitor_threat_scores_v2 WHERE competitor_id = $1 ORDER BY computed_at DESC`,
    [competitorId],
  );
  return res.rows;
}
