import type { RequestHandler } from "express";
import type { IStorage } from "./storage";
import { isAuthAccountEligible, verifyStoredPassword } from "@shared/authFlowUtils";
import {
  consumePhoneOtpLoginChallenge,
  getValidPhoneOtpLoginChallenge,
  type PhoneOtpAttemptLimiter,
} from "./phoneOtpProof";

type LoginUser = Awaited<ReturnType<IStorage["getUserByUsername"]>>;

export type LoginStorage = Pick<
  IStorage,
  "getUserByUsername" | "getUserByEmail" | "getUserByPhone" | "verifyCode"
>;

export function createLoginHandler(dependencies: {
  storage: LoginStorage;
  comparePassword(plainText: string, hash: string): Promise<boolean>;
  allowPhoneOtpAttempt: PhoneOtpAttemptLimiter;
}): RequestHandler {
  const { storage, comparePassword, allowPhoneOtpAttempt } = dependencies;

  return async (req, res) => {
    try {
      const { username, password, phoneNumber, authMethod } = req.body;
      let user: LoginUser;

      if (authMethod === "email") {
        if (!username || !password) {
          return res.status(400).json({ message: "Username and password are required for email login" });
        }

        user = await storage.getUserByUsername(username);
        if (!user || !(await verifyStoredPassword(user.password, password, comparePassword))) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
      } else if (authMethod === "phone") {
        const phone = typeof phoneNumber === "string" ? phoneNumber : "";
        const code = typeof req.body?.code === "string" ? req.body.code : "";
        const challenge = getValidPhoneOtpLoginChallenge(req.session, phone);
        if (!phone || !challenge) {
          return res.status(401).json({ message: "Invalid login credentials." });
        }
        let allowedAttempt: boolean;
        try {
          allowedAttempt = await allowPhoneOtpAttempt(
            phone,
            req.ip || req.socket.remoteAddress || "",
          );
        } catch {
          return res.status(503).json({
            code: "RATE_LIMIT_UNAVAILABLE",
            message: "Authentication is temporarily unavailable.",
          });
        }
        if (!allowedAttempt) {
          return res.status(429).json({ code: "RATE_LIMITED", message: "Too many verification attempts. Request a new code later." });
        }
        if (!/^\d{6}$/.test(code)) {
          return res.status(401).json({ message: "Invalid login credentials." });
        }
        if (!(await storage.verifyCode(phone, code))) {
          return res.status(401).json({ message: "Invalid login credentials." });
        }
        const consumedChallenge = consumePhoneOtpLoginChallenge(req.session, phone);
        if (!consumedChallenge) {
          return res.status(401).json({ message: "Invalid login credentials." });
        }
        user = await storage.getUserByPhone(phone);
        if (!user || user.phoneNumber !== phone || user.id !== challenge.accountId) {
          return res.status(401).json({ message: "Invalid login credentials." });
        }
      } else if (authMethod === "whatsapp" || authMethod === "facebook") {
        // No server-side verifier exists for these legacy identifier-only paths.
        // Never treat a client-supplied phone, WhatsApp number, Facebook ID, or
        // assertion-shaped value as proof of identity.
        return res.status(401).json({ message: "Invalid login credentials." });
      } else {
        if (!username || !password) {
          return res.status(401).json({ message: "Invalid login credentials." });
        }
        const identifier = (username as string).trim();
        const isEmail = identifier.includes("@");
        const cleanedPhone = identifier.replace(/[\s\-().]/g, "");
        const isPhone = !isEmail && /^[+\d]/.test(cleanedPhone) && /\d{6,}/.test(cleanedPhone);

        if (isEmail) {
          user = await storage.getUserByEmail(identifier.toLowerCase());
        } else if (isPhone) {
          user = await storage.getUserByPhone(cleanedPhone);
          if (!user) user = await storage.getUserByPhone(identifier);
        } else {
          user = await storage.getUserByUsername(identifier);
        }

        if (!user || !(await verifyStoredPassword(user.password, password, comparePassword))) {
          return res.status(401).json({ message: "Invalid login credentials." });
        }
      }

      if (!user || !isAuthAccountEligible(user)) {
        return res.status(401).json({ message: "Invalid login credentials." });
      }

      // Rotate the signed session ID only after credentials and account state
      // have passed. This invalidates any pre-login or prior-user session.
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      req.session.userId = user.id;
      req.session.isAdmin = user.isAdmin;
      req.session.role = user.role ?? "user";

      const userResponse: Record<string, unknown> = {
        id: user.id,
        username: user.username,
        authMethod: user.authMethod,
        isAdmin: user.isAdmin,
        role: user.role ?? "user",
      };
      if (user.email) userResponse.email = user.email;
      if (user.phoneNumber) userResponse.phoneNumber = user.phoneNumber;
      if (user.whatsappNumber) userResponse.whatsappNumber = user.whatsappNumber;
      if (user.facebookId) userResponse.facebookId = user.facebookId;

      return res.json(userResponse);
    } catch {
      return res.status(500).json({ message: "Server error" });
    }
  };
}
