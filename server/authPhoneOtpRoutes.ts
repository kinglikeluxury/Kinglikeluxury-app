import type { RequestHandler } from "express";
import { randomInt } from "node:crypto";
import type { IStorage } from "./storage";
import {
  bindPhoneOtpLoginChallenge,
  clearPhoneOtpSessionProofs,
  consumePhoneOtpLoginChallenge,
  getValidPhoneOtpLoginChallenge,
  setPhoneRegistrationProof,
  type PhoneOtpAttemptLimiter,
} from "./phoneOtpProof";

type PhoneOtpSendAuthorization =
  | { allowed: true }
  | { allowed: false; status: number; body: unknown };

export function createPhoneOtpIssueHandler(dependencies: {
  storage: Pick<IStorage, "getUserByPhone" | "createVerificationCode">;
  authorizeSend(
    req: Parameters<RequestHandler>[0],
    phoneNumber: string,
  ): Promise<PhoneOtpSendAuthorization>;
  deliverCode(phoneNumber: string, code: string): Promise<void>;
  generateCode?: () => string;
  now?: () => number;
  onSuccess?(req: Parameters<RequestHandler>[0], phoneNumber: string): void;
  onFailure?(req: Parameters<RequestHandler>[0], error: unknown): void;
}): RequestHandler {
  const {
    storage,
    authorizeSend,
    deliverCode,
    generateCode = () => randomInt(100000, 1000000).toString(),
    now = Date.now,
    onSuccess,
    onFailure,
  } = dependencies;

  return async (req, res) => {
    const phoneNumber =
      typeof req.body?.phoneNumber === "string" ? req.body.phoneNumber : "";
    if (!phoneNumber) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    try {
      const authorization = await authorizeSend(req, phoneNumber);
      if (!authorization.allowed) {
        return res.status(authorization.status).json(authorization.body);
      }

      const code = generateCode();
      if (!/^\d{6}$/.test(code)) throw new Error("OTP generator returned an invalid code");
      const expiresAt = new Date(now() + 10 * 60 * 1000);
      const existingPhoneUser = await storage.getUserByPhone(phoneNumber);
      await storage.createVerificationCode(phoneNumber, code, expiresAt);
      bindPhoneOtpLoginChallenge(
        req.session,
        phoneNumber,
        existingPhoneUser?.id ?? null,
        expiresAt.getTime(),
      );
      await deliverCode(phoneNumber, code);
      onSuccess?.(req, phoneNumber);
      return res.json({
        success: true,
        method: "sms",
        message: "Verification code sent via SMS",
      });
    } catch (error) {
      clearPhoneOtpSessionProofs(req.session);
      onFailure?.(req, error);
      return res.status(503).json({
        code: "DELIVERY_UNAVAILABLE",
        message: "We could not send a verification code. Please try again later.",
      });
    }
  };
}

export function createPhoneOtpVerificationHandler(dependencies: {
  storage: Pick<IStorage, "verifyCode">;
  allowPhoneOtpAttempt: PhoneOtpAttemptLimiter;
}): RequestHandler {
  const { storage, allowPhoneOtpAttempt } = dependencies;

  return async (req, res) => {
    const phoneNumber =
      typeof req.body?.phoneNumber === "string" ? req.body.phoneNumber : "";
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const challenge = getValidPhoneOtpLoginChallenge(req.session, phoneNumber);

    if (!phoneNumber || !challenge) {
      return res.status(401).json({ message: "Invalid or expired verification proof" });
    }
    let allowedAttempt: boolean;
    try {
      allowedAttempt = await allowPhoneOtpAttempt(
        phoneNumber,
        req.ip || req.socket.remoteAddress || "",
      );
    } catch {
      return res.status(503).json({
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "Verification is temporarily unavailable.",
      });
    }
    if (!allowedAttempt) {
      return res.status(429).json({ code: "RATE_LIMITED", message: "Too many verification attempts. Request a new code later." });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: "Invalid or expired verification code" });
    }

    try {
      if (!(await storage.verifyCode(phoneNumber, code))) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }
      const consumedChallenge = consumePhoneOtpLoginChallenge(req.session, phoneNumber);
      if (!consumedChallenge) {
        return res.status(401).json({ message: "Invalid or expired verification proof" });
      }
      if (consumedChallenge.accountId === null) {
        setPhoneRegistrationProof(req.session, consumedChallenge);
      }
      return res.json({ success: true, verified: true });
    } catch {
      return res.status(503).json({
        code: "VERIFICATION_UNAVAILABLE",
        message: "Verification is temporarily unavailable.",
      });
    }
  };
}
