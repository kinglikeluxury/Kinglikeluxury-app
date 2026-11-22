import crypto from "node:crypto";
import type { Express, Request } from "express";
import { getStagingIdentity } from "./stagingIdentityAuth";

type AdminIdentity = Readonly<{
  id: number;
  active: boolean;
  isAdmin: boolean;
  role?: string | null;
}>;
type PendingOwnerCsrf = { token: string; sessionId: string; expiresAt: number };
type SessionWithOwnerCsrf = { whatsappArchiveOwnerApprovalCsrf?: PendingOwnerCsrf };

const CSRF_PATH = "/api/admin/whatsapp-archive/owner-approval/csrf";
const APPROVE_PATH = "/api/admin/whatsapp-archive/owner-approval/:requestId/approve";
const PENDING_PATH = "/api/admin/whatsapp-archive/owner-approval/pending";
const CUSTOMER_NOTICE_INTENT_PATH =
  "/api/admin/whatsapp-archive/owner-approval/customer-notice-intents";
const CSRF_TTL_MS = 5 * 60_000;

function safeEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function registerWhatsappArchiveOwnerApprovalRoutes(
  app: Express,
  dependencies: {
    enabled?: boolean;
    requireStagingIdentity?: boolean;
    requireOwnerApprover?: boolean;
    currentAdmin(req: Request): Promise<AdminIdentity | null>;
    listPending?(sessionUserId: string): Promise<Array<Record<string, unknown>>>;
    approveRequest?(requestId: number, ownerSessionUserId: string): Promise<boolean>;
    createCustomerNoticeIntent?(
      phoneNumberId: string,
      recipientNumber: string,
      ownerSessionUserId: string,
    ): Promise<boolean>;
    now?: () => number;
  },
): void {
  const authorize = async (req: Request, res: any): Promise<AdminIdentity | null> => {
    if (dependencies.enabled !== true) {
      res.status(503).json({ error: "owner_approval_unavailable" });
      return null;
    }
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
    let admin: AdminIdentity | null;
    try {
      admin = await dependencies.currentAdmin(req);
    } catch {
      res.status(503).json({ error: "owner_approval_unavailable" });
      return null;
    }
    if (!admin || admin.id !== sessionUserId || !admin.active || !admin.isAdmin ||
        (dependencies.requireOwnerApprover && admin.role !== "owner_approver")) {
      res.status(403).json({ error: "admin_access_required" });
      return null;
    }
    return admin;
  };

  app.post(CSRF_PATH, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const admin = await authorize(req, res);
    if (!admin) return;
    const sessionId = getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? "");
    if (!sessionId) return res.status(503).json({ error: "owner_approval_unavailable" });
    const pending: PendingOwnerCsrf = {
      token: crypto.randomBytes(32).toString("base64url"),
      sessionId,
      expiresAt: (dependencies.now?.() ?? Date.now()) + CSRF_TTL_MS,
    };
    const state = getStagingIdentity(req)?.state ?? (req as any).session;
    (state as SessionWithOwnerCsrf).whatsappArchiveOwnerApprovalCsrf = pending;
    return res.json({ csrfToken: pending.token, expiresInSeconds: CSRF_TTL_MS / 1000 });
  });

  app.get(PENDING_PATH, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const admin = await authorize(req, res);
    if (!admin) return;
    if (!dependencies.listPending) return res.status(503).json({ error: "owner_approval_unavailable" });
    try {
      const pending = await dependencies.listPending(String(admin.id));
      return res.json({ requests: pending });
    } catch {
      return res.status(503).json({ error: "owner_approval_unavailable" });
    }
  });

  app.post(APPROVE_PATH, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const admin = await authorize(req, res);
    if (!admin) return;
    const session = (getStagingIdentity(req)?.state ?? (req as any).session) as SessionWithOwnerCsrf;
    const pending = session.whatsappArchiveOwnerApprovalCsrf;
    if (
      !pending ||
      pending.sessionId !== (getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? "")) ||
      pending.expiresAt <= (dependencies.now?.() ?? Date.now()) ||
      !safeEqual(req.header("x-csrf-token"), pending.token)
    ) return res.status(403).json({ error: "owner_approval_csrf_invalid" });
    delete session.whatsappArchiveOwnerApprovalCsrf;
    const requestId = Number((req.params as any).requestId);
    if (!Number.isSafeInteger(requestId) || requestId < 1 || !dependencies.approveRequest) {
      return res.status(503).json({ error: "owner_approval_unavailable" });
    }
    try {
      const approved = await dependencies.approveRequest(requestId, String(admin.id));
      if (!approved) return res.status(409).json({ error: "approval_request_unavailable" });
      return res.status(200).json({ status: "approved_not_connected" });
    } catch {
      return res.status(503).json({ error: "owner_approval_unavailable" });
    }
  });

  app.post(CUSTOMER_NOTICE_INTENT_PATH, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const admin = await authorize(req, res);
    if (!admin) return;
    const session = (getStagingIdentity(req)?.state ?? (req as any).session) as SessionWithOwnerCsrf;
    const pending = session.whatsappArchiveOwnerApprovalCsrf;
    if (
      !pending ||
      pending.sessionId !== (getStagingIdentity(req)?.sessionId ?? String((req as any).sessionID ?? "")) ||
      pending.expiresAt <= (dependencies.now?.() ?? Date.now()) ||
      !safeEqual(req.header("x-csrf-token"), pending.token)
    ) return res.status(403).json({ error: "owner_approval_csrf_invalid" });
    delete session.whatsappArchiveOwnerApprovalCsrf;
    const body = req.body as Record<string, unknown> | undefined;
    const phoneNumberId = body?.phoneNumberId;
    const recipientNumber = body?.recipientNumber;
    if (
      typeof phoneNumberId !== "string" || !/^[0-9]{1,40}$/.test(phoneNumberId) ||
      typeof recipientNumber !== "string" || !/^[0-9]{5,40}$/.test(recipientNumber) ||
      !dependencies.createCustomerNoticeIntent
    ) return res.status(400).json({ error: "customer_notice_intent_invalid" });
    try {
      const recorded = await dependencies.createCustomerNoticeIntent(
        phoneNumberId, recipientNumber, String(admin.id),
      );
      return recorded
        ? res.status(200).json({ status: "intent_registered" })
        : res.status(409).json({ error: "customer_notice_intent_unavailable" });
    } catch {
      return res.status(503).json({ error: "customer_notice_intent_unavailable" });
    }
  });
}

export const WHATSAPP_ARCHIVE_OWNER_APPROVAL_PATHS = Object.freeze({
  csrf: CSRF_PATH,
  pending: PENDING_PATH,
  approve: APPROVE_PATH,
  customerNoticeIntent: CUSTOMER_NOTICE_INTENT_PATH,
});
