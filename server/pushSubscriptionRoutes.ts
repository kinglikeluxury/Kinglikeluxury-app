import type { Express, RequestHandler } from "express";
import type { IStorage } from "./storage";

type PushSubscriptionStorage = Pick<
  IStorage,
  "savePushSubscription" | "deletePushSubscriptionByEndpoint"
>;

export function registerPushSubscriptionRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  storage: PushSubscriptionStorage,
  getVapidPublicKey: () => string | undefined,
  logError: (message: string) => void = (message) =>
    console.error("[Push] Subscribe error:", message),
): void {
  app.get("/api/push/vapid-key", (_req, res) => {
    const key = getVapidPublicKey();
    if (!key) return res.status(503).json({ error: "Push notifications not configured" });
    return res.json({ publicKey: key });
  });

  app.post("/api/push/subscribe", isAuthenticated, async (req, res) => {
    const userId = req.session?.userId;
    if (!Number.isSafeInteger(userId) || !userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const { endpoint, p256dh, auth, userAgent } = req.body ?? {};
      if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({ message: "endpoint, p256dh, auth required" });
      }
      const subscription = await storage.savePushSubscription({
        userId,
        endpoint,
        p256dh,
        auth,
        userAgent: userAgent || null,
      });
      return res.json({ success: true, id: subscription.id });
    } catch (error) {
      logError(error instanceof Error ? error.message : String(error));
      return res.status(500).json({ message: "Push subscription failed" });
    }
  });

  app.delete("/api/push/unsubscribe", isAuthenticated, async (req, res) => {
    const userId = req.session?.userId;
    if (!Number.isSafeInteger(userId) || !userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const endpoint = req.body?.endpoint;
      if (endpoint) {
        await storage.deletePushSubscriptionByEndpoint(endpoint, userId);
      }
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ message: "Server error" });
    }
  });
}
