// ── Competitor Intelligence Phase 2 — Creative Evolution (SAFE MODE, additive) ─
//
// Safety contract:
//   - Owns one NEW table only: competitor_creative_evolution.
//   - Append-only. Records a new evolution "step" only when a timeline event
//     signals a meaningful change (new_creative / creative_changed / offer_changed).
//   - Triggered only by the Phase 2 orchestrator (manual admin action).

import { pool } from "./db";
import type { AdSnapshotRow } from "./competitorMemoryService";
import type { TimelineEvent } from "./competitorTimelineService";

export async function ensureEvolutionTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitor_creative_evolution (
      id              SERIAL PRIMARY KEY,
      competitor_id   INTEGER NOT NULL,
      ad_id           INTEGER,
      sequence_index  INTEGER NOT NULL,
      format_type     TEXT,
      offer_snapshot  TEXT,
      headline_snapshot TEXT,
      recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS competitor_creative_evolution_competitor_idx
      ON competitor_creative_evolution(competitor_id, sequence_index)
  `);
  console.log("[DB] ensureCompetitorCreativeEvolutionTable \u2713");
}

function formatTypeFor(s: AdSnapshotRow): string {
  if (s.hasVideo) return "video";
  if (s.hasImage) return "image";
  return "text";
}

/**
 * Records a new evolution step for every ad snapshot whose timeline events
 * indicate a meaningful creative-level change (new creative debuted, format
 * changed, headline changed, or offer changed). Purely additive/append-only.
 */
export async function recordEvolutionSteps(
  snapshots: AdSnapshotRow[],
  events: TimelineEvent[],
): Promise<void> {
  const relevantAdIds = new Set(
    events
      .filter((e) => e.eventType === "new_creative" || e.eventType === "creative_changed" || e.eventType === "offer_changed")
      .map((e) => e.adId),
  );

  const byCompetitor = new Map<number, number>(); // competitorId -> next sequence index (loaded lazily)

  for (const s of snapshots) {
    if (!relevantAdIds.has(s.adId)) continue;

    if (!byCompetitor.has(s.competitorId)) {
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS c FROM competitor_creative_evolution WHERE competitor_id = $1`,
        [s.competitorId],
      );
      byCompetitor.set(s.competitorId, countRes.rows[0].c);
    }

    const nextIndex = (byCompetitor.get(s.competitorId) || 0) + 1;
    byCompetitor.set(s.competitorId, nextIndex);

    await pool.query(
      `INSERT INTO competitor_creative_evolution
         (competitor_id, ad_id, sequence_index, format_type, offer_snapshot, headline_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [s.competitorId, s.adId, nextIndex, formatTypeFor(s), s.offerText, s.headlineText],
    );
  }
}

export async function getEvolution(competitorId: number) {
  const res = await pool.query(
    `SELECT * FROM competitor_creative_evolution WHERE competitor_id = $1 ORDER BY sequence_index ASC`,
    [competitorId],
  );
  return res.rows;
}
