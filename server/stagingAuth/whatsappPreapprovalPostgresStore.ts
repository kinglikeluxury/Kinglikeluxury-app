import pg from "pg";
import type { NumberPreapproval, NumberPreapprovalStore } from "./whatsappPreapproval";
import { isStagingAuthHost } from "./isolation";

const { Pool } = pg;
const MIGRATION_ID = "003_staging_whatsapp_number_preapproval";
const META_BINDING_MIGRATION_ID = "004_meta_verified_pending_archive_binding";
const ACTIVE_STATES = ["pending_owner", "approved", "meta_verified_pending_binding", "connected"];

type QueryClient = { query: (...args: any[]) => Promise<any> };

export async function insertPreapprovalForEligibleEmployee(
  client: QueryClient,
  input: { employeeId: number; fingerprint: Buffer; ciphertext: Buffer },
): Promise<Record<string, unknown>> {
  const result = await client.query(
    `INSERT INTO staging_whatsapp_number_preapprovals
       (employee_user_id, requested_by_user_id, employee_acknowledged_by_user_id,
        status, number_fingerprint, number_ciphertext)
     SELECT id, id, id, 'pending_owner', $2, $3
       FROM staging_auth_users
      WHERE id=$1 AND role='crm_employee' AND is_active=TRUE
        AND is_admin=FALSE AND identity_verified_at IS NOT NULL
     RETURNING *`,
    [input.employeeId, input.fingerprint, input.ciphertext],
  );
  if (!result.rowCount) throw new Error("employee_identity_unavailable");
  return result.rows[0];
}

export function isApprovedStagingWhatsappPreapprovalTarget(
  env: NodeJS.ProcessEnv,
): boolean {
  if (env.NODE_ENV !== "development" || env.APP_DEPLOYMENT_MODE !== "staging" ||
    env.DEV_RESOURCE_ISOLATION_CONFIRMED !== "true" ||
    env.DEV_DATABASE_ISOLATION_CONFIRMED !== "true") return false;
  try {
    const target = new URL(env.WHATSAPP_STAGING_ONBOARDING_DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(target.protocol) ||
      !isStagingAuthHost(target.hostname) ||
      decodeURIComponent(target.pathname.replace(/^\/+/, "")) !== "neondb" ||
      decodeURIComponent(target.username) !== "kinglike_staging_onboarding_writer" ||
      target.searchParams.get("sslmode") !== "require") return false;
    return !["DATABASE_URL", "NEON_DATABASE_URL"].some((key) => {
      if (!env[key]) return false;
      const primary = new URL(env[key]!);
      return isStagingAuthHost(primary.hostname) &&
        isStagingAuthHost(target.hostname) &&
        (decodeURIComponent(primary.pathname.replace(/^\/+/, "")) === "neondb" ||
          primary.username === target.username);
    });
  } catch { return false; }
}

function rowToPreapproval(row: Record<string, unknown>): NumberPreapproval {
  return {
    id: String(row.approval_id),
    employeeId: Number(row.employee_user_id),
    version: Number(row.version),
    status: row.status as NumberPreapproval["status"],
    numberFingerprint: Buffer.from(row.number_fingerprint as Buffer),
    numberCiphertext: Buffer.from(row.number_ciphertext as Buffer),
    expiresAt: new Date(String(row.expires_at)),
    employeeIdentity: typeof row.employee_identity === "string" ? row.employee_identity : undefined,
    metaBusinessId: typeof row.meta_business_id === "string" ? row.meta_business_id : null,
    metaWabaId: typeof row.meta_waba_id === "string" ? row.meta_waba_id : null,
    metaPhoneNumberId: typeof row.meta_phone_number_id === "string" ? row.meta_phone_number_id : null,
  };
}

export function createStagingWhatsappPreapprovalPostgresStore(
  env: NodeJS.ProcessEnv,
): NumberPreapprovalStore {
  let pool: InstanceType<typeof Pool> | null = null;
  const getPool = () => {
    if (!isApprovedStagingWhatsappPreapprovalTarget(env)) {
      throw new Error("staging_preapproval_target_blocked");
    }
    if (!pool) pool = new Pool({
      connectionString: env.WHATSAPP_STAGING_ONBOARDING_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 3000,
      application_name: "kinglike_staging_whatsapp_preapproval",
    });
    return pool;
  };
  const verifyTarget = async (client: any) => {
    const actual = await client.query("SELECT current_database() AS db, current_user AS username");
    const target = new URL(env.WHATSAPP_STAGING_ONBOARDING_DATABASE_URL!);
    if (actual.rows[0]?.db !== "neondb" ||
      actual.rows[0]?.username !== decodeURIComponent(target.username)) {
      throw new Error("staging_preapproval_database_mismatch");
    }
  };
  const audit = (client: any, id: string, actorId: number, event: string, version: number) =>
    client.query(
      `INSERT INTO staging_whatsapp_number_preapproval_audit
        (approval_id, actor_user_id, event, version) VALUES ($1,$2,$3,$4)`,
      [id, actorId, event, version],
    );
  const transaction = async <T>(fn: (client: any) => Promise<T>): Promise<T> => {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await verifyTarget(client);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  };

  return {
    async schemaReady() {
      if (!isApprovedStagingWhatsappPreapprovalTarget(env)) return false;
      try {
        const result = await getPool().query(
          `SELECT current_database() = 'neondb' AS target_ok,
             current_user = $2 AS writer_role_ok,
             COALESCE((SELECT NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole
                 AND NOT pg_has_role(current_user,
                   (SELECT datdba FROM pg_database WHERE datname=current_database()), 'MEMBER')
                 AND NOT EXISTS (
                   SELECT 1 FROM pg_roles protected
                    WHERE protected.rolname IN ('neon_superuser', 'pg_read_all_data', 'pg_write_all_data')
                      AND pg_has_role(current_user, protected.oid, 'MEMBER')
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM pg_auth_members membership WHERE membership.member=role.oid
                 )
               FROM pg_roles role WHERE role.rolname=current_user), FALSE) AS writer_role_scoped,
              EXISTS (SELECT 1 FROM staging_auth_migrations WHERE migration_id = $1)
                AND EXISTS (SELECT 1 FROM staging_auth_migrations WHERE migration_id = $3)
                AS migration_applied,
             to_regclass('public.staging_whatsapp_number_preapprovals') IS NOT NULL AS table_exists,
             has_table_privilege(current_user, 'staging_whatsapp_number_preapprovals', 'SELECT')
               AND has_table_privilege(current_user, 'staging_whatsapp_number_preapprovals', 'INSERT')
               AND has_table_privilege(current_user, 'staging_whatsapp_number_preapprovals', 'UPDATE')
               AND has_table_privilege(current_user, 'staging_whatsapp_number_preapproval_audit', 'INSERT')
               AND has_table_privilege(current_user, 'staging_auth_migrations', 'SELECT')
               AND has_column_privilege(current_user, 'staging_auth_users', 'id', 'SELECT')
               AND has_column_privilege(current_user, 'staging_auth_users', 'username', 'SELECT')
               AND has_column_privilege(current_user, 'staging_auth_users', 'role', 'SELECT')
               AND has_column_privilege(current_user, 'staging_auth_users', 'is_active', 'SELECT')
               AND has_column_privilege(current_user, 'staging_auth_users', 'is_admin', 'SELECT')
               AND has_column_privilege(current_user, 'staging_auth_users', 'identity_verified_at', 'SELECT')
               AS metadata_grants_ready`,
           [MIGRATION_ID, "kinglike_staging_onboarding_writer", META_BINDING_MIGRATION_ID],
        );
        const row = result.rows[0];
        return row?.target_ok === true && row?.writer_role_ok === true &&
          row?.writer_role_scoped === true && row?.migration_applied === true && row?.table_exists === true &&
          row?.metadata_grants_ready === true;
      } catch { return false; }
    },
    async create(input) {
      return transaction(async (client) => {
        const expired = await client.query(
          `UPDATE staging_whatsapp_number_preapprovals
              SET status='expired', version=version+1
            WHERE status=ANY($1::text[]) AND expires_at<=NOW()
            RETURNING approval_id::text, employee_user_id, version`,
          [ACTIVE_STATES],
        );
        for (const row of expired.rows) {
          await audit(client, String(row.approval_id), Number(row.employee_user_id),
            "expired", Number(row.version));
        }
        const created = await insertPreapprovalForEligibleEmployee(client, input);
        const row = rowToPreapproval(created);
        await audit(client, row.id, input.employeeId, "requested", row.version);
        return row;
      });
    },
    async getApprovedForAttempt(input) {
      const result = await getPool().query(
        `SELECT approval_id, employee_user_id, version, status, number_fingerprint,
                number_ciphertext, expires_at, meta_business_id, meta_waba_id,
                meta_phone_number_id
           FROM staging_whatsapp_number_preapprovals
          WHERE approval_id=$1 AND version=$2 AND employee_user_id=$3
            AND status='approved' AND expires_at>NOW()
          LIMIT 1`,
        [input.id, input.version, input.employeeId],
      );
      return result.rows[0] ? rowToPreapproval(result.rows[0]) : null;
    },
    async recordMetaVerified(input) {
      return transaction(async (client) => {
        const result = await client.query(
          `UPDATE staging_whatsapp_number_preapprovals
              SET status='meta_verified_pending_binding', version=version+1,
                  meta_business_id=$5, meta_waba_id=$6, meta_phone_number_id=$7,
                  meta_display_number_fingerprint=$8, meta_verified_at=NOW()
            WHERE approval_id=$1 AND version=$2 AND employee_user_id=$3
              AND number_fingerprint=$4 AND status='approved' AND expires_at>NOW()
              AND meta_phone_number_id IS NULL
            RETURNING version`,
          [input.id, input.version, input.employeeId, input.numberFingerprint,
            input.businessId, input.wabaId, input.phoneNumberId, input.displayFingerprint],
        );
        if (!result.rowCount) return false;
        await audit(client, input.id, input.employeeId, "meta_verified", Number(result.rows[0].version));
        return true;
      });
    },
    async listForEmployee(employeeId) {
      const result = await getPool().query(
        `SELECT approval_id, employee_user_id, version, status, number_fingerprint,
                number_ciphertext, expires_at
           FROM staging_whatsapp_number_preapprovals WHERE employee_user_id=$1
          ORDER BY requested_at DESC LIMIT 10`,
        [employeeId],
      );
      return result.rows.map(rowToPreapproval);
    },
    async listPending() {
      const result = await getPool().query(
        `SELECT approval.approval_id, approval.employee_user_id, approval.version, approval.status,
                approval.number_fingerprint, approval.number_ciphertext, approval.expires_at,
                approval.meta_business_id, approval.meta_waba_id, approval.meta_phone_number_id,
                identity.username AS employee_identity
           FROM staging_whatsapp_number_preapprovals AS approval
           JOIN staging_auth_users AS identity ON identity.id=approval.employee_user_id
          WHERE approval.status='pending_owner' AND approval.expires_at>NOW()
          ORDER BY approval.requested_at ASC LIMIT 50`,
      );
      return result.rows.map(rowToPreapproval);
    },
    async decide(input) {
      return transaction(async (client) => {
        const owner = await client.query(
          `SELECT 1 FROM staging_auth_users WHERE id=$1 AND role='owner_approver'
             AND is_active=TRUE AND is_admin=TRUE AND identity_verified_at IS NOT NULL`,
          [input.ownerId],
        );
        if (!owner.rowCount) return false;
        const result = await client.query(
          `UPDATE staging_whatsapp_number_preapprovals
              SET status=$3, version=version+1, owner_decided_by_user_id=$4, owner_decided_at=NOW()
            WHERE approval_id=$1 AND version=$2 AND status='pending_owner'
              AND expires_at>NOW() AND employee_user_id<>$4
            RETURNING version`,
          [input.id, input.version, input.approve ? "approved" : "rejected", input.ownerId],
        );
        if (!result.rowCount) return false;
        await audit(client, input.id, input.ownerId, input.approve ? "approved" : "rejected",
          Number(result.rows[0].version));
        return true;
      });
    },
    async cancel(input) {
      return transaction(async (client) => {
        const result = await client.query(
          `UPDATE staging_whatsapp_number_preapprovals
              SET status='cancelled', version=version+1, cancelled_at=NOW()
            WHERE approval_id=$1 AND version=$2 AND employee_user_id=$3
              AND status=ANY($4::text[]) AND expires_at>NOW()
            RETURNING version`,
          [input.id, input.version, input.employeeId, ACTIVE_STATES],
        );
        if (!result.rowCount) return false;
        await audit(client, input.id, input.employeeId, "cancelled", Number(result.rows[0].version));
        return true;
      });
    },
  };
}
