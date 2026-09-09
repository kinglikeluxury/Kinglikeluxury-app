import { Pool } from "pg";

const connectionString = process.env.KAY_READONLY_DATABASE_URL;
const role = process.env.KAY_READONLY_DATABASE_ROLE;
if (!connectionString) throw new Error("KAY_READONLY_DATABASE_URL is required");
if (!role) throw new Error("KAY_READONLY_DATABASE_ROLE is required");

const pool = new Pool({ connectionString });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const identity = await client.query<{ current_user: string; transaction_read_only: string }>(
      "SELECT current_user, current_setting('transaction_read_only') AS transaction_read_only",
    );
    if (identity.rows[0]?.current_user !== role) throw new Error("connected role does not match expected read-only role");
    if (identity.rows[0]?.transaction_read_only !== "on") throw new Error("read-only transaction is not enforced");
    const writes = await client.query<{ table_name: string; privilege_type: string }>(
      `SELECT c.relname AS table_name, p.privilege_type
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       CROSS JOIN LATERAL (VALUES
         ('INSERT',has_table_privilege(current_user,c.oid,'INSERT')),
         ('UPDATE',has_table_privilege(current_user,c.oid,'UPDATE')),
         ('DELETE',has_table_privilege(current_user,c.oid,'DELETE')),
         ('TRUNCATE',has_table_privilege(current_user,c.oid,'TRUNCATE')),
         ('REFERENCES',has_table_privilege(current_user,c.oid,'REFERENCES')),
         ('TRIGGER',has_table_privilege(current_user,c.oid,'TRIGGER'))
       ) p(privilege_type,allowed)
       WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND p.allowed`,
      ["public"],
    );
    if (writes.rowCount) throw new Error(`read-only role has ${writes.rowCount} write privilege(s)`);
    const unsafe = await client.query(
      `SELECT
        has_database_privilege(current_user,current_database(),'CREATE') AS can_create_database_object,
        has_database_privilege(current_user,current_database(),'TEMP') AS can_temp,
        has_schema_privilege(current_user,'public','CREATE') AS can_create_schema_object,
        EXISTS(SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_relation,
        EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS has_role_membership`,
    );
    if (Object.values(unsafe.rows[0] || {}).some(Boolean)) throw new Error("read-only role has effective ownership, membership, CREATE, or TEMP privileges");
    await client.query("ROLLBACK");
    console.log(`Verified ${role}: transaction read-only and no table write privileges`);
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}