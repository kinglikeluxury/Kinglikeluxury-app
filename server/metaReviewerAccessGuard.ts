import type { Request, Response, NextFunction } from "express";
import { getMetaReviewerAccount } from "./metaReviewerAccessStore";

const REVIEWER_API_ROUTES = new Set([
  "GET /api/auth/me",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/admin/meta-review/whatsapp/status",
  "GET /api/admin/meta-review/whatsapp/events",
  "GET /api/admin/meta-review/whatsapp/management",
  "POST /api/admin/meta-review/whatsapp/send-test-template",
  "GET /api/admin/whatsapp-monitor/prototype-config",
  "GET /api/meta-review/whatsapp/webhook",
  "POST /api/meta-review/whatsapp/webhook",
]);

const REVIEWER_PAGES = new Set([
  "/login",
  "/admin/whatsapp-monitoring",
]);

const STATIC_PATHS = [
  "/@vite/",
  "/@react-refresh",
  "/src/",
  "/assets/",
  "/locales/",
  "/favicon",
  "/manifest",
  "/service-worker",
  "/sw.js",
];

export function createMetaReviewerAccessGuard(
  environment: () => NodeJS.ProcessEnv = () => process.env,
) {
  return function metaReviewerAccessGuard(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (req.session?.role !== "meta_reviewer") {
      next();
      return;
    }

    const reviewer = getMetaReviewerAccount(req.session.userId ?? 0);
    if (
      !req.session.isMetaReviewer ||
      !reviewer ||
      !reviewer.isMetaReviewer ||
      !reviewer.isActive
    ) {
      req.session.destroy(() => undefined);
      res.status(401).json({ message: "Not authenticated" });
      return;
    }

    const path = req.path.replace(/\/+$/, "") || "/";
    if (REVIEWER_API_ROUTES.has(`${req.method} ${path}`)) {
      next();
      return;
    }

    if (path.startsWith("/api/")) {
      res.status(403).json({ message: "Not authorized" });
      return;
    }

    if (REVIEWER_PAGES.has(path)) {
      next();
      return;
    }

    if (STATIC_PATHS.some((prefix) => path.startsWith(prefix)) || /\.[a-z0-9]{2,8}$/i.test(path)) {
      next();
      return;
    }

    res.status(403).type("text/plain").send("Not authorized");
  };
}
