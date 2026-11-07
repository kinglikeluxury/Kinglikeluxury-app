import type { NextFunction, Request, Response } from "express";

export type ExternalGateway = "whatsapp" | "meta" | "twilio" | "notifications";
export const STAGING_INTEGRATION_BLOCKED = "STAGING_EXTERNAL_INTEGRATION_DISABLED";
export const STAGING_DATABASE_NOT_VERIFIED = "STAGING_DATABASE_ISOLATION_NOT_VERIFIED";

export function isStagingMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_DEPLOYMENT_MODE === "staging";
}

export function resolveApplicationDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.NODE_ENV === "test") return env.KAY_TEST_DATABASE_URL;
  if (isStagingMode(env)) return env.APP_STAGING_DATABASE_URL;
  return env.NEON_DATABASE_URL;
}

export function assertExternalGatewayAllowed(
  _gateway: ExternalGateway,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isStagingMode(env)) throw new Error(STAGING_INTEGRATION_BLOCKED);
}

export function rejectStagingExternalRequest(res: Response): boolean {
  if (!isStagingMode()) return false;
  res.setHeader("Cache-Control", "no-store");
  res.status(503).json({ error: "External integrations are disabled in Staging", code: STAGING_INTEGRATION_BLOCKED });
  return true;
}

export function backgroundJobsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isStagingMode(env) && env.ENABLE_BACKGROUND_SCHEDULERS === "true";
}

export function stagingDatabaseIsIsolated(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isStagingMode(env)) return true;
  try {
    const activeDatabaseUrl = resolveApplicationDatabaseUrl(env);
    const databaseUrl = new URL(activeDatabaseUrl ?? "");
    const host = databaseUrl.hostname.toLowerCase();
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, "")).toLowerCase();
    const stagingHost = env.APP_STAGING_DATABASE_EXPECTED_HOST?.toLowerCase();
    const stagingName = env.APP_STAGING_DATABASE_EXPECTED_NAME?.toLowerCase();
    const productionHost = env.PRODUCTION_DATABASE_HOST?.toLowerCase();
    const productionName = env.PRODUCTION_DATABASE_NAME?.toLowerCase();
    const confirmation = env.APP_STAGING_DATABASE_CONFIRMATION?.trim();
    const storageConfirmation = env.APP_STAGING_STORAGE_CONFIRMATION?.trim();
    if (!stagingHost || !stagingName || !productionHost || !productionName ||
        !confirmation || !storageConfirmation) return false;
    if (host !== stagingHost || databaseName !== stagingName) return false;
    // A stale production URL must never be accepted as Staging's active URL.
    if (env.NEON_DATABASE_URL) {
      const productionUrl = new URL(env.NEON_DATABASE_URL);
      if (productionUrl.hostname.toLowerCase() === host &&
          decodeURIComponent(productionUrl.pathname.replace(/^\/+/, "")).toLowerCase() === databaseName) return false;
    }
    return host !== productionHost && databaseName !== productionName;
  } catch {
    return false;
  }
}

export function assertStagingDatabaseIsolation(env: NodeJS.ProcessEnv = process.env): void {
  if (isStagingMode(env) && !stagingDatabaseIsIsolated(env)) {
    throw new Error(STAGING_DATABASE_NOT_VERIFIED);
  }
}

export async function verifyStagingDatabaseConnection(
  query: (sql: string) => Promise<{ rows: Array<{ database_name?: string }> }>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  assertStagingDatabaseIsolation(env);
  if (!isStagingMode(env)) return;
  try {
    const result = await query("SELECT current_database() AS database_name");
    const expectedName = env.APP_STAGING_DATABASE_EXPECTED_NAME?.toLowerCase();
    if (!expectedName || result.rows[0]?.database_name?.toLowerCase() !== expectedName) {
      throw new Error(STAGING_DATABASE_NOT_VERIFIED);
    }
  } catch {
    throw new Error(STAGING_DATABASE_NOT_VERIFIED);
  }
}

export function stagingExternalHttpMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isStagingMode()) return next();
  const path = req.path.toLowerCase();
  const blocked =
    path.startsWith("/api/webhooks/whatsapp") ||
    path.startsWith("/api/admin/whatsapp-meta") ||
    path.startsWith("/api/admin/whatsapp-monitor") ||
    path === "/api/admin/whatsapp-test-send" ||
    path === "/api/admin/whatsapp-audit/config" ||
    path.startsWith("/api/admin/whatsapp-employees/numbers/") && path.endsWith("/activate") ||
    path === "/api/auth/send-verification" ||
    path === "/api/auth/send-reset-otp" ||
    path === "/api/admin/twilio-status" ||
    path.startsWith("/api/admin/meta-leads") ||
    path.startsWith("/api/admin/ai-marketing/meta-") ||
    path.startsWith("/api/admin/ai-marketing/meta-intelligence/");
  if (!blocked) return next();
  res.setHeader("Cache-Control", "no-store");
  res.status(503).json({ error: "External integrations are disabled in Staging", code: STAGING_INTEGRATION_BLOCKED });
}
