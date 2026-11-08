import assert from "node:assert/strict";
import test from "node:test";
import { inspectWhatsappCoexistenceReadiness } from "./whatsappCoexistenceReadiness";

test("employee Coexistence stays blocked even with a healthy TEST WABA receiver", () => {
  const snapshot = inspectWhatsappCoexistenceReadiness({
    APP_DEPLOYMENT_MODE: "staging",
    WHATSAPP_META_TEST_WEBHOOK_ENABLED: "true",
    WHATSAPP_META_TEST_WABA_ID: "864180513396495",
    WHATSAPP_META_TEST_PHONE_NUMBER_ID: "1112969625242813",
    WHATSAPP_META_TEST_WEBHOOK_VERIFY_TOKEN: "ValidTestVerifyTokenOnly123456789",
    WHATSAPP_META_TEST_META_APP_SECRET: "safe-placeholder-meta-test-secret",
    WHATSAPP_META_ONBOARDING_ENABLED: "true",
    WHATSAPP_EMPLOYEE_MONITORING_ENABLED: "true",
  });
  assert.equal(snapshot.testWabaReceiverConfigured, true);
  assert.equal(snapshot.safeToStartEmployeeSignup, false);
  assert.equal(snapshot.realEmployeeNumbersConnected, false);
  assert.equal(snapshot.realChatIngestionEnabled, false);
  assert.equal(snapshot.evidence.realEmbeddedSignupBackend, "not_implemented");
  assert.ok(snapshot.blockingSteps.length >= 3);
});

test("readiness is fail-closed when no test receiver is configured", () => {
  const snapshot = inspectWhatsappCoexistenceReadiness({
    APP_DEPLOYMENT_MODE: "staging",
  });
  assert.equal(snapshot.testWabaReceiverConfigured, false);
  assert.equal(snapshot.safeToStartEmployeeSignup, false);
});

test("the read-only status never serializes credentials, phone numbers or customer content", () => {
  const secret = "an-example-secret-that-must-never-appear";
  const phone = "+995511746491";
  const snapshot = inspectWhatsappCoexistenceReadiness({
    APP_DEPLOYMENT_MODE: "staging",
    WHATSAPP_META_TEST_WEBHOOK_ENABLED: "true",
    WHATSAPP_META_TEST_WABA_ID: "864180513396495",
    WHATSAPP_META_TEST_PHONE_NUMBER_ID: "1112969625242813",
    WHATSAPP_META_TEST_WEBHOOK_VERIFY_TOKEN: "ValidTestVerifyTokenOnly123456789",
    WHATSAPP_META_TEST_META_APP_SECRET: secret,
    WHATSAPP_EMPLOYEE_PHONE_NUMBER: phone,
  });
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes(secret), false);
  assert.equal(json.includes(phone), false);
  assert.equal(json.includes("864180513396495"), false);
  assert.equal(json.includes("1112969625242813"), false);
});
