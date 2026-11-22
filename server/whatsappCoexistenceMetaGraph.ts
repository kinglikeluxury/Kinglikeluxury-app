const GRAPH_VERSION = "v27.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type MetaSignupTokenInspection = {
  appId: string;
  valid: boolean;
  expiresAt: number;
  scopes: string[];
};

export type MetaGraphClient = {
  exchangeCode(code: string): Promise<string>;
  inspectToken(token: string): Promise<MetaSignupTokenInspection>;
  listBusinessOwnedWabas(businessId: string, token: string): Promise<string[]>;
  listWabaPhoneNumbers(wabaId: string, token: string): Promise<string[]>;
  listWabaPhoneNumberDetails(wabaId: string, token: string): Promise<Array<{ id: string; displayPhoneNumber: string }>>;
  subscribeAppToWaba?(wabaId: string, token: string): Promise<void>;
};

type FetchLike = typeof fetch;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numericId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,40}$/.test(value);
}

function requiredCredential(value: string | undefined): string {
  if (!value || value.length > 4096) throw new Error("Meta signup configuration unavailable.");
  return value;
}

export function createWhatsappCoexistenceMetaGraphClient(dependencies: {
  appId: string;
  appSecret: string;
  fetchImpl?: FetchLike;
}): MetaGraphClient {
  const appId = requiredCredential(dependencies.appId);
  const appSecret = requiredCredential(dependencies.appSecret);
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  const getJson = async (url: URL, bearer?: string): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: bearer ? { authorization: `Bearer ${bearer}` } : undefined,
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new Error("Meta verification request failed.");
    }
    if (!response.ok) throw new Error("Meta verification request failed.");
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new Error("Meta verification response was invalid.");
    }
    const result = object(parsed);
    if (result.error) throw new Error("Meta verification request was rejected.");
    return result;
  };
  const postJson = async (url: URL, bearer: string): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}` },
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new Error("Meta verification request failed.");
    }
    if (!response.ok) throw new Error("Meta verification request failed.");
    let parsed: unknown;
    try { parsed = await response.json(); }
    catch { throw new Error("Meta verification response was invalid."); }
    const result = object(parsed);
    if (result.error) throw new Error("Meta verification request was rejected.");
    return result;
  };

  return {
    async exchangeCode(code) {
      const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
      url.searchParams.set("client_id", appId);
      url.searchParams.set("client_secret", appSecret);
      url.searchParams.set("code", code);
      const result = await getJson(url);
      if (
        typeof result.access_token !== "string" ||
        result.access_token.length < 16 ||
        result.access_token.length > 8192 ||
        String(result.token_type ?? "").toLowerCase() !== "bearer"
      ) throw new Error("Meta token exchange response was invalid.");
      return result.access_token;
    },
    async inspectToken(token) {
      const url = new URL(`${GRAPH_BASE}/debug_token`);
      // Meta documents GET for debug_token. The URL is never logged or returned;
      // redirects are rejected and caching is disabled to limit credential exposure.
      url.searchParams.set("input_token", token);
      url.searchParams.set("access_token", `${appId}|${appSecret}`);
      const result = object((await getJson(url)).data);
      const scopes = Array.isArray(result.scopes)
        ? result.scopes.filter((scope): scope is string => typeof scope === "string")
        : [];
      return {
        appId: typeof result.app_id === "string" ? result.app_id : "",
        valid: result.is_valid === true,
        expiresAt: typeof result.expires_at === "number" ? result.expires_at : -1,
        scopes,
      };
    },
    async listBusinessOwnedWabas(businessId, token) {
      if (!numericId(businessId)) throw new Error("Meta business identity is invalid.");
      const url = new URL(`${GRAPH_BASE}/${businessId}/owned_whatsapp_business_accounts`);
      url.searchParams.set("fields", "id");
      url.searchParams.set("limit", "100");
      const result = await getJson(url, token);
      const data = Array.isArray(result.data) ? result.data : [];
      return data.map((row) => object(row).id).filter(numericId);
    },
    async listWabaPhoneNumbers(wabaId, token) {
      if (!numericId(wabaId)) throw new Error("Meta WhatsApp identity is invalid.");
      const url = new URL(`${GRAPH_BASE}/${wabaId}/phone_numbers`);
      url.searchParams.set("fields", "id");
      url.searchParams.set("limit", "100");
      const result = await getJson(url, token);
      const data = Array.isArray(result.data) ? result.data : [];
      return data.map((row) => object(row).id).filter(numericId);
    },
    async listWabaPhoneNumberDetails(wabaId, token) {
      if (!numericId(wabaId)) throw new Error("Meta WhatsApp identity is invalid.");
      const url = new URL(`${GRAPH_BASE}/${wabaId}/phone_numbers`);
      url.searchParams.set("fields", "id,display_phone_number");
      url.searchParams.set("limit", "100");
      const result = await getJson(url, token);
      const data = Array.isArray(result.data) ? result.data : [];
      return data.map((value) => {
        const row = object(value);
        return numericId(row.id) && typeof row.display_phone_number === "string"
          ? { id: row.id, displayPhoneNumber: row.display_phone_number }
          : null;
      }).filter((row): row is { id: string; displayPhoneNumber: string } => row !== null);
    },
    async subscribeAppToWaba(wabaId, token) {
      if (!numericId(wabaId)) throw new Error("Meta WhatsApp identity is invalid.");
      const url = new URL(`${GRAPH_BASE}/${wabaId}/subscribed_apps`);
      const result = await postJson(url, token);
      if (result.success !== true) throw new Error("Meta webhook subscription was not confirmed.");
    },
  };
}
