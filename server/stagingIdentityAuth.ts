import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { Express, NextFunction, Request, Response } from "express";
import pg from "pg";
import { isCrmEmployeeRole } from "../shared/crmRoles";
import { STAGING_AUTH_HOST } from "./stagingAuth/isolation";
import type { PasswordRecoveryStore } from "./stagingAuth/passwordRecoveryStore";
import {
  hashRecoveryValue,
  recoveryStoreFailureReason,
  type RecoveryStoreReasonCode,
} from "./stagingAuth/passwordRecoveryStore";

const { Pool } = pg;
const COOKIE = "kinglike_staging_identity";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const OWNER_ROLES = ["owner_approver", "legal_reviewer"];
type PasswordRecoveryReasonCode =
  | "rate_limited"
  | "invalid_request"
  | RecoveryStoreReasonCode
  | "email_provider_not_configured"
  | "email_send_rejected"
  | "email_send_accepted";

export type StagingIdentityActor = Readonly<{
  id: number;
  username?: string;
  active: boolean;
  isAdmin: boolean;
  role: string | null;
  identityVerified: boolean;
}>;

type IdentitySession = {
  actorId: number;
  expiresAt: number;
  state: Record<string, unknown>;
};

export type StagingIdentityContext = Readonly<{
  actor: StagingIdentityActor;
  sessionId: string;
  state: Record<string, unknown>;
}>;

declare global {
  namespace Express {
    interface Request {
      stagingIdentity?: StagingIdentityContext;
    }
  }
}

export function getStagingIdentity(req: Request): StagingIdentityContext | null {
  return req.stagingIdentity ?? null;
}

function safeStagingDatabaseUrl(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV !== "development" ||
      env.APP_DEPLOYMENT_MODE !== "staging" ||
      env.DEV_RESOURCE_ISOLATION_CONFIRMED !== "true" ||
      env.DEV_DATABASE_ISOLATION_CONFIRMED !== "true") return false;
  let target: URL;
  try {
    target = new URL(env.DEV_DATABASE_URL ?? "");
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol) ||
      target.hostname !== STAGING_AUTH_HOST ||
      decodeURIComponent(target.pathname.replace(/^\/+/, "")) !== "neondb") return false;
  for (const key of ["DATABASE_URL", "NEON_DATABASE_URL"] as const) {
    if (!env[key]) continue;
    try {
      const primary = new URL(env[key]!);
      if (primary.hostname === target.hostname &&
          (decodeURIComponent(primary.pathname.replace(/^\/+/, "")) === "neondb" ||
           primary.username === target.username)) return false;
    } catch {
      return false;
    }
  }
  if (env.PGHOST?.trim().toLowerCase() === target.hostname.toLowerCase()) return false;
  return true;
}

type AuthUser = {
  id: number;
  username?: string;
  passwordHash: string;
  active: boolean;
  isAdmin: boolean;
  role: string | null;
  identityVerified: boolean;
};

export type IdentityRepository = Readonly<{
  findByUsername(username: string): Promise<AuthUser | null>;
  findActiveById(id: number): Promise<StagingIdentityActor | null>;
  readiness(): Promise<{ schemaReady: boolean; hasEmployee: boolean; hasOwner: boolean }>;
}>;

function createReadOnlyRepository(env: NodeJS.ProcessEnv): IdentityRepository {
  let pool: InstanceType<typeof Pool> | null = null;
  const getPool = () => {
    if (!safeStagingDatabaseUrl(env)) throw new Error("staging_identity_store_blocked");
    if (!pool) pool = new Pool({
      connectionString: env.DEV_DATABASE_URL,
      max: 2,
      connectionTimeoutMillis: 3000,
      application_name: "kinglike_whatsapp_staging_identity_readonly",
      options: "-c default_transaction_read_only=on",
    });
    return pool;
  };
  return {
    async findByUsername(username) {
      const result = await getPool().query(
        `SELECT id::int, username, password_hash, is_active, is_admin, role,
                identity_verified_at IS NOT NULL AS identity_verified
           FROM staging_auth_users
          WHERE username = $1
          LIMIT 1`,
        [username],
      );
      const row = result.rows[0];
      return row ? {
        id: Number(row.id),
        username: typeof row.username === "string" ? row.username : "",
        passwordHash: String(row.password_hash),
        active: row.is_active === true,
        isAdmin: row.is_admin === true,
        role: typeof row.role === "string" ? row.role : null,
        identityVerified: row.identity_verified === true,
      } : null;
    },
    async findActiveById(id) {
      const result = await getPool().query(
        `SELECT id::int, username, is_active, is_admin, role,
                identity_verified_at IS NOT NULL AS identity_verified
           FROM staging_auth_users
          WHERE id = $1 AND is_active = TRUE
          LIMIT 1`,
        [id],
      );
      const row = result.rows[0];
      return row ? {
        id: Number(row.id),
        username: typeof row.username === "string" ? row.username : "",
        active: row.is_active === true,
        isAdmin: row.is_admin === true,
        role: typeof row.role === "string" ? row.role : null,
        identityVerified: row.identity_verified === true,
      } : null;
    },
    async readiness() {
      const identity = await getPool().query("SELECT current_database() AS database");
      if (identity.rows[0]?.database !== "neondb") throw new Error("staging_identity_database_mismatch");
      const migration = await getPool().query(
        "SELECT 1 FROM staging_auth_migrations WHERE migration_id = $1 LIMIT 1",
        ["002_staging_identity_provisioning"],
      );
      if (!migration.rowCount) return { schemaReady: false, hasEmployee: false, hasOwner: false };
      const result = await getPool().query(
        `SELECT is_admin, role
           FROM staging_auth_users
          WHERE is_active = TRUE AND identity_verified_at IS NOT NULL`,
      );
      return {
        schemaReady: true,
        hasEmployee: result.rows.some((row) =>
          row.is_admin === false && isCrmEmployeeRole(row.role)),
        hasOwner: result.rows.some((row) =>
          row.is_admin === true && OWNER_ROLES.includes(String(row.role))),
      };
    },
  };
}

function acceptableUser(user: AuthUser | StagingIdentityActor): boolean {
  if (user.active !== true) return false;
  if (user.identityVerified !== true) return false;
  return user.isAdmin
    ? OWNER_ROLES.includes(String(user.role)) || user.role === "admin"
    : isCrmEmployeeRole(user.role);
}

function readCookie(req: Request): string | null {
  const prefix = `${COOKIE}=`;
  const item = (req.header("cookie") ?? "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(prefix.length)); } catch { return null; }
}

function sameOrigin(req: Request): boolean {
  const origin = req.header("origin");
  const host = req.header("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === host.toLowerCase() &&
      parsed.protocol === (req.secure ? "https:" : "http:");
  } catch {
    return false;
  }
}

export function registerStagingIdentityAuth(
  app: Express,
  env: NodeJS.ProcessEnv,
  repository: IdentityRepository = createReadOnlyRepository(env),
  recovery?: {
    store: PasswordRecoveryStore;
    sendReset(email: string, token: string): Promise<boolean>;
    sendOwnerReset(email: string, token: string): Promise<boolean>;
    emailReady(): boolean;
    ownerEmailReady(): boolean;
    log?(reasonCode: PasswordRecoveryReasonCode): void;
  },
) {
  const sessions = new Map<string, IdentitySession>();
  const failedLogins = new Map<string, { count: number; resetAt: number }>();
  const recoveryLimits = new Map<string, number[]>();
  const recoveryEmail = "kinglikeluxury.sales.ge@gmail.com";
  const ownerRecoveryEmail = "info@kinglikeluxury.app";
  const recoveryEmailHash = hashRecoveryValue(recoveryEmail);
  const ownerRecoveryEmailHash = hashRecoveryValue(ownerRecoveryEmail);
  const logRecovery = (reasonCode: PasswordRecoveryReasonCode) => {
    (recovery?.log ?? ((code) => console.info(`[staging-auth-recovery] outcome=${code}`)))(reasonCode);
  };
  const rateAllowed = (key: string, maximum: number, windowMs: number) => {
    const now = Date.now();
    if (recoveryLimits.size > 10_000) {
      recoveryLimits.forEach((times, oldKey) => {
        const active = times.filter((time) => time > now - 60 * 60_000);
        if (active.length) recoveryLimits.set(oldKey, active);
        else recoveryLimits.delete(oldKey);
      });
    }
    const recent = (recoveryLimits.get(key) ?? []).filter((time) => time > now - windowMs);
    if (recent.length >= maximum) { recoveryLimits.set(key, recent); return false; }
    recent.push(now);
    recoveryLimits.set(key, recent);
    return true;
  };
  const resetPasswordAllowed = (value: unknown): value is string => {
    if (typeof value !== "string" || value.length < 14 || value.length > 256) return false;
    return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((rule) => rule.test(value)).length >= 3;
  };
  const recoveryUnavailable = (res: Response) => res.status(503).json({ status: "unavailable" });

  if (recovery) {
    app.post("/api/staging/identity/owner-password-recovery/request", async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (!safeStagingDatabaseUrl(env) || !req.secure || !sameOrigin(req)) {
        return res.status(403).json({ status: "unavailable" });
      }
      const generic = {
        status: "accepted",
        message: "إذا كانت الهوية مؤهلة، ستصل تعليمات الاستعادة إلى بريدها المؤكد.",
      };
      const ip = req.ip || "unknown";
      if (!rateAllowed(`owner-ip:${ip}`, 8, 60 * 60_000) ||
          !rateAllowed(`owner-email:${ownerRecoveryEmail}`, 3, 15 * 60_000)) {
        logRecovery("rate_limited");
        return res.status(202).json(generic);
      }
      try {
        const storeReady = await recovery.store.ownerReadiness();
        if (!storeReady.ready) {
          logRecovery(storeReady.reasonCode);
          return res.status(202).json(generic);
        }
      } catch (error) {
        logRecovery(recoveryStoreFailureReason(error));
        return res.status(202).json(generic);
      }
      let providerReady = false;
      try { providerReady = recovery.ownerEmailReady(); } catch { /* fail closed */ }
      if (!providerReady) {
        logRecovery("email_provider_not_configured");
        return res.status(202).json(generic);
      }
      try {
        const token = crypto.randomBytes(32).toString("base64url");
        const eligible = await recovery.store.issueOwner(
          crypto.createHash("sha256").update(token).digest(),
          hashRecoveryValue(ip),
          ownerRecoveryEmailHash,
        );
        if (!eligible) {
          logRecovery("invalid_request");
          return res.status(202).json(generic);
        }
        let accepted = false;
        try { accepted = await recovery.sendOwnerReset(ownerRecoveryEmail, token); } catch {
          accepted = false;
        }
        logRecovery(accepted ? "email_send_accepted" : "email_send_rejected");
      } catch (error) {
        logRecovery(recoveryStoreFailureReason(error));
      }
      return res.status(202).json(generic);
    });

    app.post("/api/staging/identity/password-recovery/request", async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (!safeStagingDatabaseUrl(env) || !req.secure || !sameOrigin(req)) {
        return res.status(403).json({ status: "unavailable" });
      }
      const generic = { status: "accepted", message: "إذا كانت الهوية مؤهلة، ستصل تعليمات الاستعادة إلى بريدها." };
      const rawEmail = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const ip = req.ip || "unknown";
      if (!rateAllowed(`ip:${ip}`, 8, 60 * 60_000) ||
          !rateAllowed(`email:${recoveryEmail}`, 3, 15 * 60_000)) {
        logRecovery("rate_limited");
        return res.status(202).json(generic);
      }
      if (rawEmail !== recoveryEmail) {
        logRecovery("invalid_request");
        return res.status(202).json(generic);
      }
      let providerReady = false;
      try { providerReady = recovery.emailReady(); } catch { /* fail closed */ }
      if (!providerReady) {
        logRecovery("email_provider_not_configured");
        return res.status(202).json(generic);
      }
      try {
        const token = crypto.randomBytes(32).toString("base64url");
        const eligible = await recovery.store.issue(
          crypto.createHash("sha256").update(token).digest(),
          hashRecoveryValue(ip),
          recoveryEmailHash,
        );
        if (!eligible) {
          logRecovery("invalid_request");
          return res.status(202).json(generic);
        }
        let accepted = false;
        try {
          accepted = await recovery.sendReset(recoveryEmail, token);
        } catch {
          accepted = false;
        }
        logRecovery(accepted ? "email_send_accepted" : "email_send_rejected");
      } catch (error) {
        logRecovery(recoveryStoreFailureReason(error));
      }
      return res.status(202).json(generic);
    });

    app.post("/api/staging/identity/password-recovery/complete", async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (!safeStagingDatabaseUrl(env) || !req.secure || !sameOrigin(req)) {
        return res.status(403).json({ status: "unavailable" });
      }
      const ip = req.ip || "unknown";
      if (!rateAllowed(`complete:${ip}`, 10, 15 * 60_000)) return res.status(429).json({ status: "invalid_or_expired" });
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      const password = req.body?.password;
      if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !resetPasswordAllowed(password)) {
        return res.status(400).json({ status: "invalid_or_expired" });
      }
      try {
        const passwordHash = await bcrypt.hash(password, 12);
        const userId = await recovery.store.complete(
          crypto.createHash("sha256").update(token).digest(),
          passwordHash,
          hashRecoveryValue(ip),
          recoveryEmailHash,
        );
        if (!userId) return res.status(400).json({ status: "invalid_or_expired" });
        sessions.forEach((session, key) => {
          if (session.actorId === userId) sessions.delete(key);
        });
        return res.json({ status: "password_updated", loginPath: "/staging/whatsapp-number-request" });
      } catch {
        return recoveryUnavailable(res);
      }
    });

    app.post("/api/staging/identity/owner-password-recovery/complete", async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (!safeStagingDatabaseUrl(env) || !req.secure || !sameOrigin(req)) {
        return res.status(403).json({ status: "unavailable" });
      }
      const ip = req.ip || "unknown";
      if (!rateAllowed(`owner-complete:${ip}`, 10, 15 * 60_000)) {
        logRecovery("rate_limited");
        return res.status(429).json({ status: "invalid_or_expired" });
      }
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      const password = req.body?.password;
      if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !resetPasswordAllowed(password)) {
        logRecovery("invalid_request");
        return res.status(400).json({ status: "invalid_or_expired" });
      }
      try {
        const passwordHash = await bcrypt.hash(password, 12);
        const userId = await recovery.store.completeOwner(
          crypto.createHash("sha256").update(token).digest(),
          passwordHash,
          hashRecoveryValue(ip),
          ownerRecoveryEmailHash,
        );
        if (!userId) {
          logRecovery("invalid_request");
          return res.status(400).json({ status: "invalid_or_expired" });
        }
        sessions.forEach((session, key) => {
          if (session.actorId === userId) sessions.delete(key);
        });
        return res.json({
          status: "password_updated",
          loginPath: "/staging/whatsapp-number-review",
        });
      } catch (error) {
        logRecovery(recoveryStoreFailureReason(error));
        return recoveryUnavailable(res);
      }
    });
  }
  const readiness = async () => {
    if (!safeStagingDatabaseUrl(env)) {
      return {
        status: "BLOCKED", reason: "staging_identity_store_not_isolated",
        schema: "BLOCKED", employee: "BLOCKED", owner: "BLOCKED",
        provisioning: "BLOCKED",
      } as const;
    }
    try {
      const present = await repository.readiness();
      if (!present.schemaReady) {
        return {
          status: "BLOCKED",
          reason: "identity_verification_migration_not_applied",
          schema: "BLOCKED",
          employee: "BLOCKED",
          owner: "BLOCKED",
          provisioning: "BLOCKED",
        } as const;
      }
      const employee = present.hasEmployee ? "READY" : "BLOCKED";
      const owner = present.hasOwner ? "READY" : "BLOCKED";
      return {
        status: employee === "READY" && owner === "READY" ? "READY" : "BLOCKED",
        reason: employee !== "READY" ? "no_active_staging_crm_employee" :
          owner !== "READY" ? "no_active_staging_owner_approver" : "staging_identity_verified",
        schema: "READY",
        employee,
        owner,
        // No verified invitation provider or provisioning writer is wired into
        // the main app. Never let environment flags alone activate provisioning.
        provisioning: "BLOCKED",
      } as const;
    } catch {
      return {
        status: "BLOCKED", reason: "staging_identity_store_unavailable",
        schema: "BLOCKED", employee: "BLOCKED", owner: "BLOCKED",
        provisioning: "BLOCKED",
      } as const;
    }
  };

  app.get("/api/staging/identity/readiness", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json(await readiness());
  });

  app.get("/api/staging/identity/session", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!safeStagingDatabaseUrl(env)) {
      return res.status(503).json({ status: "BLOCKED", reason: "staging_identity_store_not_isolated" });
    }
    const token = readCookie(req);
    const sessionId = token ? crypto.createHash("sha256").update(token).digest("hex") : "";
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || session.expiresAt <= Date.now()) {
      if (sessionId) sessions.delete(sessionId);
      return res.status(401).json({ status: "unauthenticated", reason: "staging_session_missing" });
    }
    try {
      const actor = await repository.findActiveById(session.actorId);
      if (!actor || !acceptableUser(actor)) {
        sessions.delete(sessionId);
        return res.status(401).json({ status: "unauthenticated", reason: "staging_session_invalid" });
      }
      return res.json({
        status: "authenticated",
        role: actor.isAdmin ? actor.role : "crm_employee",
        username: actor.username ?? null,
      });
    } catch {
      return res.status(503).json({ status: "BLOCKED", reason: "staging_identity_store_unavailable" });
    }
  });

  app.post("/api/staging/identity/login", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!safeStagingDatabaseUrl(env)) return res.status(503).json({ status: "BLOCKED", reason: "staging_identity_store_not_isolated" });
    if (!req.secure) return res.status(403).json({ status: "BLOCKED", reason: "https_required" });
    if (!sameOrigin(req)) return res.status(403).json({ status: "BLOCKED", reason: "same_origin_required" });
    const now = Date.now();
    const ip = req.ip || "unknown";
    const attempts = failedLogins.get(ip);
    if (attempts && attempts.resetAt <= now) failedLogins.delete(ip);
    const currentAttempts = failedLogins.get(ip);
    if (currentAttempts && currentAttempts.count >= 6) {
      return res.status(429).json({ status: "BLOCKED", reason: "staging_login_rate_limited" });
    }
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!username || username.length > 200 || !password || password.length > 1024) {
      return res.status(401).json({ status: "BLOCKED", reason: "invalid_credentials" });
    }
    try {
      const user = await repository.findByUsername(username);
      const verified = !!user && acceptableUser(user) && await bcrypt.compare(password, user.passwordHash);
      if (!verified || !user) {
        const failed = failedLogins.get(ip);
        failedLogins.set(ip, failed
          ? { count: failed.count + 1, resetAt: failed.resetAt }
          : { count: 1, resetAt: now + 15 * 60_000 });
        return res.status(401).json({ status: "BLOCKED", reason: "invalid_credentials" });
      }
      failedLogins.delete(ip);
      sessions.forEach((session, key) => {
        if (session.expiresAt <= now) sessions.delete(key);
      });
      const token = crypto.randomBytes(32).toString("base64url");
      const sessionId = crypto.createHash("sha256").update(token).digest("hex");
      sessions.set(sessionId, {
        actorId: user.id,
        expiresAt: Date.now() + SESSION_TTL_MS,
        state: Object.create(null) as Record<string, unknown>,
      });
      res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/api; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Strict`);
      return res.json({ status: "authenticated", role: user.isAdmin ? user.role : "crm_employee" });
    } catch {
      return res.status(503).json({ status: "BLOCKED", reason: "staging_identity_store_unavailable" });
    }
  });

  app.post("/api/staging/identity/logout", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const token = readCookie(req);
    if (token) sessions.delete(crypto.createHash("sha256").update(token).digest("hex"));
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
    return res.json({ status: "logged_out" });
  });

  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    if (!safeStagingDatabaseUrl(env)) {
      return res.status(503).json({ error: "staging_identity_store_not_isolated" });
    }
    const token = readCookie(req);
    if (!token) return res.status(401).json({ error: "staging_identity_required" });
    const sessionId = crypto.createHash("sha256").update(token).digest("hex");
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return res.status(401).json({ error: "staging_identity_required" });
    }
    try {
      const actor = await repository.findActiveById(session.actorId);
      if (!actor || !acceptableUser(actor)) {
        sessions.delete(sessionId);
        return res.status(403).json({ error: "staging_identity_not_authorized" });
      }
      const requestPath = (req.originalUrl || req.path).split("?", 1)[0];
      const employeePath = requestPath.startsWith("/api/employee/");
      const provisioningPath = requestPath.startsWith("/api/staging/identity/provisioning/");
      if (employeePath && (actor.isAdmin || !isCrmEmployeeRole(actor.role))) {
        return res.status(403).json({ error: "staging_employee_role_required" });
      }
      if (provisioningPath &&
          (!actor.isAdmin || actor.role !== "owner_approver")) {
        return res.status(403).json({ error: "staging_provisioning_admin_required" });
      }
      if (!employeePath && !provisioningPath &&
          (!actor.isAdmin || !OWNER_ROLES.includes(String(actor.role)))) {
        return res.status(403).json({ error: "staging_admin_role_required" });
      }
      req.stagingIdentity = { actor, sessionId, state: session.state };
      return next();
    } catch {
      return res.status(503).json({ error: "staging_identity_store_unavailable" });
    }
  };
  return { readiness, middleware };
}
