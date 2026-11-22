import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { Express, Request, Response } from "express";
import pg from "pg";
import { getRuntimeDatabaseUrl } from "../runtimeSafety";
import type { VerifiedIdentityProvider } from "../stagingIdentityProvisioning";
import { hasForbiddenDatabaseVariables, STAGING_AUTH_HOST } from "./isolation";

const { Pool } = pg;
const CSRF_COOKIE = "kinglike_staging_owner_bootstrap_csrf";
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

type Result = "issued" | "activated" | "invalid" | "used" | "blocked";

export type OwnerBootstrapStore = Readonly<{
  readiness(): Promise<"READY" | "BLOCKED" | "USED">;
  issueChallenge(input: {
    emailHash: string;
    challengeId: string;
    codeHash: string;
    expiresAt: number;
  }): Promise<"issued" | "used" | "blocked">;
  verifyAndActivate(input: {
    email: string;
    emailHash: string;
    challengeId: string;
    code: string;
    passwordHash: string;
  }): Promise<"activated" | "invalid" | "used" | "blocked">;
}>;

function approvedTarget(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV !== "development" || env.APP_DEPLOYMENT_MODE !== "staging" ||
      env.DEV_RESOURCE_ISOLATION_CONFIRMED !== "true" ||
      env.DEV_DATABASE_ISOLATION_CONFIRMED !== "true" ||
      env.WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE !== "fixture" ||
      hasForbiddenDatabaseVariables(env)) return false;
  if (Object.keys(env).some((key) =>
    key.startsWith("WHATSAPP_ARCHIVE_") ||
    (key.startsWith("WHATSAPP_EMPLOYEE_ARCHIVE_") &&
      key !== "WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE"))) return false;
  try {
    const url = new URL(env.DEV_DATABASE_URL ?? "");
    return ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname === STAGING_AUTH_HOST &&
      decodeURIComponent(url.pathname.replace(/^\/+/, "")) === "neondb" &&
      !!url.username && !!url.password;
  } catch {
    return false;
  }
}

export function createStagingOwnerBootstrapPostgresStore(
  env: NodeJS.ProcessEnv,
): OwnerBootstrapStore {
  let pool: InstanceType<typeof Pool> | null = null;
  let readPool: InstanceType<typeof Pool> | null = null;
  const getPool = () => {
    if (!approvedTarget(env)) throw new Error("staging_owner_bootstrap_target_blocked");
    if (!pool) pool = new Pool({
      connectionString: env.DEV_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 3000,
      application_name: "kinglike_staging_owner_bootstrap",
    });
    return pool;
  };
  const getReadPool = () => {
    if (!approvedTarget(env)) throw new Error("staging_owner_bootstrap_target_blocked");
    if (!readPool) readPool = new Pool({
      connectionString: env.DEV_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 3000,
      application_name: "kinglike_staging_owner_bootstrap_readiness",
      options: "-c default_transaction_read_only=on",
    });
    return readPool;
  };
  const verifyDatabase = async (client: any) => {
    const identity = await client.query(
      "SELECT current_database() AS database, current_user AS username",
    );
    const target = new URL(env.DEV_DATABASE_URL!);
    return identity.rows[0]?.database === "neondb" &&
      identity.rows[0]?.username === decodeURIComponent(target.username);
  };
  const audit = async (
    client: any,
    action: string,
    emailHash: string,
    detailCode: string,
  ) => {
    await client.query(
      `INSERT INTO staging_identity_audit
        (actor_user_id, target_user_id, invite_id, action, target_email_hash, detail_code)
       VALUES (NULL, NULL, NULL, $1, $2, $3)`,
      [action, emailHash, detailCode],
    );
  };

  return {
    async readiness() {
      if (!approvedTarget(env)) return "BLOCKED";
      const client = await getReadPool().connect();
      try {
        await client.query("BEGIN READ ONLY");
        const identity = await client.query(
          `SELECT current_database() AS database,
                  current_user AS username,
                  current_setting('transaction_read_only') AS transaction_read_only,
                  to_regclass('public.staging_identity_bootstrap') IS NOT NULL AS bootstrap_exists`,
        );
        const target = new URL(env.DEV_DATABASE_URL!);
        const row = identity.rows[0];
        if (row?.database !== "neondb" ||
            row?.username !== decodeURIComponent(target.username) ||
            row?.transaction_read_only !== "on" ||
            row?.bootstrap_exists !== true) {
          await client.query("ROLLBACK");
          return "BLOCKED";
        }
        const migration = await client.query(
          "SELECT 1 FROM staging_auth_migrations WHERE migration_id = $1 LIMIT 1",
          ["002_staging_identity_provisioning"],
        );
        if (!migration.rowCount) {
          await client.query("ROLLBACK");
          return "BLOCKED";
        }
        const bootstrap = await client.query(
          "SELECT completed_at FROM staging_identity_bootstrap WHERE singleton = TRUE",
        );
        await client.query("ROLLBACK");
        if (!bootstrap.rows[0]) return "BLOCKED";
        return bootstrap.rows[0].completed_at ? "USED" : "READY";
      } catch {
        await client.query("ROLLBACK").catch(() => undefined);
        return "BLOCKED";
      } finally {
        client.release();
      }
    },
    async issueChallenge(input) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        if (!(await verifyDatabase(client))) throw new Error("staging_owner_bootstrap_database_mismatch");
        const locked = await client.query(
          "SELECT completed_at FROM staging_identity_bootstrap WHERE singleton = TRUE FOR UPDATE",
        );
        if (!locked.rows[0]) throw new Error("staging_owner_bootstrap_row_missing");
        if (locked.rows[0].completed_at) {
          await client.query("ROLLBACK");
          return "used";
        }
        const owner = await client.query(
          `SELECT 1 FROM staging_auth_users
            WHERE is_active = TRUE AND is_admin = TRUE
              AND role IN ('owner_approver', 'legal_reviewer')
            LIMIT 1`,
        );
        if (owner.rowCount) {
          await client.query("ROLLBACK");
          return "used";
        }
        const detail = `owner_bootstrap:${input.challengeId}:${input.expiresAt}:${input.codeHash}`;
        await audit(client, "invite_issued", input.emailHash, detail);
        await client.query("COMMIT");
        return "issued";
      } catch {
        await client.query("ROLLBACK").catch(() => undefined);
        return "blocked";
      } finally {
        client.release();
      }
    },
    async verifyAndActivate(input) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        if (!(await verifyDatabase(client))) throw new Error("staging_owner_bootstrap_database_mismatch");
        const locked = await client.query(
          "SELECT completed_at FROM staging_identity_bootstrap WHERE singleton = TRUE FOR UPDATE",
        );
        if (!locked.rows[0] || locked.rows[0].completed_at) {
          await client.query("ROLLBACK");
          return "used";
        }
        const challenge = await client.query(
          `SELECT detail_code FROM staging_identity_audit
            WHERE target_email_hash = $1 AND action = 'invite_issued'
              AND detail_code LIKE 'owner_bootstrap:%'
            ORDER BY audit_id DESC LIMIT 1`,
          [input.emailHash],
        );
        const parts = String(challenge.rows[0]?.detail_code ?? "").split(":");
        const [, challengeId, expiryRaw, codeHash] = parts;
        if (parts.length !== 4 || challengeId !== input.challengeId) {
          await client.query("ROLLBACK");
          return "invalid";
        }
        const expiry = Number(expiryRaw);
        const failures = await client.query(
          `SELECT COUNT(*)::int AS attempts FROM staging_identity_audit
            WHERE target_email_hash = $1 AND action = 'verification_failed'
              AND detail_code = $2`,
          [input.emailHash, `owner_bootstrap_failed:${challengeId}`],
        );
        if (!Number.isSafeInteger(expiry) || expiry <= Date.now() ||
            Number(failures.rows[0]?.attempts ?? 0) >= MAX_ATTEMPTS) {
          await audit(client, "verification_failed", input.emailHash, `owner_bootstrap_failed:${challengeId}`);
          await client.query("COMMIT");
          return "invalid";
        }
        if (!(await bcrypt.compare(input.code, codeHash))) {
          await audit(client, "verification_failed", input.emailHash, `owner_bootstrap_failed:${challengeId}`);
          await client.query("COMMIT");
          return "invalid";
        }
        const created = await client.query(
          `INSERT INTO staging_auth_users
            (username, password_hash, is_admin, role, is_active,
             identity_verified_at, identity_verification_method, identity_subject_hash, provisioned_by)
           VALUES ($1, $2, TRUE, 'owner_approver', TRUE, NOW(), 'email_otp', $3, NULL)
           RETURNING id::int`,
          [input.email, input.passwordHash, input.emailHash],
        );
        const ownerId = Number(created.rows[0]?.id);
        if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error("owner_insert_failed");
        const completed = await client.query(
          `UPDATE staging_identity_bootstrap
              SET completed_at = NOW(), completed_by = $1, invite_id = NULL
            WHERE singleton = TRUE AND completed_at IS NULL`,
          [ownerId],
        );
        if (!completed.rowCount) throw new Error("owner_bootstrap_lock_lost");
        await audit(client, "identity_verified", input.emailHash, `owner_bootstrap_verified:${challengeId}`);
        await audit(client, "account_activated", input.emailHash, `owner_bootstrap_activated:${challengeId}`);
        await client.query("COMMIT");
        return "activated";
      } catch {
        await client.query("ROLLBACK").catch(() => undefined);
        return "blocked";
      } finally {
        client.release();
      }
    },
  };
}

function sameOriginHttps(req: Request): boolean {
  const origin = req.header("origin") ??
    (req.method === "GET" && req.path.endsWith("/bootstrap/csrf") ? req.header("referer") : undefined);
  const host = req.header("host");
  if (!req.secure || !origin || !host) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function passwordAllowed(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 14 || value.length > 256) return false;
  return [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)]
    .filter(Boolean).length >= 3;
}

export function registerStagingOwnerBootstrapRoutes(
  app: Express,
  deps: {
    enabled: boolean;
    env: NodeJS.ProcessEnv;
    store: OwnerBootstrapStore;
    verifier: VerifiedIdentityProvider;
    expectedIdentities: { ownerEmail: string; employeeEmail: string };
  },
): void {
  const ready = deps.enabled &&
    deps.env.WHATSAPP_STAGING_OWNER_BOOTSTRAP_APPROVED === "true" &&
    approvedTarget(deps.env) &&
    deps.verifier.ownerBootstrapReady();
  const csrfTokens = new Map<string, number>();
  const limits = new Map<string, { count: number; resetAt: number }>();
  const ownerEmail = deps.verifier.designatedEmail("owner_approver");
  const emailHash = ownerEmail
    ? crypto.createHash("sha256").update(ownerEmail).digest("hex")
    : "";
  const readiness = async () => {
    if (!ready) return { status: "BLOCKED", reason: "owner_bootstrap_configuration_missing" } as const;
    const checkDelivery = deps.verifier.deliveryReadiness;
    if (!checkDelivery) return { status: "BLOCKED", reason: "sender_readiness_unavailable" } as const;
    const delivery = await checkDelivery(deps.expectedIdentities).catch(() => null);
    if (!delivery) return { status: "BLOCKED", reason: "sender_readiness_unavailable" } as const;
    if (!delivery.ownerAllowlistMatch || !delivery.employeeAllowlistMatch) {
      return {
        status: "BLOCKED",
        reason: "identity_allowlist_role_mismatch",
        ownerAllowlistMatch: delivery.ownerAllowlistMatch,
        employeeAllowlistMatch: delivery.employeeAllowlistMatch,
        senderDomainMatch: delivery.senderDomainMatch,
        apiKeyPresent: delivery.apiKeyPresent,
      } as const;
    }
    if (!delivery.senderDomainMatch || !delivery.apiKeyPresent) {
      return {
        status: "BLOCKED",
        reason: !delivery.senderDomainMatch ? "resend_from_domain_mismatch" : "staging_resend_key_missing",
        ownerAllowlistMatch: true,
        employeeAllowlistMatch: true,
        senderDomainMatch: delivery.senderDomainMatch,
        apiKeyPresent: delivery.apiKeyPresent,
      } as const;
    }
    const storeState = await deps.store.readiness().catch(() => "BLOCKED" as const);
    if (storeState !== "READY") {
      return {
        status: "BLOCKED",
        reason: storeState === "USED" ? "owner_bootstrap_already_completed" : "staging_auth_schema_unavailable",
        ownerAllowlistMatch: true,
        employeeAllowlistMatch: true,
        senderDomainMatch: true,
        apiKeyPresent: true,
        resendAccessApiVerified: false,
      } as const;
    }
    return {
      status: "READY_TO_ATTEMPT_OWNER_VERIFICATION_SEND",
      reason: "local_preflight_passed_resend_scope_not_api_verified",
      ownerAllowlistMatch: true,
      employeeAllowlistMatch: true,
      senderDomainMatch: true,
      apiKeyPresent: true,
      resendAccessApiVerified: false,
      httpsRequiredForChallenge: true,
      csrfRequiredForChallenge: true,
      secureSessionCookie: true,
    } as const;
  };

  const rateLimited = (req: Request): boolean => {
    const key = req.ip || "unknown";
    const now = Date.now();
    const prior = limits.get(key);
    if (prior && prior.resetAt <= now) limits.delete(key);
    const current = limits.get(key);
    if (current && current.count >= 4) return true;
    limits.set(key, current
      ? { ...current, count: current.count + 1 }
      : { count: 1, resetAt: now + 15 * 60_000 });
    return false;
  };

  const consumeCsrf = (req: Request, res: Response): boolean => {
    const cookie = (req.header("cookie") ?? "").split(";").map((part) => part.trim())
      .find((part) => part.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1);
    const header = req.header("x-csrf-token");
    if (!cookie || !header || cookie !== header) return false;
    const key = crypto.createHash("sha256").update(cookie).digest("hex");
    const expiry = csrfTokens.get(key);
    if (!expiry || expiry <= Date.now()) return false;
    csrfTokens.delete(key);
    return true;
  };

  app.get("/api/staging/identity/bootstrap/status", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json(await readiness());
  });

  app.get("/api/staging/identity/bootstrap/csrf", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!sameOriginHttps(req)) return res.status(403).json({ error: "same_origin_https_required" });
    const token = crypto.randomBytes(32).toString("base64url");
    csrfTokens.set(crypto.createHash("sha256").update(token).digest("hex"), Date.now() + 5 * 60_000);
    res.setHeader("Set-Cookie",
      `${CSRF_COOKIE}=${token}; Path=/api/staging/identity/bootstrap; Max-Age=300; HttpOnly; Secure; SameSite=Strict`);
    return res.json({ csrfToken: token, expiresInSeconds: 300 });
  });

  app.post("/api/staging/identity/bootstrap/owner/challenge", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!sameOriginHttps(req)) return res.status(403).json({ error: "same_origin_https_required" });
    if (!consumeCsrf(req, res)) return res.status(403).json({ error: "bootstrap_csrf_invalid" });
    if (rateLimited(req)) return res.status(429).json({ error: "bootstrap_rate_limited" });
    if (!ownerEmail || !emailHash ||
        (await readiness()).status !== "READY_TO_ATTEMPT_OWNER_VERIFICATION_SEND") {
      return res.status(503).json({ status: "BLOCKED", reason: "owner_bootstrap_not_ready" });
    }
    const challengeId = crypto.randomUUID();
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = Date.now() + CODE_TTL_MS;
    try {
      const codeHash = await bcrypt.hash(code, 12);
      const result = await deps.store.issueChallenge({ emailHash, challengeId, codeHash, expiresAt });
      if (result !== "issued") return res.status(409).json({ error: "owner_bootstrap_unavailable" });
      if (!(await deps.verifier.deliverOwnerBootstrap(ownerEmail, code, challengeId))) {
        return res.status(503).json({ error: "verification_delivery_unavailable" });
      }
      return res.status(202).json({ status: "challenge_sent", challengeId, expiresInSeconds: 600 });
    } catch {
      return res.status(503).json({ error: "owner_bootstrap_unavailable" });
    }
  });

  app.post("/api/staging/identity/bootstrap/owner/verify", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!sameOriginHttps(req)) return res.status(403).json({ error: "same_origin_https_required" });
    if (!consumeCsrf(req, res)) return res.status(403).json({ error: "bootstrap_csrf_invalid" });
    if (rateLimited(req)) return res.status(429).json({ error: "bootstrap_rate_limited" });
    if (!ready || !ownerEmail || !emailHash) return res.status(503).json({
      status: "BLOCKED", reason: "owner_bootstrap_configuration_missing",
    });
    const challengeId = typeof req.body?.challengeId === "string" ? req.body.challengeId : "";
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const password = req.body?.password;
    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code) ||
        !passwordAllowed(password)) {
      return res.status(400).json({ error: "owner_bootstrap_proof_invalid" });
    }
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await deps.store.verifyAndActivate({
        email: ownerEmail,
        emailHash,
        challengeId,
        code,
        passwordHash,
      });
      if (result !== "activated") return res.status(403).json({ error: "owner_bootstrap_invalid_or_used" });
      return res.status(201).json({ status: "owner_verified", next: "staging_identity_login" });
    } catch {
      return res.status(503).json({ error: "owner_bootstrap_unavailable" });
    }
  });
}
