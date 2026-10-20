import { withKayInternalClient } from "./kayInternalDatabase";
import { assertKayInternalWriteAllowed } from "./kayInternalWriteGate";

const STATE_KEY = "recommendation_scheduler_health";

export type KayRecommendationSchedulerResult = "PASS" | "FAIL" | "SKIPPED" | null;

export type KayRecommendationSchedulerState = {
  enabledObserved: boolean;
  lastRunAt: string | null;
  lastResult: KayRecommendationSchedulerResult;
  checkedCount: number | null;
  recommendationCount: number | null;
  eligibleCount: number | null;
  staleCount: number | null;
  disabledReason: string | null;
  errorCode: string | null;
  updatedAt: string | null;
};

const emptyState: KayRecommendationSchedulerState = {
  enabledObserved: false,
  lastRunAt: null,
  lastResult: null,
  checkedCount: null,
  recommendationCount: null,
  eligibleCount: null,
  staleCount: null,
  disabledReason: null,
  errorCode: null,
  updatedAt: null,
};

function safeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[A-Z0-9_.-]{1,60}$/i.test(value) ? value : null;
}

function normalizeState(value: unknown): KayRecommendationSchedulerState {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const count = (n: unknown) => Number.isInteger(n) && Number(n) >= 0 ? Number(n) : null;
  const result = row.lastResult;
  return {
    enabledObserved: row.enabledObserved === true,
    lastRunAt: typeof row.lastRunAt === "string" ? row.lastRunAt : null,
    lastResult: result === "PASS" || result === "FAIL" || result === "SKIPPED" ? result : null,
    checkedCount: count(row.checkedCount),
    recommendationCount: count(row.recommendationCount),
    eligibleCount: count(row.eligibleCount),
    staleCount: count(row.staleCount),
    disabledReason: safeCode(row.disabledReason),
    errorCode: safeCode(row.errorCode),
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
  };
}

export async function readKayRecommendationSchedulerState(): Promise<KayRecommendationSchedulerState> {
  try {
    return await withKayInternalClient(async client => {
      const result = await client.query(
        "SELECT value,updated_at FROM kay_runtime_state WHERE key=$1",
        [STATE_KEY],
      );
      if (!result.rows[0]) return emptyState;
      const state = normalizeState(result.rows[0].value);
      state.updatedAt = result.rows[0].updated_at instanceof Date
        ? result.rows[0].updated_at.toISOString()
        : String(result.rows[0].updated_at ?? state.updatedAt ?? "") || null;
      return state;
    });
  } catch (error) {
    const code = safeCode((error as { code?: unknown })?.code);
    console.warn(`[KayRecommendationSchedulerState] read unavailable${code ? ` (${code})` : ""}`);
    return emptyState;
  }
}

export async function persistKayRecommendationSchedulerState(
  patch: Partial<Omit<KayRecommendationSchedulerState, "updatedAt">>,
): Promise<void> {
  try {
    await assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_runtime_state" });
    await withKayInternalClient(async client => {
      const current = await client.query("SELECT value FROM kay_runtime_state WHERE key=$1", [STATE_KEY]);
      const next = normalizeState({ ...(current.rows[0]?.value ?? {}), ...patch });
      await client.query(
        `INSERT INTO kay_runtime_state(key,value,updated_at)
         VALUES($1,$2::jsonb,NOW())
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,
        [STATE_KEY, JSON.stringify(next)],
      );
    });
  } catch (error) {
    const code = safeCode((error as { code?: unknown })?.code);
    console.warn(`[KayRecommendationSchedulerState] write unavailable${code ? ` (${code})` : ""}`);
  }
}
