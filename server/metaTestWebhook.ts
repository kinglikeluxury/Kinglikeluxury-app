import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type Express, type Request } from "express";

/**
 * Isolated Meta TEST WABA callback, fail-closed by default.
 * Handles only one explicitly allowlisted Meta test WABA and test phone ID.
 * No persistence, content parsing, forwarding, media download or outbound API calls.
 *
 * Must be registered BEFORE the application-wide JSON body parser so the
 * HMAC covers the exact raw request bytes.
 */
export const META_TEST_WEBHOOK_PATH = "/api/webhooks/meta-test-waba";
export const META_TEST_STATUS_PATH = "/api/admin/staging/meta-test-webhook-status";

type TestWebhookConfig = {
  wabaId: string;
  phoneId: string;
  verifyToken: string;
  appSecret: string;
};

function validId(value: string | undefined): value is string {
  return typeof value === "string" && /^\d{5,80}$/.test(value);
}

export function metaTestWebhookConfig(
  env: NodeJS.ProcessEnv = process.env,
): TestWebhookConfig | null {
  if (env.APP_DEPLOYMENT_MODE !== "staging" ||
      env.WHATSAPP_META_TEST_WEBHOOK_ENABLED !== "true") return null;
  const wabaId = env.WHATSAPP_META_TEST_WABA_ID;
  const phoneId = env.WHATSAPP_META_TEST_PHONE_NUMBER_ID;
  const verifyToken = env.WHATSAPP_META_TEST_WEBHOOK_VERIFY_TOKEN;
  const appSecret = env.WHATSAPP_META_TEST_META_APP_SECRET;

  if (!validId(wabaId) || !validId(phoneId) || wabaId === phoneId ||
      typeof verifyToken !== "string" ||
      !/^[A-Za-z0-9._~-]{24,128}$/.test(verifyToken) ||
      typeof appSecret !== "string" || appSecret.length < 16 ||
      appSecret.length > 512) return null;

  return { wabaId, phoneId, verifyToken, appSecret };
}

export function validMetaTestSignature(
  raw: Buffer,
  header: unknown,
  secret: string,
): boolean {
  if (!Buffer.isBuffer(raw) || typeof header !== "string" ||
      !/^sha256=[a-f0-9]{64}$/i.test(header) || !secret) return false;
  const expected = Buffer.from(
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex"),
    "ascii",
  );
  const actual = Buffer.from(header.toLowerCase(), "ascii");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Validate envelope ownership without extracting or retaining contact or
 * message contents. Only a Meta test phone can increment counters.
 */
export function testWebhookEnvelopeMatches(
  value: unknown,
  config: Pick<TestWebhookConfig, "wabaId" | "phoneId">,
): boolean {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, any>;
  if (payload.object !== "whatsapp_business_account" ||
      !Array.isArray(payload.entry) || payload.entry.length === 0 ||
      payload.entry.length > 10) return false;

  for (const entry of payload.entry) {
    if (!entry || String(entry.id) !== config.wabaId ||
        !Array.isArray(entry.changes) || entry.changes.length > 30) return false;
    for (const change of entry.changes) {
      if (!change || typeof change.field !== "string") return false;
      if (change.field === "messages" || change.field === "smb_message_echoes") {
        if (String(change?.value?.metadata?.phone_number_id ?? "") !== config.phoneId) {
          return false;
        }
      }
    }
  }
  return true;
}

function acceptedFieldCount(payload: any): number {
  let count = 0;
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field === "messages" || change.field === "smb_message_echoes") count++;
    }
  }
  return count;
}

export function createMetaTestWebhookRoutes(
  app: Express,
  env: NodeJS.ProcessEnv = process.env,
) {
  // Counters are volatile and aggregate only. Restart clears them.
  // No request bodies, customer data, phone IDs, token or signatures logged.
  let authenticatedBatches = 0;
  let acceptedMessageFieldChanges = 0;

  app.get(META_TEST_WEBHOOK_PATH, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const cfg = metaTestWebhookConfig(env);
    if (!cfg) return res.sendStatus(404);

    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode !== "subscribe" || typeof token !== "string" ||
        typeof challenge !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(challenge)) {
      return res.sendStatus(403);
    }

    const supplied = Buffer.from(token, "utf8");
    const expected = Buffer.from(cfg.verifyToken, "utf8");
    if (supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)) return res.sendStatus(403);

    return res.status(200).type("text/plain").send(challenge);
  });

  app.post(
    META_TEST_WEBHOOK_PATH,
    (req, res, next) => {
      if (!metaTestWebhookConfig(env)) return res.sendStatus(404);
      if (!String(req.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
        return res.sendStatus(415);
      }
      return next();
    },
    express.raw({ type: "application/json", limit: "64kb" }),
    (req: Request, res) => {
      res.setHeader("Cache-Control", "no-store");
      const cfg = metaTestWebhookConfig(env);
      if (!cfg) return res.sendStatus(404);
      if (!Buffer.isBuffer(req.body) ||
          !validMetaTestSignature(req.body, req.get("x-hub-signature-256"), cfg.appSecret)) {
        return res.sendStatus(401);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(req.body.toString("utf8"));
      } catch {
        return res.sendStatus(400);
      }
      if (!testWebhookEnvelopeMatches(payload, cfg)) return res.sendStatus(403);
      authenticatedBatches++;
      acceptedMessageFieldChanges += acceptedFieldCount(payload);
      // Event contents are deliberately discarded. Meta needs fast acknowledgement.
      return res.status(200).type("text/plain").send("EVENT_RECEIVED");
    },
  );

  return {
    registerAdminStatus() {
      app.get(META_TEST_STATUS_PATH, (req: Request, res) => {
        res.setHeader("Cache-Control", "no-store");
        if (env.APP_DEPLOYMENT_MODE !== "staging") return res.sendStatus(404);
        if (req.session?.isAdmin !== true) {
          return res.status(403).json({ message: "Admin access required" });
        }
        return res.status(200).json({
          scope: "meta_test_waba_only",
          enabled: metaTestWebhookConfig(env) !== null,
          authenticatedBatches,
          acceptedMessageFieldChanges,
          recordsPersisted: 0,
          messagesSent: 0,
          employeeNumbersConnected: false,
        });
      });
    },
  };
}
