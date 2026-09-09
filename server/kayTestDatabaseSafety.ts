export type KayTestEnvironment = Record<string, string | undefined>;

function normalizedDatabaseIdentity(raw: string) {
  const url = new URL(raw);
  return {
    href: url.href,
    host: url.hostname.toLowerCase(),
    database: decodeURIComponent(url.pathname.replace(/^\/+/, "")).toLowerCase(),
    user: decodeURIComponent(url.username),
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
  if (env.KAY_E2_ALLOW_SHARED_DB_MUTATIONS === "true") {
    fail("shared database mutation escape hatch KAY_E2_ALLOW_SHARED_DB_MUTATIONS is forbidden");
  }
  if (!env.KAY_TEST_RUN_ID || !/^[a-zA-Z0-9_-]{8,80}$/.test(env.KAY_TEST_RUN_ID)) fail("a valid KAY_TEST_RUN_ID is required");
  if (!env.KAY_TEST_DATABASE_URL) fail("KAY_TEST_DATABASE_URL is required");
  if (env.NEON_DATABASE_URL) fail("production database credentials must not be available to the Kay E2E runtime");
  if (env.DATABASE_URL || env.PGHOST || env.PGUSER || env.PGPASSWORD) {
    fail("generic production-capable database credential channels must be absent from the Kay E2E runtime");
  }
  if (!env.KAY_TEST_NEON_PROJECT_ID) fail("KAY_TEST_NEON_PROJECT_ID is required");
  if (!env.KAY_TEST_NEON_CLUSTER_ID) fail("KAY_TEST_NEON_CLUSTER_ID is required");
  if (!env.NEON_PROJECT_ID) fail("production NEON_PROJECT_ID metadata is required");
  if (!env.NEON_CLUSTER_ID) fail("production NEON_CLUSTER_ID metadata is required");
  if (!env.KAY_TEST_DATABASE_USER) fail("KAY_TEST_DATABASE_USER is required");
  if (!env.KAY_TEST_DATABASE_CREDENTIAL_ID) fail("KAY_TEST_DATABASE_CREDENTIAL_ID is required");
  if (!env.KAY_PRODUCTION_DATABASE_HOST) fail("KAY_PRODUCTION_DATABASE_HOST metadata is required");
  const productionHost = env.KAY_PRODUCTION_DATABASE_HOST!;
  if (!env.KAY_PRODUCTION_DATABASE_USER) fail("KAY_PRODUCTION_DATABASE_USER metadata is required");
  if (env.KAY_TEST_DATABASE_USER === env.KAY_PRODUCTION_DATABASE_USER) {
    fail("test database credentials must be dedicated and differ from production credentials");
  }
  if (env.NEON_DATABASE_CREDENTIAL_ID && env.KAY_TEST_DATABASE_CREDENTIAL_ID === env.NEON_DATABASE_CREDENTIAL_ID) {
    fail("test database credential identity must differ from production credentials");
  }

  const active = (() => {
    try { return normalizedDatabaseIdentity(env.KAY_TEST_DATABASE_URL!); }
    catch { return fail("database URL is invalid"); }
  })();
  if (active.host === productionHost.toLowerCase()) {
    fail("test database host must be physically separate from production");
  }
  if (env.KAY_TEST_NEON_PROJECT_ID === env.NEON_PROJECT_ID) {
    fail("test Neon project must be independent from the production project");
  }
  if (env.KAY_TEST_NEON_CLUSTER_ID === env.NEON_CLUSTER_ID) {
    fail("test Neon cluster must be independent from the production cluster");
  }
  if (active.database !== "kay_testing") fail(`database name "${active.database}" must be exactly "kay_testing"`);
  if (active.user !== env.KAY_TEST_DATABASE_USER) fail("active database URL user does not match KAY_TEST_DATABASE_USER");
  return { suite, testRunId: env.KAY_TEST_RUN_ID, host: active.host, database: active.database };
}

export function kaySyntheticMarker(prefix: string, env: KayTestEnvironment = process.env) {
  const safe = assertSafeKayMutationTestDatabase(prefix, env);
  return `${prefix}:run:${safe.testRunId}`;
}