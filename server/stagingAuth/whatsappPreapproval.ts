import crypto from "node:crypto";
import type { Express, Request } from "express";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { getStagingIdentity } from "../stagingIdentityAuth";
import { getWhatsappCoexistenceReadiness } from "../whatsappCoexistenceReadiness";
import { getStagingArchiveReadiness } from "../stagingArchive/isolation";
import { logStagingWhatsappPreapprovalFailure } from "./whatsappPreapprovalDiagnostics";

export const STAGING_WHATSAPP_PREAPPROVAL_MIGRATION =
  "003_staging_whatsapp_number_preapproval";
const EMPLOYEE_BASE = "/api/employee/whatsapp-number-preapproval";
const OWNER_BASE = "/api/admin/whatsapp-number-preapproval";
const EMPLOYEE_IDENTITY = "kinglikeluxury.sales.ge@gmail.com";
const OWNER_IDENTITY = "info@kinglikeluxury.app";
const CSRF_TTL_MS = 5 * 60_000;
const LIMIT_WINDOW_MS = 15 * 60_000;
const MAX_MUTATIONS_PER_WINDOW = 8;

export type NumberPreapproval = Readonly<{
  id: string;
  employeeId: number;
  version: number;
  status: "pending_owner" | "approved" | "rejected" | "cancelled" |
    "meta_verified_pending_binding" | "connected" | "expired";
  numberFingerprint: Buffer;
  numberCiphertext: Buffer;
  expiresAt: Date;
  employeeIdentity?: string;
  metaBusinessId?: string | null;
  metaWabaId?: string | null;
  metaPhoneNumberId?: string | null;
}>;

export type NumberPreapprovalStore = Readonly<{
  schemaReady(): Promise<boolean>;
  create(input: { employeeId: number; fingerprint: Buffer; ciphertext: Buffer }): Promise<NumberPreapproval>;
  getApprovedForAttempt(input: { id: string; version: number; employeeId: number }): Promise<NumberPreapproval | null>;
  recordMetaVerified(input: {
    id: string; version: number; employeeId: number; numberFingerprint: Buffer;
    businessId: string; wabaId: string; phoneNumberId: string; displayFingerprint: Buffer;
  }): Promise<boolean>;
  listForEmployee(employeeId: number): Promise<NumberPreapproval[]>;
  listPending(): Promise<NumberPreapproval[]>;
  decide(input: { id: string; version: number; ownerId: number; approve: boolean }): Promise<boolean>;
  cancel(input: { id: string; version: number; employeeId: number }): Promise<boolean>;
}>;

export function parseOnboardingKey(value: string | undefined): Buffer | null {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 && key.toString("base64") === value ? key : null;
}

export function normalizeE164(value: unknown): string | null {
  if (typeof value !== "string" || !/^\+[1-9]\d{7,14}$/.test(value)) return null;
  const parsed = parsePhoneNumberFromString(value);
  return parsed?.isValid() && parsed.number === value ? value : null;
}

export function normalizeMetaDisplayNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return normalizeE164(value.replace(/[()\s.-]/g, ""));
}

function deriveKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(crypto.hkdfSync(
    "sha256", master, Buffer.alloc(0), Buffer.from(`kinglike-staging-whatsapp:${purpose}:v1`), 32,
  ));
}

export function protectApprovedNumber(value: string, key: Buffer): {
  fingerprint: Buffer;
  ciphertext: Buffer;
} {
  const fingerprint = crypto.createHmac("sha256", deriveKey(key, "fingerprint"))
    .update("kinglike-staging-phone-fingerprint-v1\0").update(value).digest();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(key, "encryption"), nonce);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { fingerprint, ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), encrypted]) };
}

export function revealApprovedNumber(ciphertext: Buffer, key: Buffer): string {
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length < 29) throw new Error("number_ciphertext_invalid");
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(key, "encryption"), ciphertext.subarray(0, 12));
  decipher.setAuthTag(ciphertext.subarray(12, 28));
  const value = Buffer.concat([
    decipher.update(ciphertext.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
  if (!normalizeE164(value)) throw new Error("number_ciphertext_invalid");
  return value;
}

type CsrfRecord = { token: string; sessionId: string; userId: number; expiresAt: number };
type SessionState = { whatsappNumberPreapprovalCsrf?: CsrfRecord };

function secureEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sameOriginHttps(req: Request): boolean {
  const origin = req.header("origin");
  const host = req.header("host");
  if (!req.secure || !origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}

export function registerStagingWhatsappNumberPreapprovalRoutes(
  app: Express,
  dependencies: {
    env: NodeJS.ProcessEnv;
    store: NumberPreapprovalStore;
    now?: () => number;
  },
): void {
  const limits = new Map<number, { count: number; expiresAt: number }>();
  const now = () => dependencies.now?.() ?? Date.now();
  const key = () => parseOnboardingKey(dependencies.env.WHATSAPP_STAGING_ONBOARDING_ENCRYPTION_KEY);
  const actor = (req: Request) => getStagingIdentity(req)?.actor ?? null;
  const enabled = () => dependencies.env.NODE_ENV === "development" &&
    dependencies.env.APP_DEPLOYMENT_MODE === "staging" &&
    dependencies.env.DEV_RESOURCE_ISOLATION_CONFIRMED === "true" &&
    dependencies.env.DEV_DATABASE_ISOLATION_CONFIRMED === "true" &&
    (dependencies.env.WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE === "fixture" ||
      (dependencies.env.WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE === "postgres" &&
        getStagingArchiveReadiness(dependencies.env).storageSource ===
          "isolated_archive_database_configured"));
  const allowed = (role: "employee" | "owner", req: Request) => {
    const current = actor(req);
    return current?.active === true && current.identityVerified === true &&
      (role === "owner"
        ? current.isAdmin && current.role === "owner_approver" &&
          current.username?.trim().toLowerCase() === OWNER_IDENTITY
        : !current.isAdmin && current.role === "crm_employee" &&
          current.username?.trim().toLowerCase() === EMPLOYEE_IDENTITY);
  };
  const rateLimited = (userId: number) => {
    const time = now(); const prior = limits.get(userId);
    if (!prior || prior.expiresAt <= time) {
      limits.set(userId, { count: 1, expiresAt: time + LIMIT_WINDOW_MS });
      return false;
    }
    prior.count++;
    return prior.count > MAX_MUTATIONS_PER_WINDOW;
  };
  const checkCsrf = (req: Request) => {
    const current = actor(req);
    const context = getStagingIdentity(req);
    const state = context?.state as SessionState | undefined;
    const record = state?.whatsappNumberPreapprovalCsrf;
    if (!current || !context || !record || record.userId !== current.id ||
      record.sessionId !== context.sessionId || record.expiresAt <= now() ||
      !secureEqual(req.header("x-csrf-token"), record.token)) return false;
    delete state!.whatsappNumberPreapprovalCsrf;
    return true;
  };
  const storeReady = async () => enabled() && !!key() &&
    await dependencies.store.schemaReady().catch(() => false);
  const readiness = async (role: "employee" | "owner") => {
    const storeIsReady = await storeReady();
    const result = getWhatsappCoexistenceReadiness(dependencies.env, {
      validEmployeeSession: role === "employee",
      validOwnerSession: role === "owner",
      preapprovalMigrationApplied: storeIsReady,
      onboardingStoreAuthenticated: storeIsReady,
      minimalMetadataStoreVerified: storeIsReady,
    });
    const reason = !enabled() ? "development_isolation_required"
      : !key() ? "encryption_key_missing_or_invalid"
      : !storeIsReady ? "migration_or_writer_store_not_ready"
      : null;
    return {
      numberPreapprovalReady: result.numberPreapprovalReady,
      employeeNumberRequestReady: result.employeeNumberRequestReady,
      ownerNumberReviewReady: result.ownerNumberReviewReady,
      reason,
    };
  };
  const preflight = async () => {
    const result = await readiness("employee");
    return result.numberPreapprovalReady;
  };

  app.get(`${EMPLOYEE_BASE}/readiness`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!allowed("employee", req)) return res.status(403).json({ error: "preapproval_unavailable" });
    return res.json(await readiness("employee"));
  });
  app.get(`${OWNER_BASE}/readiness`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!allowed("owner", req)) return res.status(403).json({ error: "preapproval_unavailable" });
    return res.json(await readiness("owner"));
  });

  app.post(`${EMPLOYEE_BASE}/csrf`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const context = getStagingIdentity(req);
    if (!enabled() || !allowed("employee", req) || !sameOriginHttps(req) || !context) {
      return res.status(403).json({ error: "preapproval_unavailable" });
    }
    if (!(await preflight())) return res.status(503).json({ error: "preapproval_not_ready" });
    const token = crypto.randomBytes(32).toString("base64url");
    (context.state as SessionState).whatsappNumberPreapprovalCsrf = {
      token, sessionId: context.sessionId, userId: context.actor.id, expiresAt: now() + CSRF_TTL_MS,
    };
    return res.json({ csrfToken: token, expiresInSeconds: CSRF_TTL_MS / 1000 });
  });

  app.post(EMPLOYEE_BASE, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const current = actor(req);
    if (!enabled() || !allowed("employee", req) || !sameOriginHttps(req) || !current) {
      return res.status(403).json({ error: "preapproval_unavailable" });
    }
    if (!checkCsrf(req)) return res.status(403).json({ error: "preapproval_csrf_invalid" });
    if (rateLimited(current.id)) return res.status(429).json({ error: "preapproval_rate_limited" });
    const encryptionKey = key();
    if (!encryptionKey || !(await preflight())) return res.status(503).json({ error: "preapproval_not_ready" });
    if (req.body?.workNumberConfirmed !== true || req.body?.quarantineAcknowledged !== true) {
      return res.status(400).json({ error: "work_number_and_quarantine_ack_required" });
    }
    const number = normalizeE164(req.body?.e164);
    if (!number) return res.status(400).json({ error: "e164_number_invalid" });
    try {
      const protectedNumber = protectApprovedNumber(number, encryptionKey);
      const result = await dependencies.store.create({
        employeeId: current.id,
        ...protectedNumber,
      });
      return res.status(201).json({
        requestId: result.id, version: result.version, status: result.status,
        message: "Messages received during quarantine are discarded and cannot be recovered.",
      });
    } catch (error) {
      if (typeof error === "object" && error !== null &&
          "code" in error && (error as { code?: unknown }).code === "23505") {
        return res.status(409).json({ error: "preapproval_duplicate_active" });
      }
      logStagingWhatsappPreapprovalFailure("create", error);
      return res.status(503).json({ error: "preapproval_temporarily_unavailable" });
    }
  });

  app.get(EMPLOYEE_BASE, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const current = actor(req);
    if (!enabled() || !allowed("employee", req) || !current || !(await preflight())) {
      return res.status(503).json({ error: "preapproval_not_ready" });
    }
    try {
      const rows = await dependencies.store.listForEmployee(current.id);
      return res.json({ requests: rows.map(({ id, version, status, expiresAt }) => ({ id, version, status, expiresAt })) });
    } catch (error) {
      logStagingWhatsappPreapprovalFailure("list_employee", error);
      return res.status(503).json({ error: "preapproval_temporarily_unavailable" });
    }
  });

  app.get(`${OWNER_BASE}/pending`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const encryptionKey = key();
    if (!enabled() || !allowed("owner", req) || !encryptionKey || !(await preflight())) {
      return res.status(503).json({ error: "preapproval_not_ready" });
    }
    try {
      const rows = await dependencies.store.listPending();
      return res.json({ requests: rows.map((row) => ({
        id: row.id, employeeId: row.employeeId, employeeIdentity: row.employeeIdentity ?? null,
        version: row.version, status: row.status,
        e164: revealApprovedNumber(row.numberCiphertext, encryptionKey), expiresAt: row.expiresAt,
      })) });
    } catch (error) {
      logStagingWhatsappPreapprovalFailure("list_pending", error);
      return res.status(503).json({ error: "preapproval_temporarily_unavailable" });
    }
  });

  for (const approve of [true, false]) {
    app.post(`${OWNER_BASE}/:id/${approve ? "approve" : "reject"}/csrf`, async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const context = getStagingIdentity(req);
      if (!enabled() || !allowed("owner", req) || !sameOriginHttps(req) || !context ||
        !(await preflight())) return res.status(403).json({ error: "preapproval_unavailable" });
      const token = crypto.randomBytes(32).toString("base64url");
      (context.state as SessionState).whatsappNumberPreapprovalCsrf = {
        token, sessionId: context.sessionId, userId: context.actor.id, expiresAt: now() + CSRF_TTL_MS,
      };
      return res.json({ csrfToken: token, expiresInSeconds: CSRF_TTL_MS / 1000 });
    });
    app.post(`${OWNER_BASE}/:id/${approve ? "approve" : "reject"}`, async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const current = actor(req);
      if (!enabled() || !allowed("owner", req) || !sameOriginHttps(req) || !current) {
        return res.status(403).json({ error: "preapproval_unavailable" });
      }
      if (!checkCsrf(req)) return res.status(403).json({ error: "preapproval_csrf_invalid" });
      if (rateLimited(current.id)) return res.status(429).json({ error: "preapproval_rate_limited" });
      const id = req.params.id;
      const version = req.body?.version;
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) ||
        !Number.isSafeInteger(version) || version < 1) {
        return res.status(400).json({ error: "preapproval_request_invalid" });
      }
      try {
        const changed = await dependencies.store.decide({
          id, version, ownerId: current.id, approve,
        });
        return changed
          ? res.json({ status: approve ? "approved" : "rejected", version: version + 1 })
          : res.status(409).json({ error: "preapproval_stale_or_unavailable" });
      } catch (error) {
        logStagingWhatsappPreapprovalFailure("decide", error);
        return res.status(503).json({ error: "preapproval_temporarily_unavailable" });
      }
    });
  }

  app.post(`${EMPLOYEE_BASE}/:id/cancel`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const current = actor(req);
    if (!enabled() || !allowed("employee", req) || !sameOriginHttps(req) || !current) {
      return res.status(403).json({ error: "preapproval_unavailable" });
    }
    if (!checkCsrf(req)) return res.status(403).json({ error: "preapproval_csrf_invalid" });
    if (rateLimited(current.id)) return res.status(429).json({ error: "preapproval_rate_limited" });
    const version = req.body?.version;
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !Number.isSafeInteger(version) || version < 1) {
      return res.status(400).json({ error: "preapproval_request_invalid" });
    }
    try {
      const changed = await dependencies.store.cancel({ id: req.params.id, version, employeeId: current.id });
      return changed ? res.json({ status: "cancelled", version: version + 1 })
        : res.status(409).json({ error: "preapproval_stale_or_unavailable" });
    } catch (error) {
      logStagingWhatsappPreapprovalFailure("cancel", error);
      return res.status(503).json({ error: "preapproval_temporarily_unavailable" });
    }
  });
}

export const STAGING_WHATSAPP_PREAPPROVAL_PATHS = { employee: EMPLOYEE_BASE, owner: OWNER_BASE };
