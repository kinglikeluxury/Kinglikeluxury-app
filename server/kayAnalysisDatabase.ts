import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";

let analysisPool: Pool | null = null;

function getAnalysisPool(): Pool {
  const connectionString = process.env.KAY_ANALYSIS_DATABASE_URL;
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
      has_table_privilege(current_user,'crm_leads','INSERT') AS can_insert,
      has_table_privilege(current_user,'crm_leads','UPDATE') AS can_update,
      has_table_privilege(current_user,'crm_leads','DELETE') AS can_delete,
      has_table_privilege(current_user,'crm_leads','TRUNCATE') AS can_truncate`);
    const row = safety.rows[0];
    if (row?.transaction_read_only !== true || row?.can_insert === true ||
        row?.can_update === true || row?.can_delete === true || row?.can_truncate === true) {
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