import pg from "pg";
import { getStagingArchiveSignupWriterTarget } from "./stagingArchive/isolation";
import { buildStagingArchivePgConfig } from "./stagingArchive/postgresConfig";
import { safePgFailureMessage } from "./stagingArchive/pgFailureDiagnosis";
import type { SignupRepository } from "./whatsappCoexistenceOAuthFlow";
import type { EncryptedMetaToken } from "./stagingArchive/metaTokenVault";

const { Pool } = pg;
const DB_NAME = "kinglike_whatsapp_archive_staging";
const ROLE_NAME = "kinglike_wa_archive_signup_writer";
type SignupPool = {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export function createWhatsappCoexistenceSignupPostgresWriter(dependencies: {
  env: NodeJS.ProcessEnv;
  createPool?: (config: pg.PoolConfig) => SignupPool;
}): Pick<SignupRepository, "createPendingOwnerApprovalRequest"> & {
  recordEmployeeNoticeReceipt(employeeRef: string, noticeVersion: string): Promise<boolean>;
  createPendingOwnerApprovalRequestWithId(
    input: Parameters<SignupRepository["createPendingOwnerApprovalRequest"]>[0],
  ): Promise<number>;
  storeMetaAccessToken(input: {
    requestId: number; employeeId: number; businessId: string; wabaId: string;
    phoneNumberId: string; encrypted: EncryptedMetaToken; expiresAt: Date | null;
  }): Promise<boolean>;
  hasPendingMetaAccessToken(requestId: number): Promise<boolean>;
  getApprovedMetaAccessToken(input: {
    employeeId: number; businessId: string; wabaId: string; phoneNumberId: string;
  }): Promise<{
    requestId: number; encrypted: EncryptedMetaToken; expiresAt: Date | null;
  } | null>;
  metaTokenVaultReady(): Promise<boolean>;
} {
  let pool: SignupPool | undefined;
  let poolUrl: string | undefined;
  let verified = false;
  const getPool = async (): Promise<SignupPool> => {
    const target = getStagingArchiveSignupWriterTarget(dependencies.env);
    if (!target) throw new Error("Dedicated archive signup writer is unavailable.");
    if (pool && poolUrl !== target.connectionString) {
      throw new Error("Archive signup database target changed after initialization.");
    }
    if (!pool) {
      pool = (dependencies.createPool ?? ((config) => new Pool(config)))(
        buildStagingArchivePgConfig(target, {
          applicationName: "kinglike_staging_whatsapp_archive_signup",
          connectionTimeoutMillis: 10_000,
        }),
      );
      poolUrl = target.connectionString;
    }
    if (!verified) {
      let result;
      try {
        result = await pool.query(
          "SELECT current_database() AS database, current_user AS username, inet_server_addr()::text AS server_address",
        );
      } catch (error) {
        throw new Error(safePgFailureMessage(error, "preflight_query"));
      }
      const expectedUser = decodeURIComponent(new URL(target.connectionString).username);
      if (
        result.rows[0]?.database !== DB_NAME ||
        result.rows[0]?.username !== ROLE_NAME ||
        result.rows[0]?.username !== expectedUser ||
        !result.rows[0]?.server_address
      ) throw new Error("Archive signup database identity mismatch.");
      verified = true;
    }
    return pool;
  };

  return {
    async recordEmployeeNoticeReceipt(employeeRef, noticeVersion) {
      if (!/^[1-9][0-9]{0,19}$/.test(employeeRef) ||
        typeof noticeVersion !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(noticeVersion)) {
        throw new Error("Employee notice receipt is invalid.");
      }
      const db = await getPool();
      const result = await db.query(
        "SELECT staging_whatsapp_archive.record_employee_work_notice_receipt($1, $1, $2) AS recorded",
        [employeeRef, noticeVersion],
      );
      return result.rows[0]?.recorded === true;
    },
    async createPendingOwnerApprovalRequest(input) {
      if (
        input.employeeRef !== String(input.employeeId) ||
        !Number.isSafeInteger(input.archiveEmployeeId) ||
        input.archiveEmployeeId < 1 ||
        input.noticeReceiptRecorded !== true
      ) throw new Error("Employee binding request is invalid.");
      const db = await getPool();
      const result = await db.query(
        `SELECT staging_whatsapp_archive.request_employee_phone_binding(
          $1, $2, $3, $4, $5, $6, $7, $8
        ) AS request_id`,
        [
          input.employeeRef,
          String(input.employeeId),
          input.businessId,
          input.wabaId,
          input.phoneNumberId,
          input.noticeReceiptRecorded,
          input.noticeVersion,
          input.retentionDays,
        ],
      );
      if (!Number.isSafeInteger(Number(result.rows[0]?.request_id)) ||
        Number(result.rows[0]?.request_id) < 1) {
        throw new Error("Archive owner approval request was not saved.");
      }
      return "created";
    },
    async createPendingOwnerApprovalRequestWithId(input) {
      if (
        input.employeeRef !== String(input.employeeId) ||
        !Number.isSafeInteger(input.archiveEmployeeId) || input.archiveEmployeeId < 1 ||
        input.noticeReceiptRecorded !== true
      ) throw new Error("Employee binding request is invalid.");
      const db = await getPool();
      const result = await db.query(
        `SELECT staging_whatsapp_archive.request_employee_phone_binding(
          $1, $2, $3, $4, $5, $6, $7, $8
        ) AS request_id`,
        [
          input.employeeRef, String(input.employeeId), input.businessId, input.wabaId,
          input.phoneNumberId, true, input.noticeVersion, input.retentionDays,
        ],
      );
      const requestId = Number(result.rows[0]?.request_id);
      if (!Number.isSafeInteger(requestId) || requestId < 1) {
        throw new Error("Archive owner approval request was not saved.");
      }
      return requestId;
    },
    async storeMetaAccessToken(input) {
      if (!Number.isSafeInteger(input.requestId) || input.requestId < 1 ||
          !Number.isSafeInteger(input.employeeId) || input.employeeId < 1 ||
          !/^[0-9]{1,40}$/.test(input.businessId) ||
          !/^[0-9]{1,40}$/.test(input.wabaId) ||
          !/^[0-9]{1,40}$/.test(input.phoneNumberId) ||
          !Buffer.isBuffer(input.encrypted.nonce) || input.encrypted.nonce.length !== 12 ||
          !Buffer.isBuffer(input.encrypted.ciphertext) ||
          input.encrypted.ciphertext.length < 8 || input.encrypted.ciphertext.length > 8192 ||
          !Buffer.isBuffer(input.encrypted.authTag) || input.encrypted.authTag.length !== 16) {
        throw new Error("Encrypted Meta token record is invalid.");
      }
      const db = await getPool();
      const result = await db.query(
        `SELECT staging_whatsapp_archive.store_pending_meta_access_token(
          $1::bigint, $2::bigint, $3::text, $4::text, $5::text, $6::text,
          $7::bytea, $8::bytea, $9::bytea, $10::timestamptz
        ) AS stored`,
        [
          input.requestId, input.employeeId, input.businessId, input.wabaId,
          input.phoneNumberId, input.encrypted.keyVersion, input.encrypted.nonce,
          input.encrypted.ciphertext, input.encrypted.authTag, input.expiresAt,
        ],
      );
      return result.rows[0]?.stored === true;
    },
    async hasPendingMetaAccessToken(requestId) {
      if (!Number.isSafeInteger(requestId) || requestId < 1) return false;
      const db = await getPool();
      const result = await db.query(
        "SELECT staging_whatsapp_archive.has_pending_meta_access_token($1::bigint) AS ready",
        [requestId],
      );
      return result.rows[0]?.ready === true;
    },
    async getApprovedMetaAccessToken(input) {
      if (!Number.isSafeInteger(input.employeeId) || input.employeeId < 1 ||
          !/^[0-9]{1,40}$/.test(input.businessId) ||
          !/^[0-9]{1,40}$/.test(input.wabaId) ||
          !/^[0-9]{1,40}$/.test(input.phoneNumberId)) return null;
      const db = await getPool();
      const result = await db.query(
        `SELECT request_id, key_version, nonce, ciphertext, auth_tag, token_expires_at
           FROM staging_whatsapp_archive.get_approved_meta_access_token(
             $1::bigint, $2::text, $3::text, $4::text
           )`,
        [input.employeeId, input.businessId, input.wabaId, input.phoneNumberId],
      );
      const row = result.rows[0];
      if (!row || row.key_version !== "meta-token-v1") return null;
      return {
        requestId: Number(row.request_id),
        encrypted: {
          keyVersion: "meta-token-v1",
          nonce: Buffer.from(row.nonce as Buffer),
          ciphertext: Buffer.from(row.ciphertext as Buffer),
          authTag: Buffer.from(row.auth_tag as Buffer),
        },
        expiresAt: row.token_expires_at ? new Date(String(row.token_expires_at)) : null,
      };
    },
    async metaTokenVaultReady() {
      try {
        const db = await getPool();
        const signatures = [
          "staging_whatsapp_archive.store_pending_meta_access_token(bigint,bigint,text,text,text,text,bytea,bytea,bytea,timestamp with time zone)",
          "staging_whatsapp_archive.has_pending_meta_access_token(bigint)",
          "staging_whatsapp_archive.get_approved_meta_access_token(bigint,text,text,text)",
        ];
        const result = await db.query(
          `SELECT current_database() = $1 AS database_ok,
              current_user = $2 AS role_ok,
              EXISTS (SELECT 1 FROM staging_whatsapp_archive.schema_migrations
                       WHERE migration_id = '006_meta_token_vault')
                AND to_regclass('staging_whatsapp_archive.meta_access_token_vault') IS NOT NULL
                AS migration_ok,
              bool_and(to_regprocedure(signature) IS NOT NULL
                AND has_function_privilege(current_user, to_regprocedure(signature), 'EXECUTE')
                AND (SELECT p.prosecdef FROM pg_proc p
                      WHERE p.oid = to_regprocedure(signature))
                AND NOT EXISTS (
                  SELECT 1 FROM aclexplode(COALESCE(
                    (SELECT p.proacl FROM pg_proc p WHERE p.oid=to_regprocedure(signature)),
                    acldefault('f', (SELECT p.proowner FROM pg_proc p
                                      WHERE p.oid=to_regprocedure(signature)))
                  )) acl WHERE acl.grantee = 0 AND acl.privilege_type='EXECUTE'
                )
              ) AS functions_ok,
              NOT has_table_privilege(current_user,
                'staging_whatsapp_archive.meta_access_token_vault', 'SELECT')
              AND NOT has_table_privilege(current_user,
                'staging_whatsapp_archive.meta_access_token_vault', 'INSERT')
              AND NOT has_table_privilege(current_user,
                'staging_whatsapp_archive.meta_access_token_vault', 'UPDATE')
              AND NOT has_table_privilege(current_user,
                'staging_whatsapp_archive.meta_access_token_vault', 'DELETE')
                AS no_direct_table_access
             FROM unnest($3::text[]) signature`,
          [DB_NAME, ROLE_NAME, signatures],
        );
        const row = result.rows[0];
        return row?.database_ok === true && row?.role_ok === true &&
          row?.migration_ok === true && row?.functions_ok === true &&
          row?.no_direct_table_access === true;
      } catch {
        return false;
      }
    },
  };
}
