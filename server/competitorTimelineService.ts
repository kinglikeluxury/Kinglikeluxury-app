// ── Competitor Intelligence Phase 2 — Timeline (SAFE MODE, additive) ─────────
//
// Safety contract:
//   - Owns one NEW table only: competitor_timeline_events.
//   - Append-only. Events are derived from AdSnapshotRow diffs produced by
//     competitorMemoryService — never re-derives from or writes to MVP tables.
//   - Triggered only by the Phase 2 orchestrator (manual admin action).

import { pool } from "./db";
import type { AdSnapshotRow } from "./competitorMemoryService";

export type TimelineEventType =
  | "first_seen"
  | "new_creative"
  | "creative_changed"
  | "offer_changed"
  | "campaign_stopped"
  | "campaign_restarted";

export interface TimelineEvent {
  competitorId: number;
  adId: number;
  eventType: TimelineEventType;
  detail: Record<string, any>;
}

export async function ensureTimelineTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS competitor_timeline_events (
      id            SERIAL PRIMARY KEY,
      competitor_id INTEGER NOT NULL,
      ad_id         INTEGER,
      event_type    TEXT NOT NULL,
      detail_json   JSONB,
      detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS competitor_timeline_events_competitor_idx
      ON competitor_timeline_events(competitor_id, detected_at)
  `);
  console.log("[DB] ensureCompetitorTimelineTable \u2713");
}

/**
 * Derives timeline events purely from the snapshot diffs already computed by
 * snapshotAds() — no additional reads of MVP tables needed.
 */
export function deriveTimelineEvents(snapshots: AdSnapshotRow[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const s of snapshots) {
    if (s.isFirstEverForCompetitor) {
      events.push({
        competitorId: s.competitorId,
        adId: s.adId,
        eventType: "first_seen",
        detail: { pageStatus: s.status },
      });
    }

    if (s.isNewAd) {
      events.push({
        competitorId: s.competitorId,
        adId: s.adId,
        eventType: "new_creative",
        detail: { status: s.status, hasImage: s.hasImage, hasVideo: s.hasVideo },
      });
      continue; // no "changed" comparisons possible for a brand-new ad
    }

    const prev = s.previous!;

    if (prev.status !== s.status) {
      if (prev.status === "Active" && s.status === "Inactive") {
        events.push({
          competitorId: s.competitorId,
          adId: s.adId,
          eventType: "campaign_stopped",
          detail: { from: prev.status, to: s.status },
        });
      } else if (prev.status === "Inactive" && s.status === "Active") {
        events.push({
          competitorId: s.competitorId,
          adId: s.adId,
          eventType: "campaign_restarted",
          detail: { from: prev.status, to: s.status },
        });
      }
    }

    if ((prev.offerText || "") !== (s.offerText || "") && s.offerText) {
      events.push({
        competitorId: s.competitorId,
        adId: s.adId,
        eventType: "offer_changed",
        detail: { from: prev.offerText, to: s.offerText },
      });
    }

    const formatChanged = prev.hasImage !== s.hasImage || prev.hasVideo !== s.hasVideo;
    const headlineChanged = (prev.headlineText || "") !== (s.headlineText || "") && s.headlineText;
    if (formatChanged || headlineChanged) {
      events.push({
        competitorId: s.competitorId,
        adId: s.adId,
        eventType: "creative_changed",
        detail: {
          formatChanged,
          headlineChanged: Boolean(headlineChanged),
          fromHeadline: prev.headlineText,
          toHeadline: s.headlineText,
        },
      });
    }
  }

  return events;
}

export async function storeTimelineEvents(events: TimelineEvent[]): Promise<void> {
  for (const e of events) {
    await pool.query(
      `INSERT INTO competitor_timeline_events (competitor_id, ad_id, event_type, detail_json)
       VALUES ($1,$2,$3,$4)`,
      [e.competitorId, e.adId, e.eventType, JSON.stringify(e.detail)],
    );
  }
}

export async function getTimeline(competitorId: number) {
  const res = await pool.query(
    `SELECT * FROM competitor_timeline_events WHERE competitor_id = $1 ORDER BY detected_at DESC`,
    [competitorId],
  );
  return res.rows;
}
