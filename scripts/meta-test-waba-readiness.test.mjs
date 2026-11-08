import test from "node:test";
import assert from "node:assert/strict";
import { checkMetaTestWabaReadiness } from "./meta-test-waba-readiness.mjs";

const allowed = {
  APP_DEPLOYMENT_MODE: "local-meta-test",
  WHATSAPP_META_TEST_READ_ONLY: "YES_READ_ONLY",
  WHATSAPP_META_TEST_GRAPH_VERSION: "v27.0",
  WHATSAPP_META_TEST_WABA_ID: "123456789",
  WHATSAPP_META_TEST_PHONE_NUMBER_ID: "987654321",
  WHATSAPP_META_TEST_ACCESS_TOKEN: "synthetic-only-token-do-not-use",
};

test("cannot contact Meta when disabled or in Staging/production", async () => {
  let called = 0;
  const fake = async () => {
    called++;
    throw new Error("must not call network");
  };
  for (const env of [
    {},
    { ...allowed, WHATSAPP_META_TEST_READ_ONLY: undefined },
    { ...allowed, APP_DEPLOYMENT_MODE: "staging" },
    { ...allowed, APP_DEPLOYMENT_MODE: "production" },
    { ...allowed, NODE_ENV: "production" },
  ]) {
    const r = await checkMetaTestWabaReadiness({ env, graphFetch: fake });
    assert.equal(r.status, "disabled");
  }
  assert.equal(called, 0);
});

test("invalid identifiers and token fail closed before network", async () => {
  let called = 0;
  const fake = async () => { called++; throw Error("network must not start"); };
  for (const env of [
    { ...allowed, WHATSAPP_META_TEST_WABA_ID: "not-an-id" },
    { ...allowed, WHATSAPP_META_TEST_PHONE_NUMBER_ID: "123456789" },
    { ...allowed, WHATSAPP_META_TEST_GRAPH_VERSION: "v27.0/../../send" },
    { ...allowed, WHATSAPP_META_TEST_ACCESS_TOKEN: "short" },
    { ...allowed, WHATSAPP_META_TEST_ACCESS_TOKEN: "synthetic-only-token-do-not-use\n" },
  ]) {
    const r = await checkMetaTestWabaReadiness({ env, graphFetch: fake });
    assert.equal(r.status, "invalid_configuration");
  }
  assert.equal(called, 0);
});

test("successful read-only association uses one GET, fixed Graph host, no secrets in output", async () => {
  let called = 0;
  const result = await checkMetaTestWabaReadiness({
    env: allowed,
    graphFetch: async (url, init) => {
      called++;
      assert.equal(url.origin, "https://graph.facebook.com");
      assert.equal(url.pathname, "/v27.0/123456789/phone_numbers");
      assert.equal(url.searchParams.get("fields"), "id");
      assert.equal(url.searchParams.get("limit"), "100");
      assert.equal(url.searchParams.has("access_token"), false);
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers.Authorization, "Bearer synthetic-only-token-do-not-use");
      assert.equal(init.body, undefined);
      return new Response(JSON.stringify({
        data: [{ id: "987654321" }],
      }), { status: 200 });
    },
  });
  assert.equal(called, 1);
  assert.equal(result.status, "phone_association_found");
  assert.equal(result.testedLiveMessageDelivery, false);
  assert.equal(result.testedWebhookDelivery, false);
  assert.equal(result.verifiedAsTestAccountByMeta, false);
  assert.equal(result.noMessageSendsPerformed, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(allowed.WHATSAPP_META_TEST_ACCESS_TOKEN), false);
  assert.equal(serialized.includes(allowed.WHATSAPP_META_TEST_PHONE_NUMBER_ID), false);
});

test("lookup errors never expose Graph error body, phone IDs or credentials", async () => {
  const rejected = await checkMetaTestWabaReadiness({
    env: allowed,
    graphFetch: async () => new Response(JSON.stringify({
      error: { message: "synthetic-only-token-do-not-use" },
    }), { status: 403 }),
  });
  assert.equal(rejected.status, "lookup_failed");
  assert.equal(JSON.stringify(rejected).includes("synthetic-only-token-do-not-use"), false);

  const thrown = await checkMetaTestWabaReadiness({
    env: allowed,
    graphFetch: async () => { throw new Error("secret=synthetic-only-token-do-not-use"); },
  });
  assert.equal(thrown.status, "lookup_failed");

  const malformed = await checkMetaTestWabaReadiness({
    env: allowed,
    graphFetch: async () => new Response(JSON.stringify({
      data: [{ id: "bad-value" }],
    }), { status: 200 }),
  });
  assert.equal(malformed.status, "unexpected_response");
});

test("unknown/absent phone number remains unverified; pagination is inconclusive", async () => {
  const absent = await checkMetaTestWabaReadiness({
    env: allowed,
    graphFetch: async () => new Response(JSON.stringify({ data: [{ id: "77777777" }] }), { status: 200 }),
  });
  assert.equal(absent.status, "phone_not_listed");

  const paginated = await checkMetaTestWabaReadiness({
    env: allowed,
    graphFetch: async () => new Response(JSON.stringify({
      data: [{ id: "77777777" }],
      paging: { next: "https://graph.facebook.com/next-page" },
    }), { status: 200 }),
  });
  assert.equal(paginated.status, "incomplete_page");
});
