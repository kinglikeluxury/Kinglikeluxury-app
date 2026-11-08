import type { Express, Request, Response } from "express";
import { evaluateSyntheticWhatsappStagingReadiness } from "./whatsappStagingReadiness";

export type WhatsappMonitorPrototypeEnvironment = Record<string, string | undefined>;

export function getWhatsappMonitorPrototypeConfig(
  env: WhatsappMonitorPrototypeEnvironment,
) {
  const enabled = env.WHATSAPP_MONITORING_META_PROTOTYPE_ENABLED === "true";
  const appId = env.WHATSAPP_MONITOR_META_APP_ID?.trim();
  const configId = env.WHATSAPP_MONITOR_META_CONFIG_ID?.trim();
  const configured = Boolean(enabled && appId && configId);

  return {
    enabled,
    configured,
    status: "not_connected" as const,
    ...(configured ? { appId, configId } : {}),
  };
}

export function registerWhatsappMonitorPrototypeRoutes(app: Express): void {
  app.get(
    "/api/admin/whatsapp-monitor/prototype-config",
    (req: Request, res: Response) => {
      if (req.session?.isAdmin !== true) {
        res.status(403).json({ message: "Admin access required" });
        return;
      }

      res.setHeader("Cache-Control", "no-store");
      res.json(getWhatsappMonitorPrototypeConfig(process.env));
    },
  );
  // Synthetic parser smoke test only: no Meta, phone access, DB, or outbound calls.
  // Separate route avoids the global Staging block on live WhatsApp integrations.
  app.get(
    "/api/admin/staging/whatsapp-synthetic-readiness",
    (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      if (process.env.APP_DEPLOYMENT_MODE !== "staging") {
        res.sendStatus(404);
        return;
      }
      if (req.session?.isAdmin !== true) {
        res.status(403).json({ message: "Admin access required" });
        return;
      }
      res.json(evaluateSyntheticWhatsappStagingReadiness());
    },
  );
}
