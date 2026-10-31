import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_BLOG_TEST_DATABASE_ENV,
  AI_BLOG_TEST_DATABASE_NAME,
  assertIsolatedAiBlogTestDatabaseIdentity,
  classifyAiBlogTestDatabaseFailure,
  formatAiBlogTestDatabaseFailure,
  getIsolatedAiBlogTestDatabaseConfig,
} from "./aiBlogTestDatabase";

const localTestUrl = "postgresql://test-user:not-a-real-secret@127.0.0.1:5432/ai_blog_drafts_test";

test("test database config requires only the explicit test URL and never falls back", () => {
  assert.throws(
    () => getIsolatedAiBlogTestDatabaseConfig({ DATABASE_URL: localTestUrl, NEON_DATABASE_URL: localTestUrl }),
    new RegExp(`${AI_BLOG_TEST_DATABASE_ENV} is required`),
  );
  const config = getIsolatedAiBlogTestDatabaseConfig({ [AI_BLOG_TEST_DATABASE_ENV]: localTestUrl });
  assert.equal(config.expectedDatabaseName, AI_BLOG_TEST_DATABASE_NAME);
  assert.equal(config.applicationName, "kinglike-ai-blog-test");
});

test("test database config rejects non-loopback hosts and non-test database names", () => {
  assert.throws(
    () => getIsolatedAiBlogTestDatabaseConfig({
      [AI_BLOG_TEST_DATABASE_ENV]: "postgresql://user:pass@db.example.test:5432/ai_blog_drafts_test",
    }),
    /host must be a loopback address/,
  );
  assert.throws(
    () => getIsolatedAiBlogTestDatabaseConfig({
      [AI_BLOG_TEST_DATABASE_ENV]: "postgresql://user:pass@127.0.0.1:5432/production",
    }),
    /database name must be ai_blog_drafts_test/,
  );
});

test("server identity must verify both exact database name and loopback address", () => {
  assert.doesNotThrow(() => assertIsolatedAiBlogTestDatabaseIdentity({
    databaseName: "ai_blog_drafts_test",
    serverAddress: "127.0.0.1",
  }));
  assert.doesNotThrow(() => assertIsolatedAiBlogTestDatabaseIdentity({
    databaseName: "ai_blog_drafts_test",
    serverAddress: "::1",
  }));
  assert.throws(() => assertIsolatedAiBlogTestDatabaseIdentity({
    databaseName: "production",
    serverAddress: "127.0.0.1",
  }), { name: "AiBlogTestDatabaseIdentityError", failureCode: "DATABASE_IDENTITY_MISMATCH" });
  assert.throws(() => assertIsolatedAiBlogTestDatabaseIdentity({
    databaseName: "ai_blog_drafts_test",
    serverAddress: "198.51.100.12",
  }), { name: "AiBlogTestDatabaseIdentityError", failureCode: "DATABASE_IDENTITY_MISMATCH" });
  assert.throws(() => assertIsolatedAiBlogTestDatabaseIdentity({
    databaseName: "ai_blog_drafts_test",
    serverAddress: null,
  }), { name: "AiBlogTestDatabaseIdentityError", failureCode: "DATABASE_IDENTITY_MISMATCH" });
});

test("database failure diagnostics use stable safe codes for each stage", () => {
  assert.deepEqual(
    classifyAiBlogTestDatabaseFailure("configuration", new Error("secret connection string")),
    { stage: "configuration", code: "TEST_DATABASE_CONFIG_INVALID" },
  );
  assert.deepEqual(
    classifyAiBlogTestDatabaseFailure("tcp_connect", Object.assign(new Error("refused"), { code: "ECONNREFUSED" })),
    { stage: "tcp_connect", code: "TCP_CONNECTION_REFUSED" },
  );
  assert.deepEqual(
    classifyAiBlogTestDatabaseFailure("tcp_connect", Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })),
    { stage: "tcp_connect", code: "TCP_CONNECTION_TIMEOUT" },
  );
  assert.deepEqual(
    classifyAiBlogTestDatabaseFailure("tcp_connect", Object.assign(new Error("authentication failed"), { code: "28P01" })),
    { stage: "postgres_authentication", code: "POSTGRES_AUTHENTICATION_FAILED" },
  );
  assert.deepEqual(
    classifyAiBlogTestDatabaseFailure("tcp_connect", new Error("no pg_hba.conf entry for secret-user")),
    { stage: "postgres_authentication", code: "POSTGRES_HBA_REJECTED" },
  );
  assert.deepEqual(
    classifyAiBlogTestDatabaseFailure("tcp_connect", new Error('role "secret-user" does not exist')),
    { stage: "postgres_authentication", code: "POSTGRES_ROLE_NOT_FOUND" },
  );
  assert.deepEqual(
    classifyAiBlogTestDatabaseFailure("tcp_connect", Object.assign(new Error("missing"), { code: "3D000" })),
    { stage: "tcp_connect", code: "POSTGRES_DATABASE_NOT_FOUND" },
  );
  assert.deepEqual(
    classifyAiBlogTestDatabaseFailure("migration", new Error("private SQL")),
    { stage: "migration", code: "DATABASE_OPERATION_FAILED" },
  );
  assert.deepEqual(
    classifyAiBlogTestDatabaseFailure("identity_check", new Error("private query detail")),
    { stage: "identity_check", code: "DATABASE_OPERATION_FAILED" },
  );
  assert.deepEqual(
    classifyAiBlogTestDatabaseFailure("pool_close", new Error("private close detail")),
    { stage: "pool_close", code: "DATABASE_CLOSE_FAILED" },
  );
});

test("formatted diagnostics never expose raw errors, credentials, DSNs, or stacks", () => {
  const sensitiveError = new Error(
    "postgresql://secret-user:secret-password@127.0.0.1/private-db API_KEY=do-not-print\nat privateStack()",
  );
  Object.assign(sensitiveError, { code: "28P01" });
  const diagnostic = formatAiBlogTestDatabaseFailure(
    classifyAiBlogTestDatabaseFailure("tcp_connect", sensitiveError),
  );
  assert.equal(
    diagnostic,
    "AI_BLOG_TEST_DB_ERROR stage=postgres_authentication code=POSTGRES_AUTHENTICATION_FAILED",
  );
  for (const secret of ["secret-user", "secret-password", "127.0.0.1", "private-db", "API_KEY", "privateStack"]) {
    assert.equal(diagnostic.includes(secret), false);
  }
});
