import type { Express, Request, Response } from "express";

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
}
