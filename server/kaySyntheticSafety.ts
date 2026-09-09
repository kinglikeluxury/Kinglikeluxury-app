/**
 * Shared boundary for keeping synthetic/test records out of Kay production
 * work.  This is intentionally pure so it can be exercised without a
 * database, and callers can use it before opening a transaction.
 */
export type KaySafetyEnvironment = Record<string, string | undefined>;

const TEST_MARKER = /(?:^|[^a-z0-9])(?:synthetic|test[_-]?run|test[_-]?record|fixture|seed[_-]?data)(?:[^a-z0-9]|$)/i;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** True when the process carries an explicit test database/run identity. */
export function isKayTestEnvironmentIdentity(env: KaySafetyEnvironment = process.env): boolean {
  return env.NODE_ENV === "test" ||
    !!env.KAY_TEST_RUN_ID ||
    !!env.KAY_TEST_DATABASE_URL ||
    env.KAY_ALLOW_DESTRUCTIVE_TEST_DATABASE === "true";
}

/**
 * Detect explicit synthetic records without guessing from numeric IDs.  The
 * recursive scan is bounded and only considers strings/record keys, allowing
 * metadata and JSON payloads to carry the marker consistently.
 */
export function isKaySyntheticRecord(record: unknown, depth = 0): boolean {
  if (record == null || depth > 4) return false;
  if (typeof record === "string") return TEST_MARKER.test(record) || /:run:[a-z0-9_-]+/i.test(record);
  if (typeof record !== "object") return false;
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (/^(test_run_id|testRunId|synthetic_marker|syntheticMarker|fixture_id|fixtureId)$/i.test(key) && value != null && text(value) !== "") return true;
    if ((key === "synthetic" || key === "isSynthetic" || key === "is_test") && value === true) return true;
    if (isKaySyntheticRecord(value, depth + 1)) return true;
  }
  return false;
}

/** Fail closed at a production Kay write/notification boundary. */
export function assertKayProductionEntry(record?: unknown, env: KaySafetyEnvironment = process.env): void {
  if (isKayTestEnvironmentIdentity(env)) {
    throw Object.assign(new Error("Kay production paths reject test environment identity"), { code: "KAY_TEST_ENVIRONMENT_REJECTED" });
  }
  if (isKaySyntheticRecord(record)) {
    throw Object.assign(new Error("Kay production paths reject synthetic records"), { code: "KAY_SYNTHETIC_RECORD_REJECTED" });
  }
}

/** SQL predicate for candidate queries; NULL-safe and deliberately explicit. */
export function kayProductionRecordSql(alias = "l"): string {
  return `COALESCE(${alias}.test_run_id,'') = '' AND COALESCE(${alias}.synthetic_marker,'') = ''`;
}