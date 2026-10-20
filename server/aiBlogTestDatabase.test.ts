import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_BLOG_TEST_DATABASE_ENV,
  AI_BLOG_TEST_DATABASE_NAME,
  assertIsolatedAiBlogTestDatabaseIdentity,
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
  }), /identity does not match/);
  assert.throws(() => assertIsolatedAiBlogTestDatabaseIdentity({
    databaseName: "ai_blog_drafts_test",
    serverAddress: "198.51.100.12",
  }), /not confirmed as loopback/);
  assert.throws(() => assertIsolatedAiBlogTestDatabaseIdentity({
    databaseName: "ai_blog_drafts_test",
    serverAddress: null,
  }), /not confirmed as loopback/);
});
