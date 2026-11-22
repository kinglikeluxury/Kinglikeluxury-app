import type { MetaGraphClient } from "../whatsappCoexistenceMetaGraph";

/**
 * All Meta operations are lazy and go through the approved client factory.
 * Explicitly forward the Coexistence status check. Omitting this method
 * blocks even correctly verified Business App + Cloud API registrations.
 */
export function createStagingCoexistenceMetaAdapter(
  createClient: () => MetaGraphClient,
): MetaGraphClient {
  return {
    exchangeCode: (code) => createClient().exchangeCode(code),
    inspectToken: (token) => createClient().inspectToken(token),
    listBusinessOwnedWabas: (businessId, token) =>
      createClient().listBusinessOwnedWabas(businessId, token),
    listWabaPhoneNumbers: (wabaId, token) =>
      createClient().listWabaPhoneNumbers(wabaId, token),
    listWabaPhoneNumberDetails: (wabaId, token) =>
      createClient().listWabaPhoneNumberDetails(wabaId, token),
    async getCoexistencePhoneStatus(phoneNumberId, token) {
      const client = createClient();
      if (typeof client.getCoexistencePhoneStatus !== "function") {
        throw new Error("staging_meta_coexistence_check_unavailable");
      }
      return client.getCoexistencePhoneStatus(phoneNumberId, token);
    },
    async subscribeAppToWaba(wabaId, token) {
      const client = createClient();
      if (typeof client.subscribeAppToWaba !== "function") {
        throw new Error("staging_meta_subscription_unavailable");
      }
      return client.subscribeAppToWaba(wabaId, token);
    },
  };
}
