import type { NextFunction, Request, Response } from "express";

export type ExternalGateway = "whatsapp" | "meta" | "twilio" | "notifications";
export const STAGING_INTEGRATION_BLOCKED = "STAGING_EXTERNAL_INTEGRATION_DISABLED";
export const STAGING_DATABASE_NOT_VERIFIED = "STAGING_DATABASE_ISOLATION_NOT_VERIFIED";

export function isStagingMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_DEPLOYMENT_MODE === "staging";
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
    const activeDatabaseUrl = env.NODE_ENV === "test" ? env.KAY_TEST_DATABASE_URL : env.NEON_DATABASE_URL;
    const databaseUrl = new URL(activeDatabaseUrl ?? "");
    const host = databaseUrl.hostname.toLowerCase();
    const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, "")).toLowerCase();
    const stagingHost = env.STAGING_DATABASE_HOST?.toLowerCase();
    const stagingName = env.STAGING_DATABASE_NAME?.toLowerCase();
    const productionHost = env.PRODUCTION_DATABASE_HOST?.toLowerCase();
    const productionName = env.PRODUCTION_DATABASE_NAME?.toLowerCase();
    if (!stagingHost || !stagingName || !productionHost || !productionName) return false;
    if (host.endsWith(".neon.tech") || host === "neon.tech") return false;
    return host === stagingHost && databaseName === stagingName &&
      host !== productionHost && databaseName !== productionName;
  } catch {
    return false;
  }
}

export function assertStagingDatabaseIsolation(env: NodeJS.ProcessEnv = process.env): void {
  if (isStagingMode(env) && !stagingDatabaseIsIsolated(env)) {
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
