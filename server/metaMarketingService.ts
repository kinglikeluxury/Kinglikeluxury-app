/**
 * metaMarketingService.ts
 *
 * READ-ONLY Meta Marketing API service — Phase 2 expanded.
 *
 * Capabilities:  GET campaigns / adsets / ads / creatives / insights / breakdowns
 * Forbidden:     Any POST, PUT, DELETE to Meta Graph API
 * Credentials:   process.env.META_ACCESS_TOKEN
 *                process.env.META_AD_ACCOUNT_ID  (format: act_XXXXXXXXX)
 */

import https from "https";

const META_GRAPH_VERSION = "v21.0";
const META_GRAPH_BASE    = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// ── Helpers ────────────────────────────────────────────────────────────────────

function resolveAdAccountId(): string | null {
  const raw = process.env.META_AD_ACCOUNT_ID;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

/** GET-only Graph API helper — never issues POST/PUT/DELETE */
function graphGet(url: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    https.get(url, (r) => {
      let raw = "";
      r.on("data", (c) => (raw += c));
      r.on("end", () => {
        try { resolve({ status: r.statusCode ?? 0, data: JSON.parse(raw) }); }
        catch { resolve({ status: r.statusCode ?? 0, data: { error: { message: raw.slice(0, 300) } } }); }
      });
    }).on("error", (e) => resolve({ status: 0, data: { error: { message: e.message } } }));
  });
}

function buildUrl(path: string, params: Record<string, string> = {}): string {
  const token = process.env.META_ACCESS_TOKEN ?? "";
  const qs = new URLSearchParams({ access_token: token, ...params }).toString();
  return `${META_GRAPH_BASE}${path}?${qs}`;
}

// ── Public config helpers ─────────────────────────────────────────────────────

export function getMetaMarketingConfig(): {
  tokenPresent: boolean;
  adAccountPresent: boolean;
  adAccountId: string | null;
} {
  return {
    tokenPresent:     !!process.env.META_ACCESS_TOKEN,
    adAccountPresent: !!process.env.META_AD_ACCOUNT_ID,
    adAccountId:      resolveAdAccountId(),
  };
}

// ── Shared result type ─────────────────────────────────────────────────────────

export interface MetaReadResult<T = any> {
  ok:         boolean;
  data:       T[];
  error:      string | null;
  httpStatus: number;
}

// ── Targeting parser ──────────────────────────────────────────────────────────

export interface ParsedTargeting {
  age_min:             number | null;
  age_max:             number | null;
  genders:             string;       // JSON array: e.g. "[1,2]" (1=male,2=female)
  countries:           string;       // JSON array of ISO codes
  regions:             string;       // JSON array
  cities:              string;       // JSON array
  languages:           string;       // JSON array of locale codes
  interests:           string;       // JSON array of {id, name}
  excluded_interests:  string;       // JSON array
  publisher_platforms: string;       // JSON array: facebook, instagram, audience_network
  facebook_positions:  string;       // JSON array
  instagram_positions: string;       // JSON array
  device_platforms:    string;       // JSON array
}

export function parseAdSetTargeting(targeting: any): ParsedTargeting {
  if (!targeting || typeof targeting !== "object") {
    return {
      age_min: null, age_max: null,
      genders: "[]", countries: "[]", regions: "[]", cities: "[]",
      languages: "[]", interests: "[]", excluded_interests: "[]",
      publisher_platforms: "[]", facebook_positions: "[]",
      instagram_positions: "[]", device_platforms: "[]",
    };
  }

  const geo = targeting.geo_locations ?? {};

  const interests: any[] = [];
  const excluded: any[] = [];
  for (const spec of targeting.flexible_spec ?? []) {
    for (const i of spec.interests ?? []) interests.push({ id: i.id, name: i.name });
  }
  for (const i of (targeting.exclusions?.interests ?? [])) {
    excluded.push({ id: i.id, name: i.name });
  }

  return {
    age_min:             targeting.age_min ?? null,
    age_max:             targeting.age_max ?? null,
    genders:             JSON.stringify(targeting.genders ?? []),
    countries:           JSON.stringify(geo.countries ?? []),
    regions:             JSON.stringify((geo.regions ?? []).map((r: any) => r.name ?? r.key ?? r)),
    cities:              JSON.stringify((geo.cities   ?? []).map((c: any) => c.name ?? c.key ?? c)),
    languages:           JSON.stringify(targeting.locales ?? []),
    interests:           JSON.stringify(interests),
    excluded_interests:  JSON.stringify(excluded),
    publisher_platforms: JSON.stringify(targeting.publisher_platforms ?? []),
    facebook_positions:  JSON.stringify(targeting.facebook_positions  ?? []),
    instagram_positions: JSON.stringify(targeting.instagram_positions ?? []),
    device_platforms:    JSON.stringify(targeting.device_platforms    ?? []),
  };
}

// ── Lead action parsers ───────────────────────────────────────────────────────

export function parseLeadCount(actions: any[]): number {
  if (!Array.isArray(actions)) return 0;
  const row = actions.find((a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
  return row ? parseInt(row.value ?? "0", 10) : 0;
}

export function parseLeadCPL(costPerActionType: any[]): number | null {
  if (!Array.isArray(costPerActionType)) return null;
  const row = costPerActionType.find((a: any) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
  if (!row) return null;
  const v = parseFloat(row.value ?? "0");
  return isNaN(v) ? null : v;
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export async function getCampaigns(limit = 50): Promise<MetaReadResult> {
  const acct = resolveAdAccountId();
  if (!acct) return { ok: false, data: [], error: "META_AD_ACCOUNT_ID not configured", httpStatus: 0 };
  if (!process.env.META_ACCESS_TOKEN) return { ok: false, data: [], error: "META_ACCESS_TOKEN not configured", httpStatus: 0 };

  const fields = [
    "id", "name", "status", "objective",
    "daily_budget", "lifetime_budget",
    "start_time", "stop_time", "created_time", "updated_time",
  ].join(",");

  const url = buildUrl(`/${acct}/campaigns`, {
    fields,
    limit: String(limit),
    effective_status: '["ACTIVE","PAUSED","ARCHIVED"]',
  });

  const { status, data } = await graphGet(url);
  if (data?.error) {
    console.warn(`[MetaMarketing] getCampaigns error — code=${data.error.code}`);
    return { ok: false, data: [], error: data.error.message, httpStatus: status };
  }
  return { ok: true, data: Array.isArray(data?.data) ? data.data : [], error: null, httpStatus: status };
}

// ── Ad Sets ───────────────────────────────────────────────────────────────────

export async function getAdSets(limit = 50): Promise<MetaReadResult> {
  const acct = resolveAdAccountId();
  if (!acct) return { ok: false, data: [], error: "META_AD_ACCOUNT_ID not configured", httpStatus: 0 };
  if (!process.env.META_ACCESS_TOKEN) return { ok: false, data: [], error: "META_ACCESS_TOKEN not configured", httpStatus: 0 };

  const fields = [
    "id", "name", "status", "campaign_id",
    "daily_budget", "lifetime_budget",
    "billing_event", "bid_amount", "optimization_goal",
    "targeting",
    "created_time", "updated_time",
  ].join(",");

  const url = buildUrl(`/${acct}/adsets`, { fields, limit: String(limit) });
  const { status, data } = await graphGet(url);
  if (data?.error) {
    console.warn(`[MetaMarketing] getAdSets error — code=${data.error.code}`);
    return { ok: false, data: [], error: data.error.message, httpStatus: status };
  }
  return { ok: true, data: Array.isArray(data?.data) ? data.data : [], error: null, httpStatus: status };
}

// ── Ads (with full creative inline) ──────────────────────────────────────────

export async function getAds(limit = 50): Promise<MetaReadResult> {
  const acct = resolveAdAccountId();
  if (!acct) return { ok: false, data: [], error: "META_AD_ACCOUNT_ID not configured", httpStatus: 0 };
  if (!process.env.META_ACCESS_TOKEN) return { ok: false, data: [], error: "META_ACCESS_TOKEN not configured", httpStatus: 0 };

  const fields = [
    "id", "name", "status", "effective_status",
    "adset_id", "campaign_id",
    "created_time", "updated_time",
    "creative{id,name,body,title,image_url,image_hash,video_id,link_url,call_to_action,thumbnail_url}",
  ].join(",");

  const url = buildUrl(`/${acct}/ads`, { fields, limit: String(limit) });
  const { status, data } = await graphGet(url);
  if (data?.error) {
    console.warn(`[MetaMarketing] getAds error — code=${data.error.code}`);
    return { ok: false, data: [], error: data.error.message, httpStatus: status };
  }
  return { ok: true, data: Array.isArray(data?.data) ? data.data : [], error: null, httpStatus: status };
}

// ── Insights ──────────────────────────────────────────────────────────────────

export interface InsightsParams {
  datePreset?: string;
  level?:      string;
  limit?:      number;
}

export async function getInsights(params: InsightsParams = {}): Promise<MetaReadResult> {
  const acct = resolveAdAccountId();
  if (!acct) return { ok: false, data: [], error: "META_AD_ACCOUNT_ID not configured", httpStatus: 0 };
  if (!process.env.META_ACCESS_TOKEN) return { ok: false, data: [], error: "META_ACCESS_TOKEN not configured", httpStatus: 0 };

  const fields = [
    "campaign_id", "campaign_name",
    "adset_id", "adset_name",
    "ad_id", "ad_name",
    "impressions", "reach", "clicks",
    "spend", "cpc", "cpm", "ctr",
    "actions", "cost_per_action_type",
    "date_start", "date_stop",
  ].join(",");

  const url = buildUrl(`/${acct}/insights`, {
    fields,
    date_preset: params.datePreset ?? "last_30d",
    level:       params.level      ?? "campaign",
    limit:       String(params.limit ?? 50),
  });

  const { status, data } = await graphGet(url);
  if (data?.error) {
    console.warn(`[MetaMarketing] getInsights error — code=${data.error.code}`);
    return { ok: false, data: [], error: data.error.message, httpStatus: status };
  }
  return { ok: true, data: Array.isArray(data?.data) ? data.data : [], error: null, httpStatus: status };
}

// ── Insights with demographic / placement breakdowns ──────────────────────────

export type BreakdownType = "age" | "gender" | "country" | "device_platform";

export async function getInsightsBreakdowns(
  breakdown: BreakdownType,
  datePreset = "last_30d",
  level: "campaign" | "adset" | "ad" = "campaign",
  limit = 100,
): Promise<MetaReadResult> {
  const acct = resolveAdAccountId();
  if (!acct) return { ok: false, data: [], error: "META_AD_ACCOUNT_ID not configured", httpStatus: 0 };
  if (!process.env.META_ACCESS_TOKEN) return { ok: false, data: [], error: "META_ACCESS_TOKEN not configured", httpStatus: 0 };

  const fields = [
    "campaign_id", "campaign_name",
    "adset_id", "adset_name",
    "ad_id", "ad_name",
    "impressions", "reach", "clicks",
    "spend", "actions", "cost_per_action_type",
    "date_start", "date_stop",
  ].join(",");

  const url = buildUrl(`/${acct}/insights`, {
    fields,
    breakdowns:  breakdown,
    date_preset: datePreset,
    level,
    limit:       String(limit),
  });

  const { status, data } = await graphGet(url);
  if (data?.error) {
    console.warn(`[MetaMarketing] getInsightsBreakdowns(${breakdown}) error — code=${data.error.code}`);
    return { ok: false, data: [], error: data.error.message, httpStatus: status };
  }
  return { ok: true, data: Array.isArray(data?.data) ? data.data : [], error: null, httpStatus: status };
}

// ── Ads with creatives (legacy helper — kept for existing UI) ─────────────────

export async function getAdsWithCreatives(limit = 50): Promise<MetaReadResult> {
  return getAds(limit);
}

// ── Diagnostic ────────────────────────────────────────────────────────────────

export interface MetaReadTestResult {
  success:           boolean;
  tokenPresent:      boolean;
  adAccountPresent:  boolean;
  adAccountId:       string | null;
  campaignsReadable: boolean;
  insightsReadable:  boolean;
  adsetsReadable:    boolean;
  adsReadable:       boolean;
  errors: {
    campaigns: string | null;
    insights:  string | null;
    adsets:    string | null;
    ads:       string | null;
  };
  counts: {
    campaigns: number;
    insights:  number;
    adsets:    number;
    ads:       number;
  };
}

export async function runMetaReadTest(): Promise<MetaReadTestResult> {
  const cfg = getMetaMarketingConfig();

  if (!cfg.tokenPresent || !cfg.adAccountPresent) {
    return {
      success: false,
      ...cfg,
      campaignsReadable: false,
      insightsReadable:  false,
      adsetsReadable:    false,
      adsReadable:       false,
      errors: {
        campaigns: !cfg.tokenPresent ? "META_ACCESS_TOKEN not configured" : "META_AD_ACCOUNT_ID not configured",
        insights:  !cfg.tokenPresent ? "META_ACCESS_TOKEN not configured" : "META_AD_ACCOUNT_ID not configured",
        adsets:    !cfg.tokenPresent ? "META_ACCESS_TOKEN not configured" : "META_AD_ACCOUNT_ID not configured",
        ads:       !cfg.tokenPresent ? "META_ACCESS_TOKEN not configured" : "META_AD_ACCOUNT_ID not configured",
      },
      counts: { campaigns: 0, insights: 0, adsets: 0, ads: 0 },
    };
  }

  const [campaigns, insights, adsets, ads] = await Promise.all([
    getCampaigns(10),
    getInsights({ datePreset: "last_7d", level: "campaign", limit: 10 }),
    getAdSets(10),
    getAds(10),
  ]);

  const success = campaigns.ok && insights.ok && adsets.ok && ads.ok;
  console.log(`[MetaMarketing] read-test — campaigns=${campaigns.ok} insights=${insights.ok} adsets=${adsets.ok} ads=${ads.ok}`);

  return {
    success,
    tokenPresent:      cfg.tokenPresent,
    adAccountPresent:  cfg.adAccountPresent,
    adAccountId:       cfg.adAccountId,
    campaignsReadable: campaigns.ok,
    insightsReadable:  insights.ok,
    adsetsReadable:    adsets.ok,
    adsReadable:       ads.ok,
    errors: {
      campaigns: campaigns.error,
      insights:  insights.error,
      adsets:    adsets.error,
      ads:       ads.error,
    },
    counts: {
      campaigns: campaigns.data.length,
      insights:  insights.data.length,
      adsets:    adsets.data.length,
      ads:       ads.data.length,
    },
  };
}
