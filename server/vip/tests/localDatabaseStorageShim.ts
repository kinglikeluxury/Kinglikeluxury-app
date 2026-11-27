/**
 * Test-only Drizzle/pg adapter for DatabaseStorage and VIP routes.
 * Every invariant is checked before the pool can execute SQL.
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { assertTemporaryPostgresProcessIdentity } from "../qaLocalPostgresIdentity";

const url = process.env.VIP_TEST_DATABASE_URL;
const dataDirectory = process.env.VIP_TEST_EXPECTED_DATA_DIRECTORY;
const port = Number(process.env.PGPORT);
const runId = process.env.VIP_TEST_RUN_ID;

if (
  !url ||
  !dataDirectory ||
  !Number.isSafeInteger(port) ||
  !runId ||
  !/^[A-Za-z0-9_-]{4,32}$/.test(runId)
) {
  throw new Error("Actual database integration requires an explicit disposable VIP test target");
}

assertTemporaryPostgresProcessIdentity(dataDirectory, port);

const parsed = new URL(url);
if (
  parsed.protocol !== "postgresql:" ||
  parsed.hostname !== "127.0.0.1" ||
  parsed.pathname !== "/vipdb" ||
  Number(parsed.port) !== port ||
  decodeURIComponent(parsed.username) !== `vipqa_${runId}` ||
  parsed.searchParams.get("sslmode") !== "disable" ||
  parsed.password
) {
  throw new Error("Actual database integration refuses any non-loopback or non-synthetic database target");
}

const { Pool } = pg;
export const pool = new Pool({
  connectionString: url,
  max: 4,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 1000,
});
export const db = drizzle(pool);
export async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  return operation();
}
