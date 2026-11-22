type RuntimeEnv = Record<string, string | undefined>;

const isEnabled = (value: string | undefined): boolean => value === "true";

export function isDevelopmentRuntime(env: RuntimeEnv = process.env): boolean {
  const isDeployedProduction =
    env.NODE_ENV === "production" &&
    (
      env.REPLIT_DEPLOYMENT === "1" ||
      env.REPLIT_DEPLOYMENT === "true" ||
      env.RAILWAY_ENVIRONMENT_NAME === "production" ||
      env.RAILWAY_ENVIRONMENT === "production"
    );
  return (
    !isDeployedProduction ||
    Boolean(env.REPLIT_DEV_DOMAIN) ||
    env.REPLIT_DEPLOYMENT === "false" ||
    env.REPLIT_DEPLOYMENT === "0"
  );
}

function sameDatabaseTarget(first: string, second: string): boolean {
  try {
    const a = new URL(first);
    const b = new URL(second);
    return a.hostname === b.hostname && a.pathname === b.pathname;
  } catch {
    return first === second;
  }
}

export function getRuntimeDatabaseUrl(env: RuntimeEnv = process.env): string {
  if (env.NODE_ENV === "test") {
    if (!env.KAY_TEST_DATABASE_URL) {
      throw new Error("KAY_TEST_DATABASE_URL is required for test processes.");
    }
    return env.KAY_TEST_DATABASE_URL;
  }

  if (isDevelopmentRuntime(env)) {
    if (
      !isEnabled(env.DEV_RESOURCE_ISOLATION_CONFIRMED) ||
      !isEnabled(env.DEV_DATABASE_ISOLATION_CONFIRMED) ||
      !env.DEV_DATABASE_URL ||
      (env.NEON_DATABASE_URL &&
        sameDatabaseTarget(env.DEV_DATABASE_URL, env.NEON_DATABASE_URL))
    ) {
      throw new Error(
        "Development database access is blocked. Configure a dedicated DEV_DATABASE_URL and explicitly confirm its isolation."
      );
    }
    return env.DEV_DATABASE_URL;
  }

  if (!env.NEON_DATABASE_URL) {
    throw new Error("NEON_DATABASE_URL is not set.");
  }
  return env.NEON_DATABASE_URL;
}

export function isBackgroundJobAllowed(
  job: string,
  env: RuntimeEnv = process.env
): boolean {
  if (!isDevelopmentRuntime(env)) return true;

  if (
    !isEnabled(env.DEV_RESOURCE_ISOLATION_CONFIRMED) ||
    !isEnabled(env.DEV_DATABASE_ISOLATION_CONFIRMED) ||
    !env.DEV_DATABASE_URL ||
    !isEnabled(env[`DEV_ALLOW_${job}`])
  ) {
    return false;
  }

  // The current Meta client reads shared production account credentials
  // directly. Until a separate development client is implemented, no
  // environment flag may enable this integration outside a deployment.
  if (job === "META_LEAD_PULL_SYNC") {
    return false;
  }
  if (
    [
      "SCHEDULED_NOTIFICATIONS",
      "CRM_TASK_REMINDERS",
      "NURTURING_SCHEDULER",
      "RESUME_PENDING_BROADCASTS",
      "META_LEADS_PROCESSOR",
    ].includes(job) &&
    !isEnabled(env.DEV_NOTIFICATION_SANDBOX_CONFIRMED)
  ) {
    return false;
  }
  if (
    job === "DEVELOPER_REGISTRATION_SCHEDULER" &&
    !isEnabled(env.DEV_DEVELOPER_PORTAL_SANDBOX_CONFIRMED)
  ) {
    return false;
  }
  if (
    job === "WHATSAPP_QUAL_SCHEDULER" &&
    !isEnabled(env.DEV_WHATSAPP_SANDBOX_CONFIRMED)
  ) {
    return false;
  }
  if (
    job === "AUTO_BLOG_TRANSLATION" &&
    !isEnabled(env.DEV_AI_SANDBOX_CONFIRMED)
  ) {
    return false;
  }
  if (
    job === "DAILY_BACKUP" &&
    !isEnabled(env.DEV_BACKUP_SANDBOX_CONFIRMED)
  ) {
    return false;
  }
  return true;
}
