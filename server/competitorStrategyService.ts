// ── Competitor Intelligence Phase 2 — AI Counter Strategy (SAFE MODE) ────────
//
// Safety contract:
//   - Owns one NEW table only: competitor_counter_strategies.
//   - Append-only/versioned — generating a new strategy never overwrites a
//     prior version; version numbers increment per competitor.
//   - No Meta writes of any kind — this only produces a text/JSON recommendation.
//   - Triggered only by an explicit manual admin action ("Generate strategy").

import { pool } from "./db";
import { getOpenAiClient } from "./competitorOpenAiClient";
import { getFeedbackDigestForCompetitor } from "./competitorFeedbackService";

export async function ensureStrategyTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitor_counter_strategies (
      id                  SERIAL PRIMARY KEY,
      competitor_id       INTEGER NOT NULL,
      version             INTEGER NOT NULL,
      strategy_json       JSONB NOT NULL,
      expected_impact     TEXT,
      confidence_percent  INTEGER,
      confidence_level    TEXT,
      confidence_reason   TEXT,
      generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS competitor_counter_strategies_competitor_idx
      ON competitor_counter_strategies(competitor_id, version)
  `);
  console.log("[DB] ensureCompetitorStrategyTable \u2713");
}

function confidenceLevelFor(pct: number): string {
  if (pct >= 85) return "Very High";
  if (pct >= 65) return "High";
  if (pct >= 40) return "Medium";
  return "Low";
}

/**
 * The AI is instructed to return plain strings for each strategy field, but
 * models occasionally return arrays/objects instead. Coerce everything to a
 * flat display string so the client never has to render raw objects.
 */
function toDisplayString(value: any): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => toDisplayString(v)).filter(Boolean).join("; ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${toDisplayString(v)}`)
      .filter(Boolean)
      .join(" | ");
  }
  return String(value);
}

export async function generateCounterStrategy(competitorId: number) {
  const profileRes = await pool.query(`SELECT page_name FROM competitor_profiles WHERE id = $1`, [competitorId]);
  const pageName = profileRes.rows[0]?.page_name || "Unknown";

  const adsRes = await pool.query(
    `SELECT a.status, a.platforms, a.language, ai.hook, ai.offer, ai.positioning, ai.weakness
     FROM competitor_ads a LEFT JOIN competitor_ai_analysis ai ON ai.ad_id = a.id
     WHERE a.competitor_id = $1 ORDER BY a.created_at DESC LIMIT 20`,
    [competitorId],
  );

  const threatRes = await pool.query(
    `SELECT score, band, factors_json, overall_explanation FROM competitor_threat_scores_v2
     WHERE competitor_id = $1 ORDER BY computed_at DESC LIMIT 1`,
    [competitorId],
  );
  const threat = threatRes.rows[0] || null;

  const feedbackDigest = await getFeedbackDigestForCompetitor(competitorId, 10);

  const versionRes = await pool.query(
    `SELECT COALESCE(MAX(version), 0) AS max_version FROM competitor_counter_strategies WHERE competitor_id = $1`,
    [competitorId],
  );
  const nextVersion = (versionRes.rows[0]?.max_version || 0) + 1;

  const openai = getOpenAiClient();
  let strategy: any = null;
  let confidencePercent = 40;
  let confidenceReason = "Generated using rule-based defaults (AI unavailable).";

  if (openai) {
    try {
      const feedbackSummary = feedbackDigest.length
        ? feedbackDigest
            .map((f: any) => `v${f.version}: ${f.feedback}${f.note ? ` (${f.note})` : ""}`)
            .join("; ")
        : "No prior feedback recorded yet.";

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are Kinglike Luxury's paid-media strategist. Given a competitor's recent ads, threat score, " +
              "and feedback history on prior recommendations, respond ONLY with JSON with these exact keys: " +
              "strategyText, audience, age, interests, behaviours, placements, creatives, budget, cta, " +
              "expectedImpact, confidencePercent (0-100 integer), confidenceReason. " +
              "confidencePercent should reflect how much supporting ad/threat data you actually have (more data = higher confidence). " +
              "If prior feedback marked earlier recommendations as 'not_useful', explicitly avoid repeating that approach and mention the change in confidenceReason. " +
              "Never suggest Meta account actions requiring platform write access — only strategic/creative recommendations.",
          },
          {
            role: "user",
            content: `Competitor: ${pageName}\nRecent ads: ${JSON.stringify(adsRes.rows)}\nThreat score: ${JSON.stringify(
              threat,
            )}\nPrior feedback: ${feedbackSummary}`,
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content;
      if (raw) {
        const parsed = JSON.parse(raw);
        strategy = {
          strategyText: toDisplayString(parsed.strategyText),
          audience: toDisplayString(parsed.audience),
          age: toDisplayString(parsed.age),
          interests: toDisplayString(parsed.interests),
          behaviours: toDisplayString(parsed.behaviours),
          placements: toDisplayString(parsed.placements),
          creatives: toDisplayString(parsed.creatives),
          budget: toDisplayString(parsed.budget),
          cta: toDisplayString(parsed.cta),
        };
        confidencePercent = Math.max(0, Math.min(100, Number(parsed.confidencePercent) || 40));
        confidenceReason = parsed.confidenceReason || confidenceReason;
      }
    } catch (err) {
      console.error("[CompetitorStrategy] AI generation failed:", err);
    }
  }

  if (!strategy) {
    strategy = {
      strategyText: `Differentiate against ${pageName} by emphasizing verified trust signals and a clearer offer.`,
      audience: "Luxury property investors and end-users in target market",
      age: "30-55",
      interests: "Luxury real estate, investment property, relocation",
      behaviours: "High-value online shoppers, frequent travelers",
      placements: "Instagram, Facebook feed",
      creatives: "Video walkthrough + clear pricing/offer overlay",
      budget: "Match or moderately exceed observed competitor ad volume",
      cta: "Book a private viewing",
    };
  }

  const expectedImpact =
    (adsRes.rows.length > 0 ? `Targets a competitor with ${adsRes.rows.length} tracked ad(s)` : "Limited data available") +
    (threat ? `, currently rated '${threat.band}' (${threat.score}/100).` : ".");

  const insertRes = await pool.query(
    `INSERT INTO competitor_counter_strategies
       (competitor_id, version, strategy_json, expected_impact, confidence_percent, confidence_level, confidence_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      competitorId,
      nextVersion,
      JSON.stringify(strategy),
      expectedImpact,
      confidencePercent,
      confidenceLevelFor(confidencePercent),
      confidenceReason,
    ],
  );

  return insertRes.rows[0];
}

export async function getStrategies(competitorId: number) {
  const res = await pool.query(
    `SELECT * FROM competitor_counter_strategies WHERE competitor_id = $1 ORDER BY version DESC`,
    [competitorId],
  );
  return res.rows;
}

export async function getLatestStrategy(competitorId: number) {
  const res = await pool.query(
    `SELECT * FROM competitor_counter_strategies WHERE competitor_id = $1 ORDER BY version DESC LIMIT 1`,
    [competitorId],
  );
  return res.rows[0] || null;
}
