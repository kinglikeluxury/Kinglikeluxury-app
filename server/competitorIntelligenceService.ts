// ── Competitor Intelligence Engine — SAFE MODE (READ-ONLY, MVP) ─────────────
//
// Safety contract (do not violate):
//   - On-demand only. No scheduler/cron ever registers a call into this file.
//   - The ONLY tables this file ever CREATEs/INSERTs into are the five it
//     owns: competitor_profiles, competitor_ads, competitor_ai_analysis,
//     competitor_threat_scores, competitor_search_runs.
//   - Never touches CRM, WhatsApp, Email, Auth, Permissions, KQS, or
//     AI Marketing Director tables/routes/logic.
//   - No Meta Graph API calls (writes or reads) live in this file — all
//     public-web fetching is delegated to competitorAdLibraryFetcher.ts,
//     which only does logged-out GET navigation to the public Ad Library.
//   - OpenAI usage here is read-only analysis generation (no external writes).

import { pool } from "./db";
import { searchAdLibrary, type RawCompetitorAd } from "./competitorAdLibraryFetcher";
import { storeMediaForAd } from "./competitorCreativeMediaService";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
let openai: OpenAI | null = null;
if (apiKey) {
  openai = new OpenAI({ apiKey });
} else {
  console.warn("[CompetitorIntelligence] OPENAI_API_KEY not set — AI analysis disabled");
}

// ── Table bootstrap (new tables only, additive columns only) ───────────────

export async function ensureCompetitorIntelligenceTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS competitor_profiles (
        id                SERIAL PRIMARY KEY,
        page_name         TEXT NOT NULL UNIQUE,
        first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS competitor_ads (
        id              SERIAL PRIMARY KEY,
        competitor_id   INTEGER REFERENCES competitor_profiles(id) ON DELETE CASCADE,
        library_id      TEXT,
        ad_text         TEXT,
        status          TEXT,
        start_date      TEXT,
        end_date        TEXT,
        platforms       TEXT[],
        has_image       BOOLEAN DEFAULT FALSE,
        has_video       BOOLEAN DEFAULT FALSE,
        landing_url     TEXT,
        language        TEXT,
        search_term     TEXT,
        raw_card_text   TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS competitor_ads_library_id_idx
        ON competitor_ads(library_id) WHERE library_id IS NOT NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS competitor_ai_analysis (
        id                    SERIAL PRIMARY KEY,
        ad_id                 INTEGER REFERENCES competitor_ads(id) ON DELETE CASCADE UNIQUE,
        hook                  TEXT,
        offer                 TEXT,
        positioning           TEXT,
        weakness              TEXT,
        kinglike_suggestion   TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS competitor_threat_scores (
        id              SERIAL PRIMARY KEY,
        competitor_id   INTEGER REFERENCES competitor_profiles(id) ON DELETE CASCADE UNIQUE,
        score           INTEGER,
        band            TEXT,
        factors_json    JSONB,
        computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS competitor_search_runs (
        id              SERIAL PRIMARY KEY,
        search_term     TEXT NOT NULL,
        country         TEXT,
        success         BOOLEAN,
        blocked         BOOLEAN,
        attempts        INTEGER,
        result_count    INTEGER,
        http_status     INTEGER,
        error           TEXT,
        started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at     TIMESTAMPTZ
      )
    `);

    console.log("[DB] ensureCompetitorIntelligenceTables \u2713");
  } finally {
    client.release();
  }
}

// ── Threat score bands ──────────────────────────────────────────────────────

function bandForScore(score: number): string {
  if (score >= 80) return "Critical";
  if (score >= 60) return "Strong";
  if (score >= 40) return "Medium";
  if (score >= 20) return "Weak";
  return "Low";
}

async function computeThreatScore(competitorId: number): Promise<{ score: number; band: string; factors: any }> {
  const client = await pool.connect();
  try {
    const adsRes = await client.query(
      `SELECT status, start_date, end_date, has_image, has_video, landing_url, platforms
       FROM competitor_ads WHERE competitor_id = $1`,
      [competitorId],
    );
    const ads = adsRes.rows;
    const analysisRes = await client.query(
      `SELECT caa.weakness, caa.offer FROM competitor_ai_analysis caa
       JOIN competitor_ads ca ON ca.id = caa.ad_id
       WHERE ca.competitor_id = $1`,
      [competitorId],
    );
    const analyses = analysisRes.rows;

    const totalAds = ads.length || 1;
    const activeAds = ads.filter((a) => a.status === "Active").length;
    const withMedia = ads.filter((a) => a.has_image || a.has_video).length;
    const withLandingPage = ads.filter((a) => a.landing_url).length;
    const platformCoverage = new Set(ads.flatMap((a) => a.platforms || [])).size;
    const withOffer = analyses.filter((a) => a.offer && a.offer.trim().length > 0).length;

    // Weighted 0-100 signal blend (fixed weights, same style as KQS engine).
    const activityScore = Math.min(1, activeAds / totalAds) * 25; // campaign longevity/activity
    const volumeScore = Math.min(1, totalAds / 10) * 20; // creative refresh frequency / volume
    const mediaScore = Math.min(1, withMedia / totalAds) * 20; // branding/production quality proxy
    const landingScore = Math.min(1, withLandingPage / totalAds) * 15; // funnel maturity / trust
    const platformScore = Math.min(1, platformCoverage / 4) * 10; // market visibility
    const offerScore = Math.min(1, withOffer / totalAds) * 10; // offer strength

    const rawScore =
      activityScore + volumeScore + mediaScore + landingScore + platformScore + offerScore;
    const score = Math.round(Math.max(0, Math.min(100, rawScore)));

    return {
      score,
      band: bandForScore(score),
      factors: {
        totalAds,
        activeAds,
        withMedia,
        withLandingPage,
        platformCoverage,
        withOffer,
        breakdown: { activityScore, volumeScore, mediaScore, landingScore, platformScore, offerScore },
      },
    };
  } finally {
    client.release();
  }
}

// ── AI creative analysis (per ad) ───────────────────────────────────────────

async function analyzeAdWithAi(ad: RawCompetitorAd): Promise<{
  hook: string;
  offer: string;
  positioning: string;
  weakness: string;
  kinglikeSuggestion: string;
} | null> {
  if (!openai || !ad.adText) return null;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a luxury real estate advertising analyst working for Kinglike Luxury. " +
            "Analyze a competitor's Facebook/Instagram ad (from the public Meta Ad Library) and " +
            "respond ONLY with a JSON object with these exact keys: hook, offer, positioning, weakness, kinglikeSuggestion. " +
            "hook: the emotional/attention-grabbing opening angle used. " +
            "offer: the concrete deal/promotion/terms offered, or 'none detected'. " +
            "positioning: how the advertiser positions itself/the project (e.g. luxury, affordable, investment). " +
            "weakness: the biggest missed opportunity or weak point in this ad's copy/offer/trust-building. " +
            "kinglikeSuggestion: one concrete, better headline/offer/angle Kinglike Luxury could use to outperform this ad. " +
            "Keep every field to 1-2 concise sentences. Respond in the same language as the ad text.",
        },
        {
          role: "user",
          content: `Advertiser: ${ad.advertiserName || "unknown"}\nAd text:\n${ad.adText}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      hook: parsed.hook || "",
      offer: parsed.offer || "",
      positioning: parsed.positioning || "",
      weakness: parsed.weakness || "",
      kinglikeSuggestion: parsed.kinglikeSuggestion || "",
    };
  } catch (err) {
    console.error("[CompetitorIntelligence] AI analysis failed:", err);
    return null;
  }
}

// ── Search orchestration (on-demand only) ───────────────────────────────────

export async function runCompetitorSearch(term: string, country?: string) {
  const client = await pool.connect();
  const runInsert = await client.query(
    `INSERT INTO competitor_search_runs (search_term, country, success, blocked, attempts)
     VALUES ($1, $2, NULL, NULL, 0) RETURNING id`,
    [term, country || null],
  );
  const runId = runInsert.rows[0].id;
  client.release();

  const result = await searchAdLibrary(term, country);

  const storedAds: any[] = [];

  for (const ad of result.ads) {
    const c2 = await pool.connect();
    try {
      await c2.query("BEGIN");

      let competitorId: number;
      const pageName = ad.advertiserName || "Unknown Advertiser";
      const existing = await c2.query(`SELECT id FROM competitor_profiles WHERE page_name = $1`, [pageName]);
      if (existing.rows.length > 0) {
        competitorId = existing.rows[0].id;
        await c2.query(`UPDATE competitor_profiles SET last_detected_at = NOW() WHERE id = $1`, [competitorId]);
      } else {
        const inserted = await c2.query(
          `INSERT INTO competitor_profiles (page_name) VALUES ($1) RETURNING id`,
          [pageName],
        );
        competitorId = inserted.rows[0].id;
      }

      const adInsert = await c2.query(
        `INSERT INTO competitor_ads
           (competitor_id, library_id, ad_text, status, start_date, end_date, platforms, has_image, has_video, landing_url, language, search_term, raw_card_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (library_id) WHERE library_id IS NOT NULL
         DO UPDATE SET status = EXCLUDED.status, end_date = EXCLUDED.end_date
         RETURNING id`,
        [
          competitorId,
          ad.libraryId,
          ad.adText,
          ad.status,
          ad.startDate,
          ad.endDate,
          ad.platforms,
          ad.hasImage,
          ad.hasVideo,
          ad.landingUrl,
          ad.language,
          term,
          ad.rawCardText,
        ],
      );
      const adId = adInsert.rows[0].id;

      await c2.query("COMMIT");

      if (ad.mediaItems && ad.mediaItems.length > 0) {
        // Metadata-only: persists original media URLs, does NOT download or
        // upload anything. Caching happens later, only when an admin opens
        // a specific creative in the gallery.
        await storeMediaForAd(adId, ad.mediaItems);
      }

      const analysis = await analyzeAdWithAi(ad);
      if (analysis) {
        await pool.query(
          `INSERT INTO competitor_ai_analysis (ad_id, hook, offer, positioning, weakness, kinglike_suggestion)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (ad_id) DO UPDATE SET
             hook = EXCLUDED.hook, offer = EXCLUDED.offer, positioning = EXCLUDED.positioning,
             weakness = EXCLUDED.weakness, kinglike_suggestion = EXCLUDED.kinglike_suggestion`,
          [adId, analysis.hook, analysis.offer, analysis.positioning, analysis.weakness, analysis.kinglikeSuggestion],
        );
      }

      const threat = await computeThreatScore(competitorId);
      await pool.query(
        `INSERT INTO competitor_threat_scores (competitor_id, score, band, factors_json)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (competitor_id) DO UPDATE SET
           score = EXCLUDED.score, band = EXCLUDED.band, factors_json = EXCLUDED.factors_json, computed_at = NOW()`,
        [competitorId, threat.score, threat.band, JSON.stringify(threat.factors)],
      );

      storedAds.push({ adId, competitorId, pageName, ...ad, analysis, threat });
    } catch (err) {
      await c2.query("ROLLBACK").catch(() => {});
      console.error("[CompetitorIntelligence] Failed to store ad:", err);
    } finally {
      c2.release();
    }
  }

  await pool.query(
    `UPDATE competitor_search_runs
     SET success = $1, blocked = $2, attempts = $3, result_count = $4, http_status = $5, error = $6, finished_at = NOW()
     WHERE id = $7`,
    [result.success, result.blocked, result.attempts, result.ads.length, result.httpStatus, result.error || null, runId],
  );

  return {
    term,
    success: result.success,
    blocked: result.blocked,
    attempts: result.attempts,
    httpStatus: result.httpStatus,
    error: result.error,
    ads: storedAds,
  };
}

// ── Read queries for the admin UI ───────────────────────────────────────────
//
// Note: Market Intelligence Search / AI Market Analyst (marketIntelligenceService.ts)
// reads competitor_ads, competitor_ai_analysis, and competitor_profiles
// directly via its own read-only queries — it does not call into this file's
// functions and this file does not call into it. This keeps the two features
// fully isolated: nothing here was changed to support that feature besides
// this comment.

export async function listCompetitors() {
  const res = await pool.query(`
    SELECT p.id, p.page_name, p.first_detected_at, p.last_detected_at,
           COALESCE(t.score, 0) AS threat_score, COALESCE(t.band, 'Low') AS threat_band,
           COUNT(a.id) AS ad_count
    FROM competitor_profiles p
    LEFT JOIN competitor_threat_scores t ON t.competitor_id = p.id
    LEFT JOIN competitor_ads a ON a.competitor_id = p.id
    GROUP BY p.id, t.score, t.band
    ORDER BY COALESCE(t.score, 0) DESC, p.last_detected_at DESC
  `);
  return res.rows;
}

export async function getCompetitorAds(competitorId: number) {
  const res = await pool.query(
    `SELECT a.*, ai.hook, ai.offer, ai.positioning, ai.weakness, ai.kinglike_suggestion
     FROM competitor_ads a
     LEFT JOIN competitor_ai_analysis ai ON ai.ad_id = a.id
     WHERE a.competitor_id = $1
     ORDER BY a.created_at DESC`,
    [competitorId],
  );
  return res.rows;
}

export async function getSearchRuns(limit = 20) {
  const res = await pool.query(
    `SELECT * FROM competitor_search_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return res.rows;
}

export async function getWarRoom() {
  const competitors = await listCompetitors();
  const topCompetitors = competitors.slice(0, 20);

  const wordFreq: Record<string, number> = {};
  const hooksRes = await pool.query(
    `SELECT ai.hook FROM competitor_ai_analysis ai WHERE ai.hook IS NOT NULL AND ai.hook <> ''`,
  );
  const adsRes = await pool.query(`SELECT ad_text FROM competitor_ads WHERE ad_text IS NOT NULL`);

  const stopwords = new Set([
    "the", "and", "for", "with", "your", "you", "our", "are", "this", "that",
    "من", "في", "على", "إلى", "أو", "و", "التي", "هذا", "هذه",
  ]);

  for (const row of adsRes.rows) {
    const words: string[] = (row.ad_text || "")
      .toLowerCase()
      .replace(/[^\w\u00C0-\uFFFF\s]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 3 && !stopwords.has(w));
    for (const w of words) wordFreq[w] = (wordFreq[w] || 0) + 1;
  }

  const topKeywords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));

  const strongestHooks = hooksRes.rows.slice(0, 10).map((r) => r.hook);

  let opportunities: string[] = [];
  if (openai && (topCompetitors.length > 0 || strongestHooks.length > 0)) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are Kinglike Luxury's competitive strategist. Given a list of competitor hooks and " +
              "top keywords from their real-estate ads, respond ONLY with JSON: { \"opportunities\": string[] }. " +
              "List 3-6 concrete, actionable market gaps or angles Kinglike Luxury could exploit that competitors are " +
              "under-using. Keep each item to one sentence.",
          },
          {
            role: "user",
            content: `Top keywords: ${topKeywords.map((k) => k.word).join(", ")}\nHooks seen: ${strongestHooks.join(" | ")}`,
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content;
      if (raw) {
        const parsed = JSON.parse(raw);
        opportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities : [];
      }
    } catch (err) {
      console.error("[CompetitorIntelligence] War room opportunity generation failed:", err);
    }
  }

  return { topCompetitors, topKeywords, strongestHooks, opportunities };
}
