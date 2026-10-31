import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getKayRecommendationCycleBlockReason,
  getKayRecommendationSchedulerAvailability,
} from "./kayRecommendationScheduler";

test("dedicated scheduler is off by default and diagnostic Preview always suppresses it", () => {
  assert.deepEqual(getKayRecommendationSchedulerAvailability({ NODE_ENV: "development" }), {
    configuredEnabled: false, enabled: false, reason: "FEATURE_FLAG_DISABLED",
  });
  assert.deepEqual(getKayRecommendationSchedulerAvailability({
    NODE_ENV: "development",
    ENABLE_META_REVIEW_DIAGNOSTIC_MODE: "true",
    KAY_RECOMMENDATION_SCHEDULER_ENABLED: "true",
  }), {
    configuredEnabled: true, enabled: false, reason: "DIAGNOSTIC_PREVIEW_MODE",
  });
  assert.equal(getKayRecommendationSchedulerAvailability({
    NODE_ENV: "production", KAY_RECOMMENDATION_SCHEDULER_ENABLED: "true",
  }).enabled, true);
});

test("each evaluation cycle fails closed unless Shadow and all execution blocks remain engaged", () => {
  const safe = {
    auto_rescue_kill_switch: true,
    rescue_enabled: false,
    auto_rescue_no_answer_1_enabled: false,
    auto_rescue_no_answer_2_enabled: false,
  };
  assert.equal(getKayRecommendationCycleBlockReason("shadow", safe), null);
  assert.equal(getKayRecommendationCycleBlockReason("assisted", safe), "MODE_NOT_SHADOW");
  assert.equal(getKayRecommendationCycleBlockReason("shadow", { ...safe, auto_rescue_kill_switch: false }), "KILL_SWITCH_NOT_ENGAGED");
  assert.equal(getKayRecommendationCycleBlockReason("shadow", { ...safe, rescue_enabled: true }), "RESCUE_EXECUTION_SETTING_ENABLED");
  assert.equal(getKayRecommendationCycleBlockReason("shadow", { ...safe, auto_rescue_no_answer_1_enabled: true }), "AUTOMATION_SETTING_ENABLED");
});

test("scheduler reaches only the recommendation scan/evaluator and has no outbound or CRM writer dependency", () => {
  const source = readFileSync(new URL("./kayRecommendationScheduler.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ getKayMode, getRescueSettings, enqueueKayEvaluationScan, runKayShadowEvaluator \} from "\.\/kayService"/);
  assert.match(source, /import \{ isMetaReviewDiagnosticMode \} from "\.\/metaReviewDiagnosticMode"/);
  assert.match(source, /enqueueKayEvaluationScan\(\)/);
  assert.match(source, /runKayShadowEvaluator\(\)/);
  assert.doesNotMatch(source, /runKayAutoRescueWorker|executeRescueTransaction|denyKayWrite|sendWhatsApp|sendEmail|sendSms|placeCall|assignLead|updateLeadOwner/i);
  assert.doesNotMatch(source, /from ["'][^"']*(schedulerService|waQualScheduler|crmTaskReminderService|emailNurturingService)/);
});

test("startup gate returns before Kay scheduler in diagnostic mode and status has no action endpoint", () => {
  const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(index, /if \(!shouldRunNormalStartupWork\(process\.env\)\) \{[\s\S]*?return;[\s\S]*?startKayRecommendationScheduler\(\)/);
  const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  assert.match(routes, /recommendationScheduler:\s*await getKayRecommendationSchedulerStatusWithPersistence\(\)/);
  assert.doesNotMatch(routes, /\/api\/admin\/kay\/recommendation-scheduler\/(run|start|enable)/);
});

test("Control Center exposes scheduler status without a control button", () => {
  const client = readFileSync(new URL("../client/src/pages/admin/kay-control-center.tsx", import.meta.url), "utf8");
  assert.match(client, /Kay recommendation scheduler/);
  assert.match(client, /title="Last result"/);
  assert.match(client, /title="Checked"/);
  assert.match(client, /title="Recommendations \/ Eligible"/);
  assert.match(client, /title="Stale"/);
  assert.match(client, /title="Disabled reason"/);
  assert.match(client, /persistent\?\.lastRunAt/);
  assert.doesNotMatch(client, /lastCycleError/);
  assert.doesNotMatch(client, /Enable scheduler|Run scheduler|Start scheduler/);
});

test("scheduler history uses Kay runtime state and stores no raw error messages", () => {
  const source = readFileSync(new URL("./kayRecommendationSchedulerState.ts", import.meta.url), "utf8");
  assert.match(source, /kay_runtime_state/);
  assert.match(source, /recommendation_scheduler_health/);
  assert.match(source, /errorCode/);
  assert.doesNotMatch(source, /error\.message|stack/);
});
