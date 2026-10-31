import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import bcrypt from "bcrypt";
import {
  clearMetaReviewWhatsappEventsForTests,
  type MetaReviewWhatsappEnvironment,
} from "./metaReviewWhatsappService";
import {
  registerMetaReviewWhatsappRoutes,
  type MetaReviewWhatsappRouteDependencies,
} from "./metaReviewWhatsappRoutes";
import { verifyStoredPassword } from "./passwordAuth";
import {
  clearMetaReviewerAccountsForTests,
  authenticateMetaReviewer,
  findMetaReviewerByEmail,
  getMetaReviewerAccount,
} from "./metaReviewerAccessStore";
import { createMetaReviewerAccessGuard } from "./metaReviewerAccessGuard";

const TEST_ENV: MetaReviewWhatsappEnvironment = {
  META_REVIEW_WA_TEST_ENABLED: "true",
  META_REVIEW_WA_TEST_WABA_ID: "123456789",
  META_REVIEW_WA_TEST_PHONE_NUMBER_ID: "987654321",
  META_REVIEW_WA_TEST_RECIPIENT: "+12025550101",
  META_REVIEW_WA_TEST_ACCESS_TOKEN: "synthetic-test-access-token",
  META_REVIEW_WA_TEST_VERIFY_TOKEN: "synthetic-test-verify-token",
  META_REVIEW_WA_TEST_APP_SECRET: "synthetic-test-app-secret",
};

async function withTestServer<T>(
  admin: boolean,
  run: (origin: string) => Promise<T>,
  fetchImpl: typeof fetch = async () => ({ ok: true, status: 200 } as Response),
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
    fetchImpl,
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
    const reviewerAccess = await fetch(`${origin}/api/admin/meta-reviewer-access`);
    const statusResponse = await fetch(`${origin}/api/admin/meta-review/whatsapp/status`);
    const sendResponse = await fetch(
      `${origin}/api/admin/meta-review/whatsapp/send-test-template`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    const managementResponse = await fetch(
      `${origin}/api/admin/meta-review/whatsapp/management`,
    );
    assert.equal(reviewerAccess.status, 404);
    assert.equal(statusResponse.status, 401);
    assert.equal(sendResponse.status, 401);
    assert.equal(managementResponse.status, 401);
  });
});

test("reviewer provisioning hashes credentials and supports disable and delete", async () => {
  clearMetaReviewerAccountsForTests();
  const fakeStorage = {
    getUserByEmail: async () => undefined,
    getUserByUsername: async () => undefined,
  } as unknown as NonNullable<MetaReviewWhatsappRouteDependencies["userStorage"]>;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const reviewerSession = req.get("x-reviewer-session") === "true";
    const reviewerId = Number(req.get("x-reviewer-id"));
    const unauthenticated = req.get("x-no-admin") === "true";
    (req as typeof req & { session?: unknown }).session = unauthenticated
      ? undefined
      : reviewerSession
        ? {
            userId: reviewerId,
            isAdmin: false,
            isMetaReviewer: true,
            isActive: true,
            role: "meta_reviewer",
            destroy: (callback: (error?: Error) => void) => callback(),
          }
        : { userId: 42, isAdmin: true, isActive: true, role: "admin" };
    next();
  });
  app.use(createMetaReviewerAccessGuard(() => ({
    NODE_ENV: "development",
    ENABLE_META_REVIEW_DIAGNOSTIC_MODE: "true",
  })));
  registerMetaReviewWhatsappRoutes(app, {
    environment: () => ({
      ...TEST_ENV,
      NODE_ENV: "development",
      ENABLE_META_REVIEW_DIAGNOSTIC_MODE: "true",
    }),
    userStorage: fakeStorage,
    fetchImpl: async (input) => {
      const url = String(input);
      return new Response(
        JSON.stringify(url.includes("/phone_numbers") ? { data: [] } : {}),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  app.get("/admin/whatsapp-monitoring", (_req, res) => res.sendStatus(200));
  app.get("/admin/users", (_req, res) => res.sendStatus(200));
  app.get("/api/admin/users", (_req, res) => res.sendStatus(200));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const candidate = `reviewer-fixture-${randomUUID()}`;
    const unauthorizedCreate = await fetch(`${origin}/api/admin/meta-reviewer-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-no-admin": "true" },
      body: JSON.stringify({ email: "blocked@example.test", password: candidate }),
    });
    assert.equal(unauthorizedCreate.status, 401);

    const createResponse = await fetch(`${origin}/api/admin/meta-reviewer-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reviewer@example.test", password: candidate }),
    });
    assert.equal(createResponse.status, 201);
    const createdPayload = await createResponse.text();
    assert.equal(createdPayload.includes(candidate), false);
    assert.equal(createdPayload.includes("$2"), false);
    const created = JSON.parse(createdPayload) as { reviewer: { id: number } };
    const reviewerId = created.reviewer.id;
    const reviewer = getMetaReviewerAccount(reviewerId)!;
    assert.equal(reviewer.role, "meta_reviewer");
    assert.equal(reviewer.isMetaReviewer, true);
    assert.equal("isAdmin" in reviewer, false);
    assert.equal(reviewer.isActive, true);
    assert.notEqual(reviewer.passwordHash, candidate);
    assert.equal(findMetaReviewerByEmail("REVIEWER@example.test")?.id, reviewerId);
    assert.equal(await bcrypt.compare(candidate, reviewer.passwordHash), true);
    assert.equal(await verifyStoredPassword(candidate, reviewer.passwordHash), true);
    assert.equal(
      (await authenticateMetaReviewer("reviewer@example.test", candidate))?.id,
      reviewerId,
    );
    assert.equal(await authenticateMetaReviewer("reviewer@example.test", "wrong-password"), undefined);

    const reviewerStatus = await fetch(`${origin}/api/admin/meta-review/whatsapp/status`, {
      headers: {
        "x-reviewer-session": "true",
        "x-reviewer-id": String(reviewerId),
      },
    });
    assert.equal(reviewerStatus.status, 200);
    assert.equal(
      (await fetch(`${origin}/api/admin/meta-review/whatsapp/events`, {
        headers: { "x-reviewer-session": "true", "x-reviewer-id": String(reviewerId) },
      })).status,
      200,
    );
    assert.equal(
      (await fetch(`${origin}/api/admin/meta-review/whatsapp/management`, {
        headers: { "x-reviewer-session": "true", "x-reviewer-id": String(reviewerId) },
      })).status,
      200,
    );
    assert.equal(
      (await fetch(`${origin}/api/admin/meta-review/whatsapp/send-test-template`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-reviewer-session": "true",
          "x-reviewer-id": String(reviewerId),
        },
        body: "{}",
      })).status,
      200,
    );
    assert.equal(
      (await fetch(`${origin}/admin/whatsapp-monitoring`, {
        headers: { "x-reviewer-session": "true", "x-reviewer-id": String(reviewerId) },
      })).status,
      200,
    );

    const reviewerManagement = await fetch(
      `${origin}/api/admin/meta-reviewer-access`,
      { headers: { "x-reviewer-session": "true", "x-reviewer-id": String(reviewerId) } },
    );
    assert.equal(reviewerManagement.status, 403);
    const blockedAdminApi = await fetch(`${origin}/api/admin/users`, {
      headers: { "x-reviewer-session": "true", "x-reviewer-id": String(reviewerId) },
    });
    assert.equal(blockedAdminApi.status, 403);
    const blockedCrmApi = await fetch(`${origin}/api/admin/crm/leads`, {
      headers: { "x-reviewer-session": "true", "x-reviewer-id": String(reviewerId) },
    });
    assert.equal(blockedCrmApi.status, 403);
    const blockedAdminPage = await fetch(`${origin}/admin/users`, {
      headers: { "x-reviewer-session": "true", "x-reviewer-id": String(reviewerId) },
    });
    assert.equal(blockedAdminPage.status, 403);
    assert.equal(
      (await fetch(`${origin}/api/admin/users`, {
        headers: { "x-reviewer-session": "true", "x-reviewer-id": String(reviewerId) },
      })).status,
      403,
    );
    assert.equal(
      (await fetch(`${origin}/admin/crm/42`, {
        headers: { "x-reviewer-session": "true", "x-reviewer-id": String(reviewerId) },
      })).status,
      403,
    );

    const realAdminApi = await fetch(`${origin}/api/admin/users`);
    assert.equal(realAdminApi.status, 200);
    const realAdminPage = await fetch(`${origin}/admin/users`);
    assert.equal(realAdminPage.status, 200);

    const listResponse = await fetch(`${origin}/api/admin/meta-reviewer-access`);
    const list = await listResponse.json() as { reviewers: Array<Record<string, unknown>> };
    assert.equal(list.reviewers.length, 1);
    assert.equal("password" in list.reviewers[0], false);

    const disableResponse = await fetch(`${origin}/api/admin/meta-reviewer-access/${reviewerId}/disable`, {
      method: "PATCH",
    });
    assert.equal(disableResponse.status, 200);
    assert.equal(getMetaReviewerAccount(reviewerId)?.isActive, false);
    assert.equal(getMetaReviewerAccount(reviewerId)?.isMetaReviewer, true);

    const blockedReviewerResponse = await fetch(`${origin}/api/admin/meta-reviewer-access`, {
      headers: {
        "x-reviewer-session": "true",
        "x-reviewer-id": String(reviewerId),
      },
    });
    assert.equal(blockedReviewerResponse.status, 401);

    const deleteResponse = await fetch(`${origin}/api/admin/meta-reviewer-access/${reviewerId}`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal(getMetaReviewerAccount(reviewerId), undefined);
  } finally {
    clearMetaReviewerAccountsForTests();
    server.close();
    await once(server, "close");
  }
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

test("management endpoint reads only test WABA data and returns a redacted view", async () => {
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof URL ? input : String(input));
    requests.push({
      url: url.toString(),
      authorization: new Headers(init?.headers).get("authorization") ?? undefined,
    });
    const isPhoneList = url.pathname.endsWith("/phone_numbers");
    const data = isPhoneList
      ? {
          data: [{
            id: "987654321",
            display_phone_number: "+1 555 123 4567",
            verified_name: "Test Business",
            quality_rating: "GREEN",
            status: "CONNECTED",
            code_verification_status: "VERIFIED",
          }],
        }
      : {
          account_review_status: "APPROVED",
          business_verification_status: "VERIFIED",
        };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await withTestServer(true, async (origin) => {
    const response = await fetch(
      `${origin}/api/admin/meta-review/whatsapp/management`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json() as {
      waba: { connected: boolean; accountReviewStatus?: string };
      phoneNumbers: Array<{
        displayNumber: string;
        verifiedName?: string;
        status?: string;
        qualityRating?: string;
      }>;
    };
    assert.equal(body.waba.connected, true);
    assert.equal(body.waba.accountReviewStatus, "APPROVED");
    assert.deepEqual(body.phoneNumbers[0], {
      displayNumber: "•••• 4567",
      verifiedName: "Test Business",
      qualityRating: "GREEN",
      status: "CONNECTED",
      codeVerificationStatus: "VERIFIED",
    });
    const serialized = JSON.stringify(body);
    for (const sensitive of [
      TEST_ENV.META_REVIEW_WA_TEST_WABA_ID,
      TEST_ENV.META_REVIEW_WA_TEST_PHONE_NUMBER_ID,
      TEST_ENV.META_REVIEW_WA_TEST_ACCESS_TOKEN,
      "15551234567",
      "987654321",
    ]) {
      assert.equal(serialized.includes(sensitive), false);
    }
  }, fetchImpl);

  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ url }) =>
    url.startsWith("https://graph.facebook.com/v23.0/123456789"),
  ));
  assert.ok(requests.some(({ url }) => new URL(url).pathname.endsWith("/phone_numbers")));
  assert.ok(requests.every(({ authorization }) =>
    authorization === `Bearer ${TEST_ENV.META_REVIEW_WA_TEST_ACCESS_TOKEN}`,
  ));
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
