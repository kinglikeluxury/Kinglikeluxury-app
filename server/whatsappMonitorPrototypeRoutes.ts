import type { Express } from "express";
import { requireWhatsappAdmin } from "./whatsappInternalAuth";

export type WhatsappMonitorPrototypeEnvironment = {
  WHATSAPP_MONITOR_META_APP_ID?: string;
  WHATSAPP_MONITOR_META_CONFIG_ID?: string;
  WHATSAPP_MONITORING_META_PROTOTYPE_ENABLED?: string;
};

export function getWhatsappMonitorPrototypeConfig(
  environment: WhatsappMonitorPrototypeEnvironment = {
    WHATSAPP_MONITOR_META_APP_ID: process.env.WHATSAPP_MONITOR_META_APP_ID,
    WHATSAPP_MONITOR_META_CONFIG_ID: process.env.WHATSAPP_MONITOR_META_CONFIG_ID,
    WHATSAPP_MONITORING_META_PROTOTYPE_ENABLED:
      process.env.WHATSAPP_MONITORING_META_PROTOTYPE_ENABLED,
  },
) {
  const enabled =
    environment.WHATSAPP_MONITORING_META_PROTOTYPE_ENABLED?.trim().toLowerCase() ===
    "true";
  const appId = environment.WHATSAPP_MONITOR_META_APP_ID?.trim() ?? "";
  const configId = environment.WHATSAPP_MONITOR_META_CONFIG_ID?.trim() ?? "";
  const configured = enabled && appId.length > 0 && configId.length > 0;

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
    requireWhatsappAdmin,
    (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(getWhatsappMonitorPrototypeConfig());
    },
  );
}