import assert from "node:assert/strict";
import test from "node:test";
import { createMetaGraphOnboardingVerifier } from "./whatsappMetaGraphVerifier";

const config = { appId: "1234567890", appSecret: "synthetic-app-secret-value-only", graphApiVersion: "v27.0" };
const input = {
  code: "synthetic-exchange-code",
  businessPortfolioId: "111111",
  wabaId: "222222",
  phoneNumberId: "333333",
  displayPhoneNumber: "+995555000001",
};
const requiredScopes = ["whatsapp_business_management", "whatsapp_business_messaging"];

function graphFixture(options: { scopes?: string[]; portfolioWaba?: string; coexistence?: boolean } = {}) {
  const requests: Array<{ url: URL; headers: Headers }> = [];
  const graphFetch = async (request: string | URL, init?: RequestInit) => {
    const url = new URL(String(request));
    requests.push({ url, headers: new Headers(init?.headers) });
    let payload: unknown;
    if (url.pathname.endsWith("/oauth/access_token")) {
      payload = { access_token: "synthetic-business-token-never-persisted", token_type: "bearer" };
    } else if (url.pathname.endsWith("/debug_token")) {
      payload = { data: { app_id: config.appId, is_valid: true, scopes: options.scopes ?? requiredScopes } };
    } else if (url.pathname.endsWith("/client_whatsapp_business_accounts")) {
      payload = { data: [{ id: options.portfolioWaba ?? input.wabaId }] };
    } else if (url.pathname.endsWith("/phone_numbers")) {
      payload = { data: [{ id: input.phoneNumberId, display_phone_number: input.displayPhoneNumber }] };
    } else if (url.pathname.endsWith(`/${input.phoneNumberId}`)) {
      payload = {
        id: input.phoneNumberId,
        display_phone_number: input.displayPhoneNumber,
        is_on_biz_app: options.coexistence ?? true,
        platform_type: "CLOUD_API",
      };
    } else {
      throw new Error("Unexpected synthetic Graph request");
    }
    return new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  return { requests, graphFetch };
}

test("Graph adapter uses documented v4 verification calls and returns facts without credentials", async () => {
  const fixture = graphFixture();
  const verifier = createMetaGraphOnboardingVerifier(config, fixture.graphFetch);
  const proof = await verifier.exchangeAndVerify(input);
  assert.deepEqual(proof, {
    businessPortfolioId: input.businessPortfolioId,
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    displayPhoneNumber: input.displayPhoneNumber,
    coexistence: "verified",
    grantedPermissions: requiredScopes,
    ownershipVerified: true,
  });
  assert.equal(fixture.requests.length, 5);
  assert.ok(fixture.requests.every(request => request.url.pathname.startsWith("/v27.0/")));
  assert.equal(fixture.requests[0].url.pathname, "/v27.0/oauth/access_token");
  assert.equal(fixture.requests[0].url.searchParams.get("code"), input.code);
  assert.equal(fixture.requests[1].url.pathname, "/v27.0/debug_token");
  assert.equal(fixture.requests[2].url.pathname, `/v27.0/${input.businessPortfolioId}/client_whatsapp_business_accounts`);
  assert.equal(fixture.requests[3].url.searchParams.get("fields"), "id,display_phone_number");
  assert.equal(fixture.requests[4].url.searchParams.get("fields"), "id,display_phone_number,is_on_biz_app,platform_type");
  assert.ok(proof && !("access_token" in proof));
});

test("Graph adapter fails closed on token permissions, portfolio relationship, or Coexistence mismatch", async () => {
  for (const options of [
    { scopes: ["whatsapp_business_management"] },
    { portfolioWaba: "999999" },
    { coexistence: false },
  ]) {
    const verifier = createMetaGraphOnboardingVerifier(config, graphFixture(options).graphFetch);
    await assert.rejects(verifier.exchangeAndVerify(input));
  }
});

test("Graph adapter rejects unconfigured or malformed API versions without making requests", () => {
  assert.throws(() => createMetaGraphOnboardingVerifier({ ...config, graphApiVersion: "" }, async () => {
    throw new Error("must not call network");
  }));
});
