import { createMetaGraphOnboardingVerifier } from "./whatsappMetaGraphVerifier";
import { stagingSignupPolicy } from "./whatsappStagingOnboardingRoutes";
import type { MetaOnboardingVerifier } from "./whatsappMetaOnboardingProof";

/**
 * A narrow Meta egress exception for one owner-approved, company-number
 * verification flow on an isolated Staging database.
 *
 * This factory does NOT initiate Embedded Signup, connect any number,
 * install webhooks, sync chats, send messages, or activate employee access.
 *
 * Only the owner's existing approved app and business portfolio are eligible
 * for this pilot. Settings must be independently reviewed before enablement.
 */
const APPROVED_APP_ID = "1394232722367127";
const APPROVED_PORTFOLIO_ID = "729915175562618";

type GraphFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function validGraphSettings(env: NodeJS.ProcessEnv): boolean {
  return env.WHATSAPP_STAGING_META_GRAPH_VERIFIER_ENABLED === "true" &&
    env.WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED === "true" &&
    env.WHATSAPP_STAGING_META_APP_ID === APPROVED_APP_ID &&
    env.WHATSAPP_STAGING_APPROVED_BUSINESS_PORTFOLIO_ID === APPROVED_PORTFOLIO_ID &&
    env.WHATSAPP_STAGING_META_API_VERSION === "v27.0" &&
    typeof env.WHATSAPP_STAGING_META_APP_SECRET === "string" &&
    env.WHATSAPP_STAGING_META_APP_SECRET.length >= 16 &&
    env.WHATSAPP_STAGING_META_APP_SECRET.length <= 256;
}

/**
 * The default provider remains globally blocked in Staging. Only an explicitly
 * injected verifier for the reviewed endpoint may perform Meta's OAuth exchange
 * and ownership/Coexistence Graph reads. Every call rechecks the environment.
 */
export function createStagingMetaOnboardingVerifier(
  env: NodeJS.ProcessEnv = process.env,
  graphFetch: GraphFetch = fetch,
): MetaOnboardingVerifier | undefined {
  if (!stagingSignupPolicy(env) || !validGraphSettings(env)) return undefined;

  const verifier = createMetaGraphOnboardingVerifier(
    {
      appId: APPROVED_APP_ID,
      appSecret: env.WHATSAPP_STAGING_META_APP_SECRET!,
      graphApiVersion: "v27.0",
    },
    graphFetch,
    () => {
      if (!stagingSignupPolicy(env) || !validGraphSettings(env)) {
        throw new Error("Staging Meta employee onboarding verification is not approved");
      }
    },
  );

  return {
    async exchangeAndVerify(input) {
      if (input.businessPortfolioId !== APPROVED_PORTFOLIO_ID ||
          input.displayPhoneNumber !== env.WHATSAPP_STAGING_APPROVED_EMPLOYEE_PHONE) {
        throw new Error("Unapproved company portfolio or employee phone");
      }
      return verifier.exchangeAndVerify(input);
    },
  };
}
