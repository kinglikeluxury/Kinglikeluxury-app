import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { assertSafeKayMutationTestDatabase } from "./kayTestDatabaseSafety";

let analysisPool: Pool | null = null;
const testMode = process.env.NODE_ENV === "test";

function getAnalysisPool(): Pool {
  if (testMode) assertSafeKayMutationTestDatabase("kayAnalysisDatabase");
  const connectionString = testMode
    ? process.env.KAY_TEST_DATABASE_URL
    : process.env.KAY_ANALYSIS_DATABASE_URL;
  if (!connectionString) {
    throw Object.assign(new Error("Kay read-only analysis connection is not configured"), {
      code: "KAY_READONLY_ANALYSIS_NOT_CONFIGURED",
      status: 503,
    });
  }
  analysisPool ||= new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return analysisPool;
}

/**
 * Kay production analysis has no writer-pool fallback. PostgreSQL must report
 * both a read-only transaction and denied CRM DML privileges before queries run.
 */
export async function withKayReadonlyAnalysis<T>(read: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getAnalysisPool().connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const safety = await client.query(`SELECT
      current_setting('transaction_read_only') = 'on' AS transaction_read_only,
      COALESCE(bool_or(has_table_privilege(current_user,table_name,'INSERT')),false) AS can_insert,
      COALESCE(bool_or(has_table_privilege(current_user,table_name,'UPDATE')),false) AS can_update,
      COALESCE(bool_or(has_table_privilege(current_user,table_name,'DELETE')),false) AS can_delete,
      COALESCE(bool_or(has_table_privilege(current_user,table_name,'TRUNCATE')),false) AS can_truncate
      FROM unnest(ARRAY['crm_leads','crm_tasks','crm_notes','crm_projects','lead_assignment_history']::text[]) AS tables(table_name)`);
    const row = safety.rows[0];
    if (row?.transaction_read_only !== true || (!testMode && (row?.can_insert === true ||
        row?.can_update === true || row?.can_delete === true || row?.can_truncate === true))) {
      throw Object.assign(new Error("Kay analysis database role is not safely read-only"), {
        code: "KAY_READONLY_ROLE_UNSAFE",
        status: 503,
      });
    }
    const result = await read(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}