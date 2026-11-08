import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Explicitly local, opt-in, read-only Meta Test WABA phone association probe.
 * Never imported by the application server, never deployed as a route.
 * It does not send a message, register a number, subscribe a webhook, or
 * read contacts, messages, profile names, or personal phone numbers.
 */
const NO_LIVE_MESSAGES = true;
const ID = /^\d{5,80}$/;
const VERSION = /^v\d{1,3}\.\d{1,2}$/;
const TOKEN = /^[\x21-\x7e]{20,8192}$/;

function configuration(env) {
  if (env.APP_DEPLOYMENT_MODE !== "local-meta-test" ||
      env.NODE_ENV === "production" ||
      env.WHATSAPP_META_TEST_READ_ONLY !== "YES_READ_ONLY") {
    return null;
  }

  const version = env.WHATSAPP_META_TEST_GRAPH_VERSION;
  const wabaId = env.WHATSAPP_META_TEST_WABA_ID;
  const phoneNumberId = env.WHATSAPP_META_TEST_PHONE_NUMBER_ID;
  const accessToken = env.WHATSAPP_META_TEST_ACCESS_TOKEN;
  if (typeof version !== "string" || !VERSION.test(version) ||
      typeof wabaId !== "string" || !ID.test(wabaId) ||
      typeof phoneNumberId !== "string" || !ID.test(phoneNumberId) ||
      phoneNumberId === wabaId ||
      typeof accessToken !== "string" || !TOKEN.test(accessToken)) {
    return false;
  }
  return { version, wabaId, phoneNumberId, accessToken };
}

function result(status) {
  return {
    scope: "meta_read_only_phone_association",
    status,
    testedLiveMessageDelivery: false,
    testedWebhookDelivery: false,
    verifiedAsTestAccountByMeta: false,
    noMessageSendsPerformed: NO_LIVE_MESSAGES,
  };
}

/**
 * The owner must independently confirm that the configured WABA and phone
 * belong to Meta's TEST WABA before use. This GET cannot establish that.
 *
 * The injected fetch makes this testable without network or secrets.
 * Any Graph error is deliberately suppressed (may contain sensitive data).
 */
export async function checkMetaTestWabaReadiness({
  env = process.env,
  graphFetch = globalThis.fetch,
} = {}) {
  const config = configuration(env);
  if (config === null) return result("disabled");
  if (config === false) return result("invalid_configuration");
  const url = new URL("https://graph.facebook.com/" +
    config.version + "/" + config.wabaId + "/phone_numbers");
  url.searchParams.set("fields", "id");
  url.searchParams.set("limit", "100");

  try {
    const response = await graphFetch(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + config.accessToken,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return result("lookup_failed");
    const json = await response.json();
    if (!json || !Array.isArray(json.data) ||
        json.data.some(row => !row || typeof row.id !== "string" || !ID.test(row.id))) {
      return result("unexpected_response");
    }
    if (json.data.some(row => row.id === config.phoneNumberId)) {
      // A matching ID shows that the token can list this phone under this WABA.
      // It does not prove that this is a Meta TEST WABA or Coexistence eligible.
      return result("phone_association_found");
    }
    return result(json.paging?.next ? "incomplete_page" : "phone_not_listed");
  } catch {
    return result("lookup_failed");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outcome = await checkMetaTestWabaReadiness();
  process.stdout.write(JSON.stringify(outcome) + "\n");
  process.exitCode = outcome.status === "phone_association_found" ? 0 : 1;
}
