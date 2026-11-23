import type { RequestHandler } from "express";
import bcrypt from "bcrypt";
import { verifyStoredPassword } from "@shared/authFlowUtils";
import type { IStorage } from "./storage";

export type ChangePasswordStorage = Pick<IStorage, "getUser" | "updateUserPassword">;

/**
 * Existing application's signed session determines the account.
 * Handles both legacy plaintext credentials and bcrypt credentials for
 * verification, but ALWAYS stores a new bcrypt hash (never plaintext).
 */
export function createChangePasswordHandler(storage: ChangePasswordStorage): RequestHandler {
  return async (req, res) => {
    const userId = req.session?.userId;
    if (!Number.isSafeInteger(userId) || !userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== "string" || !currentPassword ||
        typeof newPassword !== "string" || !newPassword) {
      return res.status(400).json({ message: "Both passwords are required" });
    }
    // Keep the existing 6-character minimum without changing the current
    // form's UX. Reject overly long values that bcrypt would silently truncate.
    if (newPassword.length < 6 || Buffer.byteLength(newPassword, "utf8") > 72) {
      return res.status(400).json({ message: "Password must be 6–72 bytes" });
    }

    try {
      const user = await storage.getUser(userId);
      const correct = user && await verifyStoredPassword(
        user.password, currentPassword, (plainText, hash) => bcrypt.compare(plainText, hash)
      );
      if (!correct) return res.status(401).json({ message: "Current password is incorrect" });

      const passwordHash = await bcrypt.hash(newPassword, 12);
      const updated = await storage.updateUserPassword(userId, passwordHash);
      if (!updated) return res.status(503).json({ message: "Password update unavailable" });
      return res.json({ success: true });
    } catch {
      return res.status(503).json({ message: "Password update unavailable" });
    }
  };
}
