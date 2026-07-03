// ── Competitor Intelligence Phase 2 — Change Summary (SAFE MODE, additive) ───
//
// Safety contract:
//   - Owns one NEW table only: competitor_change_summaries.
//   - Append-only. Generated only from the Phase 2 orchestrator, triggered by
//     an explicit manual admin refresh action.

import { pool } from "./db";
import type { TimelineEvent } from "./competitorTimelineService";

export async function ensureChangeSummaryTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitor_change_summaries (
      id            SERIAL PRIMARY KEY,
      run_id        INTEGER,
      summary_json  JSONB NOT NULL,
      generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("[DB] ensureCompetitorChangeSummaryTable \u2713");
}

export async function generateChangeSummary(runId: number, events: TimelineEvent[], alerts: any[]) {
  const pageNames = new Map<number, string>();
  const competitorIds = Array.from(new Set(events.map((e) => e.competitorId)));
  if (competitorIds.length) {
    const res = await pool.query(`SELECT id, page_name FROM competitor_profiles WHERE id = ANY($1::int[])`, [competitorIds]);
    for (const row of res.rows) pageNames.set(row.id, row.page_name);
  }
  const nameFor = (id: number) => pageNames.get(id) || `Competitor #${id}`;

  const newCompetitors = events.filter((e) => e.eventType === "first_seen").map((e) => nameFor(e.competitorId));
  const newCreatives = events.filter((e) => e.eventType === "new_creative").map((e) => ({ competitor: nameFor(e.competitorId), adId: e.adId }));
  const newOffers = events.filter((e) => e.eventType === "offer_changed").map((e) => ({ competitor: nameFor(e.competitorId), ...e.detail }));
  const stoppedCampaigns = events.filter((e) => e.eventType === "campaign_stopped").map((e) => ({ competitor: nameFor(e.competitorId), adId: e.adId }));
  const threatIncreases = alerts.filter((a) => a.alert_type === "threat_increase").map((a) => a.message);
  const opportunities = alerts.filter((a) => a.alert_type === "new_opportunity").map((a) => a.message);

  const summary = {
    newCompetitors,
    newCreatives,
    newOffers,
    stoppedCampaigns,
    threatIncreases,
    opportunities,
  };

  const res = await pool.query(
    `INSERT INTO competitor_change_summaries (run_id, summary_json) VALUES ($1,$2) RETURNING *`,
    [runId, JSON.stringify(summary)],
  );
  return res.rows[0];
}

export async function getLatestChangeSummary() {
  const res = await pool.query(`SELECT * FROM competitor_change_summaries ORDER BY generated_at DESC LIMIT 1`);
  return res.rows[0] || null;
}
