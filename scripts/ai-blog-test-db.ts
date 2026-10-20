import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  AI_BLOG_TEST_APPLICATION_NAME,
  AI_BLOG_TEST_DATABASE_NAME,
  assertIsolatedAiBlogTestDatabaseIdentity,
  getIsolatedAiBlogTestDatabaseConfig,
} from "../server/aiBlogTestDatabase";

const [command, ...args] = process.argv.slice(2);
const migrationConfirmation = "--confirm-isolated-test-database-migration";

async function main() {
  if (command !== "verify" && command !== "migrate") {
    throw new Error("Usage: ai-blog:test-db verify | migrate --confirm-isolated-test-database-migration");
  }
  if (command === "migrate" &&
    (!args.includes(migrationConfirmation) || process.env.AI_BLOG_TEST_DB_ALLOW_MIGRATION !== "true")) {
    throw new Error(
      "Migration refused. Supply the explicit confirmation argument and set AI_BLOG_TEST_DB_ALLOW_MIGRATION=true.",
    );
  }

  const config = getIsolatedAiBlogTestDatabaseConfig(process.env);
  const pool = new Pool({
    connectionString: config.connectionString,
    application_name: AI_BLOG_TEST_APPLICATION_NAME,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    ssl: false,
  });

  try {
    const client = await pool.connect();
    try {
      const identity = await client.query(
        "SELECT current_database() AS database_name, inet_server_addr()::text AS server_address",
      );
      assertIsolatedAiBlogTestDatabaseIdentity(identity.rows[0] ?? {});
      if (command === "verify") {
        console.log(`Verified isolated PostgreSQL target: ${AI_BLOG_TEST_DATABASE_NAME} on loopback.`);
        return;
      }

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
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Isolated test database command failed.");
  process.exitCode = 1;
});
