import type { Express, Request } from "express";
import pg from "pg";
import { identitySyncRuntimeConfig } from "./whatsappEmployeeIdentitySyncRuntime";
import { inspectEmployeeArchiveReadiness, verifyEmployeeArchiveDatabaseGrants, verifyEmployeeArchiveAuditRole } from "./whatsappEmployeeArchiveRuntimeGuard";
import type { ProofDbClient } from "./whatsappStagingProofDb";
import { metaTestWebhookConfig } from "./metaTestWebhook";
import { isStagingMode, stagingDatabaseIsIsolated } from "./stagingExternalGuard";
import { verifyLiveArchiveReader } from "./whatsappEmployeeArchiveLiveRoutes";

/** Credential-only smoke test. Never authorizes live archive runtime or reads message data. */
export function stagingArchiveCredentialProbeConfig(env: NodeJS.ProcessEnv):
  { readerUrl: string; auditUrl: string; database: string } | null {
  if (env.APP_DEPLOYMENT_MODE !== "staging" || !stagingDatabaseIsIsolated(env)) return null;
  const host = env.WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST?.trim().toLowerCase();
  const database = env.WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME?.trim().toLowerCase();
  if (!host?.endsWith(".railway.internal") || database !== "kinglike_whatsapp_archive") return null;
  const rawReader = env.WHATSAPP_EMPLOYEE_ARCHIVE_READER_DATABASE_URL;
  const rawAudit = env.WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL;
  if (!rawReader || !rawAudit || rawReader === rawAudit) return null;
  function safeUrl(raw: string, user: string): URL | null {
    try {
      const url = new URL(raw);
      if (!["postgresql:", "postgres:"].includes(url.protocol) ||
          url.hostname.toLowerCase() !== host ||
          decodeURIComponent(url.pathname.replace(/^\\/+/, "")).toLowerCase() !== database ||
          decodeURIComponent(url.username) !== user || !url.password || url.hash ||
          url.search || (url.port && url.port !== "5432")) return null;
      return url;
    } catch { return null; }
  }
  const reader = safeUrl(rawReader, "kinglike_wa_archive_reader");
  const audit = safeUrl(rawAudit, "kinglike_wa_archive_auditwriter");
  if (!reader || !audit || reader.password === audit.password) return null;
  for (const raw of [env.APP_STAGING_DATABASE_URL, env.NEON_DATABASE_URL,
                     env.WHATSAPP_STAGING_PROOF_DATABASE_URL]) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.hostname.toLowerCase() === host ||
          decodeURIComponent(url.pathname.replace(/^\\/+/, "")).toLowerCase() === database)
        return null;
    } catch { return null; }
  }
  if (host === env.PRODUCTION_DATABASE_HOST?.trim().toLowerCase() ||
      database === env.PRODUCTION_DATABASE_NAME?.trim().toLowerCase()) return null;
  return {readerUrl:rawReader, auditUrl:rawAudit, database};
}

export type WhatsappOperationsReadiness = {
  environment: "isolated_staging";
  checkedAt: string;
  proofDatabase: "verified" | "unavailable";
  proofRows: { flows: number; proofs: number } | null;
  testWebhook: "configured" | "not_configured";
  realEnrollment: "disabled" | "awaiting_separate_review";
  employeeMonitoring: "disabled";
  identitySyncRuntime: "disabled" | "configured_not_running";
  // Code exists, but there is no pool, role LOGIN, Meta receipt or importer job.
  historyImporter: "code_ready_not_running";
  historyCompleteness: "not_verified";
  employeeNumbersConnected: "not_verified";
  previousSyntheticResults: "see_ci_logs";
  nextStep: "meta_eligibility_and_privacy_review";
};

/**
 * Admin-only read-only status. No employee phone, customer content, Meta tokens,
 * secrets, or raw SQL errors are returned. This is never a live monitoring API.
 */
export function registerWhatsappOperationsStatusRoutes(
  app: Express,
  deps: {
    proofDb: ProofDbClient | null;
    authorizeAdmin: (req: Request) => Promise<number | null>;
    env?: NodeJS.ProcessEnv;
  },
): void {
  const env = deps.env ?? process.env;
  // Explicit admin-only, staging-only, SELECT-only credential probe.
  // Works independently of consent/Meta/runtime flags; it never enables those.
  app.get("/api/admin/staging/whatsapp-archive-credential-probe", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    if (!isStagingMode(env)) return res.sendStatus(404);
    let actorId: number | null;
    try { actorId = await deps.authorizeAdmin(req); }
    catch { return res.sendStatus(503); }
    if (!Number.isSafeInteger(actorId) || !actorId || actorId <= 0) return res.sendStatus(403);
    const config = stagingArchiveCredentialProbeConfig(env);
    if (!config) return res.status(200).json({
      environment:"isolated_staging",status:"configuration_blocked",
      reader:"not_tested",audit:"not_tested",liveArchive:"disabled",
    });
    const reader = new pg.Pool({connectionString:config.readerUrl,max:1,
      connectionTimeoutMillis:1800,idleTimeoutMillis:1000,ssl:false});
    const audit = new pg.Pool({connectionString:config.auditUrl,max:1,
      connectionTimeoutMillis:1800,idleTimeoutMillis:1000,ssl:false});
    let readerOk = false;
    let auditOk = false;
    try {
      readerOk = await verifyLiveArchiveReader(sql=>reader.query(sql),config.database);
      if (readerOk) auditOk = await verifyEmployeeArchiveAuditRole(
        sql=>audit.query(sql),config.database);
    } catch {
      // No DB errors, server names or connection details in response.
    } finally {
      await Promise.allSettled([reader.end(),audit.end()]);
    }
    return res.status(200).json({
      environment:"isolated_staging",
      status:readerOk && auditOk ? "passed" : "failed",
      reader:readerOk ? "passed" : "failed",
      audit:auditOk ? "passed" : readerOk ? "failed" : "not_tested",
      liveArchive:"disabled",
    });
  });

  /**
   * Separate, admin-only, read-only archive readiness inspection.
   * Never connect to a DB unless explicit Staging configuration passes ALL
   * isolation, privacy, history/media readiness, and key-policy gates.
   * Does NOT activate webhooks, enroll employees or enable message archiving.
   */
  app.get("/api/admin/staging/whatsapp-archive-readiness", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    if (!isStagingMode(env)) return res.sendStatus(404);
    let actorId: number | null = null;
    try { actorId = await deps.authorizeAdmin(req); }
    catch { return res.sendStatus(503); }
    if (!Number.isSafeInteger(actorId) || !actorId || actorId <= 0) return res.sendStatus(403);

    const assessment = inspectEmployeeArchiveReadiness(env);
    const status = assessment.public;
    let databaseProbe: "not_run" | "passed" | "failed" = "not_run";
    const config = assessment.privateConfig;
    const priorBlockers = status.blockers.filter(
      blocker => blocker !== "archive_schema_or_grants_not_verified"
    );
    if (config && priorBlockers.length === 0) {
      // Explicitly verified private Railway host; no fallback to Neon/app DB.
      const archivePool = new pg.Pool({
        connectionString: config.connectionString,
        max: 1, connectionTimeoutMillis: 1800, idleTimeoutMillis: 3000,
        ssl: false,
      });
      const auditPool = new pg.Pool({
        connectionString: config.auditConnectionString,
        max: 1, connectionTimeoutMillis: 1800, idleTimeoutMillis: 3000,
        ssl: false,
      });
      try {
        const archiveOK = await verifyEmployeeArchiveDatabaseGrants(
          sql => archivePool.query(sql), config.expectedDatabase);
        const auditOK = archiveOK && await verifyEmployeeArchiveAuditRole(
          sql => auditPool.query(sql), config.expectedDatabase);
        databaseProbe = archiveOK && auditOK ? "passed" : "failed";
        if (databaseProbe === "passed") {
          status.checks.databaseGrants = true;
          status.blockers = priorBlockers;
          status.status = "verified_no_live_numbers";
        }
      } catch {
        databaseProbe = "failed";
      } finally {
        await Promise.allSettled([archivePool.end(),auditPool.end()]);
      }
    }

    return res.status(200).json({
      environment:"isolated_staging",
      checkedAt:new Date().toISOString(),
      ...status,
      databaseProbe,
      // This response is configuration/privilege evidence only.
      // Never interpret it as confirmed live Coexistence availability.
      liveConnection:"not_connected",
    });
  });

  app.get("/api/admin/staging/whatsapp-operations-status", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    if (!isStagingMode(env)) return res.sendStatus(404);
    let actorId: number | null;
    try {
      actorId = await deps.authorizeAdmin(req);
    } catch {
      return res.sendStatus(503);
    }
    if (!Number.isSafeInteger(actorId) || !actorId || actorId <= 0) {
      return res.sendStatus(403);
    }

    let proofRows: { flows: number; proofs: number } | null = null;
    if (deps.proofDb) {
      try {
        const data = await deps.proofDb.query(
          "SELECT (SELECT COUNT(*) FROM kinglike_whatsapp.whatsapp_onboarding_flows) AS flows, " +
          "(SELECT COUNT(*) FROM kinglike_whatsapp.whatsapp_onboarding_proofs) AS proofs",
        );
        const flows = Number(data.rows[0]?.flows);
        const proofs = Number(data.rows[0]?.proofs);
        if (!Number.isSafeInteger(flows) || flows < 0 ||
            !Number.isSafeInteger(proofs) || proofs < 0) throw Error("Bad count");
        proofRows = { flows, proofs };
      } catch {
        // Report unknown, never fall back to application database.
      }
    }

    const result: WhatsappOperationsReadiness = {
      environment: "isolated_staging",
      checkedAt: new Date().toISOString(),
      proofDatabase: proofRows ? "verified" : "unavailable",
      proofRows,
      testWebhook: metaTestWebhookConfig(env) ? "configured" : "not_configured",
      // These values intentionally cannot imply that a real company number
      // was linked or that any conversation can be accessed.
      realEnrollment: env.WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED === "true"
        ? "awaiting_separate_review" : "disabled",
      employeeMonitoring: "disabled",
      // A private config alone never starts a worker or verifies consent.
      identitySyncRuntime: identitySyncRuntimeConfig(env)
        ? "configured_not_running" : "disabled",
      historyImporter: "code_ready_not_running",
      historyCompleteness: "not_verified",
      employeeNumbersConnected: "not_verified",
      previousSyntheticResults: "see_ci_logs",
      nextStep: "meta_eligibility_and_privacy_review",
    };
    return res.status(200).json(result);
  });
}
