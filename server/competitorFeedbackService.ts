// ── Competitor Intelligence Phase 2 — Feedback / Learning System (SAFE MODE) ─
//
// Safety contract:
//   - Owns one NEW table only: competitor_recommendation_feedback.
//   - Append-only — feedback is recorded, never edited/deleted. Past
//     recommendations (competitor_counter_strategies rows) are never modified
//     by feedback; only read by the strategy generator to condition future output.
//   - Triggered only by an explicit manual admin action.

import { pool } from "./db";

export async function ensureFeedbackTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitor_recommendation_feedback (
      id            SERIAL PRIMARY KEY,
      strategy_id   INTEGER NOT NULL,
      feedback      TEXT NOT NULL,
      note          TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS competitor_recommendation_feedback_strategy_idx
      ON competitor_recommendation_feedback(strategy_id)
  `);
  console.log("[DB] ensureCompetitorFeedbackTable \u2713");
}

export async function submitFeedback(strategyId: number, feedback: "useful" | "not_useful", note?: string) {
  const res = await pool.query(
    `INSERT INTO competitor_recommendation_feedback (strategy_id, feedback, note)
     VALUES ($1,$2,$3) RETURNING *`,
    [strategyId, feedback, note || null],
  );
  return res.rows[0];
}

/**
 * Returns a compact digest of past feedback for a competitor's prior
 * strategies, capped to the most recent N items, for use as prompt context
 * when generating a new strategy version. Read-only.
 */
export async function getFeedbackDigestForCompetitor(competitorId: number, limit = 10) {
  const res = await pool.query(
    `SELECT f.feedback, f.note, s.strategy_json, s.version
     FROM competitor_recommendation_feedback f
     JOIN competitor_counter_strategies s ON s.id = f.strategy_id
     WHERE s.competitor_id = $1
     ORDER BY f.created_at DESC
     LIMIT $2`,
    [competitorId, limit],
  );
  return res.rows;
}
