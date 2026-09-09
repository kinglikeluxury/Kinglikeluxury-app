export type KayTestEnvironment = Record<string, string | undefined>;

function normalizedDatabaseIdentity(raw: string) {
  const url = new URL(raw);
  return {
    href: url.href,
    host: url.hostname.toLowerCase(),
    database: decodeURIComponent(url.pathname.replace(/^\/+/, "")).toLowerCase(),
  };
}

/**
 * Mandatory preflight for every Kay suite capable of database mutation.
 * Opt-in feature flags are never sufficient: the active database itself must
 * be an explicitly configured, dedicated test database.
 */
export function assertSafeKayMutationTestDatabase(suite: string, env: KayTestEnvironment = process.env) {
  const fail = (reason: string): never => {
    throw new Error(`[${suite}] DESTRUCTIVE KAY TEST HARD-FAILED: ${reason}`);
  };
  if (env.NODE_ENV !== "test") fail("NODE_ENV must equal test");
  if (env.REPLIT_DEPLOYMENT === "1" || env.REPLIT_DEPLOYMENT === "true") fail("deployment environments are prohibited");
  if (env.KAY_ALLOW_DESTRUCTIVE_TEST_DATABASE !== "true") fail("KAY_ALLOW_DESTRUCTIVE_TEST_DATABASE=true is required");
  if (!env.KAY_TEST_RUN_ID || !/^[a-zA-Z0-9_-]{8,80}$/.test(env.KAY_TEST_RUN_ID)) fail("a valid KAY_TEST_RUN_ID is required");
  if (!env.NEON_DATABASE_URL) fail("NEON_DATABASE_URL is missing");
  if (!env.KAY_TEST_DATABASE_URL) fail("KAY_TEST_DATABASE_URL is required");

  let active;
  let allowed;
  try {
    active = normalizedDatabaseIdentity(env.NEON_DATABASE_URL);
    allowed = normalizedDatabaseIdentity(env.KAY_TEST_DATABASE_URL);
  } catch {
    fail("database URL is invalid");
  }
  if (active.href !== allowed.href) fail("active database does not exactly match KAY_TEST_DATABASE_URL");
  if (!/(^|[_-])(test|testing)([_-]|$)/.test(active.database)) {
    fail(`database name "${active.database}" is not a dedicated test database`);
  }
  return { suite, testRunId: env.KAY_TEST_RUN_ID, host: active.host, database: active.database };
}

export function kaySyntheticMarker(prefix: string, env: KayTestEnvironment = process.env) {
  const safe = assertSafeKayMutationTestDatabase(prefix, env);
  return `${prefix}:run:${safe.testRunId}`;
}