// ── Competitor Intelligence Phase 2 — Alerts (SAFE MODE, additive) ───────────
//
// Safety contract:
//   - Owns one NEW table only: competitor_alerts.
//   - Generated only from the Phase 2 orchestrator, itself only triggered by
//     an explicit manual admin refresh action. No scheduler ever calls this.
//   - Append-only — alerts are inserted, never edited (only "seen" is
//     mutable, a UI-convenience flag, not a rewrite of alert content/history).

import { pool } from "./db";
import type { TimelineEvent } from "./competitorTimelineService";

export async function ensureAlertsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitor_alerts (
      id            SERIAL PRIMARY KEY,
      competitor_id INTEGER,
      alert_type    TEXT NOT NULL,
      message       TEXT NOT NULL,
      severity      TEXT NOT NULL DEFAULT 'info',
      seen          BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS competitor_alerts_created_idx ON competitor_alerts(created_at)
  `);
  console.log("[DB] ensureCompetitorAlertsTable \u2713");
}

const THREAT_INCREASE_THRESHOLD = 10;

export async function generateAlerts(
  events: TimelineEvent[],
  affectedCompetitorIds: number[],
): Promise<any[]> {
  const inserted: any[] = [];

  const pageNames = new Map<number, string>();
  if (affectedCompetitorIds.length) {
    const res = await pool.query(
      `SELECT id, page_name FROM competitor_profiles WHERE id = ANY($1::int[])`,
      [affectedCompetitorIds],
    );
    for (const row of res.rows) pageNames.set(row.id, row.page_name);
  }
  const nameFor = (id: number) => pageNames.get(id) || `Competitor #${id}`;

  const insert = async (competitorId: number | null, alertType: string, message: string, severity: string) => {
    const res = await pool.query(
      `INSERT INTO competitor_alerts (competitor_id, alert_type, message, severity) VALUES ($1,$2,$3,$4) RETURNING *`,
      [competitorId, alertType, message, severity],
    );
    inserted.push(res.rows[0]);
  };

  for (const e of events) {
    if (e.eventType === "first_seen") {
      await insert(e.competitorId, "new_competitor", `New competitor detected: ${nameFor(e.competitorId)}`, "high");
    } else if (e.eventType === "new_creative") {
      await insert(e.competitorId, "new_advertisement", `${nameFor(e.competitorId)} launched a new ad`, "medium");
    } else if (e.eventType === "campaign_stopped") {
      await insert(e.competitorId, "competitor_stopped", `${nameFor(e.competitorId)} stopped an active campaign`, "medium");
    }
  }

  for (const competitorId of affectedCompetitorIds) {
    const scoreRes = await pool.query(
      `SELECT score FROM competitor_threat_scores_v2 WHERE competitor_id = $1 ORDER BY computed_at DESC LIMIT 2`,
      [competitorId],
    );
    if (scoreRes.rows.length === 2) {
      const [latest, previous] = scoreRes.rows;
      const delta = latest.score - previous.score;
      if (delta >= THREAT_INCREASE_THRESHOLD) {
        await insert(
          competitorId,
          "threat_increase",
          `${nameFor(competitorId)}'s threat score increased by ${delta} points (now ${latest.score})`,
          "high",
        );
      }
    }
  }

  return inserted;
}

export async function generateOpportunityAlert(opportunities: string[]): Promise<any[]> {
  const inserted: any[] = [];
  for (const opp of opportunities.slice(0, 3)) {
    const res = await pool.query(
      `INSERT INTO competitor_alerts (competitor_id, alert_type, message, severity) VALUES (NULL,$1,$2,$3) RETURNING *`,
      ["new_opportunity", opp, "low"],
    );
    inserted.push(res.rows[0]);
  }
  return inserted;
}

export async function getAlerts(limit = 50) {
  const res = await pool.query(`SELECT * FROM competitor_alerts ORDER BY created_at DESC LIMIT $1`, [limit]);
  return res.rows;
}
