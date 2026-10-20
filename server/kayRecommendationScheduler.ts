import { getKayMode, getRescueSettings, enqueueKayEvaluationScan, runKayShadowEvaluator } from "./kayService";
import { isMetaReviewDiagnosticMode } from "./metaReviewDiagnosticMode";
import {
  persistKayRecommendationSchedulerState,
  readKayRecommendationSchedulerState,
} from "./kayRecommendationSchedulerState";

const INTERVAL_MS = 15 * 60_000;

type Environment = Record<string, string | undefined>;

export function getKayRecommendationSchedulerAvailability(environment: Environment = process.env) {
  const configuredEnabled = environment.KAY_RECOMMENDATION_SCHEDULER_ENABLED === "true";
  const diagnosticMode = isMetaReviewDiagnosticMode(environment);
  if (diagnosticMode) {
    return { configuredEnabled, enabled: false, reason: "DIAGNOSTIC_PREVIEW_MODE" };
  }
  if (!configuredEnabled) {
    return { configuredEnabled, enabled: false, reason: "FEATURE_FLAG_DISABLED" };
  }
  return { configuredEnabled, enabled: true, reason: null };
}

export function getKayRecommendationCycleBlockReason(
  mode: string,
  settings: {
    auto_rescue_kill_switch: boolean;
    rescue_enabled: boolean;
    auto_rescue_no_answer_1_enabled: boolean;
    auto_rescue_no_answer_2_enabled: boolean;
  },
): string | null {
  if (mode !== "shadow") return "MODE_NOT_SHADOW";
  if (settings.auto_rescue_kill_switch !== true) return "KILL_SWITCH_NOT_ENGAGED";
  if (settings.rescue_enabled !== false) return "RESCUE_EXECUTION_SETTING_ENABLED";
  if (settings.auto_rescue_no_answer_1_enabled !== false || settings.auto_rescue_no_answer_2_enabled !== false) {
    return "AUTOMATION_SETTING_ENABLED";
  }
  return null;
}

type SchedulerRuntime = {
  started: boolean;
  lastCycleStartedAt: string | null;
  lastCycleCompletedAt: string | null;
  lastCycleResult: { checked: number; eligible: number; blocked: number; stale: number } | null;
  lastCycleError: string | null;
  reason: string | null;
};

const runtime: SchedulerRuntime = {
  started: false,
  lastCycleStartedAt: null,
  lastCycleCompletedAt: null,
  lastCycleResult: null,
  lastCycleError: null,
  reason: null,
};
let interval: ReturnType<typeof setInterval> | null = null;
let cycleRunning = false;

export function getKayRecommendationSchedulerStatus(environment: Environment = process.env) {
  const availability = getKayRecommendationSchedulerAvailability(environment);
  const enabled = availability.enabled && runtime.started;
  return {
    enabled,
    configuredEnabled: availability.configuredEnabled,
    reason: availability.reason ?? (runtime.reason ?? (runtime.started ? null : "NOT_STARTED")),
    intervalMinutes: 15,
    lastCycleStartedAt: runtime.lastCycleStartedAt,
    lastCycleCompletedAt: runtime.lastCycleCompletedAt,
    lastCycleResult: runtime.lastCycleResult,
  };
}

export async function getKayRecommendationSchedulerStatusWithPersistence(environment: Environment = process.env) {
  const [live, persisted] = await Promise.all([
    Promise.resolve(getKayRecommendationSchedulerStatus(environment)),
    readKayRecommendationSchedulerState(),
  ]);
  return {
    ...live,
    lastCycleCompletedAt: persisted.lastRunAt ?? live.lastCycleCompletedAt,
    lastCycleResult: persisted.lastRunAt
      ? {
          checked: persisted.checkedCount ?? 0,
          eligible: persisted.eligibleCount ?? 0,
          recommendations: persisted.recommendationCount ?? persisted.eligibleCount ?? 0,
          stale: persisted.staleCount ?? 0,
        }
      : live.lastCycleResult,
    persistent: persisted,
  };
}

async function runRecommendationCycle(): Promise<void> {
  if (cycleRunning) return;
  const availability = getKayRecommendationSchedulerAvailability();
  if (!availability.enabled) {
    runtime.reason = availability.reason;
    void persistKayRecommendationSchedulerState({
      enabledObserved: false,
      disabledReason: availability.reason,
      errorCode: null,
    });
    return;
  }
  cycleRunning = true;
  runtime.lastCycleStartedAt = new Date().toISOString();
  runtime.reason = null;
  runtime.lastCycleError = null;
  let persistPatch: Parameters<typeof persistKayRecommendationSchedulerState>[0] | null = null;
  try {
    const [mode, settings] = await Promise.all([getKayMode(), getRescueSettings()]);
    const blockedReason = getKayRecommendationCycleBlockReason(mode, settings);
    if (blockedReason) {
      runtime.reason = blockedReason;
      persistPatch = {
        enabledObserved: true,
        lastRunAt: new Date().toISOString(),
        lastResult: "SKIPPED",
        checkedCount: null,
        recommendationCount: null,
        eligibleCount: null,
        staleCount: null,
        disabledReason: blockedReason,
        errorCode: null,
      };
      return;
    }

    // These are the only evaluation entrypoints this scheduler can reach.
    // CRM reads are performed by Kay's read-only analysis connection; all writes
    // stay within the existing Kay queue/events/decisions internal write gates.
    await enqueueKayEvaluationScan();
    runtime.lastCycleResult = await runKayShadowEvaluator();
    persistPatch = {
      enabledObserved: true,
      lastRunAt: new Date().toISOString(),
      lastResult: "PASS",
      checkedCount: runtime.lastCycleResult.checked,
      recommendationCount: runtime.lastCycleResult.eligible,
      eligibleCount: runtime.lastCycleResult.eligible,
      staleCount: runtime.lastCycleResult.stale,
      disabledReason: null,
      errorCode: null,
    };
  } catch (error) {
    const err = error as { name?: unknown; code?: unknown };
    const errorClass = typeof err?.name === "string" ? err.name.slice(0, 60) : "Error";
    const errorCode = typeof err?.code === "string" ? err.code.slice(0, 60) : "";
    runtime.lastCycleError = errorCode ? `${errorClass}:${errorCode}` : errorClass;
    runtime.reason = "CYCLE_FAILED";
    console.warn(`[KayRecommendationScheduler] cycle failed (${runtime.lastCycleError})`);
    persistPatch = {
      enabledObserved: true,
      lastRunAt: new Date().toISOString(),
      lastResult: "FAIL",
      disabledReason: "CYCLE_FAILED",
      errorCode: errorCode && /^[A-Za-z0-9_.-]{1,60}$/.test(errorCode) ? errorCode : null,
    };
  } finally {
    runtime.lastCycleCompletedAt = new Date().toISOString();
    cycleRunning = false;
    if (persistPatch) void persistKayRecommendationSchedulerState(persistPatch);
  }
}

/** Starts only from the normal startup path; never called in diagnostic Preview. */
export function startKayRecommendationScheduler(): void {
  const availability = getKayRecommendationSchedulerAvailability();
  if (!availability.enabled) {
    runtime.started = false;
    runtime.reason = availability.reason;
    console.info(`[KayRecommendationScheduler] disabled: ${availability.reason}`);
    return;
  }
  if (interval) return;
  runtime.started = true;
  runtime.reason = null;
  void runRecommendationCycle();
  interval = setInterval(() => void runRecommendationCycle(), INTERVAL_MS);
  interval.unref();
  console.info("[KayRecommendationScheduler] enabled; interval=15m");
}
