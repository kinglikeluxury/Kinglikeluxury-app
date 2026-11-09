import type { Express, Request } from "express";
import pg from "pg";
import { inspectEmployeeArchiveReadiness, verifyEmployeeArchiveDatabaseGrants, verifyEmployeeArchiveAuditRole } from "./whatsappEmployeeArchiveRuntimeGuard";
import type { ProofDbClient } from "./whatsappStagingProofDb";
import { metaTestWebhookConfig } from "./metaTestWebhook";
import { isStagingMode } from "./stagingExternalGuard";

export type WhatsappOperationsReadiness = {
  environment: "isolated_staging";
  checkedAt: string;
  proofDatabase: "verified" | "unavailable";
  proofRows: { flows: number; proofs: number } | null;
  testWebhook: "configured" | "not_configured";
  realEnrollment: "disabled" | "awaiting_separate_review";
  employeeMonitoring: "disabled";
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
      employeeNumbersConnected: "not_verified",
      previousSyntheticResults: "see_ci_logs",
      nextStep: "meta_eligibility_and_privacy_review",
    };
    return res.status(200).json(result);
  });
}
