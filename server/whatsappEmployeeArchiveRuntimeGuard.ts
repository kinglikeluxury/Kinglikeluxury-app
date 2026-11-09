/**
 * Fail-closed, read-only preflight for a future employee WhatsApp archive DB.
 * This is NOT a Meta onboarding or message-ingestion capability.
 *
 * No DB connections or environment changes are performed by this module.
 * Never fall back to APP_STAGING_DATABASE_URL / NEON_DATABASE_URL / proof DB.
 * Never expose configured URLs or encryption keys in API responses or logs.
 */
import { stagingDatabaseIsIsolated } from "./stagingExternalGuard";

export type EmployeeArchiveBlocker =
  | "not_staging" | "app_database_not_isolated" | "runtime_disabled"
  | "employee_notice_missing" | "customer_notice_missing"
  | "retention_policy_missing" | "meta_verification_missing"
  | "history_sync_not_ready" | "private_media_not_ready"
  | "dedicated_archive_db_not_configured" | "database_identity_not_isolated"
  | "dedicated_audit_role_missing" | "independent_keys_missing"
  | "archive_schema_or_grants_not_verified";

export type SafeArchiveReadiness = {
  status: "disabled" | "blocked" | "configured_not_verified" | "verified_no_live_numbers";
  blockers: EmployeeArchiveBlocker[];
  checks: {
    isolatedApp: boolean;
    runtimeFlag: boolean;
    employeeNotice: boolean;
    customerNotice: boolean;
    retentionPolicy: boolean;
    metaVerification: boolean;
    historyImport: boolean;
    privateMedia: boolean;
    archiveDbIdentity: boolean;
    separateAuditRole: boolean;
    independentCryptoKeys: boolean;
    databaseGrants: boolean;
  };
  liveNumbers: "not_verified";
  webhookActive: false;
};

export type EmployeeArchivePrivateConfig = Readonly<{
  connectionString: string;
  auditConnectionString: string;
  expectedHost: string;
  expectedDatabase: string;
  encryptionKey: Buffer;
  dedupeKey: Buffer;
}>;

type Identity = { host: string; database: string; username: string; password: string };

function dbIdentity(raw: string | undefined): Identity | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return null;
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, "")).toLowerCase();
    if (!database || !url.hostname || !url.username || !url.password ||
        url.searchParams.has("options") || url.hash) return null;
    return {
      host: url.hostname.toLowerCase(),
      database,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch { return null; }
}

function canonical32ByteKey(value: string | undefined): Buffer | null {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const result = Buffer.from(value, "base64");
  if (result.length !== 32 || result.toString("base64") !== value ||
      result.equals(Buffer.alloc(32))) return null;
  return result;
}

function claimed(env: NodeJS.ProcessEnv, name: string): boolean {
  return env[name] === "true";
}

export function inspectEmployeeArchiveReadiness(
  env: NodeJS.ProcessEnv = process.env,
): { public: SafeArchiveReadiness; privateConfig: EmployeeArchivePrivateConfig | null } {
  const checks: SafeArchiveReadiness["checks"] = {
    isolatedApp: env.APP_DEPLOYMENT_MODE === "staging" && stagingDatabaseIsIsolated(env),
    runtimeFlag: claimed(env, "WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED"),
    employeeNotice: claimed(env, "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED"),
    customerNotice: claimed(env, "WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED"),
    retentionPolicy: claimed(env, "WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED"),
    metaVerification: claimed(env, "WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED"),
    historyImport: claimed(env, "WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY"),
    privateMedia: claimed(env, "WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY"),
    archiveDbIdentity: false,
    separateAuditRole: false,
    independentCryptoKeys: false,
    databaseGrants: false,
  };

  const archive = dbIdentity(env.WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL);
  const audit = dbIdentity(env.WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL);
  const app = dbIdentity(env.APP_STAGING_DATABASE_URL);
  const neon = dbIdentity(env.NEON_DATABASE_URL);
  const proof = dbIdentity(env.WHATSAPP_STAGING_PROOF_DATABASE_URL);
  const expectedHost = env.WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST?.trim().toLowerCase() ?? "";
  const expectedDatabase = env.WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME?.trim().toLowerCase() ?? "";

  checks.archiveDbIdentity = !!(
    archive && audit && app && expectedHost.endsWith(".railway.internal") &&
    archive.host === expectedHost && archive.database === expectedDatabase &&
    archive.host !== app.host && archive.database !== app.database &&
    (!neon || (archive.host !== neon.host && archive.database !== neon.database)) &&
    (!proof || (archive.host !== proof.host && archive.database !== proof.database)) &&
    archive.host !== env.PRODUCTION_DATABASE_HOST?.toLowerCase() &&
    archive.database !== env.PRODUCTION_DATABASE_NAME?.toLowerCase() &&
    archive.database !== "neondb" &&
    archive.username !== "postgres"
  );
  checks.separateAuditRole = !!(
    checks.archiveDbIdentity && archive && audit && audit.host === archive.host &&
    audit.database === archive.database && audit.username !== archive.username &&
    audit.username !== "postgres"
  );
  const encryptionKey = canonical32ByteKey(env.WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64);
  const dedupeKey = canonical32ByteKey(env.WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64);
  checks.independentCryptoKeys = !!(
    encryptionKey && dedupeKey && !encryptionKey.equals(dedupeKey)
  );

  const blockers: EmployeeArchiveBlocker[] = [];
  const missing: Array<[boolean, EmployeeArchiveBlocker]> = [
    [env.APP_DEPLOYMENT_MODE === "staging", "not_staging"],
    [checks.isolatedApp, "app_database_not_isolated"],
    [checks.runtimeFlag, "runtime_disabled"],
    [checks.employeeNotice, "employee_notice_missing"],
    [checks.customerNotice, "customer_notice_missing"],
    [checks.retentionPolicy, "retention_policy_missing"],
    [checks.metaVerification, "meta_verification_missing"],
    [checks.historyImport, "history_sync_not_ready"],
    [checks.privateMedia, "private_media_not_ready"],
    [!!archive && !!audit, "dedicated_archive_db_not_configured"],
    [checks.archiveDbIdentity, "database_identity_not_isolated"],
    [checks.separateAuditRole, "dedicated_audit_role_missing"],
    [checks.independentCryptoKeys, "independent_keys_missing"],
  ];
  for (const [ok, blocker] of missing) if (!ok) blockers.push(blocker);
  // A successful configuration is still not permission to activate:
  // required DB grants are only marked verified by the separate DB preflight.
  if (!checks.databaseGrants) blockers.push("archive_schema_or_grants_not_verified");
  const status = env.APP_DEPLOYMENT_MODE !== "staging" || !checks.runtimeFlag
    ? "disabled"
    : blockers.length ? "blocked" : "configured_not_verified";

  const publicSummary: SafeArchiveReadiness = {
    status, blockers, checks,
    liveNumbers: "not_verified", webhookActive: false,
  };
  const privateConfig: EmployeeArchivePrivateConfig | null =
    checks.isolatedApp && checks.runtimeFlag && checks.archiveDbIdentity &&
    checks.separateAuditRole && checks.independentCryptoKeys && archive && audit &&
    encryptionKey && dedupeKey
      ? { connectionString: env.WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL!,
          auditConnectionString: env.WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL!,
          expectedHost, expectedDatabase, encryptionKey, dedupeKey }
      : null;
  return { public: publicSummary, privateConfig };
}

/** A READ-ONLY privilege check, called explicitly with a separately supplied DB. */
export async function verifyEmployeeArchiveDatabaseGrants(
  query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>,
  expectedDatabase: string,
): Promise<boolean> {
  try {
    const identity = await query(
      "SELECT current_database() AS database_name, current_user AS runtime_role, " +
      "(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_superuser, " +
      "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) AS db_owner",
    );
    const row = identity.rows[0];
    if (!row || row.database_name !== expectedDatabase ||
        !row.runtime_role || row.runtime_role === row.db_owner ||
        row.runtime_role === "postgres" || row.is_superuser !== false) return false;

    const tables = await query(
      "SELECT to_regclass('kinglike_whatsapp.whatsapp_employee_inbox') IS NOT NULL AS inbox, " +
      "to_regclass('whatsapp_employee_events') IS NOT NULL AS events, " +
      "to_regclass('whatsapp_employee_numbers') IS NOT NULL AS numbers, " +
      "to_regclass('whatsapp_employee_consents') IS NOT NULL AS consents, " +
      "to_regclass('whatsapp_employee_access_audit') IS NOT NULL AS audit",
    );
    if (!Object.values(tables.rows[0] ?? {}).every(value => value === true)) return false;

    const grants = await query(
      "SELECT " +
      "has_schema_privilege(current_user,'kinglike_whatsapp','USAGE') AS schema_use, " +
      "has_schema_privilege(current_user,'kinglike_whatsapp','CREATE') AS schema_create, " +
      "has_table_privilege(current_user,'kinglike_whatsapp.whatsapp_employee_inbox','SELECT') AS inbox_read, " +
      "has_table_privilege(current_user,'kinglike_whatsapp.whatsapp_employee_inbox','INSERT') AS inbox_insert, " +
      "has_table_privilege(current_user,'kinglike_whatsapp.whatsapp_employee_inbox','UPDATE') AS inbox_update, " +
      "has_table_privilege(current_user,'kinglike_whatsapp.whatsapp_employee_inbox','DELETE') AS inbox_delete, " +
      "has_table_privilege(current_user,'kinglike_whatsapp.whatsapp_employee_inbox','TRUNCATE') AS inbox_truncate, " +
      "has_table_privilege(current_user,'whatsapp_employee_events','SELECT') AS events_read, " +
      "has_table_privilege(current_user,'whatsapp_employee_events','INSERT') AS events_insert, " +
      "has_table_privilege(current_user,'whatsapp_employee_events','UPDATE') AS events_update, " +
      "has_table_privilege(current_user,'whatsapp_employee_events','DELETE') AS events_delete, " +
      "has_table_privilege(current_user,'whatsapp_employee_events','TRUNCATE') AS events_truncate, " +
      "has_table_privilege(current_user,'whatsapp_employee_access_audit','DELETE') AS audit_delete",
    );
    const p = grants.rows[0] ?? {};
    const positives = ["schema_use","inbox_read","inbox_insert","inbox_update",
      "events_read","events_insert"];
    const negatives = ["schema_create","inbox_delete","inbox_truncate",
      "events_update","events_delete","events_truncate","audit_delete"];
    return positives.every(key => p[key] === true) &&
      negatives.every(key => p[key] === false);
  } catch {
    // Never log host, secrets, SQL error or identity details.
    return false;
  }
}
