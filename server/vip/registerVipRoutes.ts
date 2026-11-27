import type { Express } from "express";
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
import { registerVipCoreRoutes } from "./vipCoreRoutes";

/**
 * KINGLIKE VIP: disabled unless explicitly enabled on the server.
 * Register this only after the application's existing session middleware.
 * No VIP schema is created on startup; migrations must be reviewed/applied in isolated staging.
 */
export function registerVipRoutes(app: Express): void {
  // Explicit route chain: the core routes and every feature share live guards.
  const { enabled, requireSession, requireAdmin } = registerVipCoreRoutes(app);
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
