// ── Competitor Intelligence Phase 2 — Public API Seam (SAFE MODE) ───────────
//
// This is the ONLY sanctioned integration point for future consumers
// (AI Marketing Director, KQS, Meta Intelligence). Today, nothing calls
// these functions except the admin-only /public/v1/* routes in routes.ts —
// no other subsystem imports this file or is imported by it. This keeps a
// stable seam ready for later without creating any live coupling now.
//
// Read-only. No writes, no side effects beyond what's already computed by
// the other Phase 2 services.

import { pool } from "./db";
import { getLatestThreatScoreV2 } from "./competitorThreatScoreV2Service";
import { getAlerts } from "./competitorAlertsService";
import { getLatestStrategy } from "./competitorStrategyService";

export async function getCompetitorSummary(competitorId: number) {
  const profileRes = await pool.query(`SELECT * FROM competitor_profiles WHERE id = $1`, [competitorId]);
  const profile = profileRes.rows[0] || null;
  if (!profile) return null;

  const [threatV2, strategy] = await Promise.all([
    getLatestThreatScoreV2(competitorId),
    getLatestStrategy(competitorId),
  ]);

  const adCountRes = await pool.query(`SELECT COUNT(*)::int AS c FROM competitor_ads WHERE competitor_id = $1`, [competitorId]);

  return {
    profile,
    adCount: adCountRes.rows[0]?.c || 0,
    threatScoreV2: threatV2,
    latestStrategy: strategy,
  };
}

export async function getThreatScoreV2Public(competitorId: number) {
  return getLatestThreatScoreV2(competitorId);
}

export async function getLatestAlertsPublic(limit = 20) {
  return getAlerts(limit);
}
