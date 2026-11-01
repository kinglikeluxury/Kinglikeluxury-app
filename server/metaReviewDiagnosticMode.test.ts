import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import express from "express";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isMetaReviewDiagnosticMode,
  META_REVIEW_DIAGNOSTIC_MODE_FLAG,
  META_REVIEW_DIAGNOSTIC_MODE_STARTUP_LOG,
  shouldRunNormalStartupWork,
} from "./metaReviewDiagnosticMode";
import { registerMetaReviewWhatsappRoutes } from "./metaReviewWhatsappRoutes";

const DIAGNOSTIC_ENV = {
  NODE_ENV: "development",
  [META_REVIEW_DIAGNOSTIC_MODE_FLAG]: "true",
};

const TEST_ENV = {
  META_REVIEW_WA_TEST_ENABLED: "true",
  META_REVIEW_WA_TEST_WABA_ID: "123456789",
  META_REVIEW_WA_TEST_PHONE_NUMBER_ID: "987654321",
  META_REVIEW_WA_TEST_RECIPIENT: "+12025550101",
  META_REVIEW_WA_TEST_ACCESS_TOKEN: randomBytes(32).toString("hex"),
  META_REVIEW_WA_TEST_VERIFY_TOKEN: randomBytes(32).toString("hex"),
  META_REVIEW_WA_TEST_APP_SECRET: randomBytes(32).toString("hex"),
};

test("diagnostic startup mode is explicit and development-only", () => {
  assert.equal(isMetaReviewDiagnosticMode({ NODE_ENV: "development" }), false);
  assert.equal(
    isMetaReviewDiagnosticMode({
      NODE_ENV: "development",
      [META_REVIEW_DIAGNOSTIC_MODE_FLAG]: "false",
    }),
    false,
  );
  assert.equal(isMetaReviewDiagnosticMode(DIAGNOSTIC_ENV), true);
  assert.equal(
    isMetaReviewDiagnosticMode({
      NODE_ENV: "production",
      [META_REVIEW_DIAGNOSTIC_MODE_FLAG]: "true",
    }),
    false,
  );
  assert.equal(
    isMetaReviewDiagnosticMode({
      NODE_ENV: "test",
      [META_REVIEW_DIAGNOSTIC_MODE_FLAG]: "true",
    }),
    false,
  );
  assert.equal(shouldRunNormalStartupWork(DIAGNOSTIC_ENV), false);
  assert.equal(shouldRunNormalStartupWork({ NODE_ENV: "development" }), true);
  assert.equal(
    META_REVIEW_DIAGNOSTIC_MODE_STARTUP_LOG,
    "[Startup] Meta Review diagnostic mode active; background jobs are disabled.",
  );
});

test("diagnostic mode skips startup work while HTTP and Meta Review routes remain available", async () => {
  let backgroundWorkStarted = false;
  if (shouldRunNormalStartupWork(DIAGNOSTIC_ENV)) {
    backgroundWorkStarted = true;
  }
  assert.equal(backgroundWorkStarted, false);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { session?: unknown }).session = {
      userId: 1,
      isAdmin: true,
      isActive: true,
      role: "admin",
    };
    next();
  });
  app.get("/", (_req, res) => res.type("html").send("<main>Meta Review Test</main>"));
  registerMetaReviewWhatsappRoutes(app, {
    environment: () => TEST_ENV,
    fetchImpl: async () => {
      throw new Error("The test must not send a Meta request.");
    },
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const origin = `http://127.0.0.1:${address.port}`;
    const pageResponse = await fetch(origin);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /Meta Review Test/);

    const statusResponse = await fetch(
      `${origin}/api/admin/meta-review/whatsapp/status`,
    );
    assert.equal(statusResponse.status, 200);
    assert.equal(
      (await statusResponse.json() as { sendConfigured: boolean }).sendConfigured,
      true,
    );

    const challengeResponse = await fetch(
      `${origin}/api/meta-review/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${TEST_ENV.META_REVIEW_WA_TEST_VERIFY_TOKEN}&hub.challenge=diagnostic-check`,
    );
    assert.equal(challengeResponse.status, 200);
    assert.equal(await challengeResponse.text(), "diagnostic-check");

    const indexSource = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    const listenPosition = indexSource.indexOf("server.listen(");
    const diagnosticGatePosition = indexSource.indexOf(
      "if (!shouldRunNormalStartupWork(process.env))",
    );
    const firstBackgroundWorkPosition = indexSource.indexOf(
      "const schedulersEnabled =",
    );
    assert.ok(listenPosition >= 0);
    assert.ok(diagnosticGatePosition > listenPosition);
    assert.ok(firstBackgroundWorkPosition > diagnosticGatePosition);
    assert.ok(indexSource.includes("META_REVIEW_DIAGNOSTIC_MODE_STARTUP_LOG"));
    assert.match(
      indexSource,
      /if \(!metaReviewDiagnosticMode\)\s*\{\s*await enforceKayProductionSafetyFreeze\(\);\s*\}/,
    );
    for (const startupTask of [
      "startScheduler();",
      "startDailyBackup();",
      "startCrmTaskReminderScheduler();",
      "validateMetaWhatsAppConfig();",
      "startMetaLeadsProcessor();",
      "startPullSyncScheduler();",
      "startDeveloperRegistrationScheduler();",
      "resumePendingBroadcasts();",
      "startNurturingScheduler();",
      "startWaQualScheduler();",
      "AutoTranslate",
    ]) {
      assert.ok(
        indexSource.indexOf(startupTask, diagnosticGatePosition) >
          diagnosticGatePosition,
        `${startupTask} should remain behind the diagnostic-mode early return`,
      );
    }
  } finally {
    server.close();
    await once(server, "close");
  }
});
