import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { createWhatsappCoexistenceMetaGraphClient } from "./whatsappCoexistenceMetaGraph";
import { createVerifiedPreapprovalSignupCompleter } from "./whatsappCoexistencePreapprovalFlow";
import { protectApprovedNumber } from "./stagingAuth/whatsappPreapproval";
import { COEXISTENCE_SIGNUP_TTL_MS } from "./whatsappCoexistenceOAuthRoutes";

function fixtureGraphResponse(body: unknown, status = 200): typeof fetch {
  return (async (_url: URL | RequestInfo, opts?: RequestInit) => {
    assert.equal(opts?.method, "GET");
    assert.equal(opts?.redirect, "error");
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

test("Meta status: only a matching phone in both Business App and Cloud API is accepted", async () => {
  const cases = [
    { value: { id: "888", is_on_biz_app: true, platform_type: "CLOUD_API" }, accepted: true },
    { value: { id: "888", is_on_biz_app: false, platform_type: "CLOUD_API" }, accepted: false },
    { value: { id: "888", platform_type: "CLOUD_API" }, accepted: false },
    { value: { id: "888", is_on_biz_app: true, platform_type: "ON_PREMISE" }, accepted: false },
    { value: { id: "999", is_on_biz_app: true, platform_type: "CLOUD_API" }, accepted: false },
  ];
  for (const { value, accepted } of cases) {
    const api = createWhatsappCoexistenceMetaGraphClient({
      appId: "123", appSecret: "synthetic-not-real", fetchImpl: fixtureGraphResponse(value),
    });
    const result = await api.getCoexistencePhoneStatus!("888", "synthetic-token");
    assert.equal(result.isOnBizApp, accepted);
    assert.equal(result.platformType === "CLOUD_API", accepted);
  }
});

test("Meta status: errors, missing permissions and invalid phone IDs all fail closed", async () => {
  const api = createWhatsappCoexistenceMetaGraphClient({
    appId: "123", appSecret: "synthetic-not-real", fetchImpl: fixtureGraphResponse({ error: { code: 200 } }, 403),
  });
  await assert.rejects(() => api.getCoexistencePhoneStatus!("888", "synthetic-token"));
  await assert.rejects(() => api.getCoexistencePhoneStatus!("not-a-number", "synthetic-token"));
});

test("Meta completion: a Cloud-only phone cannot be persisted as Samer's approved Coexistence number", async () => {
  const number = "+995511746491";
  const key = randomBytes(32);
  const encrypted = protectApprovedNumber(number, key);
  let wroteMetaVerification = false;
  const store = {
    getApprovedForAttempt: async () => ({
      id: "11111111-2222-3333-4444-555555555555",
      employeeId: 7, version: 1, status: "approved",
      numberFingerprint: encrypted.fingerprint, numberCiphertext: encrypted.ciphertext,
    }),
    recordMetaVerified: async () => { wroteMetaVerification = true; return true; },
  };
  const fakeGraph = {
    exchangeCode: async () => "synthetic-token",
    inspectToken: async () => ({
      valid: true, appId: "123", expiresAt: Math.floor(Date.now() / 1000) + 900,
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"],
    }),
    listBusinessOwnedWabas: async () => ["777"],
    listWabaPhoneNumberDetails: async () => [{ id: "888", displayPhoneNumber: number }],
    getCoexistencePhoneStatus: async () => ({ isOnBizApp: false, platformType: "" }),
  };
  const verify = createVerifiedPreapprovalSignupCompleter({
    env: { WHATSAPP_STAGING_ONBOARDING_ENCRYPTION_KEY: key.toString("base64") } as NodeJS.ProcessEnv,
    graph: fakeGraph,
    store: store as any,
    expectedAppId: "123",
  });
  await assert.rejects(
    () => verify({
      approvalId: "11111111-2222-3333-4444-555555555555",
      version: 1, employeeId: 7, code: "synthetic-code-long-enough",
      claims: { businessId: "666", wabaId: "777", phoneNumberId: "888" },
    }),
    /meta_phone_not_verified_as_coexistence/,
  );
  assert.equal(wroteMetaVerification, false);
});

test("Meta completion: a verified Business App + Cloud API phone can pass the Coexistence-only gate", async () => {
  const number = "+995511746491";
  const key = randomBytes(32);
  const encrypted = protectApprovedNumber(number, key);
  let wroteMetaVerification = false;
  const store = {
    getApprovedForAttempt: async () => ({
      id: "11111111-2222-3333-4444-555555555555",
      employeeId: 7, version: 1, status: "approved",
      numberFingerprint: encrypted.fingerprint, numberCiphertext: encrypted.ciphertext,
    }),
    recordMetaVerified: async () => { wroteMetaVerification = true; return true; },
  };
  const verify = createVerifiedPreapprovalSignupCompleter({
    env: { WHATSAPP_STAGING_ONBOARDING_ENCRYPTION_KEY: key.toString("base64") } as NodeJS.ProcessEnv,
    graph: {
      exchangeCode: async () => "synthetic-token",
      inspectToken: async () => ({
        valid: true, appId: "123", expiresAt: Math.floor(Date.now() / 1000) + 900,
        scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      }),
      listBusinessOwnedWabas: async () => ["777"],
      listWabaPhoneNumberDetails: async () => [{ id: "888", displayPhoneNumber: number }],
      getCoexistencePhoneStatus: async () => ({ isOnBizApp: true, platformType: "CLOUD_API" }),
    },
    store: store as any,
    expectedAppId: "123",
  });
  const status = await verify({
    approvalId: "11111111-2222-3333-4444-555555555555",
    version: 1, employeeId: 7, code: "synthetic-code-long-enough",
    claims: { businessId: "666", wabaId: "777", phoneNumberId: "888" },
  });
  assert.equal(status, "verified");
  assert.equal(wroteMetaVerification, true);
});


test("Meta onboarding TTL accommodates a human QR scan while remaining time-bounded", () => {
  assert.equal(COEXISTENCE_SIGNUP_TTL_MS, 25 * 60_000);
  assert.ok(COEXISTENCE_SIGNUP_TTL_MS <= 30 * 60_000);
});

test("archive-specific prerequisites cannot be bypassed by Meta-only verification", async () => {
  const number = "+995511746491";
  const key = randomBytes(32);
  const encrypted = protectApprovedNumber(number, key);
  let persisted = false;
  const verify = createVerifiedPreapprovalSignupCompleter({
    env: { WHATSAPP_STAGING_ONBOARDING_ENCRYPTION_KEY: key.toString("base64") } as NodeJS.ProcessEnv,
    expectedAppId: "123",
    graph: {
      exchangeCode: async () => "synthetic-token",
      inspectToken: async () => ({
        valid: true, appId: "123", expiresAt: Math.floor(Date.now() / 1000) + 900,
        scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      }),
      listBusinessOwnedWabas: async () => ["777"],
      listWabaPhoneNumberDetails: async () => [{id:"888",displayPhoneNumber:number}],
      getCoexistencePhoneStatus: async () => ({ isOnBizApp: true, platformType: "CLOUD_API" }),
    },
    store: {
      getApprovedForAttempt: async () => ({
        id: "11111111-2222-3333-4444-555555555555",
        employeeId: 7, version: 1, status: "approved",
        numberFingerprint: encrypted.fingerprint, numberCiphertext: encrypted.ciphertext,
      }),
      recordMetaVerified: async () => { persisted = true; return true; },
    } as any,
    archiveSignupWriter: {} as any,
    // Deliberately no getArchiveEligibility: archive flow must fail closed.
  });
  await assert.rejects(
    () => verify({
      approvalId:"11111111-2222-3333-4444-555555555555",
      version:1,employeeId:7,code:"synthetic-code-long-enough",
      claims:{businessId:"666",wabaId:"777",phoneNumberId:"888"},
    }),
    /staging_archive_binding_store_unavailable/,
  );
  assert.equal(persisted, false);
});
