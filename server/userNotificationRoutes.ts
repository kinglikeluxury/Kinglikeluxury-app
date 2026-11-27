import type { Express, RequestHandler } from "express";
import type { IStorage } from "./storage";

type NotificationStorage = Pick<
  IStorage,
  "getUserNotifications" | "markNotificationRead" | "markAllNotificationsRead"
>;

export function registerUserNotificationRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  storage: NotificationStorage,
): void {
  app.get("/api/notifications", isAuthenticated, async (req, res) => {
    const userId = req.session?.userId;
    if (!Number.isSafeInteger(userId) || !userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const notifications = await storage.getUserNotifications(userId);
      return res.json(notifications);
    } catch {
      return res.status(500).json({ message: "Server error" });
    }
  });

  app.patch("/api/notifications/:id/read", isAuthenticated, async (req, res) => {
    const userId = req.session?.userId;
    if (!Number.isSafeInteger(userId) || !userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      await storage.markNotificationRead(Number.parseInt(req.params.id, 10), userId);
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ message: "Server error" });
    }
  });

  app.patch("/api/notifications/read-all", isAuthenticated, async (req, res) => {
    const userId = req.session?.userId;
    if (!Number.isSafeInteger(userId) || !userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      await storage.markAllNotificationsRead(userId);
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ message: "Server error" });
    }
  });
}
