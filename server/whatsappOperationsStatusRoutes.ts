import type { Express, Request } from "express";
import pg from "pg";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
          decodeURIComponent(url.pathname.slice(1)).toLowerCase() !== database ||
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
          decodeURIComponent(url.pathname.slice(1)).toLowerCase() === database)
        return null;
    } catch { return null; }
  }
  if (host === env.PRODUCTION_DATABASE_HOST?.trim().toLowerCase() ||
      database === env.PRODUCTION_DATABASE_NAME?.trim().toLowerCase()) return null;
  return {readerUrl:rawReader, auditUrl:rawAudit, database};
}

/** Staging-only connection identity; does not start a worker or enable message ingress. */
/**
 * Return only a coarse nonsecret cause for a failed staging worker URL.
 * No URL, hostname, username, password or raw SQL error is returned.
 */
export function stagingArchiveWorkerProbeBlocker(env: NodeJS.ProcessEnv):
  "staging_boundary" | "reader_audit_configuration" | "worker_url_missing" |
  "worker_url_invalid" | "worker_identity_mismatch" | "worker_password_missing" |
  "worker_password_reused" | null {
  if (env.APP_DEPLOYMENT_MODE !== "staging" || !stagingDatabaseIsIsolated(env))
    return "staging_boundary";
  const base = stagingArchiveCredentialProbeConfig(env);
  if (!base) return "reader_audit_configuration";
  const raw = env.WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL;
  if (!raw) return "worker_url_missing";
  try {
    const worker = new URL(raw);
    const reader = new URL(base.readerUrl);
    const audit = new URL(base.auditUrl);
    if (!["postgresql:", "postgres:"].includes(worker.protocol) ||
        !worker.hostname || !worker.username || worker.hash || worker.search ||
        (worker.port && worker.port !== "5432")) return "worker_url_invalid";
    if (worker.hostname.toLowerCase() !== reader.hostname.toLowerCase() ||
        decodeURIComponent(worker.pathname.slice(1)).toLowerCase() !== base.database ||
        decodeURIComponent(worker.username) !== "kinglike_wa_archive_worker")
      return "worker_identity_mismatch";
    if (!worker.password) return "worker_password_missing";
    if (raw === base.readerUrl || raw === base.auditUrl ||
        decodeURIComponent(worker.password) === decodeURIComponent(reader.password) ||
        decodeURIComponent(worker.password) === decodeURIComponent(audit.password))
      return "worker_password_reused";
    return null;
  } catch { return "worker_url_invalid"; }
}

export function stagingArchiveWorkerProbeConfig(env: NodeJS.ProcessEnv):
  { workerUrl: string; database: string } | null {
  const base = stagingArchiveCredentialProbeConfig(env);
  if (!base) return null;
  const raw = env.WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL;
  if (!raw || raw === base.readerUrl || raw === base.auditUrl) return null;
  try {
    const worker = new URL(raw);
    const reader = new URL(base.readerUrl);
    const audit = new URL(base.auditUrl);
    if (!["postgresql:", "postgres:"].includes(worker.protocol) ||
        worker.hostname.toLowerCase() !== reader.hostname.toLowerCase() ||
        decodeURIComponent(worker.pathname.slice(1)).toLowerCase() !== base.database ||
        decodeURIComponent(worker.username) !== "kinglike_wa_archive_worker" ||
        !worker.password || worker.hash || worker.search ||
        (worker.port && worker.port !== "5432") ||
        decodeURIComponent(worker.password) === decodeURIComponent(reader.password) ||
        decodeURIComponent(worker.password) === decodeURIComponent(audit.password))
      return null;
    return {workerUrl:raw,database:base.database};
  } catch { return null; }
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
  /**
   * Admin-only, isolated staging, in-memory encryption self-test. Uses fresh
   * synthetic bytes and the configured secret keys; never reads/writes
   * conversation data, opens a DB connection or starts Meta ingestion.
   */
  app.get("/api/admin/staging/whatsapp-archive-crypto-probe",async(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Pragma","no-cache");
    if (!isStagingMode(env) || !stagingDatabaseIsIsolated(env))
      return res.sendStatus(404);
    let actorId:number|null;
    try { actorId=await deps.authorizeAdmin(req); }
    catch { return res.sendStatus(503); }
    if (!Number.isSafeInteger(actorId) || !actorId || actorId<1)
      return res.sendStatus(403);
    const decode=(value:string|undefined):Buffer|null=>{
      if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value))return null;
      const key=Buffer.from(value,"base64");
      return key.length===32 && key.toString("base64")===value &&
        !key.equals(Buffer.alloc(32)) ? key:null;
    };
    const aes=decode(env.WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64);
    const hmac=decode(env.WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64);
    if (!aes || !hmac || aes.equals(hmac))return res.json({
      environment:"isolated_staging",crypto:"configuration_blocked",
      persistentWrites:0,liveArchive:"disabled",
    });
    let passed=false;
    const plaintext=randomBytes(64),iv=randomBytes(12);
    try {
      const digest=createHmac("sha256",hmac).update(plaintext).digest();
      const cipher=createCipheriv("aes-256-gcm",aes,iv);
      cipher.setAAD(digest);
      const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
      const tag=cipher.getAuthTag();
      const decipher=createDecipheriv("aes-256-gcm",aes,iv);
      decipher.setAAD(digest);
      decipher.setAuthTag(tag);
      const restored=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
      let tamperingRejected=false;
      const tampered=Buffer.from(ciphertext);
      tampered[0]^=1;
      try {
        const corrupted=createDecipheriv("aes-256-gcm",aes,iv);
        corrupted.setAAD(digest);
        corrupted.setAuthTag(tag);
        corrupted.update(tampered);
        corrupted.final();
      } catch { tamperingRejected=true; }
      passed=timingSafeEqual(restored,plaintext) && tamperingRejected;
      restored.fill(0);
      ciphertext.fill(0);
      tampered.fill(0);
      digest.fill(0);
    }catch{passed=false;}
    finally{plaintext.fill(0);iv.fill(0);}
    return res.json({
      environment:"isolated_staging",crypto:passed?"passed":"failed",
      algorithm:"AES-256-GCM",independentMac:"HMAC-SHA256",
      tamperProtection:passed?"passed":"failed",
      persistentWrites:0,liveArchive:"disabled",
    });
  });

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

  // No external Meta calls or database writes. The worker stays dormant.
  app.get("/api/admin/staging/whatsapp-archive-worker-probe", async (req,res) => {
    res.setHeader("Cache-Control","no-store");
    res.setHeader("Pragma","no-cache");
    if (!isStagingMode(env)) return res.sendStatus(404);
    let actorId:number|null;
    try { actorId = await deps.authorizeAdmin(req); }
    catch { return res.sendStatus(503); }
    if (!Number.isSafeInteger(actorId) || !actorId || actorId < 1)
      return res.sendStatus(403);
    const config = stagingArchiveWorkerProbeConfig(env);
    if (!config) return res.status(200).json({
      environment:"isolated_staging",worker:"configuration_blocked",
      blocker:stagingArchiveWorkerProbeBlocker(env),
      liveArchive:"disabled",messagesWritten:0,
    });
    const pool = new pg.Pool({connectionString:config.workerUrl,max:1,
      connectionTimeoutMillis:1800,idleTimeoutMillis:1000,ssl:false});
    let authenticated=false;
    let grantsVerified=false;
    try {
      const identity = await pool.query(
        "SELECT current_user AS role_name, current_database() AS database_name");
      authenticated = identity.rows[0]?.role_name === "kinglike_wa_archive_worker" &&
        identity.rows[0]?.database_name === config.database;
      if (authenticated) {
        grantsVerified = await verifyEmployeeArchiveDatabaseGrants(
          sql=>pool.query(sql),config.database);
      }
    } catch {
      // Never expose SQL errors, private network addresses or credentials.
    } finally {
      await pool.end().catch(()=>undefined);
    }
    return res.status(200).json({
      environment:"isolated_staging",
      worker:authenticated && grantsVerified?"passed":"failed",
      connection:authenticated?"passed":"failed",
      privileges:grantsVerified?"passed":authenticated?"failed":"not_tested",
      liveArchive:"disabled",messagesWritten:0,
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
