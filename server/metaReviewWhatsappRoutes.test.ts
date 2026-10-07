import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import {
  clearMetaReviewWhatsappEventsForTests,
  type MetaReviewWhatsappEnvironment,
} from "./metaReviewWhatsappService";
import { registerMetaReviewWhatsappRoutes } from "./metaReviewWhatsappRoutes";

const TEST_ENV: MetaReviewWhatsappEnvironment = {
  META_REVIEW_WA_TEST_ENABLED: "true",
  META_REVIEW_WA_TEST_WABA_ID: "123456789",
  META_REVIEW_WA_TEST_PHONE_NUMBER_ID: "987654321",
  META_REVIEW_WA_TEST_RECIPIENT: "+15551234567",
  META_REVIEW_WA_TEST_ACCESS_TOKEN: "synthetic-test-access-token",
  META_REVIEW_WA_TEST_VERIFY_TOKEN: "synthetic-test-verify-token",
  META_REVIEW_WA_TEST_APP_SECRET: "synthetic-test-app-secret",
};

async function withTestServer<T>(
  admin: boolean,
  run: (origin: string) => Promise<T>,
): Promise<T> {
  const app = express();
  app.use(express.json({
    verify: (req, _res, body) => {
      if (req.path === "/api/meta-review/whatsapp/webhook") {
        (req as typeof req & { rawBody?: Buffer }).rawBody = body;
      }
    },
  }));
  app.use((req, _res, next) => {
    (req as typeof req & { session?: unknown }).session = admin
      ? { userId: 42, isAdmin: true, isActive: true, role: "admin" }
      : undefined;
    next();
  });
  registerMetaReviewWhatsappRoutes(app, {
    environment: () => TEST_ENV,
    fetchImpl: async () => ({ ok: true, status: 200 } as Response),
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("admin test endpoints require an authenticated admin session", async () => {
  clearMetaReviewWhatsappEventsForTests();
  await withTestServer(false, async (origin) => {
    const statusResponse = await fetch(`${origin}/api/admin/meta-review/whatsapp/status`);
    const sendResponse = await fetch(
      `${origin}/api/admin/meta-review/whatsapp/send-test-template`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    assert.equal(statusResponse.status, 401);
    assert.equal(sendResponse.status, 401);
  });
});

test("admin sees isolated readiness and can send only the fixed empty-body action", async () => {
  clearMetaReviewWhatsappEventsForTests();
  await withTestServer(true, async (origin) => {
    const statusResponse = await fetch(`${origin}/api/admin/meta-review/whatsapp/status`);
    const status = await statusResponse.json() as { sendConfigured: boolean };
    assert.equal(status.sendConfigured, true);

    const arbitraryBody = await fetch(
      `${origin}/api/admin/meta-review/whatsapp/send-test-template`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "employee-number", text: "arbitrary" }),
      },
    );
    assert.equal(arbitraryBody.status, 400);

    const fixedAction = await fetch(
      `${origin}/api/admin/meta-review/whatsapp/send-test-template`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    assert.equal(fixedAction.status, 200);
    assert.deepEqual(await fixedAction.json(), {
      ok: true,
      message: "The fixed test template was submitted.",
    });
  });
});

test("public callback verifies challenge and stores only signed test-recipient events", async () => {
  clearMetaReviewWhatsappEventsForTests();
  await withTestServer(true, async (origin) => {
    const challenge = await fetch(
      `${origin}/api/meta-review/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=synthetic-test-verify-token&hub.challenge=review-challenge`,
    );
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), "review-challenge");

    const payload = {
      object: "whatsapp_business_account",
      entry: [{
        id: "123456789",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "987654321" },
            messages: [{
              id: "synthetic-wamid-route",
              from: "15551234567",
              timestamp: "1791389928",
              type: "text",
              text: { body: "Real callback test event" },
            }],
          },
        }],
      }],
    };
    const rawBody = JSON.stringify(payload);
    const signature = "sha256=" + createHmac(
      "sha256",
      TEST_ENV.META_REVIEW_WA_TEST_APP_SECRET!,
    ).update(rawBody).digest("hex");
    const webhookResponse = await fetch(`${origin}/api/meta-review/whatsapp/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signature,
      },
      body: rawBody,
    });
    assert.equal(webhookResponse.status, 200);

    const eventResponse = await fetch(
      `${origin}/api/admin/meta-review/whatsapp/events`,
    );
    const eventBody = await eventResponse.json() as {
      events: Array<{ text?: string; direction?: string }>;
    };
    assert.equal(eventBody.events.length, 1);
    assert.equal(eventBody.events[0].text, "Real callback test event");
    assert.equal(eventBody.events[0].direction, "inbound");
  });
  clearMetaReviewWhatsappEventsForTests();
});
