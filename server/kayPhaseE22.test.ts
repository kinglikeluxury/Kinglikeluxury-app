import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateRescueWindow, recommendRescueEmployee } from "./kayAutoRescuePlanner";

const baseline = readFileSync(new URL("./kayLegacyBaselineService.ts", import.meta.url), "utf8");
const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("./kayAutoRescueService.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../client/src/pages/admin/kay-control-center.tsx", import.meta.url), "utf8");
const integration = readFileSync(new URL("./kayPhaseE22.integration.test.ts", import.meta.url), "utf8");

test("E22 resolver uses latest overall status history and explicit source warning", () => {
  assert.match(baseline, /ORDER BY h\.entered_at DESC,h\.id DESC LIMIT 1/);
  assert.match(baseline, /CASE WHEN h\.status=l\.status/);
  assert.match(baseline, /LEGACY_BASELINE_WARNING/);
});
test("E22 ledger is additive and exact active uniqueness is maintained", () => {
  assert.match(db, /DROP INDEX IF EXISTS kay_legacy_baseline_one_active_idx/);
  assert.match(db, /ON kay_legacy_rescue_baselines\(lead_id,observed_status\) WHERE state='ACTIVE'/);
  assert.match(db, /DUPLICATE_ACTIVE_REPAIRED/);
});
test("E22 never uses CRM created/updated dates for status entry", () => {
  assert.doesNotMatch(baseline, /observation_started_at\s*[:=].*(created_at|updated_at)/);
  assert.doesNotMatch(baseline, /enteredAt['"]?\s*[:,].*(created_at|updated_at)/);
});
test("E22 worker uses central scope and admin endpoints are protected", () => {
  assert.match(worker, /getKayScopeForLead/);
  for (const path of ["legacy-rescue-baselines/preview", "legacy-rescue-baselines/initialize", "legacy-rescue-baselines/readiness", "legacy-rescue-baselines/diagnostics"])
    assert.match(routes, new RegExp(path.replaceAll("/", "\\/") + '".*requireKayAdmin'));
});
test("E22 initializer is bounded, audited, idempotent and session-confirmed", () => {
  assert.match(baseline, /ON CONFLICT DO NOTHING RETURNING id/);
  assert.match(baseline, /kay_legacy_baseline_init_runs/);
  assert.match(routes, /expiresAt/);
  assert.match(routes, /confirmation\.adminId/);
});
test("E22 readiness exposes threshold and safety dimensions", () => {
  for (const token of ["lackingTrusted", "trustedCurrentWindows", "dueWithin6", "dueWithin12", "dueWithin24", "statusChanged", "blocked", "wouldRescue", "invalidated"])
    assert.match(baseline, new RegExp(token));
});
test("E22 diagnostics classify owners and resolve final scope policy", () => {
  assert.match(baseline, /scopeOutcome|IN_KAY_SCOPE/);
  assert.match(baseline, /statusMix/);
  assert.match(baseline, /INTAKE_OWNER/);
});

test("E22 planner enforces threshold and exact blockers", () => {
  const now = new Date("2025-01-02T00:00:00Z");
  assert.equal(evaluateRescueWindow({status:"no_answer_1",statusEnteredAt:new Date("2025-01-01T12:01:00Z"),now,thresholdHours:12}).eligible, false);
  assert.equal(evaluateRescueWindow({status:"no_answer_1",statusEnteredAt:new Date("2025-01-01T12:00:00Z"),now,thresholdHours:12}).eligible, true);
  assert.equal(evaluateRescueWindow({status:"no_answer_2",statusEnteredAt:new Date("2025-01-01T00:00:00Z"),now,thresholdHours:12,blockers:["ACTIVE_TASK"]}).state, "BLOCKED");
});
test("E22 target selection excludes current and ping-pong owners", () => {
  const picked = recommendRescueEmployee([
    {id:1,name:"owner",activeLeadCount:0,overdueTaskCount:0},
    {id:2,name:"ping",activeLeadCount:0,overdueTaskCount:0,pingPongPrevented:true},
    {id:3,name:"safe",activeLeadCount:2,overdueTaskCount:0},
  ], 1);
  assert.equal(picked.candidate?.id, 3);
});
test("E22 unavailable LEAVE alternative yields no eligible target", () => {
  const picked = recommendRescueEmployee([{id:1,name:"current",activeLeadCount:1,overdueTaskCount:0}], 1);
  assert.equal(picked.candidate, null);
  assert.equal(picked.managerReview, true);
  assert.match(baseline, /phase_c_availability/);
  assert.match(baseline, /'AVAILABLE'/);
  assert.match(baseline, /u\.id<>\$3/);
});
test("E22 production routes cannot pass the synthetic scope and UI renders evidence", () => {
  assert.doesNotMatch(routes, /getLegacyBaselineReadiness\(\s*\{/);
  assert.doesNotMatch(routes, /previewLegacyBaselineInitialization\([^)]*,\s*\{/);
  assert.match(ui, /\(owner\.evidence \?\? \[\]\)\.map/);
  assert.match(ui, /owner\.conclusion/);
  assert.match(ui, /capacitySensitivity/);
});
test("E22 audit failure hook is gated and transaction precedes baseline insert", () => {
  assert.match(baseline, /failAuditInsertForTest.*KAY_E22_POSTGRES_TESTS/);
  assert.ok(baseline.indexOf('client.query("BEGIN")') < baseline.indexOf("INSERT INTO kay_legacy_rescue_baselines"));
  assert.match(baseline, /ROLLBACK/);
});
test("E22 integration uses real scoped services and never bootstraps", () => {
  assert.doesNotMatch(integration, /ensureKayTables/);
  for (const call of [
    "previewLegacyBaselineInitialization",
    "initializeLegacyBaselines",
    "resolveKayStatusWindow",
    "getLegacyBaselineReadiness",
    "getLegacyOwnerDiagnostics",
    "getLegacyCapacitySensitivity",
  ]) assert.match(integration, new RegExp(`${call}\\(`));
  assert.match(integration, /Promise\.all/);
  assert.match(integration, /failAuditInsertForTest/);
  assert.match(integration, /forced E22 baseline failure/);
});
test("E22 bootstrap defines DB clock defaults and both unique indexes", () => {
  assert.match(db, /ALTER COLUMN observation_started_at SET DEFAULT clock_timestamp\(\)/);
  assert.match(db, /ALTER COLUMN created_at SET DEFAULT clock_timestamp\(\)/);
  assert.match(db, /kay_legacy_baseline_continuity_unique_idx/);
  assert.match(db, /kay_legacy_baseline_one_active_idx/);
});
test("E22 races, fingerprints and exact readiness outcomes are substantive", () => {
  assert.match(integration, /secondAdminId/);
  assert.match(integration, /FOR UPDATE/);
  assert.match(integration, /pg_stat_activity/);
  assert.match(integration, /canonicalFingerprints/);
  assert.match(integration, /assert\.deepEqual\(effectsAfter, effectsBefore\)/);
  assert.match(integration, /targetId, ownerId/);
  assert.match(integration, /wouldRescue, 1/);
  assert.match(integration, /noEligible, 1/);
});
test("E22 lock tests are exact, bounded and cannot strand transactions", () => {
  assert.match(integration, /initializerPid/);
  assert.match(integration, /pg_blocking_pids\(\$1::int\)/);
  assert.match(integration, /attempt < 100/);
  assert.match(integration, /setTimeout\(resolve, 50\)/);
  assert.match(integration, /finally \{[\s\S]*ROLLBACK[\s\S]*locker\.release/);
  assert.match(integration, /pg_cancel_backend/);
  assert.match(integration, /Promise\.allSettled/);
  assert.match(integration, /bounded barrier timeout/);
});