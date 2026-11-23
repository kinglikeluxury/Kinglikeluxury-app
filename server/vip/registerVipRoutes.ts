import type { Express, Request, Response } from "express";
import { pool } from "../db";
import { registerVipStatementRoutes } from "./vipStatementRoutes";
import { registerVipProjectRoutes } from "./vipProjectRoutes";
import { registerVipInstallmentRoutes } from "./vipInstallmentRoutes";
import { registerVipReceiptRoutes } from "./vipReceiptRoutes";
import { registerVipInvitationRoutes } from "./vipInvitationRoutes";
import { registerVipCameraRoutes } from "./vipCameraRoutes";
import { registerVipPhotoRoutes } from "./vipPhotoRoutes";
import { registerVipHandoverRoutes } from "./vipHandoverRoutes";
import { registerVipCardRoutes } from "./vipCardRoutes";
import { registerVipReferralRoutes } from "./vipReferralRoutes";
import { registerVipNotificationRoutes } from "./vipNotificationRoutes";
import { registerVipSellerRoutes } from "./vipSellerRoutes";
import {registerVipExperienceRoutes} from "./vipExperienceRoutes";
import {registerVipAccountingRoutes} from "./vipAccountingRoutes";
import {registerVipReferralLinkRoutes} from "./vipReferralLinkRoutes";
import {registerVipKeyReceiptRoutes} from "./vipKeyReceiptRoutes";
import {registerVipSupportRoutes} from "./vipSupportRoutes";
import {registerVipOperationsRoutes} from "./vipOperationsRoutes";
import {registerVipAdvancedFinanceRoutes} from "./vipAdvancedFinanceRoutes";
import {registerVipCrmBridgeRoutes} from "./vipCrmBridgeRoutes";

/**
 * KINGLIKE VIP: disabled unless explicitly enabled on the server.
 * Register this only after the application's existing session middleware.
 * No VIP schema is created on startup; migrations must be reviewed/applied in isolated staging.
 */
export function registerVipRoutes(app: Express): void {
  const enabled = (_req: Request, res: Response, next: () => void) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (process.env.KINGLIKE_VIP_ENABLED !== "true") {
      return res.status(404).json({ error: "Not found" });
    }
    next();
  };

  const requireSession = async (req: Request, res: Response, next: () => void) => {
    const userId = req.session?.userId;
    if (!Number.isSafeInteger(userId) || Number(userId) <= 0) {
      return res.status(401).json({ error: "Authentication required" });
    }
    try {
      const { rows } = await pool.query(
        "SELECT id, is_admin FROM users WHERE id = $1 AND is_active = TRUE AND is_verified = TRUE LIMIT 1",
        [userId],
      );
      if (rows.length !== 1) return res.status(403).json({ error: "Account not authorized" });
      res.locals.vipUser = { id: Number(rows[0].id), isAdmin: rows[0].is_admin === true };
      next();
    } catch {
      res.status(503).json({ error: "VIP temporarily unavailable" });
    }
  };

  const requireAdmin = (_req: Request, res: Response, next: () => void) => {
    if (!res.locals.vipUser?.isAdmin) return res.status(403).json({ error: "VIP administration restricted" });
    next();
  };

  // Explicit route chain: both checks run before every database read.
  app.get("/api/vip/me", enabled, requireSession, async (_req: Request, res: Response) => {
    const userId: number = res.locals.vipUser.id;
    try {
      // Entitlement is checked by the JOIN itself; client-provided IDs are never trusted.
      const { rows } = await pool.query(
        `SELECT u.id AS unit_id, u.unit_number, u.floor_number,
                p.id AS project_id, p.name AS project_name, p.developer_name,
                (SELECT pr.percent_complete FROM vip_progress_updates pr
                  WHERE pr.project_id = p.id AND pr.is_published = TRUE
                  ORDER BY pr.created_at DESC, pr.id DESC LIMIT 1) AS progress_percent
          FROM vip_unit_access a
          JOIN vip_units u ON u.id = a.unit_id
          JOIN vip_projects p ON p.id = u.project_id
          WHERE a.user_id = $1 AND a.access_role = 'owner' AND a.revoked_at IS NULL
          ORDER BY p.name, u.unit_number`,
        [userId],
      );
      return res.json({ units: rows });
    } catch {
      return res.status(503).json({ error: "VIP data not ready" });
    }
  });

  app.get("/api/admin/vip/overview", enabled, requireSession, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT
            (SELECT COUNT(*)::int FROM vip_projects) AS projects,
            (SELECT COUNT(*)::int FROM vip_units) AS units,
            (SELECT COUNT(DISTINCT user_id)::int FROM vip_unit_access
              WHERE access_role='owner' AND revoked_at IS NULL) AS clients,
            (SELECT COUNT(*)::int FROM vip_receipts WHERE review_status='pending') AS pending_receipts,
            (SELECT COUNT(*)::int FROM vip_statement_requests
              WHERE status IN ('new','following_up')) AS statement_requests`
      );
      return res.json({ overview: rows[0] });
    } catch {
      return res.status(503).json({ error: "VIP data not ready" });
    }
  });
  registerVipStatementRoutes(app, enabled, requireSession, requireAdmin);
  registerVipProjectRoutes(app, enabled, requireSession, requireAdmin);
  registerVipInstallmentRoutes(app, enabled, requireSession, requireAdmin);
  registerVipReceiptRoutes(app, enabled, requireSession, requireAdmin);
  registerVipInvitationRoutes(app, enabled, requireSession, requireAdmin);
  registerVipCameraRoutes(app, enabled, requireSession, requireAdmin);
  registerVipPhotoRoutes(app, enabled, requireSession, requireAdmin);
  registerVipHandoverRoutes(app, enabled, requireSession, requireAdmin);
  registerVipCardRoutes(app, enabled, requireSession, requireAdmin);
  registerVipReferralRoutes(app, enabled, requireSession, requireAdmin);
  registerVipNotificationRoutes(app, enabled, requireSession, requireAdmin);
  registerVipSellerRoutes(app, enabled, requireSession, requireAdmin);
  registerVipExperienceRoutes(app, enabled, requireSession, requireAdmin);
  registerVipAccountingRoutes(app, enabled, requireSession, requireAdmin);
  registerVipReferralLinkRoutes(app, enabled, requireSession);
  registerVipKeyReceiptRoutes(app, enabled, requireSession, requireAdmin);
  registerVipSupportRoutes(app, enabled, requireSession, requireAdmin);
  registerVipOperationsRoutes(app, enabled, requireSession, requireAdmin);
  registerVipAdvancedFinanceRoutes(app, enabled, requireSession, requireAdmin);
  registerVipCrmBridgeRoutes(app, enabled, requireSession, requireAdmin);

}
