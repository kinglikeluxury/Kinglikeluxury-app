import { Pool, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "@shared/schema";
import {
  KAY_INTERNAL_APPROVED_WRITABLE_TABLES,
  KAY_INTERNAL_WRITABLE_TABLES,
} from "./kayDataOwnership";
import { assertSafeKayMutationTestDatabase } from "./kayTestDatabaseSafety";

export class KayInternalPersistenceUnavailableError extends Error {
  readonly code = "KAY_INTERNAL_PERSISTENCE_UNAVAILABLE";
  readonly status = 503;
  constructor(message: string) { super(message); this.name = "KayInternalPersistenceUnavailableError"; }
}

let pool: Pool | null = null;
let verified: Promise<void> | null = null;
function requiredWritableTables(): readonly string[] {
  return process.env.KAY_INTERNAL_CALLS_ENABLED === "true"
    ? KAY_INTERNAL_APPROVED_WRITABLE_TABLES
    : KAY_INTERNAL_WRITABLE_TABLES;
}

function getPool(): Pool {
  const testMode = process.env.NODE_ENV === "test";
  if (testMode) assertSafeKayMutationTestDatabase("kayInternalDatabase");
  const url = testMode ? process.env.KAY_TEST_DATABASE_URL : process.env.KAY_INTERNAL_DATABASE_URL;
  if (!url) throw new KayInternalPersistenceUnavailableError(
    testMode ? "Kay isolated test persistence connection is not configured" : "Kay internal persistence connection is not configured",
  );
  pool ||= new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  return pool;
}

const lazyPool = new Proxy({} as Pool, {
  get(_target, property) {
    const value = (getPool() as any)[property];
    return typeof value === "function" ? value.bind(getPool()) : value;
  },
});

export const kayInternalDb = drizzle({ client: lazyPool, schema });

async function verifyBoundary(): Promise<void> {
  verified ||= (async () => {
    const requiredTables = requiredWritableTables();
    const updateTables = requiredTables.filter(table => table !== "kay_events");
    const client = await getPool().connect();
    try {
      if (process.env.NODE_ENV === "test") {
        const safe = assertSafeKayMutationTestDatabase("kayInternalDatabase");
        const identity = await client.query(`SELECT current_user AS current_user,current_database() AS current_database`);
        if (identity.rows[0]?.current_user !== process.env.KAY_TEST_DATABASE_USER ||
            identity.rows[0]?.current_database !== safe.database) {
          throw new KayInternalPersistenceUnavailableError("Kay isolated test database identity is unsafe");
        }
        return;
      }
      const result = await client.query(`SELECT
        current_user='kay_internal_writer' AS correct_user,
        current_database()='neondb' AS correct_database,
        NOT has_schema_privilege(current_user,'public','CREATE') AS create_denied,
        NOT has_table_privilege(current_user,'crm_leads','SELECT') AS crm_select_denied,
        NOT has_table_privilege(current_user,'crm_leads','INSERT') AS crm_insert_denied,
        NOT has_table_privilege(current_user,'crm_leads','UPDATE') AS crm_update_denied,
        NOT has_table_privilege(current_user,'crm_leads','DELETE') AS crm_delete_denied,
        NOT has_table_privilege(current_user,'crm_leads','TRUNCATE') AS crm_truncate_denied,
        COALESCE(bool_and(has_table_privilege(current_user,t,'SELECT')),false) AS internal_select,
        COALESCE(bool_and(has_table_privilege(current_user,t,'INSERT')),false) AS internal_insert,
        COALESCE(bool_and(has_table_privilege(current_user,t,'UPDATE'))
          FILTER (WHERE t=ANY($2::text[])),false) AS internal_update,
        COALESCE(bool_and(NOT has_table_privilege(current_user,t,'DELETE')),false) AS internal_delete_denied,
        COALESCE(bool_and(NOT has_table_privilege(current_user,t,'TRUNCATE')),false) AS internal_truncate_denied,
        COALESCE(
          has_function_privilege(
            current_user,
            to_regprocedure('public.kay_lock_mission_scope(integer,integer)'),
            'EXECUTE'
          ),
          false
        ) AS mission_scope_fence,
        NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p')
            AND c.relname <> ALL($3::text[])
            AND (
              has_table_privilege(current_user,c.oid,'INSERT') OR
              has_table_privilege(current_user,c.oid,'UPDATE') OR
              has_table_privilege(current_user,c.oid,'DELETE') OR
              has_table_privilege(current_user,c.oid,'TRUNCATE')
            )
        ) AS unapproved_writes_denied
        FROM unnest($1::text[]) AS approved(t)`, [
          requiredTables,
          updateTables,
          KAY_INTERNAL_APPROVED_WRITABLE_TABLES,
        ]);
      const row = result.rows[0];
      if (!row?.correct_user || !row?.correct_database || !row?.create_denied ||
          !row?.crm_select_denied || !row?.crm_insert_denied || !row?.crm_update_denied ||
          !row?.crm_delete_denied || !row?.crm_truncate_denied ||
          !row?.internal_select || !row?.internal_insert || !row?.internal_update ||
          !row?.internal_delete_denied || !row?.internal_truncate_denied ||
           !row?.mission_scope_fence || !row?.unapproved_writes_denied) {
        throw new KayInternalPersistenceUnavailableError("Kay internal database privilege boundary is unsafe");
      }
    } finally { client.release(); }
  })().catch(error => { verified = null; throw error; });
  return verified;
}

export async function withKayInternalClient<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  await verifyBoundary();
  const client = await getPool().connect();
  try { return await operation(client); } finally { client.release(); }
}

export async function verifyKayInternalDatabase(): Promise<void> {
  await verifyBoundary();
}