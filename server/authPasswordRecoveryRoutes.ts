import type { RequestHandler } from "express";
import type { IStorage } from "./storage";
import { isOtpActive, normalizeAuthEmail } from "@shared/authFlowUtils";

export type PasswordResetStore = Map<string, { code: string; expiresAt: Date }>;
export type IpOtpLimitStatus = "ok" | "rate_limited" | "blocked";
export type PasswordRecoveryStorage = Pick<
  IStorage,
  "getUserByEmail" | "getUserByPhone" | "updateUserPassword"
>;

type RecoveryLog = {
  type: "reset";
  identifier: string;
  ip: string;
  result: "sent" | "ip_blocked" | "ip_rate_limited" | "captcha_failed" | "phone_rate_limited";
  userAgent: string;
};

const GENERIC_OK = {
  code: "RECOVERY_REQUEST_ACCEPTED",
  message: "If an account exists, a code may be sent. We cannot confirm delivery; if it does not arrive, try again later.",
};

const INVALID_CODE = {
  code: "INVALID_OR_EXPIRED_CODE",
  message: "Invalid or expired verification code",
};

export function createPasswordRecoveryHandlers(dependencies: {
  storage: PasswordRecoveryStorage;
  passwordResetStore: PasswordResetStore;
  getClientIp(req: Parameters<RequestHandler>[0]): string;
  checkIpOtpLimit(ip: string): IpOtpLimitStatus;
  checkRequestRateLimit(identifier: string): boolean;
  checkVerifyRateLimit(identifier: string): boolean;
  verifyTurnstile(token: string | undefined, ip: string): Promise<boolean>;
  sendSms(phoneNumber: string, message: string): Promise<boolean>;
  sendEmailOtp(email: string, code: string): Promise<unknown>;
  generateCode(): string;
  now(): number;
  maskIdentifier(identifier: string): string;
  addOtpLog(entry: RecoveryLog): void;
  logWarning(message: string, error: unknown): void;
  logError(message: string, error: unknown): void;
}): {
  sendResetOtp: RequestHandler;
  verifyResetOtp: RequestHandler;
  resetPassword: RequestHandler;
} {
  const {
    storage, passwordResetStore, getClientIp, checkIpOtpLimit,
    checkRequestRateLimit, checkVerifyRateLimit, verifyTurnstile,
    sendSms, sendEmailOtp, generateCode, now, maskIdentifier,
    addOtpLog, logWarning, logError,
  } = dependencies;

  const sendResetOtp: RequestHandler = async (req, res) => {
    const ip = getClientIp(req);
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 300);
    try {
      const { method, phoneNumber, email, turnstileToken } = req.body;
      const identifier = phoneNumber || email || "?";

      const ipStatus = checkIpOtpLimit(ip);
      if (ipStatus === "blocked" || ipStatus === "rate_limited") {
        addOtpLog({
          type: "reset",
          identifier: maskIdentifier(identifier),
          ip,
          result: ipStatus === "blocked" ? "ip_blocked" : "ip_rate_limited",
          userAgent,
        });
        return res.status(429).json({
          code: "RATE_LIMITED",
          message: "Too many requests. Please wait before trying again.",
        });
      }

      const captchaOk = await verifyTurnstile(turnstileToken, ip);
      if (!captchaOk) {
        addOtpLog({
          type: "reset",
          identifier: maskIdentifier(identifier),
          ip,
          result: "captcha_failed",
          userAgent,
        });
        return res.status(403).json({
          code: "SECURITY_VALIDATION_FAILED",
          message: "Security verification failed. Please complete the check again.",
        });
      }

      if (method === "phone") {
        if (!phoneNumber || typeof phoneNumber !== "string") {
          return res.status(400).json({ message: "Phone number required" });
        }
        if (!checkRequestRateLimit(phoneNumber)) {
          addOtpLog({
            type: "reset",
            identifier: maskIdentifier(phoneNumber),
            ip,
            result: "phone_rate_limited",
            userAgent,
          });
          return res.status(429).json({
            code: "RATE_LIMITED",
            message: "Too many reset attempts. Please wait 15 minutes.",
          });
        }

        const code = generateCode();
        const expiresAt = new Date(now() + 10 * 60 * 1000);
        const message = `🔐 Kinglike Luxury\nPassword reset code: ${code}\nValid for 10 minutes.`;
        let delivered = false;

        try {
          delivered = await sendSms(phoneNumber, message);
        } catch (error) {
          logWarning(`[Reset OTP] SMS delivery failed for ${maskIdentifier(phoneNumber)}`, error);
        }

        if (!delivered) {
          try {
            const user = await storage.getUserByPhone(phoneNumber);
            if (user?.email) {
              await sendEmailOtp(user.email, code);
              delivered = true;
            }
          } catch (error) {
            logWarning(`[Reset OTP] Email fallback failed for ${maskIdentifier(phoneNumber)}`, error);
          }
        }

        if (delivered) passwordResetStore.set(`phone:${phoneNumber}`, { code, expiresAt });
        return res.json(GENERIC_OK);
      }

      if (method === "email") {
        if (!email || typeof email !== "string") {
          return res.status(400).json({ message: "Email required" });
        }
        const emailKey = normalizeAuthEmail(email);
        if (!checkRequestRateLimit(emailKey)) {
          return res.status(429).json({
            code: "RATE_LIMITED",
            message: "Too many reset attempts. Please wait 10 minutes.",
          });
        }

        const code = generateCode();
        const expiresAt = new Date(now() + 10 * 60 * 1000);
        try {
          const user = await storage.getUserByEmail(emailKey);
          if (user) {
            try {
              await sendEmailOtp(emailKey, code);
              passwordResetStore.set(`email:${emailKey}`, { code, expiresAt });
              addOtpLog({
                type: "reset",
                identifier: maskIdentifier(emailKey),
                ip,
                result: "sent",
                userAgent,
              });
            } catch (error) {
              logWarning(`[Reset OTP] Email delivery failed for ${maskIdentifier(emailKey)}`, error);
              passwordResetStore.delete(`email:${emailKey}`);
            }
          }
        } catch (error) {
          logWarning(`[Reset OTP] Email request failed for ${maskIdentifier(emailKey)}`, error);
        }
        return res.json(GENERIC_OK);
      }

      return res.status(400).json({ message: "Method must be 'phone' or 'email'" });
    } catch (error) {
      logError("[Reset OTP] Request failed", error);
      return res.status(503).json({
        code: "RECOVERY_UNAVAILABLE",
        message: "Recovery is temporarily unavailable. Please try again later.",
      });
    }
  };

  const verifyResetOtp: RequestHandler = async (req, res) => {
    try {
      const { method, phoneNumber, email, code } = req.body;
      if (!code) return res.status(400).json({ message: "Code required" });

      const verifyIdentifier = method === "phone"
        ? `phone:${phoneNumber || ""}`
        : `email:${typeof email === "string" ? normalizeAuthEmail(email) : ""}`;
      if (!checkVerifyRateLimit(verifyIdentifier)) {
        return res.status(429).json({
          code: "RATE_LIMITED",
          message: "Too many verification attempts. Request a new code later.",
        });
      }

      let record: { code: string; expiresAt: Date } | undefined;
      if (method === "phone" && phoneNumber) {
        record = passwordResetStore.get(`phone:${phoneNumber}`);
      } else if (method === "email" && email) {
        record = passwordResetStore.get(`email:${normalizeAuthEmail(email)}`);
      }

      if (!isOtpActive(record, String(code), now())) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }
      return res.json({ success: true });
    } catch (error) {
      logError("[Reset OTP] Code verification failed", error);
      return res.status(503).json({
        code: "VERIFICATION_UNAVAILABLE",
        message: "Verification is temporarily unavailable.",
      });
    }
  };

  const resetPassword: RequestHandler = async (req, res) => {
    try {
      const { method, phoneNumber, email, code, newPassword } = req.body;
      if (!code || !newPassword) {
        return res.status(400).json({ message: "Code and new password are required" });
      }
      if (typeof newPassword !== "string" || newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const resetIdentifier = method === "phone"
        ? `phone:${phoneNumber || ""}`
        : `email:${typeof email === "string" ? normalizeAuthEmail(email) : ""}`;
      if (!checkVerifyRateLimit(resetIdentifier)) {
        return res.status(429).json({
          code: "RATE_LIMITED",
          message: "Too many verification attempts. Request a new code later.",
        });
      }

      let user;
      let resetKey: string;
      if (method === "phone" && phoneNumber) {
        resetKey = `phone:${phoneNumber}`;
        if (!isOtpActive(passwordResetStore.get(resetKey), String(code), now())) {
          return res.status(400).json(INVALID_CODE);
        }
        user = await storage.getUserByPhone(phoneNumber);
      } else if (method === "email" && email) {
        const emailKey = normalizeAuthEmail(email);
        resetKey = `email:${emailKey}`;
        if (!isOtpActive(passwordResetStore.get(resetKey), String(code), now())) {
          return res.status(400).json(INVALID_CODE);
        }
        user = await storage.getUserByEmail(emailKey);
      } else {
        return res.status(400).json({ message: "Phone number or email required" });
      }

      if (!user) return res.json({ success: true });

      const updatedUser = await storage.updateUserPassword(user.id, newPassword);
      if (!updatedUser) {
        return res.status(503).json({
          code: "RECOVERY_UNAVAILABLE",
          message: "Recovery is temporarily unavailable.",
        });
      }
      passwordResetStore.delete(resetKey);
      return res.json({ success: true });
    } catch (error) {
      logError("[Reset OTP] Password update failed", error);
      return res.status(503).json({
        code: "RECOVERY_UNAVAILABLE",
        message: "Recovery is temporarily unavailable.",
      });
    }
  };

  return { sendResetOtp, verifyResetOtp, resetPassword };
}
