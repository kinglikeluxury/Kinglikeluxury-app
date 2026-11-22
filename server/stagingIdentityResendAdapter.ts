import { Resend } from "resend";
import type { ProvisionedRole, VerifiedIdentityProvider } from "./stagingIdentityProvisioning";
import type { StagingIdentityActor } from "./stagingIdentityAuth";

type ResendMessage = { from: string; to: string; subject: string; text: string };
type Send = (apiKey: string, message: ResendMessage) => Promise<boolean>;

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function activationPageUrl(env: NodeJS.ProcessEnv): string | null {
  if (env.NODE_ENV !== "development" || env.APP_DEPLOYMENT_MODE !== "staging") return null;
  const host = env.REPLIT_DEV_DOMAIN?.trim().toLowerCase();
  if (!host || !/^(?:[a-z0-9-]+\.)+replit\.dev$/.test(host)) return null;
  return `https://${host}/staging/whatsapp-employee-activate`;
}
function passwordResetPageUrl(env: NodeJS.ProcessEnv): string | null {
  if (env.NODE_ENV !== "development" || env.APP_DEPLOYMENT_MODE !== "staging") return null;
  const host = env.REPLIT_DEV_DOMAIN?.trim().toLowerCase();
  if (!host || !/^(?:[a-z0-9-]+\.)+replit\.dev$/.test(host)) return null;
  return `https://${host}/staging/whatsapp-password-reset`;
}

function parseAllowlist(raw: string | undefined): Map<string, ProvisionedRole[]> {
  if (!raw) return new Map();
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return new Map();
    const result = new Map<string, ProvisionedRole[]>();
    for (const [email, roles] of Object.entries(value)) {
      const normalized = normalizedEmail(email);
      const allowed = Array.isArray(roles)
        ? roles.filter((role): role is ProvisionedRole =>
          ["crm_employee", "sub_agent", "owner_approver", "legal_reviewer"].includes(String(role)))
        : [];
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && allowed.length) {
        result.set(normalized, allowed.filter((role, index) => allowed.indexOf(role) === index));
      }
    }
    return result;
  } catch {
    return new Map();
  }
}

function defaultSend(apiKey: string, message: ResendMessage): Promise<boolean> {
  return new Resend(apiKey).emails.send(message).then((result) => !result.error).catch(() => false);
}

export function createStagingResendIdentityProvider(
  env: NodeJS.ProcessEnv,
  send: Send = defaultSend,
): VerifiedIdentityProvider {
  const allowlist = parseAllowlist(env.WHATSAPP_STAGING_IDENTITY_EMAIL_ALLOWLIST);
  const apiKey = env.WHATSAPP_STAGING_RESEND_API_KEY;
  const from = env.WHATSAPP_STAGING_IDENTITY_EMAIL_FROM?.trim();
  const fromFormatValid = !!from &&
    /^[^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/.test(from);
  const gatesPass = env.NODE_ENV === "development" &&
    env.APP_DEPLOYMENT_MODE === "staging" &&
    env.WHATSAPP_STAGING_IDENTITY_EMAIL_APPROVED === "true" &&
    !!apiKey &&
    fromFormatValid;
  const designatedEmail = (role: ProvisionedRole): string | null => {
    const matches = Array.from(allowlist.entries())
      .filter(([, roles]) => roles.includes(role))
      .map(([email]) => email);
    return matches.length === 1 ? matches[0] : null;
  };
  const passwordResetReadiness = () => {
    const fromMatch = from?.match(/<[^<>@\s]+@([^<>\s]+)>$/);
    const senderDomainMatch = fromMatch?.[1]?.toLowerCase() === "kinglikeluxury.app";
    const employeeAllowlistMatch =
      designatedEmail("crm_employee") === "kinglikeluxury.sales.ge@gmail.com";
    const resetPageReady = passwordResetPageUrl(env) !== null;
    return {
      ready: gatesPass && !!apiKey && senderDomainMatch &&
        employeeAllowlistMatch && resetPageReady,
      apiKeyPresent: !!apiKey,
      approvalEnabled: env.WHATSAPP_STAGING_IDENTITY_EMAIL_APPROVED === "true",
      fromFormatValid,
      senderDomainMatch,
      employeeAllowlistMatch,
      resetPageReady,
    };
  };
  const ownerPasswordResetReadiness = () => {
    const fromMatch = from?.match(/<[^<>@\s]+@([^<>\s]+)>$/);
    const senderDomainMatch = fromMatch?.[1]?.toLowerCase() === "kinglikeluxury.app";
    const ownerAllowlistMatch =
      designatedEmail("owner_approver") === "info@kinglikeluxury.app";
    const resetPageReady = passwordResetPageUrl(env) !== null;
    return {
      ready: gatesPass && !!apiKey && senderDomainMatch &&
        ownerAllowlistMatch && resetPageReady,
      apiKeyPresent: !!apiKey,
      approvalEnabled: env.WHATSAPP_STAGING_IDENTITY_EMAIL_APPROVED === "true",
      fromFormatValid,
      senderDomainMatch,
      ownerAllowlistMatch,
      resetPageReady,
    };
  };

  return {
    isConfigured() {
      return gatesPass &&
        designatedEmail("owner_approver") !== null &&
        designatedEmail("crm_employee") !== null;
    },
    passwordResetReadiness,
    ownerPasswordResetReadiness,
    designatedEmail(role) {
      return designatedEmail(role);
    },
    ownerBootstrapReady() {
      return gatesPass &&
        env.WHATSAPP_STAGING_OWNER_BOOTSTRAP_APPROVED === "true" &&
        designatedEmail("owner_approver") !== null;
    },
    async deliveryReadiness(expected) {
      const ownerAllowlistMatch =
        designatedEmail("owner_approver") === normalizedEmail(expected.ownerEmail);
      const employeeAllowlistMatch =
        designatedEmail("crm_employee") === normalizedEmail(expected.employeeEmail);
      const match = from?.match(/<[^<>@\s]+@([^<>\s]+)>$/);
      return {
        ownerAllowlistMatch,
        employeeAllowlistMatch,
        senderDomainMatch: match?.[1]?.toLowerCase() === "kinglikeluxury.app",
        apiKeyPresent: !!apiKey,
      };
    },
    async isOwnerDesignated(email, role) {
      if (!gatesPass) return false;
      return allowlist.get(normalizedEmail(email))?.includes(role) === true;
    },
    async canBootstrapOwner(actor: StagingIdentityActor) {
      return gatesPass &&
        env.WHATSAPP_STAGING_OWNER_BOOTSTRAP_APPROVED === "true" &&
        actor.active && actor.identityVerified && actor.isAdmin && actor.role === "admin";
    },
    async deliverInvite(email, role, token, proofCode, inviteId) {
      if (!gatesPass || !apiKey || !from ||
          !allowlist.get(normalizedEmail(email))?.includes(role) ||
          !/^[A-Za-z0-9_-]{40,64}$/.test(token) ||
          !/^\d{6}$/.test(proofCode) ||
          !/^[0-9a-f-]{36}$/i.test(inviteId)) return false;
      const target = normalizedEmail(email);
      const activationUrl = activationPageUrl(env);
      const message: ResendMessage = {
        from,
        to: target,
        subject: "Kinglike Luxury staging identity invitation",
        text: [
          "This message is for a staging-only WhatsApp identity invitation.",
          `Invitation ID: ${inviteId}`,
          `One-time invitation token: ${token}`,
          `Email verification code: ${proofCode}`,
          ...(activationUrl ? [`Activation page: ${activationUrl}`] : []),
          "The invitation expires in 30 minutes; the verification code expires in 10 minutes.",
          "If you did not expect this invitation, ignore it and contact the staging administrator.",
        ].join("\n"),
      };
      return send(apiKey, message);
    },
    async deliverOwnerBootstrap(email, proofCode, challengeId) {
      if (!gatesPass ||
          env.WHATSAPP_STAGING_OWNER_BOOTSTRAP_APPROVED !== "true" ||
          designatedEmail("owner_approver") !== normalizedEmail(email) ||
          !/^\d{6}$/.test(proofCode) ||
          !/^[0-9a-f-]{36}$/i.test(challengeId)) return false;
      return send(apiKey!, {
        from: from!,
        to: normalizedEmail(email),
        subject: "Kinglike Luxury staging owner verification",
        text: [
          "This message verifies the first owner_approver identity for the isolated staging system.",
          `Challenge ID: ${challengeId}`,
          `One-time verification code: ${proofCode}`,
          "The code expires in 10 minutes. Ignore this message if you did not request it.",
        ].join("\n"),
      });
    },
    async deliverPasswordReset(email, token) {
      if (!passwordResetReadiness().ready || !apiKey || !from ||
          normalizedEmail(email) !== "kinglikeluxury.sales.ge@gmail.com" ||
          designatedEmail("crm_employee") !== normalizedEmail(email) ||
          !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
      const page = passwordResetPageUrl(env);
      if (!page) return false;
      return send(apiKey, {
        from,
        to: normalizedEmail(email),
        subject: "Staging Auth password reset",
        text: [
          "This is a staging-only password reset link for the verified employee account.",
          `Reset page: ${page}#token=${token}`,
          "The one-time link expires in 15 minutes. Ignore this email if you did not request it.",
        ].join("\n"),
      });
    },
    async deliverOwnerPasswordReset(email, token) {
      if (!ownerPasswordResetReadiness().ready || !apiKey || !from ||
          normalizedEmail(email) !== "info@kinglikeluxury.app" ||
          designatedEmail("owner_approver") !== normalizedEmail(email) ||
          !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
      const page = passwordResetPageUrl(env);
      if (!page) return false;
      return send(apiKey, {
        from,
        to: normalizedEmail(email),
        subject: "Kinglike Luxury Staging owner password reset",
        text: [
          "This is a staging-only password reset link for the verified owner account.",
          `Reset page: ${page}#type=owner&token=${token}`,
          "The one-time link expires in 15 minutes. Ignore this email if you did not request it.",
        ].join("\n"),
      });
    },
  };
}
