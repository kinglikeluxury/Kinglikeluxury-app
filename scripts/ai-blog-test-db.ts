import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  AI_BLOG_TEST_APPLICATION_NAME,
  AI_BLOG_TEST_DATABASE_NAME,
  assertIsolatedAiBlogTestDatabaseIdentity,
  classifyAiBlogTestDatabaseFailure,
  formatAiBlogTestDatabaseFailure,
  getIsolatedAiBlogTestDatabaseConfig,
} from "../server/aiBlogTestDatabase";

const [command, ...args] = process.argv.slice(2);
const migrationConfirmation = "--confirm-isolated-test-database-migration";

async function main() {
  if (command !== "verify" && command !== "migrate") {
    console.error("AI_BLOG_TEST_DB_ERROR stage=configuration code=TEST_DATABASE_CONFIG_INVALID");
    process.exitCode = 1;
    return;
  }
  if (command === "migrate" &&
    (!args.includes(migrationConfirmation) || process.env.AI_BLOG_TEST_DB_ALLOW_MIGRATION !== "true")) {
    console.error("AI_BLOG_TEST_DB_ERROR stage=configuration code=TEST_DATABASE_CONFIG_INVALID");
    process.exitCode = 1;
    return;
  }

  let stage: "configuration" | "tcp_connect" | "identity_check" | "migration" | "pool_close" = "configuration";
  let pool: Pool | undefined;
  let client: Awaited<ReturnType<Pool["connect"]>> | undefined;
  let failure: ReturnType<typeof classifyAiBlogTestDatabaseFailure> | undefined;
  try {
    const config = getIsolatedAiBlogTestDatabaseConfig(process.env);
    pool = new Pool({
      connectionString: config.connectionString,
      application_name: AI_BLOG_TEST_APPLICATION_NAME,
      max: 1,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      ssl: false,
    });
    stage = "tcp_connect";
    client = await pool.connect();
    stage = "identity_check";
    const identity = await client.query(
      "SELECT current_database() AS database_name, inet_server_addr()::text AS server_address",
    );
    assertIsolatedAiBlogTestDatabaseIdentity(identity.rows[0] ?? {});
    if (command === "verify") {
      console.log(`Verified isolated PostgreSQL target: ${AI_BLOG_TEST_DATABASE_NAME} on loopback.`);
    } else {
      stage = "migration";
      const migrationPath = path.resolve(
        process.cwd(),
        "server/migrations/2026-10-20-ai-blog-usage-quotas.sql",
      );
      const migrationSql = await readFile(migrationPath, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(migrationSql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      console.log("Applied AI Blog usage migration to the verified isolated test database only.");
    }
  } catch (error) {
    failure = classifyAiBlogTestDatabaseFailure(stage, error);
  } finally {
    client?.release();
    if (pool) {
      try {
        stage = "pool_close";
        await pool.end();
      } catch (error) {
        failure ??= classifyAiBlogTestDatabaseFailure(stage, error);
      }
    }
  }
  if (failure) {
    console.error(formatAiBlogTestDatabaseFailure(failure));
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("AI_BLOG_TEST_DB_ERROR stage=configuration code=TEST_DATABASE_CONFIG_INVALID");
  process.exitCode = 1;
});
