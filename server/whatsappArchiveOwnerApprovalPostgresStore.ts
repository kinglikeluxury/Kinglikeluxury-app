import pg from "pg";
import { getStagingArchiveOwnerApproverTarget } from "./stagingArchive/isolation";
import { buildStagingArchivePgConfig } from "./stagingArchive/postgresConfig";
import { safePgFailureMessage } from "./stagingArchive/pgFailureDiagnosis";

const { Pool } = pg;
const OWNER_ROLE = "kinglike_wa_archive_owner_approver";
const ARCHIVE_DB = "kinglike_whatsapp_archive_staging";
type OwnerPool = {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};
type PoolFactory = (config: pg.PoolConfig) => OwnerPool;

export function createWhatsappArchiveOwnerApprovalPostgresStore(dependencies: {
  env: NodeJS.ProcessEnv;
  createPool?: PoolFactory;
}) {
  let pool: OwnerPool | undefined;
  let verified = false;
  const getPool = async (): Promise<OwnerPool> => {
    const target = getStagingArchiveOwnerApproverTarget(dependencies.env);
    if (!target) throw new Error("Dedicated archive owner approval role is unavailable.");
    if (!pool) {
      pool = (dependencies.createPool ?? ((config) => new Pool(config)))(
        buildStagingArchivePgConfig(target, {
          applicationName: "kinglike_staging_whatsapp_archive_owner_approval",
          connectionTimeoutMillis: 10_000,
        }),
      );
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
      const expectedUsername = decodeURIComponent(new URL(target.connectionString).username);
      if (
        result.rows[0]?.database !== ARCHIVE_DB ||
        result.rows[0]?.username !== OWNER_ROLE ||
        result.rows[0]?.username !== expectedUsername ||
        !result.rows[0]?.server_address
      ) throw new Error("Archive owner approval database identity mismatch.");
      verified = true;
    }
    return pool;
  };

  return {
    /**
     * Read-only verification of the exact capabilities required by the
     * owner's post-Meta approval flow. No DB grant is changed here.
     */
    async requiredGrantsReady(): Promise<boolean> {
      const db = await getPool();
      const signatures = [
        "staging_whatsapp_archive.list_pending_owner_approvals(text)",
        "staging_whatsapp_archive.approve_employee_phone_binding(bigint,text)",
        "staging_whatsapp_archive.create_customer_notice_echo_intent(text,bytea,text)",
      ];
      const result = await db.query(
        `SELECT current_user = $1 AS exact_owner_role,
                bool_and(
                  to_regprocedure(s.signature) IS NOT NULL
                  AND COALESCE(has_function_privilege(
                    current_user, to_regprocedure(s.signature), 'EXECUTE'
                  ), false)
                  AND NOT EXISTS (
                    SELECT 1
                    FROM pg_proc p
                    CROSS JOIN LATERAL aclexplode(
                      COALESCE(p.proacl, acldefault('f', p.proowner))
                    ) acl
                    WHERE p.oid = to_regprocedure(s.signature)
                      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
                  )
                ) AS functions_ready
           FROM unnest($2::text[]) AS s(signature)`,
        [OWNER_ROLE, signatures],
      );
      return result.rows[0]?.exact_owner_role === true &&
        result.rows[0]?.functions_ready === true;
    },
    async listPending(sessionUserId: string) {
      if (!/^[0-9]{1,20}$/.test(sessionUserId)) throw new Error("Archive owner identity is invalid.");
      const db = await getPool();
      const result = await db.query(
        "SELECT request_id AS \"requestId\", employee_ref AS \"employeeRef\", business_id AS \"businessId\", waba_id AS \"wabaId\", phone_number_id AS \"phoneNumberId\", created_at AS \"createdAt\", expires_at AS \"expiresAt\" FROM staging_whatsapp_archive.list_pending_owner_approvals($1)",
        [sessionUserId],
      );
      return result.rows;
    },
    async customerNoticeIntentReady(): Promise<boolean> {
      const db = await getPool();
      const result = await db.query(
        `SELECT current_database() = $1 AS database_ready,
                current_user = $2 AS role_ready,
                EXISTS (
                  SELECT 1 FROM staging_whatsapp_archive.schema_migrations
                   WHERE migration_id = '007_customer_notice_echo_intents'
                ) AS migration_applied,
                to_regprocedure(
                  'staging_whatsapp_archive.create_customer_notice_echo_intent(text,bytea,text)'
                ) IS NOT NULL AS function_exists,
                COALESCE(has_function_privilege(
                  current_user,
                  to_regprocedure('staging_whatsapp_archive.create_customer_notice_echo_intent(text,bytea,text)'),
                  'EXECUTE'
                ), false) AS owner_can_execute,
                NOT COALESCE(has_function_privilege(
                  'kinglike_wa_archive_runtime',
                  to_regprocedure('staging_whatsapp_archive.create_customer_notice_echo_intent(text,bytea,text)'),
                  'EXECUTE'
                ), true)
                AND NOT COALESCE(has_function_privilege(
                  'kinglike_wa_archive_signup_writer',
                  to_regprocedure('staging_whatsapp_archive.create_customer_notice_echo_intent(text,bytea,text)'),
                  'EXECUTE'
                ), true)
                AND NOT COALESCE(has_function_privilege(
                  'kinglike_wa_archive_notice_webhook',
                  to_regprocedure('staging_whatsapp_archive.create_customer_notice_echo_intent(text,bytea,text)'),
                  'EXECUTE'
                ), true) AS other_roles_blocked,
                NOT EXISTS (
                  SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(COALESCE(
                    p.proacl, acldefault('f', p.proowner)
                  )) acl
                   WHERE p.oid = to_regprocedure(
                     'staging_whatsapp_archive.create_customer_notice_echo_intent(text,bytea,text)'
                   )
                     AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
                ) AS public_is_blocked,
                NOT has_schema_privilege(current_user, 'staging_whatsapp_archive', 'CREATE')
                  AS schema_is_locked`,
        [ARCHIVE_DB, OWNER_ROLE],
      );
      const row = result.rows[0];
      return row?.database_ready === true && row?.role_ready === true &&
        row?.migration_applied === true && row?.function_exists === true &&
        row?.owner_can_execute === true && row?.other_roles_blocked === true &&
        row?.public_is_blocked === true &&
        row?.schema_is_locked === true;
    },
    async createCustomerNoticeEchoIntent(
      phoneNumberId: string,
      recipientFingerprint: Buffer,
      ownerSessionUserId: string,
    ): Promise<boolean> {
      if (!/^[0-9]{1,40}$/.test(phoneNumberId) ||
          !Buffer.isBuffer(recipientFingerprint) || recipientFingerprint.length !== 32 ||
          !/^[0-9]{1,20}$/.test(ownerSessionUserId)) {
        throw new Error("Customer notice intent is invalid.");
      }
      const db = await getPool();
      const result = await db.query(
        `SELECT staging_whatsapp_archive.create_customer_notice_echo_intent(
          $1::text, $2::bytea, $3::text
        ) AS evidence_id`,
        [phoneNumberId, recipientFingerprint, ownerSessionUserId],
      );
      return Number.isSafeInteger(Number(result.rows[0]?.evidence_id)) &&
        Number(result.rows[0]?.evidence_id) > 0;
    },
    async approveRequest(requestId: number, ownerSessionUserId: string): Promise<boolean> {
      if (!Number.isSafeInteger(requestId) || requestId < 1 || !/^[0-9]{1,20}$/.test(ownerSessionUserId)) {
        throw new Error("Archive owner approval request is invalid.");
      }
      const db = await getPool();
      const result = await db.query(
        "SELECT staging_whatsapp_archive.approve_employee_phone_binding($1, $2) AS binding_id",
        [requestId, ownerSessionUserId],
      );
      return Number.isSafeInteger(Number(result.rows[0]?.binding_id)) &&
        Number(result.rows[0]?.binding_id) > 0;
    },
    async listVerifiedRequests(adminId: string) {
      if (!/^[0-9]{1,20}$/.test(adminId)) throw new Error("Archive admin identity is invalid.");
      const db = await getPool();
      const result = await db.query(
        "SELECT * FROM staging_whatsapp_archive.list_verified_company_number_requests($1)",
        [adminId],
      );
      return result.rows;
    },
    async listCompanyNumbers(adminId: string) {
      if (!/^[0-9]{1,20}$/.test(adminId)) throw new Error("Archive admin identity is invalid.");
      const db = await getPool();
      return (await db.query(
        "SELECT * FROM staging_whatsapp_archive.list_company_work_numbers($1)",
        [adminId],
      )).rows;
    },
    async assignVerifiedRequest(requestId: number, reference: string, adminId: string) {
      if (!Number.isSafeInteger(requestId) || requestId < 1 ||
        reference.trim().length < 3 || reference.length > 500 ||
        !/^[0-9]{1,20}$/.test(adminId)) throw new Error("Company number assignment is invalid.");
      const db = await getPool();
      const result = await db.query(
        "SELECT staging_whatsapp_archive.assign_company_number_from_verified_request($1, $2, $3) AS assigned",
        [requestId, reference.trim(), adminId],
      );
      return result.rows[0]?.assigned === true;
    },
    async deactivateCompanyNumber(assignmentId: number, adminId: string) {
      if (!Number.isSafeInteger(assignmentId) || assignmentId < 1 ||
        !/^[0-9]{1,20}$/.test(adminId)) throw new Error("Company number assignment is invalid.");
      const db = await getPool();
      const result = await db.query(
        "SELECT staging_whatsapp_archive.deactivate_company_work_number($1, $2) AS deactivated",
        [assignmentId, adminId],
      );
      return result.rows[0]?.deactivated === true;
    },
    async getPolicy(adminId: string) {
      if (!/^[0-9]{1,20}$/.test(adminId)) throw new Error("Archive admin identity is invalid.");
      const db = await getPool();
      return (await db.query(
        "SELECT * FROM staging_whatsapp_archive.get_archive_policy($1)",
        [adminId],
      )).rows[0] ?? null;
    },
    async savePolicyDraft(input: {
      version: string; lawfulBasis: string; legalAssessmentReference: string;
      processingPurpose: string; retentionDays: number; employeeNoticeText: string;
      customerNoticeText: string;
    }, adminId: string) {
      if (!/^[0-9]{1,20}$/.test(adminId)) throw new Error("Archive admin identity is invalid.");
      const db = await getPool();
      const result = await db.query(
        "SELECT staging_whatsapp_archive.save_archive_policy_draft($1, $2, $3, $4, $5, $6, $7, $8, $9) AS saved",
        [input.version, input.lawfulBasis, input.legalAssessmentReference, input.processingPurpose,
          input.retentionDays, input.employeeNoticeText, input.customerNoticeText, adminId,
          dependencies.env.WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY_ID || "archive-key-v1"],
      );
      return result.rows[0]?.saved === true;
    },
    async submitPolicyForReview(version: string, adminId: string) {
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(version) || !/^[0-9]{1,20}$/.test(adminId)) {
        throw new Error("Archive policy version is invalid.");
      }
      const db = await getPool();
      const result = await db.query(
        "SELECT staging_whatsapp_archive.submit_archive_policy_for_review($1, $2) AS submitted",
        [version, adminId],
      );
      return result.rows[0]?.submitted === true;
    },
    async approvePolicy(version: string, assessmentReference: string, reviewerId: string) {
      if (!/^[A-Za-z0-9._-]{1,80}$/.test(version) ||
        assessmentReference.trim().length < 4 || assessmentReference.length > 500 ||
        !/^[0-9]{1,20}$/.test(reviewerId)) throw new Error("Legal review evidence is invalid.");
      const db = await getPool();
      const result = await db.query(
        "SELECT staging_whatsapp_archive.approve_archive_policy($1, $2, $3) AS approved",
        [version, assessmentReference.trim(), reviewerId],
      );
      return result.rows[0]?.approved === true;
    },
    async listCustomerNoticeEvidence(adminId: string) {
      if (!/^[0-9]{1,20}$/.test(adminId)) throw new Error("Archive admin identity is invalid.");
      const db = await getPool();
      return (await db.query(
        "SELECT * FROM staging_whatsapp_archive.list_customer_notice_evidence($1)",
        [adminId],
      )).rows;
    },
    async registerCustomerNoticePending(
      assignmentId: number, policyVersion: string, providerMessageId: string, adminId: string,
    ) {
      if (!Number.isSafeInteger(assignmentId) || assignmentId < 1 ||
        !/^[A-Za-z0-9._-]{1,80}$/.test(policyVersion) ||
        !/^[A-Za-z0-9_.:-]{1,160}$/.test(providerMessageId) ||
        !/^[0-9]{1,20}$/.test(adminId)) throw new Error("Customer notice reference is invalid.");
      const db = await getPool();
      const result = await db.query(
        "SELECT staging_whatsapp_archive.record_customer_notice_pending($1, $2, $3, $4) AS recorded",
        [assignmentId, policyVersion, providerMessageId, adminId],
      );
      return result.rows[0]?.recorded === true;
    },
  };
}
