import assert from "node:assert/strict";
import test from "node:test";
import { createStagingMetaOnboardingVerifier } from "./whatsappStagingMetaVerifier";
import { assertExternalGatewayAllowed } from "./stagingExternalGuard";

const env: NodeJS.ProcessEnv = {
  APP_DEPLOYMENT_MODE: "staging",
  WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED: "true",
  WHATSAPP_STAGING_EMPLOYEE_NOTICE_REVIEWED: "true",
  WHATSAPP_STAGING_PROOF_SCHEMA_REVIEWED: "true",
  WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED: "true",
  WHATSAPP_STAGING_META_GRAPH_VERIFIER_ENABLED: "true",
  WHATSAPP_STAGING_APPROVED_BUSINESS_PORTFOLIO_ID: "729915175562618",
  WHATSAPP_STAGING_APPROVED_EMPLOYEE_PHONE: "+995555000001",
  WHATSAPP_STAGING_META_APP_ID: "1394232722367127",
  WHATSAPP_STAGING_META_API_VERSION: "v27.0",
  WHATSAPP_STAGING_META_APP_SECRET: "synthetic-staging-secret-do-not-use",
  APP_STAGING_DATABASE_URL: "postgresql://test@example.invalid:5432/stage_safe",
  APP_STAGING_DATABASE_EXPECTED_HOST: "example.invalid",
  APP_STAGING_DATABASE_EXPECTED_NAME: "stage_safe",
  PRODUCTION_DATABASE_HOST: "production.invalid",
  PRODUCTION_DATABASE_NAME: "neondb",
  APP_STAGING_DATABASE_CONFIRMATION: "reviewed-isolated-test",
  APP_STAGING_STORAGE_CONFIRMATION: "reviewed-isolated-storage",
};
const input = {
  code: "synthetic-one-time-meta-code-not-a-secret",
  businessPortfolioId: "729915175562618",
  wabaId: "2233445566",
  phoneNumberId: "3344556677",
  displayPhoneNumber: "+995555000001",
};

test("real verifier is absent without full isolated Staging / staff consent / owner approval", () => {
  const required = [
    "WHATSAPP_STAGING_META_GRAPH_VERIFIER_ENABLED",
    "WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED",
    "WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED",
    "WHATSAPP_STAGING_EMPLOYEE_NOTICE_REVIEWED",
    "WHATSAPP_STAGING_PROOF_SCHEMA_REVIEWED",
    "WHATSAPP_STAGING_META_APP_SECRET",
    "APP_STAGING_DATABASE_CONFIRMATION",
    "APP_STAGING_STORAGE_CONFIRMATION",
  ];
  for (const key of required) {
    const incomplete = { ...env };
    delete incomplete[key];
    assert.equal(createStagingMetaOnboardingVerifier(incomplete), undefined, key);
  }
  for (const changed of [
    { APP_DEPLOYMENT_MODE: "production" },
    { WHATSAPP_STAGING_APPROVED_BUSINESS_PORTFOLIO_ID: "000001" },
    { WHATSAPP_STAGING_META_APP_ID: "000001" },
    { WHATSAPP_STAGING_META_API_VERSION: "v28.0" },
    { WHATSAPP_STAGING_APPROVED_EMPLOYEE_PHONE: "invalid" },
    { APP_STAGING_DATABASE_URL: "postgresql://test@production.invalid:5432/neondb" },
  ]) {
    assert.equal(createStagingMetaOnboardingVerifier({ ...env, ...changed }), undefined);
  }
});

test("only approved business and exact work phone can be checked; unrelated Meta APIs remain blocked", async () => {
  const requests: Array<{ path: string; headers: Headers; params: URLSearchParams }> = [];
  const token = "synthetic-token-never-persisted";
  const graphFetch = async (request: string | URL, options?: RequestInit) => {
    const url = new URL(String(request));
    requests.push({ path: url.pathname, headers: new Headers(options?.headers), params: url.searchParams });
    let data: unknown;
    if (url.pathname.endsWith("/oauth/access_token")) data = { access_token: token };
    else if (url.pathname.endsWith("/debug_token")) data = { data: {
      app_id: env.WHATSAPP_STAGING_META_APP_ID, is_valid: true,
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
    } };
    else if (url.pathname.endsWith("/client_whatsapp_business_accounts")) data = { data: [{ id: input.wabaId }] };
    else if (url.pathname.endsWith("/phone_numbers")) data = { data: [{
      id: input.phoneNumberId, display_phone_number: input.displayPhoneNumber,
    }] };
    else if (url.pathname.endsWith("/"+input.phoneNumberId)) data = {
      id: input.phoneNumberId, display_phone_number: input.displayPhoneNumber,
      is_on_biz_app: true, platform_type: "CLOUD_API",
    };
    else throw new Error("Unapproved Graph request");
    return new Response(JSON.stringify(data), { status: 200 });
  };
  const verifier = createStagingMetaOnboardingVerifier({ ...env }, graphFetch);
  assert.ok(verifier);
  await assert.rejects(verifier.exchangeAndVerify({ ...input, displayPhoneNumber: "+995555000002" }));
  await assert.rejects(verifier.exchangeAndVerify({ ...input, businessPortfolioId: "999999" }));
  assert.equal(requests.length, 0);

  const proof = await verifier.exchangeAndVerify(input);
  assert.equal(proof.coexistence, "verified");
  assert.equal(proof.displayPhoneNumber, input.displayPhoneNumber);
  assert.equal(proof.ownershipVerified, true);
  assert.equal(requests.length, 5);
  assert.equal(requests[0].path, "/v27.0/oauth/access_token");
  assert.equal(requests[0].params.get("code"), input.code);
  assert.equal(JSON.stringify(proof).includes(token), false);
  assert.equal(JSON.stringify(proof).includes(input.code), false);

  // Generic meta calls remain blocked; only the scoped verifier has a guard.
  assert.throws(() => assertExternalGatewayAllowed("meta", env), /STAGING_EXTERNAL_INTEGRATION_DISABLED/);
});

test("revocation of approval fails closed even after the verifier was constructed", async () => {
  let calls = 0;
  const mutable = { ...env };
  const verifier = createStagingMetaOnboardingVerifier(mutable, async () => {
    calls++;
    throw new Error("Should not request Meta after revocation");
  });
  assert.ok(verifier);
  mutable.WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED = "false";
  await assert.rejects(verifier.exchangeAndVerify(input));
  assert.equal(calls, 0);
});

test("real Meta response lacking verified Coexistence is refused", async () => {
  const graphFetch = async (request: string | URL) => {
    const url = new URL(String(request));
    let result: unknown;
    if (url.pathname.endsWith("/oauth/access_token")) result = { access_token: "synthetic-token-never-persisted" };
    else if (url.pathname.endsWith("/debug_token")) result = { data: { app_id: env.WHATSAPP_STAGING_META_APP_ID,
      is_valid: true, scopes: ["whatsapp_business_management", "whatsapp_business_messaging"] } };
    else if (url.pathname.endsWith("/client_whatsapp_business_accounts")) result = { data: [{ id: input.wabaId }] };
    else if (url.pathname.endsWith("/phone_numbers")) result = { data: [{ id: input.phoneNumberId,
      display_phone_number: input.displayPhoneNumber }] };
    else result = { id: input.phoneNumberId, display_phone_number: input.displayPhoneNumber,
      is_on_biz_app: false, platform_type: "CLOUD_API" };
    return new Response(JSON.stringify(result), { status: 200 });
  };
  const verifier = createStagingMetaOnboardingVerifier({ ...env }, graphFetch);
  assert.ok(verifier);
  await assert.rejects(verifier.exchangeAndVerify(input));
});
