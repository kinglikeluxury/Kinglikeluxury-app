import type { RequestHandler } from "express";
import type { IStorage } from "./storage";
import { verifyStoredPassword } from "@shared/authFlowUtils";

type LoginUser = Awaited<ReturnType<IStorage["getUserByUsername"]>>;

export type LoginStorage = Pick<
  IStorage,
  "getUserByUsername" | "getUserByEmail" | "getUserByPhone"
> & {
  getUserByField(field: string, value: string): Promise<LoginUser>;
};

export function createLoginHandler(dependencies: {
  storage: LoginStorage;
  comparePassword(plainText: string, hash: string): Promise<boolean>;
}): RequestHandler {
  const { storage, comparePassword } = dependencies;

  return async (req, res) => {
    try {
      const { username, password, phoneNumber, whatsappNumber, facebookId, authMethod } = req.body;
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
        if (!phoneNumber) {
          return res.status(400).json({ message: "Phone number is required for SMS login" });
        }
        user = await storage.getUserByField("phoneNumber", phoneNumber);
      } else if (authMethod === "whatsapp") {
        if (!whatsappNumber) {
          return res.status(400).json({ message: "WhatsApp number is required for WhatsApp login" });
        }
        user = await storage.getUserByField("whatsappNumber", whatsappNumber);
      } else if (authMethod === "facebook") {
        if (!facebookId) {
          return res.status(400).json({ message: "Facebook ID is required for Facebook login" });
        }
        user = await storage.getUserByField("facebookId", facebookId);
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

      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

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
