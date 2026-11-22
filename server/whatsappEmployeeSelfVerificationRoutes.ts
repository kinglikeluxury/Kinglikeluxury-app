import crypto from "node:crypto";
import type { Express, Request } from "express";
import { isCrmEmployeeRole } from "@shared/crmRoles";
import { getStagingIdentity } from "./stagingIdentityAuth";

export type EmployeeVerificationActor = Readonly<{
  id: number;
  isActive: boolean;
  isAdmin: boolean;
  role: string | null;
}>;
export type EmployeeBindingStatus =
  | "not_connected" | "pending" | "approved_not_connected" | "verified"
  | "connected" | "revoked" | "error";
type NoticeIntent = {
  employeeId: number; sessionId: string; noticeVersion: string;
  retentionDays: number; expiresAt: number;
};
type NoticeCsrf = { token: string; sessionId: string; employeeId: number; expiresAt: number };
type EmployeeSession = {
  whatsappWorkNotice?: NoticeIntent;
  whatsappWorkNoticeCsrf?: NoticeCsrf;
};
const NOTICE_TTL_MS = 10 * 60_000;
const CSRF_TTL_MS = 5 * 60_000;
const BASE = "/api/employee/whatsapp-meta-verification";

export function employeeWhatsappVerificationState(
  env: NodeJS.ProcessEnv, actor: EmployeeVerificationActor,
): "awaiting_company_setup" | "awaiting_meta_verification" {
  const pilot = env.APP_DEPLOYMENT_MODE === "staging" &&
    /^[1-9]\d*$/.test(env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID ?? "") &&
    Number(env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID) === actor.id;
  return pilot &&
    env.WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED === "true" &&
    env.WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED === "true"
    ? "awaiting_meta_verification" : "awaiting_company_setup";
}

export function hasEmployeeWhatsappNotice(
  req: Request, employeeId: number, noticeVersion?: string, retentionDays?: number, now = Date.now(),
): boolean {
  const session = (getStagingIdentity(req)?.state ?? (req as any).session) as EmployeeSession | undefined;
  const intent = session?.whatsappWorkNotice;
  return !!intent && intent.employeeId === employeeId &&
    intent.sessionId === (getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? "")) &&
    intent.expiresAt > now &&
    (noticeVersion === undefined || intent.noticeVersion === noticeVersion) &&
    (retentionDays === undefined || intent.retentionDays === retentionDays);
}

export function consumeEmployeeWhatsappNotice(req: Request, employeeId: number): void {
  if (hasEmployeeWhatsappNotice(req, employeeId)) {
    delete ((getStagingIdentity(req)?.state ?? (req as any).session) as EmployeeSession).whatsappWorkNotice;
  }
}

function secureEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function registerEmployeeWhatsappVerificationRoutes(
  app: Express,
  deps: Readonly<{
    currentActor(req: Request): Promise<EmployeeVerificationActor | null>;
    getBindingStatus?(employeeId: number): Promise<{
      status: Exclude<EmployeeBindingStatus, "error">;
      metaVerified: boolean; phoneConnected: boolean; phoneNumberId: string | null;
    }>;
    getNoticeEligibility?(employeeId: number): Promise<{
      currentNoticeReceived: boolean;
      noticeVersion: string;
      customerNoticeVersion: string;
      retentionDays: number;
      policyApproved: boolean;
      lawfulBasis: string;
      legalAssessmentReference: string;
      noticeText: string;
      customerTransparencyText: string;
      companyWorkNumberOnly: boolean;
    } | null>;
    recordNoticeRead?(employeeId: number, noticeVersion: string): Promise<boolean>;
    simulationOnly?: boolean;
    requireStagingIdentity?: boolean;
    env?: NodeJS.ProcessEnv;
    now?: () => number;
  }>,
): void {
  const env = deps.env ?? process.env;
  const now = () => deps.now?.() ?? Date.now();
  const actorFor = async (req: Request, res: any) => {
    if (deps.requireStagingIdentity && !getStagingIdentity(req)) {
      res.status(401).json({ error: "staging_identity_required" }); return null;
    }
    let actor: EmployeeVerificationActor | null;
    try { actor = await deps.currentActor(req); } catch { res.status(503).json({ error: "employee_service_unavailable" }); return null; }
    if (!actor || !Number.isSafeInteger(actor.id) || actor.id < 1 ||
      actor.isActive !== true || actor.isAdmin || !isCrmEmployeeRole(actor.role)) {
      res.status(403).json({ error: "employee_access_required" }); return null;
    }
    return actor;
  };
  const statusFor = async (employeeId: number) => {
    if (!deps.getBindingStatus) throw new Error("Binding status source unavailable.");
    return deps.getBindingStatus(employeeId);
  };
  app.get(BASE, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    const actor = await actorFor(req, res); if (!actor) return;
    let status: EmployeeBindingStatus = "error";
    let metaVerified = false; let phoneConnected = false;
    let noticeAvailable = false; let noticeVersion: string | null = null;
    let retentionDays: number | null = null;
    let companyTransparencyText: string | null = null;
    let employeeNoticeText: string | null = null;
    let lawfulBasis: string | null = null;
    try {
      const result = await statusFor(actor.id);
      status = result.status; metaVerified = result.metaVerified;
      phoneConnected = result.status === "connected" && result.phoneConnected;
      const terms = await deps.getNoticeEligibility?.(actor.id);
      noticeAvailable = !!terms && terms.policyApproved &&
        !!terms.legalAssessmentReference &&
        !!terms.lawfulBasis && !!terms.noticeText && !!terms.customerNoticeVersion &&
        typeof terms.noticeVersion === "string" && Number.isInteger(terms.retentionDays) &&
        terms.retentionDays > 0 && terms.retentionDays <= 3650;
      if (noticeAvailable) {
        noticeVersion = terms!.noticeVersion; retentionDays = terms!.retentionDays;
      companyTransparencyText = terms!.customerTransparencyText;
        employeeNoticeText = terms!.noticeText;
        lawfulBasis = terms!.lawfulBasis;
      }
    } catch {
      status = "error"; metaVerified = false; phoneConnected = false;
      noticeAvailable = false; noticeVersion = null; retentionDays = null;
      companyTransparencyText = null;
      employeeNoticeText = null; lawfulBasis = null;
    }
    return res.json({
      mode: deps.simulationOnly === true ? "employee_verification_simulation" : "employee_verification_only",
      simulationOnly: deps.simulationOnly === true,
      status, metaEnrollmentVerified: metaVerified,
      phoneConnected, noticeAvailable, noticeVersion, retentionDays, companyTransparencyText,
      lawfulBasis, employeeNoticeText,
      readiness: employeeWhatsappVerificationState(env, actor),
      availableActions: noticeAvailable ? ["acknowledge_notice"] : [],
      employeeCanDisconnect: false,
      employeeCanCancelEnrollment: false,
    });
  });
  app.post(`${BASE}/csrf`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const actor = await actorFor(req, res); if (!actor) return;
    const sessionId = getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? "");
    if (!sessionId) return res.status(503).json({ error: "employee_session_unavailable" });
    const token = crypto.randomBytes(32).toString("base64url");
    (((getStagingIdentity(req)?.state ?? (req as any).session) as EmployeeSession)).whatsappWorkNoticeCsrf = {
      token, sessionId, employeeId: actor.id, expiresAt: now() + CSRF_TTL_MS,
    };
    return res.json({ csrfToken: token, expiresInSeconds: CSRF_TTL_MS / 1000 });
  });
  app.post(`${BASE}/notice-read`, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const actor = await actorFor(req, res); if (!actor) return;
    const session = (getStagingIdentity(req)?.state ?? (req as any).session) as EmployeeSession;
    const csrf = session.whatsappWorkNoticeCsrf;
    if (!csrf || csrf.employeeId !== actor.id ||
      csrf.sessionId !== (getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? "")) ||
      csrf.expiresAt <= now() || !secureEqual(req.header("x-csrf-token"), csrf.token)) {
      return res.status(403).json({ error: "employee_notice_csrf_invalid" });
    }
    delete session.whatsappWorkNoticeCsrf;
    if ((req.body as any)?.readConfirmed !== true) {
      delete session.whatsappWorkNotice;
      return res.status(400).json({ error: "notice_receipt_required" });
    }
    try {
      const terms = await deps.getNoticeEligibility?.(actor.id);
      if (!terms || !terms.policyApproved ||
        !terms.legalAssessmentReference || !terms.lawfulBasis ||
        !terms.noticeVersion || !terms.customerNoticeVersion ||
        !Number.isInteger(terms.retentionDays) ||
        terms.retentionDays < 1 || terms.retentionDays > 3650) {
        return res.status(409).json({ error: "current_archive_policy_required" });
      }
      if (!deps.recordNoticeRead ||
        !(await deps.recordNoticeRead(actor.id, terms.noticeVersion))) {
        return res.status(503).json({ error: "notice_receipt_unavailable" });
      }
      const sessionId = getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? "");
      session.whatsappWorkNotice = {
        employeeId: actor.id, sessionId, noticeVersion: terms.noticeVersion,
        retentionDays: terms.retentionDays, expiresAt: now() + NOTICE_TTL_MS,
      };
      return res.status(200).json({ status: "notice_receipt_recorded", expiresInSeconds: NOTICE_TTL_MS / 1000 });
    } catch { return res.status(503).json({ error: "employee_service_unavailable" }); }
  });
}
