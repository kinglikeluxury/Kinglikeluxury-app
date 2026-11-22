import crypto from "node:crypto";
import pg from "pg";
import {
  getStagingArchiveNoticeWebhookTarget,
  type StagingArchiveTarget,
} from "./isolation";
import { buildStagingArchivePgConfig } from "./postgresConfig";
import { parseArchiveEncryptionKey } from "../whatsappEmployeeArchiveSafety";
import {
  fingerprintCustomerNoticeRecipient,
  parseCustomerNoticeRecipientHmacKey,
} from "./customerNoticeRecipientFingerprint";

export const CUSTOMER_NOTICE_STATUS_FUNCTION =
  "staging_whatsapp_archive.apply_customer_notice_webhook_event(text,text,bytea,text,text,bigint,bigint,text,text,bytea,bytea,bytea,timestamp with time zone)";
export const CUSTOMER_NOTICE_SOURCE_FUNCTION =
  "staging_whatsapp_archive.find_verified_customer_notice_sender_receipt(text,text,text,bytea)";
export const CUSTOMER_NOTICE_ECHO_FUNCTION =
  "staging_whatsapp_archive.record_customer_notice_sender_receipt_from_signed_echo(text,text,text,bytea,bytea,bytea,timestamp with time zone,text)";
export const CUSTOMER_NOTICE_GATE_FUNCTION =
  "staging_whatsapp_archive.has_current_customer_notice_receipt(text,text,bytea)";

export type CustomerNoticeStatusOutcome =
  | "not_applicable"
  | "applied"
  | "duplicate"
  | "blocked";

export type CustomerNoticeWebhookStatus = Readonly<{
  wabaId: string;
  phoneNumberId: string;
  providerMessageId: string;
  status: "sent" | "delivered" | "read";
  recipientFingerprint: Buffer;
  payloadFingerprint: Buffer;
  occurredAt: Date;
  eventId: string;
}>;
export type CustomerNoticeEcho = Readonly<{
  wabaId: string;
  phoneNumberId: string;
  providerMessageId: string;
  recipientFingerprint: Buffer;
  noticeContentFingerprint: Buffer;
  sourceReceiptFingerprint: Buffer;
  noticeText: string;
  sentAt: Date;
}>;

export type VerifiedCustomerNoticeSource = Readonly<{
  source: "approved_notice_sender";
  wabaId: string;
  phoneNumberId: string;
  employeeId: number;
  assignmentId: number;
  noticeEvidenceId: number;
  providerMessageId: string;
  policyVersion: string;
  approvedCurrentPolicy: true;
  activeCompanyWorkNumber: true;
  exactNoticeContentWasSent: true;
  noticeContentFingerprint: Buffer;
  sourceReceiptFingerprint: Buffer;
  recipientFingerprint: Buffer;
  sentAt: Date;
}>;

export type CustomerNoticeStatusWriterDependencies = Readonly<{
  env: NodeJS.ProcessEnv;
  source?: {
    /** Must return only a sender receipt whose text hash matches the exact approved policy text. */
    findVerifiedNotice(input: Pick<CustomerNoticeWebhookStatus,
      "wabaId" | "phoneNumberId" | "providerMessageId" | "recipientFingerprint">):
      Promise<VerifiedCustomerNoticeSource | null>;
  };
  databaseContract?: {
    /** Must be a READ ONLY pg_catalog check, never a grant or migration. */
    verify(): Promise<{
      database: string;
      username: string;
      approvedHost: boolean;
      functionSignature: string;
      writerCanExecute: boolean;
      sourceFunctionSignature: string;
      sourceCanExecute: boolean;
      echoFunctionSignature: string;
      echoCanExecute: boolean;
      gateFunctionSignature: string;
      gateCanExecute: boolean;
      forbiddenRolesCanExecute: boolean;
      migration005Applied: boolean;
      roleLimited: boolean;
    }>;
  };
  /** Must invoke the event-keyed DB function; never a direct table write. */
  applyStatus?: (
    status: CustomerNoticeWebhookStatus,
    receipt: VerifiedCustomerNoticeSource,
  ) => Promise<"applied" | "duplicate">;
  recordNoticeEcho?: (
    echo: CustomerNoticeEcho,
  ) => Promise<"recorded" | "duplicate" | "not_applicable">;
}>;

type NoticePool = {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};
type NoticePoolFactory = (config: pg.PoolConfig) => NoticePool;

const FORBIDDEN_EXECUTE_ROLES = [
  "kinglike_wa_archive_runtime",
  "kinglike_wa_archive_signup_writer",
  "kinglike_wa_archive_owner_approver",
] as const;

/**
 * Creates a lazy, dedicated-role adapter. It returns null unless the exact
 * isolated staging target is configured; construction itself never connects.
 */
export function createStagingCustomerNoticeStatusDatabaseAdapter(
  env: NodeJS.ProcessEnv,
  createPool?: NoticePoolFactory,
) {
  const target = getStagingArchiveNoticeWebhookTarget(env);
  if (!target) return null;
  let pool: NoticePool | undefined;
  let contractVerified = false;
  const getPool = () => {
    if (!pool) {
      pool = (createPool ?? ((config) => new pg.Pool(config)))(
        buildStagingArchivePgConfig(target, {
          applicationName: "kinglike_staging_customer_notice_webhook",
          connectionTimeoutMillis: 5000,
        }),
      );
    }
    return pool;
  };
  return {
    async verify() {
      const result = await getPool().query(
        `SELECT current_database() AS database, current_user AS username,
            CASE WHEN to_regprocedure($1) IS NULL THEN '' ELSE $1 END AS function_signature,
            CASE WHEN to_regprocedure($2) IS NULL THEN '' ELSE $2 END AS source_function_signature,
            CASE WHEN to_regprocedure($3) IS NULL THEN '' ELSE $3 END AS echo_function_signature,
            CASE WHEN to_regprocedure($4) IS NULL THEN '' ELSE $4 END AS gate_function_signature,
            EXISTS (SELECT 1 FROM staging_whatsapp_archive.schema_migrations
                     WHERE migration_id = '005_customer_notice_webhook_idempotency')
            AND to_regclass('staging_whatsapp_archive.customer_notice_webhook_events') IS NOT NULL
            AND to_regclass('staging_whatsapp_archive.customer_notice_sender_receipts') IS NOT NULL
            AND to_regprocedure($1) IS NOT NULL
            AND to_regprocedure($2) IS NOT NULL
            AND to_regprocedure($3) IS NOT NULL
            AND to_regprocedure($4) IS NOT NULL
              AS migration_005_applied,
           COALESCE(has_function_privilege(current_user, to_regprocedure($1), 'EXECUTE'), false)
             AND COALESCE(has_function_privilege(current_user, to_regprocedure($2), 'EXECUTE'), false)
             AS writer_can_execute,
           COALESCE(has_function_privilege(current_user, to_regprocedure($2), 'EXECUTE'), false)
             AS source_can_execute,
           COALESCE(has_function_privilege(current_user, to_regprocedure($3), 'EXECUTE'), false)
             AS echo_can_execute,
           COALESCE(has_function_privilege(current_user, to_regprocedure($4), 'EXECUTE'), false)
             AS gate_can_execute,
           EXISTS (
             SELECT 1 FROM pg_proc p
             CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
             LEFT JOIN pg_roles r ON r.oid = acl.grantee
              WHERE p.oid = ANY(ARRAY[
                to_regprocedure($1), to_regprocedure($2), to_regprocedure($3), to_regprocedure($4)
              ]::oid[])
               AND acl.privilege_type = 'EXECUTE'
               AND (
                  acl.grantee = 0 OR r.rolname = ANY($5::text[])
                  OR has_function_privilege('kinglike_wa_archive_runtime', p.oid, 'EXECUTE')
                  OR has_function_privilege('kinglike_wa_archive_signup_writer', p.oid, 'EXECUTE')
                  OR has_function_privilege('kinglike_wa_archive_owner_approver', p.oid, 'EXECUTE')
               )
            ) AS forbidden_roles_can_execute,
            NOT has_schema_privilege(current_user, 'staging_whatsapp_archive', 'CREATE')
            AND NOT EXISTS (
              SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
               WHERE r.rolname = current_user
            )
            AND NOT EXISTS (
              SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'staging_whatsapp_archive'
                  AND p.oid <> ALL(ARRAY[
                    to_regprocedure($1), to_regprocedure($2), to_regprocedure($3), to_regprocedure($4)
                  ]::oid[])
                 AND has_function_privilege(current_user, p.oid, 'EXECUTE')
            )
            AND NOT EXISTS (
              SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'staging_whatsapp_archive'
                 AND c.relkind IN ('r','p','v','m','S')
                 AND (
                   (c.relkind = 'S' AND (
                     has_sequence_privilege(current_user, c.oid, 'USAGE')
                     OR has_sequence_privilege(current_user, c.oid, 'SELECT')
                     OR has_sequence_privilege(current_user, c.oid, 'UPDATE')
                   ))
                   OR (c.relkind <> 'S' AND (
                     (c.relname = 'schema_migrations' AND (
                       has_table_privilege(current_user, c.oid, 'INSERT')
                       OR has_table_privilege(current_user, c.oid, 'UPDATE')
                       OR has_table_privilege(current_user, c.oid, 'DELETE')
                       OR has_table_privilege(current_user, c.oid, 'TRUNCATE')
                       OR has_table_privilege(current_user, c.oid, 'REFERENCES')
                       OR has_table_privilege(current_user, c.oid, 'TRIGGER')
                     ))
                     OR (c.relname <> 'schema_migrations' AND (
                     has_table_privilege(current_user, c.oid, 'SELECT')
                     OR has_table_privilege(current_user, c.oid, 'INSERT')
                     OR has_table_privilege(current_user, c.oid, 'UPDATE')
                     OR has_table_privilege(current_user, c.oid, 'DELETE')
                     OR has_table_privilege(current_user, c.oid, 'TRUNCATE')
                     OR has_table_privilege(current_user, c.oid, 'REFERENCES')
                     OR has_table_privilege(current_user, c.oid, 'TRIGGER')
                     ))
                   ))
                 )
            ) AS role_limited`,
           [
             CUSTOMER_NOTICE_STATUS_FUNCTION,
             CUSTOMER_NOTICE_SOURCE_FUNCTION,
             CUSTOMER_NOTICE_ECHO_FUNCTION,
             CUSTOMER_NOTICE_GATE_FUNCTION,
             [...FORBIDDEN_EXECUTE_ROLES],
           ],
      );
      const row = result.rows[0] ?? {};
      const verified = row.database === "kinglike_whatsapp_archive_staging" &&
        row.username === "kinglike_wa_archive_notice_webhook" &&
        row.function_signature === CUSTOMER_NOTICE_STATUS_FUNCTION &&
        row.source_function_signature === CUSTOMER_NOTICE_SOURCE_FUNCTION &&
        row.echo_function_signature === CUSTOMER_NOTICE_ECHO_FUNCTION &&
        row.gate_function_signature === CUSTOMER_NOTICE_GATE_FUNCTION &&
        row.migration_005_applied === true &&
        row.writer_can_execute === true &&
        row.source_can_execute === true &&
        row.echo_can_execute === true &&
        row.gate_can_execute === true &&
        row.forbidden_roles_can_execute === false &&
        row.role_limited === true;
      contractVerified = verified;
      return {
        database: String(row.database ?? ""),
        username: String(row.username ?? ""),
        approvedHost: target.host === "ep-long-block-bcu3yyy1-pooler.c-16.us-east-1.aws.neon.tech",
        functionSignature: String(row.function_signature ?? ""),
        writerCanExecute: row.writer_can_execute === true,
        sourceFunctionSignature: String(row.source_function_signature ?? ""),
        sourceCanExecute: row.source_can_execute === true,
        echoFunctionSignature: String(row.echo_function_signature ?? ""),
        echoCanExecute: row.echo_can_execute === true,
        gateFunctionSignature: String(row.gate_function_signature ?? ""),
        gateCanExecute: row.gate_can_execute === true,
        forbiddenRolesCanExecute: row.forbidden_roles_can_execute === true,
        migration005Applied: row.migration_005_applied === true,
        roleLimited: row.role_limited === true,
      };
    },
    async applyStatus(status: CustomerNoticeWebhookStatus, receipt: VerifiedCustomerNoticeSource) {
      if (!contractVerified) throw new Error("Dedicated notice writer contract is not verified.");
      const result = await getPool().query(
        `SELECT staging_whatsapp_archive.apply_customer_notice_webhook_event(
           $1::text, $2::text, $3::bytea, $4::text, $5::text, $6::bigint,
           $7::bigint, $8::text, $9::text, $10::bytea, $11::bytea,
           $12::bytea, $13::timestamptz
         ) AS applied`,
        [
          "kinglike_luxury_staging",
          status.eventId,
          status.payloadFingerprint,
          status.wabaId,
          status.phoneNumberId,
          receipt.assignmentId,
          receipt.noticeEvidenceId,
          status.providerMessageId,
          status.status,
          status.recipientFingerprint,
          receipt.noticeContentFingerprint,
          receipt.sourceReceiptFingerprint,
          status.occurredAt,
        ],
      );
      const outcome = result.rows[0]?.applied;
      if (outcome !== "applied" && outcome !== "duplicate") {
        throw new Error("Notice event transition was not acknowledged.");
      }
      return outcome;
    },
    async findVerifiedNotice(input: Pick<CustomerNoticeWebhookStatus,
      "wabaId" | "phoneNumberId" | "providerMessageId" | "recipientFingerprint">) {
      if (!contractVerified) throw new Error("Dedicated notice source contract is not verified.");
      const result = await getPool().query(
        `SELECT * FROM staging_whatsapp_archive.find_verified_customer_notice_sender_receipt(
          $1::text, $2::text, $3::text, $4::bytea
        )`,
        [
          input.wabaId, input.phoneNumberId, input.providerMessageId,
          input.recipientFingerprint,
        ],
      );
      const row = result.rows[0];
      if (!row) return null;
      const employeeId = Number(row.employee_id);
      const assignmentId = Number(row.assignment_id);
      const noticeEvidenceId = Number(row.notice_evidence_id);
      const policyVersion = String(row.policy_version ?? "");
      const sentAt = new Date(String(row.sent_at));
      if (!Number.isSafeInteger(employeeId) || employeeId < 1 ||
          !Number.isSafeInteger(assignmentId) || assignmentId < 1 ||
          !Number.isSafeInteger(noticeEvidenceId) || noticeEvidenceId < 1 ||
          !/^[A-Za-z0-9._-]{1,80}$/.test(policyVersion) ||
          !Number.isFinite(sentAt.getTime())) {
        throw new Error("Verified customer notice receipt is invalid.");
      }
      return {
        source: "approved_notice_sender" as const,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        employeeId,
        assignmentId,
        noticeEvidenceId,
        providerMessageId: input.providerMessageId,
        policyVersion,
        approvedCurrentPolicy: true as const,
        activeCompanyWorkNumber: true as const,
        exactNoticeContentWasSent: true as const,
        noticeContentFingerprint: Buffer.from(row.notice_content_fingerprint as Buffer),
        sourceReceiptFingerprint: Buffer.from(row.source_receipt_fingerprint as Buffer),
        recipientFingerprint: Buffer.from(row.recipient_fingerprint as Buffer),
        sentAt,
      };
    },
    async recordNoticeEcho(echo: CustomerNoticeEcho) {
      if (!contractVerified) throw new Error("Dedicated notice source contract is not verified.");
      const result = await getPool().query(
        `SELECT staging_whatsapp_archive.record_customer_notice_sender_receipt_from_signed_echo(
          $1::text, $2::text, $3::text, $4::bytea, $5::bytea, $6::bytea,
          $7::timestamptz, $8::text
        ) AS outcome`,
        [
          echo.wabaId, echo.phoneNumberId, echo.providerMessageId,
          echo.recipientFingerprint, echo.noticeContentFingerprint,
          echo.sourceReceiptFingerprint, echo.sentAt, echo.noticeText,
        ],
      );
      const outcome = result.rows[0]?.outcome;
      if (outcome !== "recorded" && outcome !== "duplicate" &&
          outcome !== "not_applicable") {
        throw new Error("Signed notice echo was not acknowledged.");
      }
      return outcome;
    },
    async hasCurrentNoticeReceipt(input: {
      wabaId: string; phoneNumberId: string; recipientFingerprint: Buffer;
    }) {
      if (!contractVerified) return false;
      const result = await getPool().query(
        `SELECT staging_whatsapp_archive.has_current_customer_notice_receipt(
          $1::text, $2::text, $3::bytea
        ) AS ready`,
        [input.wabaId, input.phoneNumberId, input.recipientFingerprint],
      );
      return result.rows[0]?.ready === true;
    },
    async close() {
      if (pool) await pool.end();
      pool = undefined;
      contractVerified = false;
    },
    target: target as StagingArchiveTarget,
  };
}

const ID = /^[0-9]{1,40}$/;
const STATUS = new Set(["sent", "delivered", "read"]);

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validSignature(rawBody: Buffer, supplied: unknown, secret: string): boolean {
  if (typeof supplied !== "string" || !/^sha256=[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return constantTimeEqual(supplied, expected);
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || !/^[0-9]{1,12}$/.test(value)) return null;
  const result = new Date(Number(value) * 1000);
  return Number.isFinite(result.getTime()) ? result : null;
}

function parseStatusOnlyPayload(
  rawBody: Buffer,
  recipientKey: Buffer,
): CustomerNoticeWebhookStatus | null | "invalid" {
  let payload: any;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch { return "invalid"; }
  if (payload?.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return "invalid";
  if (payload.entry.length !== 1) return "invalid";
  const entry = payload.entry[0];
  if (!Array.isArray(entry?.changes) || entry.changes.length !== 1) return "invalid";
  const change = entry.changes[0];
  if (change?.field !== "messages" || !change.value || typeof change.value !== "object") return "invalid";
  const value = change.value;
  // Mixed inbound messages and status callbacks stay on the ordinary archive
  // processor; this writer only handles one isolated status event at a time.
  if (Array.isArray(value.messages) && value.messages.length > 0) return null;
  if (!Array.isArray(value.statuses) || value.statuses.length === 0) return null;
  if (value.statuses.length !== 1) return "invalid";
  const status = value.statuses[0];
  const wabaId = entry?.id;
  const phoneNumberId = value?.metadata?.phone_number_id;
  const providerMessageId = status?.id;
  const recipientId = status?.recipient_id;
  const occurredAt = parseTimestamp(status?.timestamp);
  if (!ID.test(wabaId ?? "") || !ID.test(phoneNumberId ?? "") ||
      typeof providerMessageId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(providerMessageId) ||
      !ID.test(recipientId ?? "") || !STATUS.has(status?.status) || !occurredAt) return "invalid";
  const recipientFingerprint = fingerprintCustomerNoticeRecipient(recipientId, recipientKey);
  if (!recipientFingerprint) return "invalid";
  const eventId = crypto.createHash("sha256").update([
    "meta-whatsapp-status-v1", wabaId, phoneNumberId, providerMessageId, status.status, occurredAt.toISOString(),
    recipientFingerprint.toString("hex"),
  ].join("\0")).digest("hex");
  return { wabaId, phoneNumberId, providerMessageId, status: status.status,
    recipientFingerprint, payloadFingerprint: crypto.createHash("sha256").update(rawBody).digest(),
    occurredAt, eventId };
}

function parseSignedNoticeEchoes(
  rawBody: Buffer,
  recipientKey: Buffer,
): CustomerNoticeEcho[] | "invalid" {
  let payload: any;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch { return "invalid"; }
  if (payload?.object !== "whatsapp_business_account" ||
      !Array.isArray(payload.entry) || payload.entry.length > 100) return "invalid";
  const echoes: CustomerNoticeEcho[] = [];
  for (const entry of payload.entry) {
    if (!ID.test(entry?.id ?? "") || !Array.isArray(entry?.changes) ||
        entry.changes.length > 100) return "invalid";
    for (const change of entry.changes) {
      if (change?.field !== "smb_message_echoes") continue;
      const value = change?.value;
      const wabaId = entry.id;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!ID.test(phoneNumberId ?? "") || !Array.isArray(value?.message_echoes) ||
          value.message_echoes.length > 100) return "invalid";
      for (const echo of value.message_echoes) {
        if (echo?.type !== "text") continue;
        const providerMessageId = echo?.id;
        const recipientId = echo?.to_user_id ?? echo?.to;
        const noticeText = echo?.text?.body ??
          echo?.message?.text?.body ??
          echo?.message?.body;
        const sentAt = parseTimestamp(echo?.timestamp);
        if (typeof providerMessageId !== "string" ||
            !/^[A-Za-z0-9_.:-]{1,160}$/.test(providerMessageId) ||
            typeof recipientId !== "string" || !ID.test(recipientId) ||
            typeof noticeText !== "string" || noticeText.length < 8 ||
            noticeText.length > 8192 || !sentAt || sentAt > new Date()) {
          return "invalid";
        }
        const recipientFingerprint = fingerprintCustomerNoticeRecipient(recipientId, recipientKey);
        if (!recipientFingerprint) return "invalid";
        echoes.push({
          wabaId,
          phoneNumberId,
          providerMessageId,
          recipientFingerprint,
          noticeContentFingerprint: crypto.createHash("sha256").update(noticeText, "utf8").digest(),
          sourceReceiptFingerprint: crypto.createHash("sha256").update(rawBody).digest(),
          noticeText,
          sentAt,
        });
      }
    }
  }
  return echoes;
}

export function createCustomerNoticeWebhookStatusWriter(
  dependencies: CustomerNoticeStatusWriterDependencies,
) {
  return {
    async process(rawBody: Buffer, signature: unknown): Promise<CustomerNoticeStatusOutcome> {
      const env = dependencies.env;
      const appSecret = env.META_APP_SECRET;
      if (env.APP_DEPLOYMENT_MODE !== "staging" ||
          !Buffer.isBuffer(rawBody) || rawBody.length === 0 ||
          rawBody.length > 1_048_576 || !appSecret ||
          !validSignature(rawBody, signature, appSecret)) return "blocked";
      const recipientKey = parseCustomerNoticeRecipientHmacKey(
        env.WHATSAPP_ARCHIVE_STAGING_NOTICE_RECIPIENT_HMAC_KEY,
      );
      if (!recipientKey) return "blocked";
      const status = parseStatusOnlyPayload(rawBody, recipientKey);
      if (status === null) return "not_applicable";
      if (status === "invalid") return "blocked";
      const publicBaseUrl = env.WHATSAPP_ARCHIVE_STAGING_PUBLIC_BASE_URL ?? "";
      let publicHttps = false;
      try {
        const url = new URL(publicBaseUrl);
        publicHttps = url.protocol === "https:" && !url.username && !url.password &&
          url.origin === publicBaseUrl;
      } catch { publicHttps = false; }
      const retentionDays = Number(env.WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_DAYS);
      if (
        env.WHATSAPP_ARCHIVE_STAGING_APPROVED !== "true" ||
        env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_APPROVED !== "true" ||
        env.WHATSAPP_ARCHIVE_STAGING_NOTICE_SOURCE_APPROVED !== "true" ||
        env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_ROLE_READONLY_VERIFIED !== "true" ||
        env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_SCHEMA_READONLY_VERIFIED !== "true" ||
        env.WHATSAPP_ARCHIVE_STAGING_PUBLIC_HTTPS_READONLY_VERIFIED !== "true" ||
        env.WHATSAPP_ARCHIVE_STAGING_FUNCTION_GRANTS_READONLY_VERIFIED !== "true" ||
        env.WHATSAPP_COEXISTENCE_STAGING_IDENTITY_STORE_READONLY_VERIFIED !== "true" ||
        env.WHATSAPP_ARCHIVE_STAGING_WEBHOOK_APPROVED !== "true" || !publicHttps ||
        !env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_DATABASE_URL?.trim() ||
        env.WHATSAPP_COEXISTENCE_STAGING_ENABLED !== "true" ||
        env.WHATSAPP_COEXISTENCE_STAGING_APPROVED !== "true" ||
        env.WHATSAPP_EMPLOYEE_ARCHIVE_ENABLED !== "true" ||
        env.WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED !== "true" ||
        env.WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED !== "true" ||
        parseArchiveEncryptionKey(env.WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY) === null ||
        !Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650 ||
        !env.WHATSAPP_MONITOR_META_APP_ID || !env.WHATSAPP_MONITOR_META_CONFIG_ID ||
        !env.WHATSAPP_ARCHIVE_WEBHOOK_VERIFY_TOKEN ||
        !dependencies.source || !dependencies.databaseContract ||
        !dependencies.applyStatus
      ) return "blocked";
      const retentionStart = Date.now() - retentionDays * 86_400_000;
      if (status.occurredAt.getTime() < retentionStart || status.occurredAt.getTime() > Date.now()) {
        return "blocked";
      }

      let contract: Awaited<ReturnType<NonNullable<typeof dependencies.databaseContract>["verify"]>>;
      try { contract = await dependencies.databaseContract.verify(); } catch { return "blocked"; }
      if (
        contract.database !== "kinglike_whatsapp_archive_staging" ||
        contract.username !== "kinglike_wa_archive_notice_webhook" ||
        contract.approvedHost !== true ||
        contract.functionSignature !== CUSTOMER_NOTICE_STATUS_FUNCTION ||
        contract.sourceFunctionSignature !== CUSTOMER_NOTICE_SOURCE_FUNCTION ||
        contract.echoFunctionSignature !== CUSTOMER_NOTICE_ECHO_FUNCTION ||
        contract.gateFunctionSignature !== CUSTOMER_NOTICE_GATE_FUNCTION ||
        contract.writerCanExecute !== true ||
        contract.sourceCanExecute !== true ||
        contract.echoCanExecute !== true ||
        contract.gateCanExecute !== true ||
        contract.forbiddenRolesCanExecute !== false ||
        contract.migration005Applied !== true ||
        contract.roleLimited !== true
      ) return "blocked";

      let receipt: VerifiedCustomerNoticeSource | null;
      try {
        receipt = await dependencies.source.findVerifiedNotice(status);
      } catch { return "blocked"; }
      if (!receipt) return "not_applicable";
      if (
        receipt.source !== "approved_notice_sender" ||
        receipt.wabaId !== status.wabaId ||
        receipt.phoneNumberId !== status.phoneNumberId ||
        receipt.providerMessageId !== status.providerMessageId ||
        !Number.isSafeInteger(receipt.employeeId) || receipt.employeeId < 1 ||
        !Number.isSafeInteger(receipt.assignmentId) || receipt.assignmentId < 1 ||
        !Number.isSafeInteger(receipt.noticeEvidenceId) || receipt.noticeEvidenceId < 1 ||
        !/^[A-Za-z0-9._-]{1,80}$/.test(receipt.policyVersion) ||
        receipt.approvedCurrentPolicy !== true ||
        receipt.activeCompanyWorkNumber !== true ||
        receipt.exactNoticeContentWasSent !== true ||
        !Buffer.isBuffer(receipt.noticeContentFingerprint) ||
        receipt.noticeContentFingerprint.length !== 32 ||
        !Buffer.isBuffer(receipt.sourceReceiptFingerprint) ||
        receipt.sourceReceiptFingerprint.length !== 32 ||
        !Buffer.isBuffer(receipt.recipientFingerprint) ||
        receipt.recipientFingerprint.length !== 32 ||
        !crypto.timingSafeEqual(receipt.recipientFingerprint, status.recipientFingerprint) ||
        !(receipt.sentAt instanceof Date) || receipt.sentAt > status.occurredAt
      ) return "blocked";

      try {
        return await dependencies.applyStatus!(status, receipt);
      } catch { return "blocked"; }
    },
    async processSignedNoticeEcho(rawBody: Buffer, signature: unknown):
      Promise<"recorded" | "duplicate" | "not_applicable" | "blocked"> {
      const env = dependencies.env;
      const appSecret = env.META_APP_SECRET;
      if (env.APP_DEPLOYMENT_MODE !== "staging" ||
          !Buffer.isBuffer(rawBody) || rawBody.length === 0 ||
          rawBody.length > 1_048_576 || !appSecret ||
          !validSignature(rawBody, signature, appSecret)) return "blocked";
      const requiredEnv = [
        "WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_APPROVED",
        "WHATSAPP_ARCHIVE_STAGING_NOTICE_SOURCE_APPROVED",
        "WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_ROLE_READONLY_VERIFIED",
        "WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_SCHEMA_READONLY_VERIFIED",
        "WHATSAPP_ARCHIVE_STAGING_PUBLIC_HTTPS_READONLY_VERIFIED",
        "WHATSAPP_ARCHIVE_STAGING_FUNCTION_GRANTS_READONLY_VERIFIED",
        "WHATSAPP_ARCHIVE_STAGING_WEBHOOK_APPROVED",
        "WHATSAPP_COEXISTENCE_STAGING_ENABLED",
        "WHATSAPP_COEXISTENCE_STAGING_APPROVED",
      ];
      if (requiredEnv.some((key) => env[key] !== "true") ||
          !env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_DATABASE_URL?.trim() ||
          !parseCustomerNoticeRecipientHmacKey(
            env.WHATSAPP_ARCHIVE_STAGING_NOTICE_RECIPIENT_HMAC_KEY,
          ) ||
          !env.WHATSAPP_ARCHIVE_WEBHOOK_VERIFY_TOKEN ||
          !env.WHATSAPP_MONITOR_META_APP_ID || !env.WHATSAPP_MONITOR_META_CONFIG_ID ||
          !dependencies.source || !dependencies.databaseContract ||
          !dependencies.recordNoticeEcho) return "blocked";

      const recipientKey = parseCustomerNoticeRecipientHmacKey(
        env.WHATSAPP_ARCHIVE_STAGING_NOTICE_RECIPIENT_HMAC_KEY,
      );
      if (!recipientKey) return "blocked";
      const echoes = parseSignedNoticeEchoes(rawBody, recipientKey);
      if (echoes === "invalid") return "not_applicable";
      if (!echoes.length) return "not_applicable";

      let contract: Awaited<ReturnType<NonNullable<typeof dependencies.databaseContract>["verify"]>>;
      try { contract = await dependencies.databaseContract.verify(); } catch { return "blocked"; }
      if (
        contract.database !== "kinglike_whatsapp_archive_staging" ||
        contract.username !== "kinglike_wa_archive_notice_webhook" ||
        contract.approvedHost !== true ||
        contract.functionSignature !== CUSTOMER_NOTICE_STATUS_FUNCTION ||
        contract.sourceFunctionSignature !== CUSTOMER_NOTICE_SOURCE_FUNCTION ||
        contract.echoFunctionSignature !== CUSTOMER_NOTICE_ECHO_FUNCTION ||
        contract.gateFunctionSignature !== CUSTOMER_NOTICE_GATE_FUNCTION ||
        contract.writerCanExecute !== true ||
        contract.sourceCanExecute !== true ||
        contract.echoCanExecute !== true ||
        contract.gateCanExecute !== true ||
        contract.forbiddenRolesCanExecute !== false ||
        contract.migration005Applied !== true ||
        contract.roleLimited !== true
      ) return "blocked";

      let recorded = false;
      let duplicate = false;
      try {
        for (const echo of echoes) {
          const outcome = await dependencies.recordNoticeEcho(echo);
          if (outcome === "recorded") recorded = true;
          else if (outcome === "duplicate") duplicate = true;
        }
      } catch {
        return "blocked";
      }
      return recorded ? "recorded" : duplicate ? "duplicate" : "not_applicable";
    },
  };
}
