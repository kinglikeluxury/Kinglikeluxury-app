import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { Express, Request, Response } from "express";
import { getStagingIdentity, type StagingIdentityActor } from "./stagingIdentityAuth";

export type ProvisionedRole = "crm_employee" | "sub_agent" | "owner_approver" | "legal_reviewer";
const ROLES = new Set<ProvisionedRole>(["crm_employee", "sub_agent", "owner_approver", "legal_reviewer"]);
const CSRF_TTL = 5 * 60_000;
const INVITE_TTL = 30 * 60_000;

export type ProvisioningStore = Readonly<{
  hasActiveInvite(emailHash: string, role: ProvisionedRole): Promise<boolean>;
  revokeActiveInvite(
    emailHash: string, role: ProvisionedRole, actorId: number, reason: string,
  ): Promise<boolean>;
  issueInvite(input: {
    email: string; emailHash: string; role: ProvisionedRole; tokenHash: string;
    creatorId: number; expiresAt: Date;
  }): Promise<{ id: string } | "duplicate">;
  setVerificationCode(id: string, codeHash: string, expiresAt: Date): Promise<boolean>;
  revokeInvite(id: string, actorId: number, reason: string): Promise<void>;
  redeemInvite(input: {
    tokenHash: string; email: string; proofCode: string; subjectHash: string; passwordHash: string;
    verificationMethod: "email_otp";
  }): Promise<"activated" | "invalid" | "duplicate">;
  disableUser(id: number, actorId: number): Promise<boolean>;
}>;

export type VerifiedIdentityProvider = Readonly<{
  isConfigured(): boolean;
  passwordResetReadiness?(): {
    ready: boolean;
    apiKeyPresent: boolean;
    approvalEnabled: boolean;
    fromFormatValid: boolean;
    senderDomainMatch: boolean;
    employeeAllowlistMatch: boolean;
    resetPageReady: boolean;
  };
  ownerPasswordResetReadiness?(): {
    ready: boolean;
    apiKeyPresent: boolean;
    approvalEnabled: boolean;
    fromFormatValid: boolean;
    senderDomainMatch: boolean;
    ownerAllowlistMatch: boolean;
    resetPageReady: boolean;
  };
  designatedEmail(role: ProvisionedRole): string | null;
  ownerBootstrapReady(): boolean;
  isOwnerDesignated(email: string, role: ProvisionedRole): Promise<boolean>;
  canBootstrapOwner(actor: StagingIdentityActor): Promise<boolean>;
  deliverInvite(email: string, role: ProvisionedRole, token: string, proofCode: string, inviteId: string): Promise<boolean>;
  deliverOwnerBootstrap(email: string, proofCode: string, challengeId: string): Promise<boolean>;
  deliverPasswordReset?(email: string, token: string): Promise<boolean>;
  deliverOwnerPasswordReset?(email: string, token: string): Promise<boolean>;
  deliveryReadiness?(expected: {
    ownerEmail: string;
    employeeEmail: string;
  }): Promise<{
    ownerAllowlistMatch: boolean;
    employeeAllowlistMatch: boolean;
    senderDomainMatch: boolean;
    apiKeyPresent: boolean;
  }>;
}>;

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function passwordAllowed(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 14 || value.length > 256) return false;
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)];
  return classes.filter(Boolean).length >= 3;
}

function constantEqual(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isOwnerApprover(req: Request): StagingIdentityActor | null {
  const actor = getStagingIdentity(req)?.actor;
  return actor?.active && actor.identityVerified && actor.isAdmin &&
    actor.role === "owner_approver"
    ? actor : null;
}

function checkCsrf(req: Request): boolean {
  const ctx = getStagingIdentity(req);
  const state = ctx?.state as { provisioningCsrf?: { token: string; expiresAt: number; sessionId: string } } | undefined;
  const csrf = state?.provisioningCsrf;
  return !!ctx && !!csrf && csrf.expiresAt > Date.now() &&
    csrf.sessionId === ctx.sessionId && constantEqual(req.header("x-csrf-token"), csrf.token);
}

function consumeCsrf(req: Request): boolean {
  if (!checkCsrf(req)) return false;
  const ctx = getStagingIdentity(req)!;
  delete (ctx.state as any).provisioningCsrf;
  return true;
}

function sameOrigin(req: Request): boolean {
  const origin = req.header("origin");
  const host = req.header("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === host.toLowerCase() &&
      parsed.protocol === (req.secure ? "https:" : "http:");
  } catch { return false; }
}

const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export function registerStagingIdentityProvisioningRoutes(
  app: Express,
  deps: { enabled?: boolean; store?: ProvisioningStore; verifier?: VerifiedIdentityProvider },
): void {
  const ready = deps.enabled === true && !!deps.store && !!deps.verifier &&
    deps.verifier.isConfigured();
  const attempts = new Map<string, { count: number; resetAt: number }>();
  const rateLimited = (req: Request, limit: number, scope: string) => {
    const now = Date.now();
    const key = `${scope}:${req.ip || "unknown"}`;
    const current = attempts.get(key);
    if (current && current.resetAt <= now) attempts.delete(key);
    const fresh = attempts.get(key);
    if (fresh && fresh.count >= limit) return true;
    attempts.set(key, fresh
      ? { count: fresh.count + 1, resetAt: fresh.resetAt }
      : { count: 1, resetAt: now + 15 * 60_000 });
    return false;
  };
  const blocked = (_req: Request, res: Response) =>
    res.status(503).json({ status: "BLOCKED", reason: "verified_provisioning_provider_unavailable" });

  app.get("/api/staging/identity/provisioning/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      status: ready ? "READY" : "BLOCKED",
      reason: ready ? "trusted_provider_configured" : "verified_provisioning_provider_unavailable",
    });
  });

  app.get("/api/staging/identity/provisioning/invites/employee/status", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const actor = isOwnerApprover(req);
    const email = normalizeEmail(deps.verifier?.designatedEmail("crm_employee"));
    if (!actor || !deps.store || !email) {
      return res.status(403).json({ status: "BLOCKED", reason: "owner_approver_required" });
    }
    try {
      return res.json({ active: await deps.store.hasActiveInvite(digest(email), "crm_employee") });
    } catch {
      return res.status(503).json({ status: "BLOCKED", reason: "invite_status_unavailable" });
    }
  });

  app.post("/api/staging/identity/provisioning/csrf", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.secure || !sameOrigin(req)) return res.status(403).json({ error: "same_origin_https_required" });
    const actor = isOwnerApprover(req);
    const ctx = getStagingIdentity(req);
    if (!actor || !ctx) return res.status(403).json({ error: "staging_admin_required" });
    const token = crypto.randomBytes(32).toString("base64url");
    (ctx.state as any).provisioningCsrf = {
      token, sessionId: ctx.sessionId, expiresAt: Date.now() + CSRF_TTL,
    };
    return res.json({ csrfToken: token, expiresInSeconds: CSRF_TTL / 1000 });
  });

  const issue = (role: ProvisionedRole) => async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (!ready || !deps.store || !deps.verifier) return blocked(req, res);
    if (!req.secure) return res.status(403).json({ error: "https_required" });
    if (!sameOrigin(req)) return res.status(403).json({ error: "same_origin_required" });
    if (rateLimited(req, 10, `issue:${role}`)) return res.status(429).json({ error: "provisioning_rate_limited" });
    const actor = isOwnerApprover(req);
    if (!actor) return res.status(403).json({ error: "staging_admin_required" });
    if (!consumeCsrf(req)) return res.status(403).json({ error: "provisioning_csrf_invalid" });
    if (!ROLES.has(role)) return res.status(400).json({ error: "role_not_allowed" });
    if (role === "owner_approver" &&
        (actor.role !== "admin" ||
          !(await deps.verifier.canBootstrapOwner(actor).catch(() => false)))) {
      return res.status(403).json({ error: "owner_bootstrap_authority_required" });
    }
    const email = normalizeEmail(deps.verifier.designatedEmail(role));
    if (!email) return res.status(400).json({ error: "verified_target_required" });
    let issuedInviteId: string | null = null;
    try {
      if (!(await deps.verifier.isOwnerDesignated(email, role))) {
        return res.status(403).json({ error: "target_not_owner_designated" });
      }
      const token = crypto.randomBytes(32).toString("base64url");
      const result = await deps.store.issueInvite({
        email,
        emailHash: digest(email),
        role,
        tokenHash: digest(token),
        creatorId: actor.id,
        expiresAt: new Date(Date.now() + INVITE_TTL),
      });
      if (result === "duplicate") return res.status(409).json({ error: "invite_already_active" });
      issuedInviteId = result.id;
      const proofCode = crypto.randomInt(100000, 1000000).toString();
      const proofCodeHash = await bcrypt.hash(proofCode, 12);
      const codeExpiresAt = new Date(Date.now() + 10 * 60_000);
      if (!(await deps.store.setVerificationCode(result.id, proofCodeHash, codeExpiresAt))) {
        await deps.store.revokeInvite(result.id, actor.id, "challenge_store_failed");
        return res.status(503).json({ error: "verification_challenge_unavailable" });
      }
      if (!(await deps.verifier.deliverInvite(email, role, token, proofCode, result.id))) {
        await deps.store.revokeInvite(result.id, actor.id, "delivery_failed");
        return res.status(503).json({ error: "invite_delivery_unavailable" });
      }
      return res.status(202).json({ status: "invite_sent", inviteId: result.id, expiresInSeconds: INVITE_TTL / 1000 });
    } catch {
      if (issuedInviteId) {
        await deps.store.revokeInvite(issuedInviteId, actor.id, "provisioning_failed").catch(() => undefined);
      }
      return res.status(503).json({ error: "provisioning_unavailable" });
    }
  };
  app.post("/api/staging/identity/provisioning/invites/employee", issue("crm_employee"));
  app.post("/api/staging/identity/provisioning/invites/owner", issue("owner_approver"));
  app.post("/api/staging/identity/provisioning/invites/legal-reviewer", issue("legal_reviewer"));

  app.post("/api/staging/identity/provisioning/invites/employee/revoke-active", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!deps.store || !deps.verifier) return blocked(req, res);
    if (!req.secure) return res.status(403).json({ error: "https_required" });
    if (!sameOrigin(req)) return res.status(403).json({ error: "same_origin_required" });
    if (rateLimited(req, 10, "revoke_employee_invite")) return res.status(429).json({ error: "provisioning_rate_limited" });
    const actor = isOwnerApprover(req);
    if (!actor) return res.status(403).json({ error: "owner_approver_required" });
    if (!consumeCsrf(req)) return res.status(403).json({ error: "provisioning_csrf_invalid" });
    const email = normalizeEmail(deps.verifier.designatedEmail("crm_employee"));
    if (!email || !(await deps.verifier.isOwnerDesignated(email, "crm_employee").catch(() => false))) {
      return res.status(403).json({ error: "target_not_owner_designated" });
    }
    try {
      const revoked = await deps.store.revokeActiveInvite(
        digest(email), "crm_employee", actor.id, "owner_revoked_for_reissue",
      );
      return revoked
        ? res.json({ status: "invite_revoked" })
        : res.status(409).json({ status: "BLOCKED", reason: "no_active_employee_invite" });
    } catch {
      return res.status(503).json({ error: "provisioning_unavailable" });
    }
  });

  app.post("/api/staging/identity/provisioning/redeem", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!ready || !deps.store || !deps.verifier) return blocked(req, res);
    if (!req.secure) return res.status(403).json({ error: "https_required" });
    if (!sameOrigin(req)) return res.status(403).json({ error: "same_origin_required" });
    if (rateLimited(req, 8, "redeem")) return res.status(429).json({ error: "provisioning_rate_limited" });
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const email = normalizeEmail(req.body?.email);
    const proof = typeof req.body?.proof === "string" ? req.body.proof : "";
    const password = req.body?.password;
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token) || !email || !/^\d{6}$/.test(proof) ||
        !passwordAllowed(password)) {
      return res.status(400).json({ error: "invite_redemption_invalid" });
    }
    try {
      const result = await deps.store.redeemInvite({
        tokenHash: digest(token),
        email,
        proofCode: proof,
        subjectHash: digest(`email:${email}`),
        passwordHash: await bcrypt.hash(password, 12),
        verificationMethod: "email_otp",
      });
      if (result === "duplicate") return res.status(409).json({ error: "identity_already_provisioned" });
      if (result !== "activated") return res.status(403).json({ error: "invite_invalid_or_expired" });
      return res.status(201).json({ status: "identity_activated" });
    } catch {
      return res.status(503).json({ error: "provisioning_unavailable" });
    }
  });

  app.post("/api/staging/identity/provisioning/users/:id/disable", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!ready || !deps.store) return blocked(req, res);
    if (!req.secure || !sameOrigin(req)) return res.status(403).json({ error: "same_origin_https_required" });
    const actor = isOwnerApprover(req);
    if (!actor) return res.status(403).json({ error: "staging_admin_required" });
    if (!consumeCsrf(req)) return res.status(403).json({ error: "provisioning_csrf_invalid" });
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || id === actor.id) {
      return res.status(400).json({ error: "target_identity_invalid" });
    }
    try {
      return await deps.store.disableUser(id, actor.id)
        ? res.json({ status: "identity_disabled" })
        : res.status(409).json({ error: "identity_disable_rejected" });
    } catch {
      return res.status(503).json({ error: "provisioning_unavailable" });
    }
  });

  app.post("/api/staging/identity/provisioning/invites/:id/revoke", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!ready || !deps.store) return blocked(req, res);
    if (!req.secure || !sameOrigin(req)) return res.status(403).json({ error: "same_origin_https_required" });
    const actor = isOwnerApprover(req);
    if (!actor) return res.status(403).json({ error: "staging_admin_required" });
    if (!consumeCsrf(req)) return res.status(403).json({ error: "provisioning_csrf_invalid" });
    const inviteId = typeof req.params.id === "string" ? req.params.id : "";
    if (!/^[0-9a-f-]{36}$/i.test(inviteId)) return res.status(400).json({ error: "invite_id_invalid" });
    try {
      await deps.store.revokeInvite(inviteId, actor.id, "admin_revoked");
      return res.json({ status: "invite_revoked" });
    } catch {
      return res.status(503).json({ error: "provisioning_unavailable" });
    }
  });
}
