import { parseArchiveEncryptionKey } from "../whatsappEmployeeArchiveSafety";

const ARCHIVE_RUNTIME_ROLE = "kinglike_wa_archive_runtime";
const ARCHIVE_RUNTIME_DATABASE = "kinglike_whatsapp_archive_staging";
const ARCHIVE_RUNTIME_HOST =
  "ep-long-block-bcu3yyy1-pooler.c-16.us-east-1.aws.neon.tech";
const ARCHIVE_BRANCH_ID = "br-red-glitter-bc8mf9xr";

export const STAGING_AUTH_TARGET = Object.freeze({
  projectId: "wandering-truth-48328031",
  branchId: "br-broad-glitter-bcgf43z8",
  databaseId: 694262,
  databaseName: "neondb",
  endpointId: "ep-wild-cloud-bc2mpun2",
  host: "ep-wild-cloud-bc2mpun2-pooler.c-16.us-east-1.aws.neon.tech",
});
export const STAGING_AUTH_HOST = STAGING_AUTH_TARGET.host;
export const STAGING_AUTH_DIRECT_HOST =
  "ep-wild-cloud-bc2mpun2.c-16.us-east-1.aws.neon.tech";
const STAGING_AUTH_ALLOWED_HOSTS = new Set([
  STAGING_AUTH_HOST,
  STAGING_AUTH_DIRECT_HOST,
]);
export function isStagingAuthHost(host: string): boolean {
  return STAGING_AUTH_ALLOWED_HOSTS.has(host);
}
export const STAGING_AUTH_PORT = 5179;

function isForbiddenDatabaseKey(key: string): boolean {
  return key === "DATABASE_URL" || key === "NEON_DATABASE_URL" || key.startsWith("PG");
}

export type StagingAuthCommand =
  | "server"
  | "migrate"
  | "migrate-003"
  | "migrate-meta-binding"
  | "migrate-recovery"
  | "seed"
  | "preflight";
type RuntimeEnvironment = Record<string, string | undefined>;

export function buildStagingAuthChildEnv(
  parent: RuntimeEnvironment,
  command: StagingAuthCommand,
): NodeJS.ProcessEnv {
  if (parent.NODE_ENV !== "development") {
    throw new Error("Staging auth is available only in Development.");
  }
  if (parent.DEV_RESOURCE_ISOLATION_CONFIRMED !== "true") {
    throw new Error("Development resource isolation is not confirmed.");
  }
  if (parent.DEV_DATABASE_ISOLATION_CONFIRMED !== "true") {
    throw new Error("Development database isolation is not confirmed.");
  }

  const rawUrl = parent.DEV_DATABASE_URL;
  if (!rawUrl) throw new Error("DEV_DATABASE_URL is required.");

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("DEV_DATABASE_URL is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== STAGING_AUTH_HOST ||
    decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) !== "neondb"
  ) {
    throw new Error("DEV_DATABASE_URL is not the approved staging endpoint.");
  }

  const child: NodeJS.ProcessEnv = {
    PATH: parent.PATH,
    HOME: parent.HOME,
    NODE_ENV: "development",
    PORT: String(STAGING_AUTH_PORT),
    DEV_DATABASE_URL: rawUrl,
    DEV_RESOURCE_ISOLATION_CONFIRMED: "true",
    DEV_DATABASE_ISOLATION_CONFIRMED: "true",
    STAGING_AUTH_CHILD: "1",
    STAGING_AUTH_COMMAND: command,
    APP_DEPLOYMENT_MODE: "staging",
    WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE:
      parent.WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE || "fixture",
  };
  const archiveSource = child.WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE;
  if (archiveSource !== "fixture" && archiveSource !== "postgres") {
    throw new Error("Unknown WhatsApp archive source.");
  }
  if (
    (command === "preflight" || command === "migrate" || command === "migrate-003" ||
      command === "migrate-meta-binding" || command === "migrate-recovery") &&
    archiveSource !== "fixture"
  ) {
    throw new Error("Staging-auth migrations require the isolated archive fixture.");
  }
  if (archiveSource === "postgres") {
    const archiveUrl = parent.WHATSAPP_ARCHIVE_STAGING_DATABASE_URL;
    const expectedHost = parent.WHATSAPP_ARCHIVE_STAGING_EXPECTED_HOST?.trim().toLowerCase();
    const expectedDatabase = parent.WHATSAPP_ARCHIVE_STAGING_EXPECTED_DATABASE?.trim();
    let archiveIdentity: { host: string; database: string; username: string } | null = null;
    try {
      const parsedArchiveUrl = new URL(archiveUrl || "");
      if (["postgres:", "postgresql:"].includes(parsedArchiveUrl.protocol)) {
        archiveIdentity = {
          host: parsedArchiveUrl.hostname.toLowerCase(),
          database: decodeURIComponent(parsedArchiveUrl.pathname.replace(/^\/+/, "")),
          username: decodeURIComponent(parsedArchiveUrl.username),
        };
      }
    } catch {
      archiveIdentity = null;
    }
    if (
      parent.WHATSAPP_ARCHIVE_STAGING_APPROVED !== "true" ||
      !archiveUrl ||
      !expectedHost ||
      !expectedDatabase ||
      archiveIdentity?.host !== expectedHost ||
      archiveIdentity?.database !== expectedDatabase ||
      archiveIdentity?.host !== ARCHIVE_RUNTIME_HOST ||
      archiveIdentity?.database !== ARCHIVE_RUNTIME_DATABASE ||
      archiveIdentity?.username !== ARCHIVE_RUNTIME_ROLE ||
      parent.WHATSAPP_ARCHIVE_STAGING_APPROVED_BRANCH_ID !== ARCHIVE_BRANCH_ID ||
      archiveIdentity?.host === STAGING_AUTH_HOST.toLowerCase() ||
      !parseArchiveEncryptionKey(parent.WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY)
    ) {
      throw new Error("Requested archive database is not independently approved and keyed.");
    }
    for (const key of ["DATABASE_URL", "NEON_DATABASE_URL", "DEV_DATABASE_URL"] as const) {
      if (!parent[key]) continue;
      try {
        const otherUrl = new URL(parent[key] || "");
        const otherDatabase = decodeURIComponent(otherUrl.pathname.replace(/^\/+/, ""));
        if (
          otherUrl.hostname.toLowerCase() === archiveIdentity.host &&
          (otherDatabase === archiveIdentity.database ||
            otherUrl.username === new URL(archiveUrl).username)
        ) {
          throw new Error("Archive database role and identity must be separate from application databases.");
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Archive database role")) throw error;
      }
    }
    for (const key of [
      "WHATSAPP_ARCHIVE_STAGING_APPROVED",
      "WHATSAPP_ARCHIVE_STAGING_DATABASE_URL",
      "WHATSAPP_ARCHIVE_STAGING_EXPECTED_HOST",
      "WHATSAPP_ARCHIVE_STAGING_EXPECTED_DATABASE",
      "WHATSAPP_ARCHIVE_STAGING_APPROVED_BRANCH_ID",
      "WHATSAPP_EMPLOYEE_ARCHIVE_ENABLED",
      "WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY",
      "WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY_ID",
      "WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED",
      "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED",
      "WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_DAYS",
    ] as const) {
      child[key] = parent[key];
    }
    if (command === "server") {
      if (!parent.WHATSAPP_ARCHIVE_STAGING_RUNTIME_PASSWORD) {
        throw new Error("Dedicated archive runtime credential is not configured.");
      }
      child.WHATSAPP_ARCHIVE_STAGING_RUNTIME_PASSWORD =
        parent.WHATSAPP_ARCHIVE_STAGING_RUNTIME_PASSWORD;
    }
  }
  if (command === "seed") {
    if (!parent.STAGING_ADMIN_PASSWORD) {
      throw new Error("STAGING_ADMIN_PASSWORD is required for the staging seed.");
    }
    child.STAGING_ADMIN_PASSWORD = parent.STAGING_ADMIN_PASSWORD;
  }
  if (command === "migrate-003") {
    child.WHATSAPP_STAGING_AUTH_MIGRATION_PROJECT_ID = STAGING_AUTH_TARGET.projectId;
    child.WHATSAPP_STAGING_AUTH_MIGRATION_BRANCH_ID = STAGING_AUTH_TARGET.branchId;
    child.WHATSAPP_STAGING_AUTH_MIGRATION_DATABASE_ID =
      String(STAGING_AUTH_TARGET.databaseId);
    for (const key of [
      "WHATSAPP_STAGING_AUTH_MIGRATION_DATABASE_URL",
      "WHATSAPP_STAGING_AUTH_003_APPLY_APPROVED",
    ] as const) {
      if (parent[key] !== undefined) child[key] = parent[key];
    }
  }
  if (command === "migrate-meta-binding") {
    child.WHATSAPP_STAGING_AUTH_MIGRATION_PROJECT_ID = STAGING_AUTH_TARGET.projectId;
    child.WHATSAPP_STAGING_AUTH_MIGRATION_BRANCH_ID = STAGING_AUTH_TARGET.branchId;
    child.WHATSAPP_STAGING_AUTH_MIGRATION_DATABASE_ID =
      String(STAGING_AUTH_TARGET.databaseId);
    for (const key of [
      "WHATSAPP_STAGING_AUTH_MIGRATION_DATABASE_URL",
      "WHATSAPP_STAGING_AUTH_004_META_BINDING_APPLY_APPROVED",
    ] as const) {
      if (parent[key] !== undefined) child[key] = parent[key];
    }
  }
  if (command === "migrate-recovery") {
    child.WHATSAPP_STAGING_AUTH_MIGRATION_PROJECT_ID = STAGING_AUTH_TARGET.projectId;
    child.WHATSAPP_STAGING_AUTH_MIGRATION_BRANCH_ID = STAGING_AUTH_TARGET.branchId;
    child.WHATSAPP_STAGING_AUTH_MIGRATION_DATABASE_ID = String(STAGING_AUTH_TARGET.databaseId);
    for (const key of [
      "WHATSAPP_STAGING_AUTH_MIGRATION_DATABASE_URL",
      "WHATSAPP_STAGING_AUTH_RECOVERY_RUNTIME_PASSWORD",
    ] as const) {
      if (parent[key] !== undefined) child[key] = parent[key];
    }
  }
  if (command === "server") {
    for (const key of [
      "WHATSAPP_STAGING_RESEND_API_KEY",
      "WHATSAPP_STAGING_IDENTITY_EMAIL_FROM",
      "WHATSAPP_STAGING_IDENTITY_EMAIL_ALLOWLIST",
      "WHATSAPP_STAGING_IDENTITY_EMAIL_APPROVED",
      "WHATSAPP_STAGING_IDENTITY_PROVISIONING_ENABLED",
      "WHATSAPP_STAGING_OWNER_BOOTSTRAP_APPROVED",
      "WHATSAPP_STAGING_ONBOARDING_DATABASE_URL",
      "WHATSAPP_STAGING_ONBOARDING_ENCRYPTION_KEY",
      "WHATSAPP_STAGING_AUTH_RECOVERY_RUNTIME_PASSWORD",
    ] as const) {
      if (parent[key] !== undefined) child[key] = parent[key];
    }
    // Coexistence credentials and gates are exposed only to this isolated
    // server child. The app, migration, seed, and preflight commands never
    // receive these values. Target checks remain pinned in stagingArchive.
    for (const key of [
      "WHATSAPP_ARCHIVE_STAGING_APPROVED",
      "WHATSAPP_ARCHIVE_STAGING_APPROVED_BRANCH_ID",
      "WHATSAPP_ARCHIVE_STAGING_EXPECTED_DATABASE",
      "WHATSAPP_ARCHIVE_STAGING_MIGRATION_EXPECTED_HOST",
      "WHATSAPP_ARCHIVE_STAGING_SIGNUP_WRITER_DATABASE_URL",
      "WHATSAPP_ARCHIVE_STAGING_SIGNUP_WRITER_APPROVED",
      "WHATSAPP_ARCHIVE_STAGING_OWNER_APPROVER_DATABASE_URL",
      "WHATSAPP_ARCHIVE_STAGING_OWNER_APPROVAL_APPROVED",
      "WHATSAPP_STAGING_META_TOKEN_ENCRYPTION_KEY",
      "WHATSAPP_ARCHIVE_STAGING_PUBLIC_BASE_URL",
      "WHATSAPP_ARCHIVE_STAGING_PUBLIC_HTTPS_READONLY_VERIFIED",
      "WHATSAPP_ARCHIVE_WEBHOOK_VERIFY_TOKEN",
      "WHATSAPP_ARCHIVE_STAGING_WEBHOOK_APPROVED",
      "WHATSAPP_ARCHIVE_STAGING_QUARANTINE_SIGNATURE_READONLY_VERIFIED",
      "WHATSAPP_COEXISTENCE_STAGING_IDENTITY_STORE_READONLY_VERIFIED",
      "WHATSAPP_COEXISTENCE_STAGING_ENABLED",
      "WHATSAPP_COEXISTENCE_STAGING_APPROVED",
      "WHATSAPP_MONITOR_META_APP_ID",
      "WHATSAPP_MONITOR_META_CONFIG_ID",
      "WHATSAPP_MONITOR_META_CONFIG_READONLY_VERIFIED",
      "META_APP_SECRET",
    ] as const) {
      if (parent[key] !== undefined) child[key] = parent[key];
    }
    const previewDomain = parent.REPLIT_DEV_DOMAIN?.trim().toLowerCase();
    if (previewDomain && /^(?:[a-z0-9-]+\.)+replit\.dev$/.test(previewDomain)) {
      child.REPLIT_DEV_DOMAIN = previewDomain;
    }
  }

  if (Object.keys(child).some(isForbiddenDatabaseKey)) {
    throw new Error("A production database variable entered the staging process.");
  }
  return child;
}

export function hasForbiddenDatabaseVariables(
  env: RuntimeEnvironment,
): boolean {
  return Object.keys(env).some(isForbiddenDatabaseKey);
}
