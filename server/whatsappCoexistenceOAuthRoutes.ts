import crypto from "node:crypto";
import type { Express, Request } from "express";
import { isCrmEmployeeRole } from "../shared/crmRoles";
import type {
  CompleteSignupInput,
  SignupAssetClaims,
} from "./whatsappCoexistenceOAuthFlow";
import {
  getWhatsappCoexistenceReadiness,
  type WhatsappCoexistenceReadinessContext,
} from "./whatsappCoexistenceReadiness";
import { getStagingIdentity } from "./stagingIdentityAuth";

type OAuthEmployee = Readonly<{
  id: number;
  active: boolean;
  isAdmin: boolean;
  role: string | null;
}>;

type PendingSignupState = {
  state: string;
  csrfToken: string;
  employeeId: number;
  sessionId: string;
  expiresAt: number;
  preapprovalId?: string;
  preapprovalVersion?: number;
};
type StartCsrfState = { token: string; employeeId: number; sessionId: string; expiresAt: number };

type SessionWithSignupState = {
  whatsappCoexistenceSignup?: PendingSignupState;
  whatsappCoexistenceStartCsrf?: StartCsrfState;
};

const STATE_TTL_MS = 5 * 60_000;
const START_WINDOW_MS = 15 * 60_000;
const MAX_STARTS_PER_EMPLOYEE = 5;
const START_PATH = "/api/employee/whatsapp-coexistence/oauth/start";
const FINISH_PATH = "/api/employee/whatsapp-coexistence/oauth/finish";

function safeEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
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

export function registerWhatsappCoexistenceOAuthRoutes(
  app: Express,
  dependencies: {
    currentEmployee(req: Request): Promise<OAuthEmployee | null>;
    completeSignup?(input: CompleteSignupInput): Promise<"created" | "duplicate">;
    completePreapprovedSignup?(input: {
      approvalId: string; version: number; employeeId: number; code: string;
      claims: SignupAssetClaims;
    }): Promise<"verified" | "stale">;
    getPreapprovalForAttempt?(input: {
      approvalId: string; version: number; employeeId: number;
    }): Promise<boolean>;
    employeeNoticeValid?(req: Request, employeeId: number): Promise<boolean> | boolean;
    consumeEmployeeNotice?(req: Request, employeeId: number): void;
    preapprovalStoreReady?(): Promise<boolean>;
    /** Read-only DB probes; must not call Meta or mutate state. */
    readinessContext?(): Promise<Partial<WhatsappCoexistenceReadinessContext>>;
    getSignupConfig?(): { appId: string; configId: string } | null;
    /** Main app sets this only after the staging-only readiness gate passes. */
    enabled?: boolean;
    /** Separate, still-disabled path for exact-number preapproval quarantine signup. */
    quarantineEnabled?: boolean;
    requireStagingIdentity?: boolean;
    env?: NodeJS.ProcessEnv;
    /** In the isolated fixture server, returns a simulation result without Meta or persistence. */
    simulationOnly?: boolean;
    now?: () => number;
  },
): void {
  const startLimits = new Map<number, { count: number; expiresAt: number }>();
  const startRateLimited = (employeeId: number, now: number) => {
    const prior = startLimits.get(employeeId);
    if (!prior || prior.expiresAt <= now) {
      startLimits.set(employeeId, { count: 1, expiresAt: now + START_WINDOW_MS });
      return false;
    }
    prior.count++;
    return prior.count > MAX_STARTS_PER_EMPLOYEE;
  };
  const consumeStartCsrf = (req: Request, employeeId: number, now: number): boolean => {
    const session = (getStagingIdentity(req)?.state ?? (req as any).session) as SessionWithSignupState;
    const record = session?.whatsappCoexistenceStartCsrf;
    const sessionId = getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? "");
    if (!record || record.employeeId !== employeeId || record.sessionId !== sessionId ||
      record.expiresAt <= now || !safeEqual(req.header("x-csrf-token"), record.token)) return false;
    delete session.whatsappCoexistenceStartCsrf;
    return true;
  };
  const getEmployee = async (req: Request, res: any): Promise<OAuthEmployee | null> => {
    const stagingIdentity = getStagingIdentity(req);
    if (dependencies.requireStagingIdentity && !stagingIdentity) {
      res.status(401).json({ error: "staging_identity_required" });
      return null;
    }
    const sessionUserId = dependencies.requireStagingIdentity
      ? stagingIdentity?.actor.id
      : Number((req as any).session?.userId);
    if (typeof sessionUserId !== "number" || !Number.isSafeInteger(sessionUserId) || sessionUserId < 1) {
      res.status(401).json({ error: "authentication_required" });
      return null;
    }
    let employee: OAuthEmployee | null;
    try {
      employee = await dependencies.currentEmployee(req);
    } catch {
      res.status(503).json({ error: "employee_auth_unavailable" });
      return null;
    }
    if (!employee) {
      res.status(401).json({ error: "authentication_required" });
      return null;
    }
    if (
      !Number.isSafeInteger(employee.id) ||
      employee.id < 1 ||
      employee.id !== sessionUserId ||
      !employee.active ||
      employee.isAdmin ||
      !isCrmEmployeeRole(employee.role)
    ) {
      res.status(403).json({ error: "employee_access_required" });
      return null;
    }
    return employee;
  };

  app.get("/api/employee/whatsapp-coexistence/readiness", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const employee = await getEmployee(req, res);
    if (!employee) return;
    const storeReady = await dependencies.preapprovalStoreReady?.().catch(() => false) ?? false;
    const serviceContext = await dependencies.readinessContext?.().catch(() => ({})) ?? {};
    const readiness = getWhatsappCoexistenceReadiness(dependencies.env ?? process.env, {
      ...serviceContext,
      validEmployeeSession: true,
      preapprovalMigrationApplied: storeReady,
      onboardingStoreAuthenticated: storeReady,
      minimalMetadataStoreVerified: storeReady,
    });
    const runtimeGateEnabled =
      dependencies.enabled === true || dependencies.quarantineEnabled === true;
    return res.json({
      ...readiness,
      oauthEnabled: readiness.oauthEnabled && runtimeGateEnabled,
      onboardingQuarantineReady:
        readiness.onboardingQuarantineReady && runtimeGateEnabled,
      quarantineWebhookEnabled:
        readiness.quarantineWebhookEnabled && runtimeGateEnabled,
      connectionReady: readiness.connectionReady && runtimeGateEnabled,
    });
  });

  app.post(`${START_PATH}/csrf`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const employee = await getEmployee(req, res);
    if (!employee) return;
    if (dependencies.requireStagingIdentity && !sameOriginHttps(req)) {
      return res.status(403).json({ error: "same_origin_https_required" });
    }
    if (dependencies.enabled !== true && dependencies.quarantineEnabled !== true) {
      return res.status(503).json({ error: "signup_not_activated" });
    }
    const sessionId = getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? "");
    if (!sessionId) return res.status(503).json({ error: "signup_session_unavailable" });
    const token = crypto.randomBytes(32).toString("base64url");
    const session = (getStagingIdentity(req)?.state ?? (req as any).session) as SessionWithSignupState;
    session.whatsappCoexistenceStartCsrf = {
      token, employeeId: employee.id, sessionId,
      expiresAt: (dependencies.now?.() ?? Date.now()) + STATE_TTL_MS,
    };
    return res.json({ csrfToken: token, expiresInSeconds: STATE_TTL_MS / 1000 });
  });

  app.post(START_PATH, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const employee = await getEmployee(req, res);
    if (!employee) return;
    if (dependencies.requireStagingIdentity && !sameOriginHttps(req)) {
      return res.status(403).json({ error: "same_origin_https_required" });
    }
    const quarantineMode = dependencies.quarantineEnabled === true;
    if (dependencies.enabled !== true && !quarantineMode) {
      return res.status(503).json({ error: "signup_not_activated" });
    }
    const requestNow = dependencies.now?.() ?? Date.now();
    if (dependencies.requireStagingIdentity && !consumeStartCsrf(req, employee.id, requestNow)) {
      return res.status(403).json({ error: "signup_csrf_invalid" });
    }
    if (startRateLimited(employee.id, requestNow)) {
      return res.status(429).json({ error: "signup_rate_limited" });
    }
    let preapprovalId: string | undefined;
    let preapprovalVersion: number | undefined;
    if (quarantineMode) {
      const body = req.body as Record<string, unknown> | null;
      if (typeof body?.approvalId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.approvalId) ||
        !Number.isSafeInteger(body.version) || Number(body.version) < 1 ||
        !dependencies.getPreapprovalForAttempt) {
        return res.status(403).json({ error: "approved_number_preapproval_required" });
      }
      preapprovalId = body.approvalId;
      preapprovalVersion = Number(body.version);
      try {
        if (!(await dependencies.getPreapprovalForAttempt({
          approvalId: preapprovalId, version: preapprovalVersion, employeeId: employee.id,
        }))) return res.status(403).json({ error: "approved_number_preapproval_required" });
      } catch { return res.status(503).json({ error: "preapproval_unavailable" }); }
      const signupConfig = dependencies.getSignupConfig?.();
      if (!signupConfig ||
          !/^\d{1,40}$/.test(signupConfig.appId) ||
          !/^\d{1,40}$/.test(signupConfig.configId)) {
        return res.status(503).json({ error: "signup_config_unavailable" });
      }
      (req as any).__stagingWhatsappSignupConfig = signupConfig;
    } else {
      let noticeValid = false;
      try {
        noticeValid = !!dependencies.employeeNoticeValid &&
          await dependencies.employeeNoticeValid(req, employee.id);
      } catch {
        return res.status(503).json({ error: "employee_notice_unavailable" });
      }
      if (!noticeValid) return res.status(403).json({ error: "employee_notice_required" });
    }
    const pending: PendingSignupState = {
      state: crypto.randomBytes(32).toString("base64url"),
      csrfToken: crypto.randomBytes(32).toString("base64url"),
      employeeId: employee.id,
      sessionId: getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? ""),
      expiresAt: requestNow + STATE_TTL_MS,
      preapprovalId,
      preapprovalVersion,
    };
    if (!pending.sessionId) {
      return res.status(503).json({ error: "signup_session_unavailable" });
    }
    const state = getStagingIdentity(req)?.state ?? (req as any).session as SessionWithSignupState;
    (state as SessionWithSignupState).whatsappCoexistenceSignup = pending;
    const signupConfig = (req as any).__stagingWhatsappSignupConfig as
      { appId: string; configId: string } | undefined;
    return res.json({
      state: pending.state,
      csrfToken: pending.csrfToken,
      expiresInSeconds: STATE_TTL_MS / 1000,
      status: "prepared_not_connected",
      mode: quarantineMode ? "approved_number_quarantine" : "archive_notice_flow",
      ...(signupConfig ? { metaSignupConfig: signupConfig } : {}),
    });
  });

  app.post(FINISH_PATH, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const employee = await getEmployee(req, res);
    if (!employee) return;
    if (dependencies.requireStagingIdentity && !sameOriginHttps(req)) {
      return res.status(403).json({ error: "same_origin_https_required" });
    }
    const session = (getStagingIdentity(req)?.state ?? (req as any).session) as SessionWithSignupState;
    const pending = session.whatsappCoexistenceSignup;
    const body = req.body as Record<string, unknown> | null;
    if (
      (dependencies.enabled !== true && dependencies.quarantineEnabled !== true) ||
      !pending ||
      pending.employeeId !== employee.id ||
      !pending.sessionId ||
      pending.sessionId !== (getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? "")) ||
      pending.expiresAt <= (dependencies.now?.() ?? Date.now()) ||
      (dependencies.quarantineEnabled === true &&
        (!pending.preapprovalId || !Number.isSafeInteger(pending.preapprovalVersion))) ||
      !safeEqual(body?.state, pending.state) ||
      !safeEqual(req.header("x-csrf-token"), pending.csrfToken)
    ) {
      return res.status(403).json({ error: "signup_state_invalid" });
    }
    // Consume only a valid, session-bound state. A forged request cannot burn
    // the employee's legitimate pending state, while successful attempts are
    // strictly one-time.
    delete session.whatsappCoexistenceSignup;
    if (
      typeof body?.code !== "string" ||
      body.code.length < 8 ||
      body.code.length > 4096
    ) {
      return res.status(400).json({ error: "authorization_code_invalid" });
    }
    if (dependencies.quarantineEnabled !== true && !dependencies.completeSignup) {
      return res.status(503).json({ error: "signup_verification_unavailable" });
    }
    const claims = body.assets as SignupAssetClaims | undefined;
    if (
      !claims ||
      typeof claims !== "object" ||
      typeof claims.businessId !== "string" ||
      typeof claims.wabaId !== "string" ||
      typeof claims.phoneNumberId !== "string"
    ) {
      return res.status(400).json({ error: "signup_assets_invalid" });
    }
    try {
      if (dependencies.quarantineEnabled === true) {
        if (!dependencies.completePreapprovedSignup || !pending.preapprovalId ||
          !pending.preapprovalVersion) {
          return res.status(503).json({ error: "preapproval_signup_unavailable" });
        }
        const result = await dependencies.completePreapprovedSignup({
          approvalId: pending.preapprovalId,
          version: pending.preapprovalVersion,
          employeeId: employee.id,
          code: body.code,
          claims,
        });
        if (result === "stale") return res.status(409).json({ error: "preapproval_changed" });
        return res.status(200).json({
          status: "owner_approval_pending",
          metaAssetsVerified: true,
          messagesStored: false,
          archiveEnabled: false,
        });
      }
      let noticeValid = false;
      try {
        noticeValid = !!dependencies.employeeNoticeValid &&
          await dependencies.employeeNoticeValid(req, employee.id);
      } catch {
        return res.status(503).json({ error: "employee_notice_unavailable" });
      }
      if (!noticeValid) return res.status(403).json({ error: "employee_notice_required" });
      dependencies.consumeEmployeeNotice?.(req, employee.id);
      const completeSignup = dependencies.completeSignup;
      if (!completeSignup) return res.status(503).json({ error: "signup_verification_unavailable" });
      const result = await completeSignup({
        actor: {
          employeeId: employee.id,
          sessionId: pending.sessionId,
        },
        code: body.code,
        claims,
        noticeReceiptRecorded: true,
      });
      if (dependencies.simulationOnly === true) {
        return res.status(200).json({
          status: "simulation_completed_not_connected",
          liveSignup: false,
          metaCalled: false,
          persisted: false,
        });
      }
      if (result === "created") {
        return res.status(202).json({ status: "owner_approval_pending" });
      }
      if (result === "duplicate") {
        return res.status(200).json({ status: "already_pending_owner_approval" });
      }
    } catch {
      // Codes, tokens, Graph errors, IDs, and provider responses are never
      // included in client errors or logs.
    }
    return res.status(503).json({ error: "signup_verification_unavailable" });
  });
}

export const WHATSAPP_COEXISTENCE_OAUTH_PATHS = Object.freeze({
  start: START_PATH,
  finish: FINISH_PATH,
});
