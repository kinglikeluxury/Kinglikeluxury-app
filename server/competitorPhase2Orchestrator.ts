// ── Competitor Intelligence Phase 2 — Orchestrator (SAFE MODE) ──────────────
//
// Safety contract:
//   - Never imports/modifies competitorIntelligenceService.ts or
//     competitorAdLibraryFetcher.ts (the MVP). Only reads MVP tables via the
//     shared `pool`, through the individual Phase 2 services.
//   - refreshIntelligence() is only ever invoked from an explicit admin
//     action (a route handler triggered by a button click) — never a scheduler.
//   - ensureAllPhase2Tables() only CREATEs the new Phase 2 tables; it never
//     touches any existing table.

import { ensureMemoryTables, snapshotAds, snapshotThreatScores } from "./competitorMemoryService";
import { ensureTimelineTable, deriveTimelineEvents, storeTimelineEvents } from "./competitorTimelineService";
import { ensureEvolutionTable, recordEvolutionSteps } from "./competitorCreativeEvolutionService";
import { ensureThreatScoreV2Table, computeAndStoreThreatScoreV2 } from "./competitorThreatScoreV2Service";
import { ensureFeedbackTable } from "./competitorFeedbackService";
import { ensureStrategyTable } from "./competitorStrategyService";
import { ensureAlertsTable, generateAlerts, generateOpportunityAlert } from "./competitorAlertsService";
import { ensureChangeSummaryTable, generateChangeSummary } from "./competitorChangeSummaryService";

export async function ensureAllPhase2Tables(): Promise<void> {
  await ensureMemoryTables();
  await ensureTimelineTable();
  await ensureEvolutionTable();
  await ensureThreatScoreV2Table();
  await ensureFeedbackTable();
  await ensureStrategyTable();
  await ensureAlertsTable();
  await ensureChangeSummaryTable();
  console.log("[DB] ensureCompetitorPhase2Tables \u2713 (all additive, new tables only)");
}

/**
 * Full manual-refresh pipeline: snapshot → timeline → evolution → threat V2
 * (recomputed for affected competitors) → threat-score history snapshot →
 * alerts → change summary. Everything here is triggered synchronously by a
 * single admin-initiated HTTP request — nothing here is scheduled.
 */
export async function refreshIntelligence(runId: number, adIds: number[], opportunities: string[] = []) {
  const snapshots = await snapshotAds(runId, adIds);
  const events = deriveTimelineEvents(snapshots);
  await storeTimelineEvents(events);
  await recordEvolutionSteps(snapshots, events);

  const affectedCompetitorIds = Array.from(new Set(snapshots.map((s) => s.competitorId)));

  const threatScoresV2: any[] = [];
  for (const competitorId of affectedCompetitorIds) {
    const result = await computeAndStoreThreatScoreV2(competitorId);
    threatScoresV2.push(result);
  }
  await snapshotThreatScores(affectedCompetitorIds);

  const alerts = await generateAlerts(events, affectedCompetitorIds);
  const opportunityAlerts = opportunities.length ? await generateOpportunityAlert(opportunities) : [];
  const allAlerts = [...alerts, ...opportunityAlerts];

  const changeSummary = await generateChangeSummary(runId, events, allAlerts);

  return {
    timelineEvents: events,
    threatScoresV2,
    alerts: allAlerts,
    changeSummary,
    affectedCompetitorIds,
  };
}
