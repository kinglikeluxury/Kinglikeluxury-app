import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { registerWhatsappMonitorPrototypeRoutes } from "./whatsappMonitorPrototypeRoutes";
import { evaluateSyntheticWhatsappStagingReadiness } from "./whatsappStagingReadiness";

test("synthetic staging readiness exercises HMAC, inbound, status, echo and fail-closed checks", () => {
  const result = evaluateSyntheticWhatsappStagingReadiness();
  assert.equal(result.scope, "synthetic_parser_only");
  assert.equal(result.passed, true);
  assert.ok(Object.keys(result.checks).length >= 8);
  assert.ok(Object.values(result.checks).every(Boolean));
  assert.equal(result.liveMetaConnected, false);
  assert.equal(result.realEmployeeNumbersAuthorized, false);
  assert.equal(result.databaseAndWebhookDeliveryTested, false);
  assert.equal(JSON.stringify(result).includes("Synthetic inbound"), false);
  assert.equal(JSON.stringify(result).includes("15550000001"), false);
});

test("synthetic readiness HTTP route is unavailable outside Staging and requires an admin", async () => {
  const originalMode = process.env.APP_DEPLOYMENT_MODE;
  let isAdmin = false;
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = { isAdmin };
    next();
  });
  registerWhatsappMonitorPrototypeRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback port");
  const url = "http://127.0.0.1:" + address.port +
    "/api/admin/staging/whatsapp-synthetic-readiness";

  try {
    process.env.APP_DEPLOYMENT_MODE = "production";
    isAdmin = true;
    let response = await fetch(url);
    assert.equal(response.status, 404);

    process.env.APP_DEPLOYMENT_MODE = "staging";
    isAdmin = false;
    response = await fetch(url);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");

    isAdmin = true;
    response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.scope, "synthetic_parser_only");
    assert.equal(body.passed, true);
    assert.equal(body.liveMetaConnected, false);
  } finally {
    if (originalMode === undefined) delete process.env.APP_DEPLOYMENT_MODE;
    else process.env.APP_DEPLOYMENT_MODE = originalMode;
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});
