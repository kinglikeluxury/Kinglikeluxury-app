import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import express from "express";
import https from "node:https";
import path from "node:path";
import cron from "node-cron";
import test from "node:test";
import { sendMetaWhatsApp } from "./services/metaWhatsAppService";
import { sendInteractiveMessage, sendQualOpenerTemplate, sendQualTextMessage } from "./interactiveMessageHelper";
import { createMetaGraphOnboardingVerifier } from "./whatsappMetaGraphVerifier";
import {
  assertStagingDatabaseIsolation,
  backgroundJobsAllowed,
  guardResendClient,
  guardTwilioClient,
  guardedExternalCall,
  resolveApplicationDatabaseUrl,
  stagingDatabaseIsIsolated,
  stagingExternalHttpMiddleware,
  STAGING_DATABASE_NOT_VERIFIED,
  STAGING_INTEGRATION_BLOCKED,
  verifyStagingDatabaseConnection,
} from "./stagingExternalGuard";
import { registerWhatsappEmployeeWebhook } from "./whatsappEmployeeWebhook";
import { sendBulkWhatsApp } from "./whatsappNotificationService";
import { pullSyncFromMeta, startMetaLeadsProcessor, startPullSyncScheduler } from "./metaLeadsService";
import { startBroadcastRunner, resumePendingBroadcasts, sendBroadcastTestEmail } from "./broadcastService";
import { processNurturingQueue, sendTestNurturingEmail, startNurturingScheduler } from "./emailNurturingService";
import { pool } from "./db";
import { assertExternalGatewayAllowed } from "./stagingExternalGuard";
import { startCrmTaskReminderScheduler } from "./crmTaskReminderService";
import { startScheduler } from "./schedulerService";

test("SDK send boundaries block Resend, Twilio fallback, and push in Staging", async () => {
  const oldMode = process.env.APP_DEPLOYMENT_MODE;
  const oldScheduler = process.env.ENABLE_BACKGROUND_SCHEDULERS;
  const oldMeta = process.env.META_LEAD_PULL_SYNC_ENABLED;
  const oldMonitoring = process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED;
  let resendCalls = 0;
  let twilioCalls = 0;
  let pushCalls = 0;
  const resend = guardResendClient({
    emails: {
      send: async () => {
        resendCalls++;
        return { data: { id: "synthetic-id" }, error: null };
      },
    },
  });
  const twilio = guardTwilioClient({
    messages: {
      create: async () => {
        twilioCalls++;
        return { sid: "synthetic-sid" };
      },
    },
  });
  try {
    process.env.APP_DEPLOYMENT_MODE = "staging";
    process.env.ENABLE_BACKGROUND_SCHEDULERS = "true";
    process.env.META_LEAD_PULL_SYNC_ENABLED = "true";
    process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED = "true";
    await assert.rejects(resend.emails.send({ to: "synthetic@example.invalid" }), new RegExp(STAGING_INTEGRATION_BLOCKED));

    // Match the OTP sender's primary-SID -> from-number fallback behavior.
    try {
      await twilio.messages.create({ to: "+10000000000", messagingServiceSid: "synthetic" });
    } catch {
      await assert.rejects(
        twilio.messages.create({ to: "+10000000000", from: "+10000000000" }),
        new RegExp(STAGING_INTEGRATION_BLOCKED),
      );
    }
    await assert.rejects(
      guardedExternalCall("notifications", async () => {
        pushCalls++;
      }),
      new RegExp(STAGING_INTEGRATION_BLOCKED),
    );
    assert.deepEqual({ resendCalls, twilioCalls, pushCalls }, { resendCalls: 0, twilioCalls: 0, pushCalls: 0 });
  } finally {
    if (oldMode === undefined) delete process.env.APP_DEPLOYMENT_MODE;
    else process.env.APP_DEPLOYMENT_MODE = oldMode;
    if (oldScheduler === undefined) delete process.env.ENABLE_BACKGROUND_SCHEDULERS;
    else process.env.ENABLE_BACKGROUND_SCHEDULERS = oldScheduler;
    if (oldMeta === undefined) delete process.env.META_LEAD_PULL_SYNC_ENABLED;
    else process.env.META_LEAD_PULL_SYNC_ENABLED = oldMeta;
    if (oldMonitoring === undefined) delete process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED;
    else process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED = oldMonitoring;
  }
});

test("Guarded SDK proxies preserve mocked production success and SDK failure", async () => {
  const oldMode = process.env.APP_DEPLOYMENT_MODE;
  let resendCalls = 0;
  let twilioCalls = 0;
  const resend = guardResendClient({
    emails: {
      send: async ({ fail }: { fail?: boolean }) => {
        resendCalls++;
        if (fail) throw new Error("synthetic provider failure");
        return { data: { id: "synthetic-id" }, error: null };
      },
    },
  });
  const twilio = guardTwilioClient({
    messages: {
      create: async ({ fail }: { fail?: boolean }) => {
        twilioCalls++;
        if (fail) throw new Error("synthetic Twilio failure");
        return { sid: "synthetic-sid" };
      },
    },
  });
  try {
    process.env.APP_DEPLOYMENT_MODE = "production";
    assert.deepEqual(await resend.emails.send({}), { data: { id: "synthetic-id" }, error: null });
    await assert.rejects(resend.emails.send({ fail: true }), /synthetic provider failure/);
    assert.deepEqual(await twilio.messages.create({}), { sid: "synthetic-sid" });
    await assert.rejects(twilio.messages.create({ fail: true }), /synthetic Twilio failure/);
    assert.equal(resendCalls, 2);
    assert.equal(twilioCalls, 2);
  } finally {
    if (oldMode === undefined) delete process.env.APP_DEPLOYMENT_MODE;
    else process.env.APP_DEPLOYMENT_MODE = oldMode;
  }
});

test("all first-party Resend, Twilio, and Web Push call sites use guarded clients", () => {
  const serverDir = path.dirname(new URL(import.meta.url).pathname);
  const files = readdirSync(serverDir)
    .filter(file => file.endsWith(".ts"))
    .map(file => ({ file, source: readFileSync(path.join(serverDir, file), "utf8") }));
  const sdkConstructors = files.filter(({ source }) => /\bnew Resend\s*\(/.test(source));
  assert.ok(sdkConstructors.length > 0, "inventory must find the Resend SDK call sites");
  for (const { file, source } of sdkConstructors) {
    assert.match(source, /guardResendClient\s*\(\s*new Resend\s*\(/, `${file}: Resend must be wrapped at construction`);
  }
  for (const { file, source } of files.filter(({ source }) => /\.emails\.send\s*\(/.test(source))) {
    assert.match(source, /guardResendClient/, `${file}: Resend send must use the guarded client`);
  }
  for (const { file, source } of files.filter(({ source }) => /\.messages\.create\s*\(/.test(source))) {
    assert.match(source, /guardTwilioClient/, `${file}: Twilio message send must use the guarded client`);
  }
  for (const { file, source } of files.filter(({ source }) => /webpush\.sendNotification\s*\(/.test(source))) {
    assert.match(source, /guardedExternalCall\s*\(\s*"notifications"/, `${file}: Web Push send must be guarded at invocation`);
  }
});

test("Staging blocks WhatsApp and Graph send helpers before any HTTP request", async () => {
  const oldMode = process.env.APP_DEPLOYMENT_MODE;
  const oldFlag = process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED;
  const oldResendKey = process.env.RESEND_API_KEY;
  const oldFetch = globalThis.fetch;
  let outboundCalls = 0;
  try {
    process.env.APP_DEPLOYMENT_MODE = "staging";
    process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED = "true";
    process.env.RESEND_API_KEY = "synthetic-only-placeholder";
    const { sendEmail, sendPushNotification } = await import("./notificationService");
    globalThis.fetch = (async () => {
      outboundCalls++;
      throw new Error("network must not be reached");
    }) as typeof fetch;

    assert.equal((await sendMetaWhatsApp("synthetic-number", "fixture")).error, STAGING_INTEGRATION_BLOCKED);
    assert.equal((await sendInteractiveMessage("synthetic-number", "fixture", [])).error, STAGING_INTEGRATION_BLOCKED);
    assert.equal((await sendQualTextMessage("synthetic-number", "fixture")).error, STAGING_INTEGRATION_BLOCKED);
    assert.equal((await sendQualOpenerTemplate("synthetic-number")).error, STAGING_INTEGRATION_BLOCKED);
    assert.deepEqual(await sendBulkWhatsApp("weekly_update"), {
      sent: 0, failed: 0, skipped: STAGING_INTEGRATION_BLOCKED,
    });
    assert.deepEqual(await sendEmail({ to: "synthetic@example.invalid", subject: "fixture", html: "fixture" }), {
      sent: false, error: STAGING_INTEGRATION_BLOCKED,
    });
    const { isEmailConfigured, sendEmailOtp } = await import("./emailService");
    assert.equal(await isEmailConfigured(), false, "Staging must not load the email API key from its fallback database");
    await assert.rejects(sendEmailOtp("synthetic@example.invalid", "000000"), /Email service not configured/);
    assert.deepEqual(await sendPushNotification(
      { endpoint: "https://push.invalid/fixture", p256dh: "synthetic", auth: "synthetic" },
      { title: "fixture", body: "fixture" },
    ), { sent: false, error: STAGING_INTEGRATION_BLOCKED });
    assert.throws(() => assertExternalGatewayAllowed("twilio"), new RegExp(STAGING_INTEGRATION_BLOCKED));

    let graphCalls = 0;
    const verifier = createMetaGraphOnboardingVerifier(
      { appId: "123456", appSecret: "synthetic-placeholder-only", graphApiVersion: "v24.0" },
      async () => {
        graphCalls++;
        throw new Error("network must not be reached");
      },
    );
    await assert.rejects(
      verifier.exchangeAndVerify({
        code: "synthetic-code",
        businessPortfolioId: "111111",
        wabaId: "222222",
        phoneNumberId: "333333",
        displayPhoneNumber: "+10000000000",
      }),
      new RegExp(STAGING_INTEGRATION_BLOCKED),
    );
    assert.equal(outboundCalls, 0);
    assert.equal(graphCalls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldMode === undefined) delete process.env.APP_DEPLOYMENT_MODE;
    else process.env.APP_DEPLOYMENT_MODE = oldMode;
    if (oldFlag === undefined) delete process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED;
    else process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED = oldFlag;
    if (oldResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldResendKey;
  }
});

test("Staging disables direct Meta lead sync and worker entry points", async () => {
  const oldMode = process.env.APP_DEPLOYMENT_MODE;
  const oldSchedulerFlag = process.env.ENABLE_BACKGROUND_SCHEDULERS;
  const oldMetaFlag = process.env.META_LEAD_PULL_SYNC_ENABLED;
  const oldMetaToken = process.env.META_ACCESS_TOKEN;
  const oldGet = https.get;
  const oldSetInterval = globalThis.setInterval;
  let outboundCalls = 0;
  let timerCalls = 0;
  try {
    process.env.APP_DEPLOYMENT_MODE = "staging";
    process.env.ENABLE_BACKGROUND_SCHEDULERS = "true";
    process.env.META_LEAD_PULL_SYNC_ENABLED = "true";
    process.env.META_ACCESS_TOKEN = "synthetic-only-placeholder";
    (https as any).get = () => {
      outboundCalls++;
      throw new Error("network must not be reached");
    };
    (globalThis as any).setInterval = () => {
      timerCalls++;
      return {} as NodeJS.Timeout;
    };

    startMetaLeadsProcessor();
    startPullSyncScheduler();
    await assert.rejects(
      pullSyncFromMeta(),
      new RegExp(STAGING_INTEGRATION_BLOCKED),
    );
    assert.equal(outboundCalls, 0);
    assert.equal(timerCalls, 0);
  } finally {
    https.get = oldGet;
    globalThis.setInterval = oldSetInterval;
    if (oldMode === undefined) delete process.env.APP_DEPLOYMENT_MODE;
    else process.env.APP_DEPLOYMENT_MODE = oldMode;
    if (oldSchedulerFlag === undefined) delete process.env.ENABLE_BACKGROUND_SCHEDULERS;
    else process.env.ENABLE_BACKGROUND_SCHEDULERS = oldSchedulerFlag;
    if (oldMetaFlag === undefined) delete process.env.META_LEAD_PULL_SYNC_ENABLED;
    else process.env.META_LEAD_PULL_SYNC_ENABLED = oldMetaFlag;
    if (oldMetaToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = oldMetaToken;
  }
});

test("Staging blocks direct nurturing and broadcast sender entry points", async () => {
  const oldMode = process.env.APP_DEPLOYMENT_MODE;
  const oldResendKey = process.env.RESEND_API_KEY;
  const oldQuery = pool.query;
  const oldConnect = pool.connect;
  const oldInterval = globalThis.setInterval;
  const oldSetTimeout = globalThis.setTimeout;
  const oldCronSchedule = cron.schedule;
  const oldBackground = process.env.ENABLE_BACKGROUND_SCHEDULERS;
  const oldNurturing = process.env.ENABLE_EMAIL_NURTURING;
  let databaseCalls = 0;
  let timerCalls = 0;
  try {
    process.env.APP_DEPLOYMENT_MODE = "staging";
    process.env.ENABLE_BACKGROUND_SCHEDULERS = "true";
    process.env.ENABLE_EMAIL_NURTURING = "true";
    process.env.RESEND_API_KEY = "synthetic-only-placeholder";
    (pool as any).query = async () => {
      databaseCalls++;
      throw new Error("database must not be reached");
    };
    (pool as any).connect = async () => {
      databaseCalls++;
      throw new Error("database must not be reached");
    };
    (globalThis as any).setInterval = () => {
      timerCalls++;
      return {} as NodeJS.Timeout;
    };
    (globalThis as any).setTimeout = () => {
      timerCalls++;
      return {} as NodeJS.Timeout;
    };
    (cron as any).schedule = () => {
      timerCalls++;
      return {};
    };

    startNurturingScheduler();
    startCrmTaskReminderScheduler();
    startScheduler();
    await processNurturingQueue();
    assert.deepEqual(await sendTestNurturingEmail("synthetic@example.invalid"), {
      ok: false, error: STAGING_INTEGRATION_BLOCKED,
    });
    await startBroadcastRunner(123);
    await resumePendingBroadcasts();
    assert.deepEqual(await sendBroadcastTestEmail(123, "synthetic@example.invalid"), {
      ok: false, error: STAGING_INTEGRATION_BLOCKED,
    });
    assert.equal(databaseCalls, 0);
    assert.equal(timerCalls, 0);
  } finally {
    (pool as any).query = oldQuery;
    (pool as any).connect = oldConnect;
    globalThis.setInterval = oldInterval;
    globalThis.setTimeout = oldSetTimeout;
    (cron as any).schedule = oldCronSchedule;
    if (oldMode === undefined) delete process.env.APP_DEPLOYMENT_MODE;
    else process.env.APP_DEPLOYMENT_MODE = oldMode;
    if (oldBackground === undefined) delete process.env.ENABLE_BACKGROUND_SCHEDULERS;
    else process.env.ENABLE_BACKGROUND_SCHEDULERS = oldBackground;
    if (oldNurturing === undefined) delete process.env.ENABLE_EMAIL_NURTURING;
    else process.env.ENABLE_EMAIL_NURTURING = oldNurturing;
    if (oldResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldResendKey;
  }
});

test("Staging HTTP gate rejects live webhook, onboarding, activation, Meta, and Twilio routes", async () => {
  const oldMode = process.env.APP_DEPLOYMENT_MODE;
  const oldWebhookFlag = process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED;
  const oldSchedulerFlag = process.env.ENABLE_BACKGROUND_SCHEDULERS;
  const oldMetaFlag = process.env.WHATSAPP_META_ONBOARDING_ENABLED;
  let handlerReached = false;
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    process.env.APP_DEPLOYMENT_MODE = "staging";
    process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED = "true";
    process.env.WHATSAPP_META_ONBOARDING_ENABLED = "true";
    process.env.ENABLE_BACKGROUND_SCHEDULERS = "true";
    assert.equal(backgroundJobsAllowed(), false);

    const app = express();
    app.use(stagingExternalHttpMiddleware);
    registerWhatsappEmployeeWebhook(app);
    for (const route of [
      "/api/webhooks/whatsapp-employee",
      "/api/admin/whatsapp-meta/onboarding/start",
      "/api/admin/whatsapp-monitor/prototype-config",
      "/api/admin/whatsapp-test-send",
      "/api/admin/whatsapp-audit/config",
      "/api/admin/whatsapp-employees/numbers/333333/activate",
      "/api/auth/send-verification",
      "/api/auth/send-reset-otp",
      "/api/admin/twilio-status",
      "/api/admin/meta-leads/token-test",
      "/api/admin/ai-marketing/meta-read-test",
    ]) {
      app.all(route, (_req, res) => {
        handlerReached = true;
        res.sendStatus(200);
      });
    }
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    for (const route of [
      "/api/webhooks/whatsapp-employee",
      "/api/admin/whatsapp-meta/onboarding/start",
      "/api/admin/whatsapp-monitor/prototype-config",
      "/api/admin/whatsapp-test-send",
      "/api/admin/whatsapp-audit/config",
      "/api/admin/whatsapp-employees/numbers/333333/activate",
      "/api/auth/send-verification",
      "/api/auth/send-reset-otp",
      "/api/admin/twilio-status",
      "/api/admin/meta-leads/token-test",
      "/api/admin/ai-marketing/meta-read-test",
    ]) {
      const response = await fetch(`${base}${route}`, { method: "POST" });
      assert.equal(response.status, 503, route);
      const body = await response.text();
      assert.match(body, new RegExp(STAGING_INTEGRATION_BLOCKED));
      assert.doesNotMatch(body, /token|secret|password|synthetic-number/i);
    }
    assert.equal(handlerReached, false);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (oldMode === undefined) delete process.env.APP_DEPLOYMENT_MODE;
    else process.env.APP_DEPLOYMENT_MODE = oldMode;
    if (oldWebhookFlag === undefined) delete process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED;
    else process.env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED = oldWebhookFlag;
    if (oldSchedulerFlag === undefined) delete process.env.ENABLE_BACKGROUND_SCHEDULERS;
    else process.env.ENABLE_BACKGROUND_SCHEDULERS = oldSchedulerFlag;
    if (oldMetaFlag === undefined) delete process.env.WHATSAPP_META_ONBOARDING_ENABLED;
    else process.env.WHATSAPP_META_ONBOARDING_ENABLED = oldMetaFlag;
  }
});

test("Staging database selects only its designated URL and requires isolated identity confirmations", async () => {
  const base = {
    APP_DEPLOYMENT_MODE: "staging",
    NODE_ENV: "production",
    APP_STAGING_DATABASE_URL: "postgresql://synthetic@stage.db.invalid/kinglike_staging",
    APP_STAGING_DATABASE_EXPECTED_HOST: "stage.db.invalid",
    APP_STAGING_DATABASE_EXPECTED_NAME: "kinglike_staging",
    APP_STAGING_DATABASE_CONFIRMATION: "synthetic project confirmation",
    APP_STAGING_STORAGE_CONFIRMATION: "synthetic storage confirmation",
    NEON_DATABASE_URL: "postgresql://synthetic@prod.db.invalid/kinglike_production",
    PRODUCTION_DATABASE_HOST: "prod.db.invalid",
    PRODUCTION_DATABASE_NAME: "kinglike_production",
  } as NodeJS.ProcessEnv;
  assert.equal(resolveApplicationDatabaseUrl(base), base.APP_STAGING_DATABASE_URL);
  assert.equal(stagingDatabaseIsIsolated(base), true);
  assert.equal(stagingDatabaseIsIsolated({ ...base, APP_STAGING_DATABASE_URL: undefined }), false);
  assert.equal(stagingDatabaseIsIsolated({ ...base, APP_STAGING_DATABASE_EXPECTED_HOST: undefined }), false);
  assert.equal(stagingDatabaseIsIsolated({ ...base, APP_STAGING_DATABASE_CONFIRMATION: undefined }), false);
  assert.equal(stagingDatabaseIsIsolated({ ...base, APP_STAGING_STORAGE_CONFIRMATION: undefined }), false);
  assert.equal(stagingDatabaseIsIsolated({
    ...base,
    NEON_DATABASE_URL: "postgresql://synthetic@stage.db.invalid/kinglike_staging",
  }), false);
  assert.equal(stagingDatabaseIsIsolated({ ...base, PRODUCTION_DATABASE_HOST: "stage.db.invalid" }), false);
  assert.equal(stagingDatabaseIsIsolated({ ...base, PRODUCTION_DATABASE_NAME: "kinglike_staging" }), false);
  assert.throws(() => assertStagingDatabaseIsolation({ APP_DEPLOYMENT_MODE: "staging" } as NodeJS.ProcessEnv), new RegExp(STAGING_DATABASE_NOT_VERIFIED));
  let dbQueries = 0;
  await verifyStagingDatabaseConnection(async () => {
    dbQueries++;
    return { rows: [{ database_name: "kinglike_staging" }] };
  }, base);
  assert.equal(dbQueries, 1);
  await assert.rejects(
    verifyStagingDatabaseConnection(async () => {
      dbQueries++;
      throw new Error("synthetic database unavailable");
    }, base),
    new RegExp(STAGING_DATABASE_NOT_VERIFIED),
  );
  await assert.rejects(
    verifyStagingDatabaseConnection(async () => {
      dbQueries++;
      return { rows: [{ database_name: "kinglike_staging" }] };
    }, { APP_DEPLOYMENT_MODE: "staging" } as NodeJS.ProcessEnv),
    new RegExp(STAGING_DATABASE_NOT_VERIFIED),
  );
  assert.equal(dbQueries, 2, "invalid identity must abort before issuing a database query");
  await assert.rejects(
    verifyStagingDatabaseConnection(async () => ({ rows: [{ database_name: "kinglike_production" }] }), base),
    new RegExp(STAGING_DATABASE_NOT_VERIFIED),
  );
  assert.equal(stagingDatabaseIsIsolated({ APP_DEPLOYMENT_MODE: "production" } as NodeJS.ProcessEnv), true);
  assert.equal(resolveApplicationDatabaseUrl({
    APP_DEPLOYMENT_MODE: "production",
    NODE_ENV: "production",
    NEON_DATABASE_URL: "postgresql://synthetic@prod.db.invalid/kinglike_production",
    APP_STAGING_DATABASE_URL: "postgresql://synthetic@stage.db.invalid/kinglike_staging",
  } as NodeJS.ProcessEnv), "postgresql://synthetic@prod.db.invalid/kinglike_production");
});

test("Staging skips startup schema work and automatic translation jobs", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /if \(stagingExternalIsolation\) \{[\s\S]*startup schema\/bootstrap work is disabled[\s\S]*\} else \{\s*for \(const step of bootSteps\)/);
  assert.match(source, /if \(!stagingExternalIsolation\) \(async \(\) =>/);
});
