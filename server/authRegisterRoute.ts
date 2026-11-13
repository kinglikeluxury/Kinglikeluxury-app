import type { RequestHandler } from "express";
import type { User } from "@shared/schema";
import type { IStorage } from "./storage";
import { normalizeAuthEmail, registrationConflictResponse, uniqueUserFieldFromError } from "@shared/authFlowUtils";

export type EmailRegistrationOtpStore = Map<
  string,
  { code: string; expiresAt: Date; verified: boolean }
>;

export type RegistrationStorage = Pick<
  IStorage,
  "getUserByUsername" | "getUserByEmail" | "getUserByPhone" | "isPhoneVerified" | "createUser"
>;

export function createRegisterHandler(dependencies: {
  storage: RegistrationStorage;
  emailOtpStore: EmailRegistrationOtpStore;
  sendWelcomeEmail(user: User): Promise<unknown>;
  sendWelcomeWhatsApp(user: User): Promise<unknown>;
  logError(error: unknown): void;
}): RequestHandler {
  const { storage, emailOtpStore, sendWelcomeEmail, sendWelcomeWhatsApp, logError } = dependencies;

  return async (req, res) => {
    try {
      const { username, password, email, phoneNumber, authMethod } = req.body;
      const emailKey = typeof email === "string" && email.trim() ? normalizeAuthEmail(email) : null;

      if (!username || typeof username !== "string" || username.length < 3) {
        return res.status(400).json({ message: "Username must be at least 3 characters" });
      }
      if (!password || typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const emailRecord = emailKey ? emailOtpStore.get(emailKey) : null;
      const isEmailVerified = emailRecord?.verified === true && Date.now() < emailRecord.expiresAt.getTime();
      if (phoneNumber) {
        const isPhoneVerified = await storage.isPhoneVerified(phoneNumber);
        if (!isPhoneVerified && !isEmailVerified) {
          return res.status(400).json({ message: "Phone number must be verified before registration" });
        }
      } else if (authMethod === "phone") {
        return res.status(400).json({ message: "Phone number is required" });
      } else if (!isEmailVerified) {
        return res.status(400).json({ message: "Email must be verified before registration" });
      }

      if (emailKey && await storage.getUserByEmail(emailKey)) {
        const conflict = registrationConflictResponse("email");
        return res.status(conflict.status).json(conflict.body);
      }
      if (phoneNumber && await storage.getUserByPhone(phoneNumber)) {
        const conflict = registrationConflictResponse("phoneNumber");
        return res.status(conflict.status).json(conflict.body);
      }

      const user = await storage.createUser({
        username,
        password,
        email: emailKey ?? undefined,
        phoneNumber: phoneNumber || undefined,
        authMethod: authMethod || "phone",
        isAdmin: false,
        isVerified: true,
      });

      req.session.userId = user.id;
      req.session.isAdmin = user.isAdmin;
      req.session.role = user.role ?? "user";
      if (emailKey) emailOtpStore.delete(emailKey);

      sendWelcomeEmail(user).catch(() => {});
      sendWelcomeWhatsApp(user).catch(() => {});

      const userResponse: Record<string, unknown> = {
        id: user.id,
        username: user.username,
        authMethod: user.authMethod,
        isAdmin: user.isAdmin,
      };
      if (user.email) userResponse.email = user.email;
      if (user.phoneNumber) userResponse.phoneNumber = user.phoneNumber;

      return res.status(201).json(userResponse);
    } catch (error) {
      const uniqueField = uniqueUserFieldFromError(error);
      if (uniqueField) {
        const conflict = registrationConflictResponse(uniqueField);
        return res.status(conflict.status).json(conflict.body);
      }
      logError(error);
      return res.status(500).json({
        code: "REGISTRATION_UNAVAILABLE",
        message: "Registration could not be completed. Please try again.",
      });
    }
  };
}
