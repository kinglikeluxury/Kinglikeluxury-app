import assert from "node:assert/strict";
import test from "node:test";
import { getWhatsappMonitorPrototypeConfig } from "./whatsappMonitorPrototypeRoutes";

test("Meta Embedded Signup prototype is disabled unless explicitly enabled", () => {
  assert.deepEqual(getWhatsappMonitorPrototypeConfig({}), {
    enabled: false,
    configured: false,
    status: "not_connected",
  });
  assert.deepEqual(
    getWhatsappMonitorPrototypeConfig({
      WHATSAPP_MONITORING_META_PROTOTYPE_ENABLED: "false",
      WHATSAPP_MONITOR_META_APP_ID: "test-app",
      WHATSAPP_MONITOR_META_CONFIG_ID: "test-config",
    }),
    { enabled: false, configured: false, status: "not_connected" },
  );
});

test("prototype remains unavailable until both non-secret IDs are configured", () => {
  assert.deepEqual(
    getWhatsappMonitorPrototypeConfig({
      WHATSAPP_MONITORING_META_PROTOTYPE_ENABLED: "true",
      WHATSAPP_MONITOR_META_APP_ID: "test-app",
    }),
    { enabled: true, configured: false, status: "not_connected" },
  );
  assert.deepEqual(
    getWhatsappMonitorPrototypeConfig({
      WHATSAPP_MONITORING_META_PROTOTYPE_ENABLED: "true",
      WHATSAPP_MONITOR_META_APP_ID: "test-app",
      WHATSAPP_MONITOR_META_CONFIG_ID: "test-config",
    }),
    {
      enabled: true,
      configured: true,
      status: "not_connected",
      appId: "test-app",
      configId: "test-config",
    },
  );
});
