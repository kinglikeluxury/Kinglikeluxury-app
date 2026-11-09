import type { MetaOnboardingProof, MetaOnboardingVerifier } from "./whatsappMetaOnboardingProof";
import { assertExternalGatewayAllowed } from "./stagingExternalGuard";

type GraphFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type MetaGraphVerifierConfig = {
  appId: string;
  appSecret: string;
  graphApiVersion: string;
};

function validConfig(config: MetaGraphVerifierConfig): boolean {
  return /^\d{5,30}$/.test(config.appId) && config.appSecret.length >= 16 &&
    /^v\d{1,3}\.\d{1,2}$/.test(config.graphApiVersion);
}

function rows(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || !Array.isArray((value as any).data)) {
    throw new Error("Meta verification unavailable");
  }
  return (value as any).data.filter((item: unknown) => item && typeof item === "object");
}

export function createMetaGraphOnboardingVerifier(
  config: MetaGraphVerifierConfig,
  graphFetch: GraphFetch = fetch,
  assertGraphAllowed: () => void = () => assertExternalGatewayAllowed("meta"),
): MetaOnboardingVerifier {
  if (!validConfig(config)) throw new Error("Meta Graph verifier configuration is invalid");
  const base = `https://graph.facebook.com/${config.graphApiVersion}`;
  const get = async (path: string, token: string, params: Record<string, string> = {}) => {
    const url = new URL(`${base}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await graphFetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Meta verification unavailable");
    return response.json() as Promise<Record<string, any>>;
  };

  return {
    async exchangeAndVerify(input): Promise<MetaOnboardingProof> {
      // Dedicated staging proof verification can supply a narrower, explicit
      // release-time guard. All other callers retain the global egress block.
      assertGraphAllowed();
      if (!/^\d{5,80}$/.test(input.businessPortfolioId) ||
          !/^\d{5,80}$/.test(input.wabaId) ||
          (input.phoneNumberId !== undefined && !/^\d{5,80}$/.test(input.phoneNumberId)) ||
          !/^\+[1-9]\d{7,14}$/.test(input.displayPhoneNumber)) {
        throw new Error("Meta verification unavailable");
      }
      const exchangeUrl = new URL(`${base}/oauth/access_token`);
      exchangeUrl.searchParams.set("client_id", config.appId);
      exchangeUrl.searchParams.set("client_secret", config.appSecret);
      exchangeUrl.searchParams.set("code", input.code);
      const exchangeResponse = await graphFetch(exchangeUrl, {
        method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000),
      });
      if (!exchangeResponse.ok) throw new Error("Meta verification unavailable");
      const exchanged = await exchangeResponse.json() as Record<string, unknown>;
      const businessToken = exchanged.access_token;
      if (typeof businessToken !== "string" || businessToken.length < 20 || businessToken.length > 8192) {
        throw new Error("Meta verification unavailable");
      }

      const appToken = `${config.appId}|${config.appSecret}`;
      const debug = await get("debug_token", appToken, { input_token: businessToken });
      const tokenData = debug.data;
      const scopes = tokenData?.scopes;
      if (tokenData?.is_valid !== true || tokenData?.app_id !== config.appId ||
          !Array.isArray(scopes) ||
          !["whatsapp_business_management", "whatsapp_business_messaging"]
            .every(scope => scopes.includes(scope))) throw new Error("Meta verification unavailable");

      // Coexistence FINISH can omit phone_number_id. Discover it from the
      // server-authorized WABA, and require EXACTLY ONE approved phone match.
      const [sharedAccounts, numbers] = await Promise.all([
        get(`${input.businessPortfolioId}/client_whatsapp_business_accounts`, businessToken, { fields: "id" }),
        get(`${input.wabaId}/phone_numbers`, businessToken, { fields: "id,display_phone_number" }),
      ]);
      const portfolioOwnsWaba = rows(sharedAccounts).some(row => row.id === input.wabaId);
      const sameNumber = (value: unknown): boolean =>
        typeof value === "string" &&
        value.replace(/\D/g, "") === input.displayPhoneNumber.replace(/\D/g, "");
      const matchingNumbers = rows(numbers).filter(row =>
        typeof row.id === "string" && /^\d{5,80}$/.test(row.id) &&
        sameNumber(row.display_phone_number) &&
        (input.phoneNumberId === undefined || row.id === input.phoneNumberId));
      if (!portfolioOwnsWaba || matchingNumbers.length !== 1) {
        throw new Error("Meta verification unavailable");
      }
      const verifiedPhoneId = matchingNumbers[0].id as string;
      const phone = await get(verifiedPhoneId, businessToken, {
        fields: "id,display_phone_number,is_on_biz_app,platform_type",
      });
      if (phone.id !== verifiedPhoneId || !sameNumber(phone.display_phone_number) ||
          phone.is_on_biz_app !== true || phone.platform_type !== "CLOUD_API") {
        throw new Error("Meta verification unavailable");
      }
      return {
        businessPortfolioId: input.businessPortfolioId,
        wabaId: input.wabaId,
        phoneNumberId: verifiedPhoneId,
        displayPhoneNumber: input.displayPhoneNumber,
        coexistence: "verified",
        grantedPermissions: scopes,
        ownershipVerified: true,
      };
    },
  };
}
