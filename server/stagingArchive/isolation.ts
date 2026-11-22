import { STAGING_AUTH_HOST } from "../stagingAuth/isolation";
import { parseArchiveEncryptionKey } from "../whatsappEmployeeArchiveSafety";

const ARCHIVE_DATABASE = "kinglike_whatsapp_archive_staging";
const ARCHIVE_ENDPOINT_ROOT = "ep-long-block-bcu3yyy1";
const ARCHIVE_ENDPOINT_SUFFIX = ".c-16.us-east-1.aws.neon.tech";
export const ARCHIVE_PROJECT_ID = "dark-poetry-16181200";
export const ARCHIVE_BRANCH_ID = "br-red-glitter-bc8mf9xr";
export const ARCHIVE_BRANCH_NAME = "production";
const ARCHIVE_RUNTIME_HOST = `${ARCHIVE_ENDPOINT_ROOT}-pooler${ARCHIVE_ENDPOINT_SUFFIX}`;
const ARCHIVE_MIGRATION_HOST = `${ARCHIVE_ENDPOINT_ROOT}${ARCHIVE_ENDPOINT_SUFFIX}`;
function isApprovedSignupServiceHost(host: string): boolean {
  return host === ARCHIVE_MIGRATION_HOST || host === ARCHIVE_RUNTIME_HOST;
}
const ARCHIVE_RUNTIME_ROLE = "kinglike_wa_archive_runtime";
const ARCHIVE_MIGRATION_ROLE = "kinglike_wa_archive_migrator";
const ARCHIVE_OWNER_APPROVER_ROLE = "kinglike_wa_archive_owner_approver";
const ARCHIVE_SIGNUP_WRITER_ROLE = "kinglike_wa_archive_signup_writer";
const ARCHIVE_NOTICE_WEBHOOK_ROLE = "kinglike_wa_archive_notice_webhook";

export type StagingArchiveTarget = Readonly<{
  connectionString: string;
  host: string;
  database: string;
}>;

export function isExactArchiveBranchApproval(env: NodeJS.ProcessEnv): boolean {
  return env.WHATSAPP_ARCHIVE_STAGING_APPROVED_BRANCH_ID === ARCHIVE_BRANCH_ID;
}

export type StagingArchiveReadiness = Readonly<{
  storageSource: "fixture" | "isolated_archive_database_configured" | "unavailable";
  archiveTargetConfigured: boolean;
  archiveDatabaseConnected: false;
  archiveKeyReady: boolean;
  archiveFeatureEnabled: boolean;
  retentionPolicyReady: boolean;
  metaAppReviewApproved: boolean;
  employeeNoticeApproved: boolean;
  signedMessageSourceReady: false;
  connectEnabled: false;
  blockers: string[];
}>;

function databaseIdentity(
  value: string | undefined,
): { host: string; database: string; username: string; passwordPresent: boolean } | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return null;
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const username = decodeURIComponent(url.username);
    if (!url.hostname || !database || !username) return null;
    return {
      host: url.hostname.toLowerCase(),
      database,
      username,
      passwordPresent: Boolean(url.password),
    };
  } catch {
    return null;
  }
}

function getApprovedArchiveTarget(
  env: NodeJS.ProcessEnv,
  connectionString: string | undefined,
  expectedHostVariable: "WHATSAPP_ARCHIVE_STAGING_EXPECTED_HOST" |
    "WHATSAPP_ARCHIVE_STAGING_MIGRATION_EXPECTED_HOST" |
    "WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_EXPECTED_HOST",
  requiredRole: string,
  approvedHost: string,
): StagingArchiveTarget | null {
  if (
    env.APP_DEPLOYMENT_MODE !== "staging" ||
    env.WHATSAPP_ARCHIVE_STAGING_APPROVED !== "true"
  ) return null;

  const expectedHost = env[expectedHostVariable]?.trim().toLowerCase();
  const expectedDatabase = env.WHATSAPP_ARCHIVE_STAGING_EXPECTED_DATABASE?.trim();
  const identity = databaseIdentity(connectionString);
  if (
    !connectionString ||
    !identity ||
    !expectedHost ||
    !expectedDatabase ||
    expectedHost !== approvedHost ||
    identity.host !== expectedHost ||
    identity.database !== ARCHIVE_DATABASE ||
    expectedDatabase !== ARCHIVE_DATABASE ||
    identity.username !== requiredRole ||
    identity.host === STAGING_AUTH_HOST.toLowerCase()
  ) return null;

  for (const key of ["DATABASE_URL", "NEON_DATABASE_URL", "DEV_DATABASE_URL"] as const) {
    const other = databaseIdentity(env[key]);
    if (other && other.host === identity.host && other.database === identity.database) return null;
    if (other && other.host === identity.host) {
      if (other.username === identity.username) return null;
    }
  }

  return {
    connectionString,
    host: identity.host,
    database: identity.database,
  };
}

export function getStagingArchiveTarget(
  env: NodeJS.ProcessEnv,
): StagingArchiveTarget | null {
  return getApprovedArchiveTarget(
    env,
    env.WHATSAPP_ARCHIVE_STAGING_DATABASE_URL,
    "WHATSAPP_ARCHIVE_STAGING_EXPECTED_HOST",
    ARCHIVE_RUNTIME_ROLE,
    ARCHIVE_RUNTIME_HOST,
  );
}

export function getStagingArchiveNoticeWebhookTarget(
  env: NodeJS.ProcessEnv,
): StagingArchiveTarget | null {
  if (
    env.APP_DEPLOYMENT_MODE !== "staging" ||
    env.WHATSAPP_ARCHIVE_STAGING_APPROVED !== "true" ||
    env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_APPROVED !== "true"
  ) return null;
  return getApprovedArchiveTarget(
    env,
    env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_DATABASE_URL,
    "WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_EXPECTED_HOST",
    ARCHIVE_NOTICE_WEBHOOK_ROLE,
    ARCHIVE_RUNTIME_HOST,
  );
}

export function getStagingArchiveOwnerApproverTarget(
  env: NodeJS.ProcessEnv,
): StagingArchiveTarget | null {
  if (
    env.APP_DEPLOYMENT_MODE !== "staging" ||
    env.WHATSAPP_ARCHIVE_STAGING_APPROVED !== "true" ||
    env.WHATSAPP_ARCHIVE_STAGING_OWNER_APPROVAL_APPROVED !== "true"
  ) return null;
  const expectedHost = env.WHATSAPP_ARCHIVE_STAGING_MIGRATION_EXPECTED_HOST?.trim().toLowerCase();
  const expectedDatabase = env.WHATSAPP_ARCHIVE_STAGING_EXPECTED_DATABASE?.trim();
  const ownerUrl = env.WHATSAPP_ARCHIVE_STAGING_OWNER_APPROVER_DATABASE_URL;
  const owner = databaseIdentity(ownerUrl);
  if (
    !ownerUrl || !owner ||
    !expectedHost || expectedHost !== ARCHIVE_MIGRATION_HOST ||
    !isApprovedSignupServiceHost(owner.host) ||
    owner.database !== ARCHIVE_DATABASE ||
    expectedDatabase !== ARCHIVE_DATABASE ||
    owner.username !== ARCHIVE_OWNER_APPROVER_ROLE ||
    !owner.passwordPresent ||
    !isExactArchiveBranchApproval(env)
  ) return null;
  for (const key of ["DATABASE_URL", "NEON_DATABASE_URL", "DEV_DATABASE_URL"] as const) {
    const other = databaseIdentity(env[key]);
    if (other && (other.host === owner.host || other.database === owner.database)) return null;
  }
  return { connectionString: ownerUrl, host: owner.host, database: owner.database };
}

export function getStagingArchiveSignupWriterTarget(
  env: NodeJS.ProcessEnv,
): StagingArchiveTarget | null {
  if (
    env.APP_DEPLOYMENT_MODE !== "staging" ||
    env.WHATSAPP_ARCHIVE_STAGING_APPROVED !== "true" ||
    env.WHATSAPP_ARCHIVE_STAGING_SIGNUP_WRITER_APPROVED !== "true"
  ) return null;
  const expectedHost = env.WHATSAPP_ARCHIVE_STAGING_MIGRATION_EXPECTED_HOST?.trim().toLowerCase();
  const expectedDatabase = env.WHATSAPP_ARCHIVE_STAGING_EXPECTED_DATABASE?.trim();
  const signupUrl = env.WHATSAPP_ARCHIVE_STAGING_SIGNUP_WRITER_DATABASE_URL;
  const signup = databaseIdentity(signupUrl);
  if (
    !signupUrl || !signup ||
    !expectedHost || expectedHost !== ARCHIVE_MIGRATION_HOST ||
    !isApprovedSignupServiceHost(signup.host) ||
    signup.database !== ARCHIVE_DATABASE ||
    expectedDatabase !== ARCHIVE_DATABASE ||
    signup.username !== ARCHIVE_SIGNUP_WRITER_ROLE ||
    !signup.passwordPresent ||
    !isExactArchiveBranchApproval(env)
  ) return null;
  for (const key of ["DATABASE_URL", "NEON_DATABASE_URL", "DEV_DATABASE_URL"] as const) {
    const other = databaseIdentity(env[key]);
    if (other && (other.host === signup.host || other.database === signup.database)) return null;
  }
  return { connectionString: signupUrl, host: signup.host, database: signup.database };
}

export function getStagingArchiveRoleBootstrapTarget(
  env: NodeJS.ProcessEnv,
): StagingArchiveTarget | null {
  if (
    env.APP_DEPLOYMENT_MODE !== "staging" ||
    env.WHATSAPP_ARCHIVE_STAGING_APPROVED !== "true"
  ) return null;
  const expectedHost = env.WHATSAPP_ARCHIVE_STAGING_MIGRATION_EXPECTED_HOST?.trim().toLowerCase();
  const expectedDatabase = env.WHATSAPP_ARCHIVE_STAGING_EXPECTED_DATABASE?.trim();
  const connectionString = env.WHATSAPP_ARCHIVE_STAGING_ADMIN_DATABASE_URL;
  const bootstrap = databaseIdentity(connectionString);
  const runtime = databaseIdentity(env.WHATSAPP_ARCHIVE_STAGING_DATABASE_URL);
  const migrator = databaseIdentity(env.WHATSAPP_ARCHIVE_STAGING_MIGRATION_DATABASE_URL);
  if (
    !connectionString || !bootstrap || !runtime || !migrator ||
    !expectedHost || expectedHost !== ARCHIVE_MIGRATION_HOST ||
    expectedDatabase !== ARCHIVE_DATABASE ||
    bootstrap.host !== ARCHIVE_RUNTIME_HOST ||
    bootstrap.database !== ARCHIVE_DATABASE ||
    bootstrap.username !== "neondb_owner" ||
    runtime.username !== ARCHIVE_RUNTIME_ROLE ||
    migrator.username !== ARCHIVE_MIGRATION_ROLE ||
    runtime.database !== bootstrap.database ||
    migrator.database !== bootstrap.database ||
    runtime.host !== bootstrap.host ||
    migrator.host !== ARCHIVE_MIGRATION_HOST
  ) return null;
  for (const key of ["DATABASE_URL", "NEON_DATABASE_URL", "DEV_DATABASE_URL"] as const) {
    const other = databaseIdentity(env[key]);
    if (other && (other.host === bootstrap.host || other.database === bootstrap.database)) return null;
  }
  return { connectionString, host: bootstrap.host, database: bootstrap.database };
}

function getVerifiedStagingArchiveMigrationTarget(
  env: NodeJS.ProcessEnv,
): StagingArchiveTarget | null {
  const runtimeTarget = getStagingArchiveTarget(env);
  const migrationUrl = env.WHATSAPP_ARCHIVE_STAGING_MIGRATION_DATABASE_URL;
  if (!runtimeTarget || !migrationUrl) return null;
  const migrationTarget = getApprovedArchiveTarget(
    env,
    migrationUrl,
    "WHATSAPP_ARCHIVE_STAGING_MIGRATION_EXPECTED_HOST",
    ARCHIVE_MIGRATION_ROLE,
    ARCHIVE_MIGRATION_HOST,
  );
  if (
    !migrationTarget ||
    migrationTarget.database !== runtimeTarget.database ||
    runtimeTarget.host !== ARCHIVE_RUNTIME_HOST ||
    migrationTarget.host !== ARCHIVE_MIGRATION_HOST ||
    runtimeTarget.host.replace("-pooler", "") !== migrationTarget.host
  ) return null;
  return migrationTarget;
}

export function getStagingArchiveMigrationTarget(
  env: NodeJS.ProcessEnv,
): StagingArchiveTarget | null {
  if (env.WHATSAPP_ARCHIVE_STAGING_MIGRATION_APPROVED !== "true") return null;
  return getVerifiedStagingArchiveMigrationTarget(env);
}

export function requireStagingArchiveReadOnlyDiagnosticTarget(
  env: NodeJS.ProcessEnv,
): StagingArchiveTarget {
  const target = getVerifiedStagingArchiveMigrationTarget(env);
  if (!target) {
    throw new Error("Archive read-only diagnostic target is not approved or does not match its identity.");
  }
  return target;
}

export function getStagingArchiveReadiness(
  env: NodeJS.ProcessEnv,
): StagingArchiveReadiness {
  const target = getStagingArchiveTarget(env);
  const archiveKeyReady = parseArchiveEncryptionKey(
    env.WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY,
  ) !== null;
  const metaAppReviewApproved =
    env.WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED === "true";
  const archiveFeatureEnabled = env.WHATSAPP_EMPLOYEE_ARCHIVE_ENABLED === "true";
  const retentionDays = Number(env.WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_DAYS);
  const retentionPolicyReady =
    /^[1-9]\d*$/.test(env.WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_DAYS || "") &&
    Number.isSafeInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 3650;
  const employeeNoticeApproved =
    env.WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED === "true";
  const fixtureSelected = env.WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE === "fixture";
  const liveRequested = env.WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE === "postgres";
  const blockers: string[] = [];

  if (!target) blockers.push("A separately approved archive staging database is not configured.");
  if (!archiveKeyReady) blockers.push("A dedicated archive encryption key is not configured.");
  if (!archiveFeatureEnabled) blockers.push("Archive staging has not been explicitly enabled.");
  if (!retentionPolicyReady) blockers.push("A bounded archive retention period is not configured.");
  if (!metaAppReviewApproved) blockers.push("Meta test-app review approval is incomplete.");
  if (!employeeNoticeApproved) blockers.push("Employee notice approval is incomplete.");
  blockers.push("A real signed test-message source is not configured.");

  return {
    storageSource: fixtureSelected
      ? "fixture"
      : target && archiveKeyReady && liveRequested
        ? "isolated_archive_database_configured"
        : "unavailable",
    archiveTargetConfigured: Boolean(target),
    archiveDatabaseConnected: false,
    archiveKeyReady,
    archiveFeatureEnabled,
    retentionPolicyReady,
    metaAppReviewApproved,
    employeeNoticeApproved,
    signedMessageSourceReady: false,
    connectEnabled: false,
    blockers,
  };
}

export function requireStagingArchiveTarget(env: NodeJS.ProcessEnv): StagingArchiveTarget {
  const target = getStagingArchiveTarget(env);
  if (!target) {
    throw new Error("Isolated staging archive database is not approved or does not match its identity.");
  }
  if (!parseArchiveEncryptionKey(env.WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY)) {
    throw new Error("Dedicated archive encryption key is not configured.");
  }
  return target;
}

export function requireStagingArchiveMigrationTarget(
  env: NodeJS.ProcessEnv,
): StagingArchiveTarget {
  const target = getStagingArchiveMigrationTarget(env);
  if (!target) {
    throw new Error("Archive migration requires a distinct, verified archive database role.");
  }
  return target;
}
