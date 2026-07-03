// ── Competitor Intelligence Phase 2 — Market Memory (SAFE MODE, additive) ───
//
// Safety contract:
//   - Owns two NEW tables only: competitor_ad_history, competitor_threat_score_history.
//   - Append-only — never UPDATEs or DELETEs a row. Every refresh writes new
//     rows; nothing is ever overwritten. This is the permanent historical record.
//   - Reads (never writes) from the existing MVP tables (competitor_ads,
//     competitor_ai_analysis, competitor_threat_scores). competitorIntelligenceService.ts
//     itself is never imported/modified — only the shared `pool` is used.
//   - Triggered only by an explicit admin action (via the Phase 2 orchestrator),
//     never by a scheduler.

import { pool } from "./db";

export async function ensureMemoryTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS competitor_ad_history (
        id              SERIAL PRIMARY KEY,
        ad_id           INTEGER NOT NULL,
        competitor_id   INTEGER NOT NULL,
        run_id          INTEGER,
        status          TEXT,
        offer_text      TEXT,
        headline_text   TEXT,
        has_image       BOOLEAN DEFAULT FALSE,
        has_video       BOOLEAN DEFAULT FALSE,
        landing_url     TEXT,
        captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS competitor_ad_history_ad_idx ON competitor_ad_history(ad_id, captured_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS competitor_ad_history_competitor_idx ON competitor_ad_history(competitor_id, captured_at)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS competitor_threat_score_history (
        id              SERIAL PRIMARY KEY,
        competitor_id   INTEGER NOT NULL,
        score           INTEGER,
        band            TEXT,
        factors_json    JSONB,
        computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS competitor_threat_score_history_competitor_idx
        ON competitor_threat_score_history(competitor_id, computed_at)
    `);

    console.log("[DB] ensureCompetitorMemoryTables \u2713");
  } finally {
    client.release();
  }
}

export interface AdSnapshotRow {
  adId: number;
  competitorId: number;
  status: string | null;
  offerText: string | null;
  headlineText: string | null;
  hasImage: boolean;
  hasVideo: boolean;
  landingUrl: string | null;
  previous: {
    status: string | null;
    offerText: string | null;
    headlineText: string | null;
    hasImage: boolean;
    hasVideo: boolean;
  } | null;
  isFirstEverForCompetitor: boolean;
  isNewAd: boolean;
}

/**
 * Snapshots the current state of the given ad IDs into competitor_ad_history
 * (append-only). Returns each snapshot alongside its immediately-preceding
 * history row (if any) so callers (timeline/evolution) can diff without a
 * second round-trip.
 */
export async function snapshotAds(runId: number, adIds: number[]): Promise<AdSnapshotRow[]> {
  if (!adIds.length) return [];
  const client = await pool.connect();
  const results: AdSnapshotRow[] = [];
  try {
    const currentRes = await client.query(
      `SELECT a.id AS ad_id, a.competitor_id, a.status, a.has_image, a.has_video, a.landing_url,
              a.ad_text, ai.offer, ai.hook
       FROM competitor_ads a
       LEFT JOIN competitor_ai_analysis ai ON ai.ad_id = a.id
       WHERE a.id = ANY($1::int[])`,
      [adIds],
    );

    for (const row of currentRes.rows) {
      const headlineText: string | null = row.hook || (row.ad_text ? String(row.ad_text).slice(0, 120) : null);
      const offerText: string | null = row.offer || null;

      const prevRes = await client.query(
        `SELECT status, offer_text, headline_text, has_image, has_video
         FROM competitor_ad_history WHERE ad_id = $1 ORDER BY captured_at DESC LIMIT 1`,
        [row.ad_id],
      );
      const previous = prevRes.rows[0]
        ? {
            status: prevRes.rows[0].status,
            offerText: prevRes.rows[0].offer_text,
            headlineText: prevRes.rows[0].headline_text,
            hasImage: prevRes.rows[0].has_image,
            hasVideo: prevRes.rows[0].has_video,
          }
        : null;

      const competitorHistoryCountRes = await client.query(
        `SELECT COUNT(*)::int AS c FROM competitor_ad_history WHERE competitor_id = $1`,
        [row.competitor_id],
      );
      const isFirstEverForCompetitor = competitorHistoryCountRes.rows[0].c === 0;
      const isNewAd = previous === null;

      await client.query(
        `INSERT INTO competitor_ad_history
           (ad_id, competitor_id, run_id, status, offer_text, headline_text, has_image, has_video, landing_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          row.ad_id,
          row.competitor_id,
          runId,
          row.status,
          offerText,
          headlineText,
          row.has_image,
          row.has_video,
          row.landing_url,
        ],
      );

      results.push({
        adId: row.ad_id,
        competitorId: row.competitor_id,
        status: row.status,
        offerText,
        headlineText,
        hasImage: row.has_image,
        hasVideo: row.has_video,
        landingUrl: row.landing_url,
        previous,
        isFirstEverForCompetitor,
        isNewAd,
      });
    }

    return results;
  } finally {
    client.release();
  }
}

/**
 * Snapshots the current (V1) threat score for each competitor into the
 * append-only history table. Purely additive — never touches
 * competitor_threat_scores itself.
 */
export async function snapshotThreatScores(competitorIds: number[]): Promise<void> {
  if (!competitorIds.length) return;
  const uniqueIds = Array.from(new Set(competitorIds));
  const res = await pool.query(
    `SELECT competitor_id, score, band, factors_json FROM competitor_threat_scores WHERE competitor_id = ANY($1::int[])`,
    [uniqueIds],
  );
  for (const row of res.rows) {
    await pool.query(
      `INSERT INTO competitor_threat_score_history (competitor_id, score, band, factors_json)
       VALUES ($1,$2,$3,$4)`,
      [row.competitor_id, row.score, row.band, row.factors_json],
    );
  }
}

export async function getAdHistory(competitorId: number, opts?: { since?: string; until?: string }) {
  const clauses: string[] = ["competitor_id = $1"];
  const params: any[] = [competitorId];
  if (opts?.since) {
    params.push(opts.since);
    clauses.push(`captured_at >= $${params.length}`);
  }
  if (opts?.until) {
    params.push(opts.until);
    clauses.push(`captured_at <= $${params.length}`);
  }
  const res = await pool.query(
    `SELECT * FROM competitor_ad_history WHERE ${clauses.join(" AND ")} ORDER BY captured_at DESC`,
    params,
  );
  return res.rows;
}

export async function getThreatScoreHistory(competitorId: number) {
  const res = await pool.query(
    `SELECT * FROM competitor_threat_score_history WHERE competitor_id = $1 ORDER BY computed_at DESC`,
    [competitorId],
  );
  return res.rows;
}
