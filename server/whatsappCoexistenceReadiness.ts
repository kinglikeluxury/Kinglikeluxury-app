import { metaTestWebhookConfig } from "./metaTestWebhook";

/**
 * Non-actionable, admin-only Coexistence readiness snapshot.
 * Never treats a successful TEST WABA message as proof that a real employee
 * number may be enrolled. No Meta requests, account access, DB reads, sends,
 * historical chat sync, or side effects.
 */
export type WhatsappCoexistenceReadiness = {
  scope: "employee_coexistence";
  environment: "isolated_staging";
  safeToStartEmployeeSignup: false;
  realEmployeeNumbersConnected: false;
  realChatIngestionEnabled: false;
  testWabaReceiverConfigured: boolean;
  evidence: {
    testWabaTransport: "configured" | "not_configured";
    realEmployeeOwnershipAndMetaEligibility: "not_verified";
    realEmbeddedSignupBackend: "not_implemented";
    persistentVerifiedProofRepository: "not_implemented";
    employeeConsentAndCustomerNotice: "not_recorded";
    realEmployeeWebhookRoutingAndAudit: "not_approved";
  };
  blockingSteps: string[];
};

export function inspectWhatsappCoexistenceReadiness(
  env: NodeJS.ProcessEnv = process.env,
): WhatsappCoexistenceReadiness {
  const testReady = metaTestWebhookConfig(env) !== null;
  return {
    scope: "employee_coexistence",
    environment: "isolated_staging",
    safeToStartEmployeeSignup: false,
    realEmployeeNumbersConnected: false,
    realChatIngestionEnabled: false,
    testWabaReceiverConfigured: testReady,
    evidence: {
      testWabaTransport: testReady ? "configured" : "not_configured",
      realEmployeeOwnershipAndMetaEligibility: "not_verified",
      realEmbeddedSignupBackend: "not_implemented",
      persistentVerifiedProofRepository: "not_implemented",
      employeeConsentAndCustomerNotice: "not_recorded",
      realEmployeeWebhookRoutingAndAudit: "not_approved",
    },
    blockingSteps: [
      "Implement a trusted Meta Embedded Signup v4 code exchange and independently verify the exact WABA, phone and Coexistence status.",
      "Store verified ownership and employee consent in an isolated, reviewed non-test repository; do not import prior chats by default.",
      "Review work-only customer notice, retention, revocation, access audit and webhook ownership before activating any live number.",
      "Exercise real-number webhook routing and rollback in an approved isolated staging acceptance test before enabling production.",
    ],
  };
}
