import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import express from "express";
import {
  createMetaTestWebhookRoutes,
  metaTestWebhookConfig,
  validMetaTestSignature,
  testWebhookEnvelopeMatches,
  META_TEST_WEBHOOK_PATH,
  META_TEST_STATUS_PATH,
} from "./metaTestWebhook";

const env: NodeJS.ProcessEnv = {
  APP_DEPLOYMENT_MODE: "staging",
  WHATSAPP_META_TEST_WEBHOOK_ENABLED: "true",
  WHATSAPP_META_TEST_WABA_ID: "123456789",
  WHATSAPP_META_TEST_PHONE_NUMBER_ID: "987654321",
  WHATSAPP_META_TEST_WEBHOOK_VERIFY_TOKEN: "synthetic-verify-token-1234567",
  WHATSAPP_META_TEST_META_APP_SECRET: "synthetic-meta-test-app-secret-1234567",
};

const payload = {
  object: "whatsapp_business_account",
  entry: [{
    id: "123456789",
    changes: [{
      field: "messages",
      value: {
        metadata: { phone_number_id: "987654321" },
        messages: [{ id: "fixture-message", from: "15550000000",
          type: "text", text: { body: "DO_NOT_SAVE_THIS_MESSAGE" } }],
      },
    }],
  }],
};

function sign(raw: string) {
  return "sha256=" + createHmac("sha256", env.WHATSAPP_META_TEST_META_APP_SECRET!)
    .update(Buffer.from(raw, "utf8")).digest("hex");
}

async function withServer(
  config: NodeJS.ProcessEnv,
  action: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  const receiver = createMetaTestWebhookRoutes(app, config);
  // The production application has a common JSON parser after the callback.
  app.use(express.json({ limit: "50mb" }));
  app.use((req, _res, next) => {
    (req as any).session = { isAdmin: req.get("x-fixture-admin") === "true" };
    next();
  });
  receiver.registerAdminStatus();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("No local test port");
  try {
    await action("http://127.0.0.1:" + addr.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error =>
      error ? reject(error) : resolve()));
  }
}

test("feature disabled by default and invalid config rejected", () => {
  assert.equal(metaTestWebhookConfig({}), null);
  assert.equal(metaTestWebhookConfig({ ...env, APP_DEPLOYMENT_MODE: "production" }), null);
  assert.equal(metaTestWebhookConfig({ ...env, WHATSAPP_META_TEST_WEBHOOK_ENABLED: "false" }), null);
  assert.equal(metaTestWebhookConfig({ ...env, WHATSAPP_META_TEST_WABA_ID: "not-id" }), null);
  assert.equal(metaTestWebhookConfig({ ...env, WHATSAPP_META_TEST_PHONE_NUMBER_ID: "123456789" }), null);
  assert.equal(metaTestWebhookConfig({ ...env, WHATSAPP_META_TEST_WEBHOOK_VERIFY_TOKEN: "weak" }), null);
  assert.equal(metaTestWebhookConfig({ ...env, WHATSAPP_META_TEST_META_APP_SECRET: "weak" }), null);
});

test("HMAC validates raw bytes; signed edits and malformed signature are rejected", () => {
  const raw = Buffer.from(JSON.stringify(payload));
  assert.equal(validMetaTestSignature(raw, sign(raw.toString()), env.WHATSAPP_META_TEST_META_APP_SECRET!), true);
  assert.equal(validMetaTestSignature(Buffer.concat([raw, Buffer.from(" ")]), sign(raw.toString()), env.WHATSAPP_META_TEST_META_APP_SECRET!), false);
  assert.equal(validMetaTestSignature(raw, "bearer invalid", env.WHATSAPP_META_TEST_META_APP_SECRET!), false);
  assert.equal(testWebhookEnvelopeMatches(payload, { wabaId: "123456789", phoneId: "987654321" }), true);
  assert.equal(testWebhookEnvelopeMatches({ ...payload, object: "page" }, { wabaId: "123456789", phoneId: "987654321" }), false);
});

test("inactive receiver answers 404 and cannot accept signed requests", async () => {
  await withServer({ ...env, WHATSAPP_META_TEST_WEBHOOK_ENABLED: "false" }, async base => {
    let r = await fetch(base + META_TEST_WEBHOOK_PATH + "?hub.mode=subscribe&hub.verify_token=synthetic-verify-token-1234567&hub.challenge=123");
    assert.equal(r.status, 404);
    const raw = JSON.stringify(payload);
    r = await fetch(base + META_TEST_WEBHOOK_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(raw) },
      body: raw,
    });
    assert.equal(r.status, 404);
  });
});

test("isolated GET challenge, admin counters, and signed test-only POST work without storing body", async () => {
  await withServer(env, async base => {
    const path = base + META_TEST_WEBHOOK_PATH;
    let r = await fetch(path + "?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123");
    assert.equal(r.status, 403);

    r = await fetch(path + "?hub.mode=subscribe&hub.verify_token=synthetic-verify-token-1234567&hub.challenge=123456");
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "123456");

    const raw = JSON.stringify(payload);
    r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(raw) },
      body: raw,
    });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "EVENT_RECEIVED");

    let status = await fetch(base + META_TEST_STATUS_PATH);
    assert.equal(status.status, 403);

    status = await fetch(base + META_TEST_STATUS_PATH, {
      headers: { "x-fixture-admin": "true" },
    });
    assert.equal(status.status, 200);
    assert.equal(status.headers.get("cache-control"), "no-store");
    const body = await status.json();
    assert.deepEqual({
      enabled: body.enabled,
      authenticatedBatches: body.authenticatedBatches,
      acceptedMessageFieldChanges: body.acceptedMessageFieldChanges,
      recordsPersisted: body.recordsPersisted,
      messagesSent: body.messagesSent,
      employeeNumbersConnected: body.employeeNumbersConnected,
    }, {
      enabled: true,
      authenticatedBatches: 1,
      acceptedMessageFieldChanges: 1,
      recordsPersisted: 0,
      messagesSent: 0,
      employeeNumbersConnected: false,
    });
    assert.equal(JSON.stringify(body).includes("DO_NOT_SAVE_THIS_MESSAGE"), false);
    assert.equal(JSON.stringify(body).includes("15550000000"), false);
  });
});

test("wrong signature, wrong WABA, wrong phone, content-type and malformed JSON never count", async () => {
  await withServer(env, async base => {
    const path = base + META_TEST_WEBHOOK_PATH;
    const wrongWaba = { ...payload, entry: [{ ...payload.entry[0], id: "333333333" }] };
    const wrongPhone = { ...payload, entry: [{ ...payload.entry[0],
      changes: [{ ...payload.entry[0].changes[0], value: {
        ...payload.entry[0].changes[0].value,
        metadata: { phone_number_id: "333333333" },
      } }] }] };
    for (const fixture of [wrongWaba, wrongPhone]) {
      const raw = JSON.stringify(fixture);
      const r = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": sign(raw) },
        body: raw,
      });
      assert.equal(r.status, 403);
    }

    const raw = JSON.stringify(payload);
    let r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign("wrong") },
      body: raw,
    });
    assert.equal(r.status, 401);

    r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-hub-signature-256": sign(raw) },
      body: raw,
    });
    assert.equal(r.status, 415);

    const broken = "{not valid json";
    r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign(broken) },
      body: broken,
    });
    assert.equal(r.status, 400);

    const status = await fetch(base + META_TEST_STATUS_PATH, {
      headers: { "x-fixture-admin": "true" },
    });
    const body = await status.json();
    assert.equal(body.authenticatedBatches, 0);
  });
});
