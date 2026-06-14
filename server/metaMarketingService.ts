/**
 * metaMarketingService.ts
 *
 * READ-ONLY Meta Marketing API service.
 *
 * Capabilities:  GET campaigns / adsets / ads / insights
 * Forbidden:     Any POST, PUT, DELETE to Meta Graph API
 * Credentials:   process.env.META_ACCESS_TOKEN  (existing)
 *                process.env.META_AD_ACCOUNT_ID  (new — format: act_XXXXXXXXX or just XXXXXXXXX)
 *
 * Railway/Replit compatible — uses only process.env and Node https built-in.
 * No Replit-specific storage or APIs used.
 */

import https from "https";

const META_GRAPH_VERSION = "v21.0";
const META_GRAPH_BASE    = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Normalise ad account ID — ensures the act_ prefix is present */
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

/** Build a full Graph URL with token appended — token never logged */
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
    tokenPresent:    !!process.env.META_ACCESS_TOKEN,
    adAccountPresent: !!process.env.META_AD_ACCOUNT_ID,
    adAccountId:     resolveAdAccountId(),        // safe — no token here
  };
}

// ── Read functions ─────────────────────────────────────────────────────────────

export interface MetaReadResult<T = any> {
  ok:      boolean;
  data:    T[];
  error:   string | null;
  httpStatus: number;
}

/** GET campaigns for the configured ad account */
export async function getCampaigns(limit = 25): Promise<MetaReadResult> {
  const acct = resolveAdAccountId();
  if (!acct) return { ok: false, data: [], error: "META_AD_ACCOUNT_ID not configured", httpStatus: 0 };
  if (!process.env.META_ACCESS_TOKEN) return { ok: false, data: [], error: "META_ACCESS_TOKEN not configured", httpStatus: 0 };

  const fields = "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time";
  const url = buildUrl(`/${acct}/campaigns`, { fields, limit: String(limit), effective_status: '["ACTIVE","PAUSED","ARCHIVED"]' });

  const { status, data } = await graphGet(url);
  if (data?.error) {
    console.warn(`[MetaMarketing] getCampaigns error — code=${data.error.code} type=${data.error.type}`);
    return { ok: false, data: [], error: data.error.message, httpStatus: status };
  }
  return { ok: true, data: Array.isArray(data?.data) ? data.data : [], error: null, httpStatus: status };
}

/** GET ad sets for the configured ad account */
export async function getAdSets(limit = 25): Promise<MetaReadResult> {
  const acct = resolveAdAccountId();
  if (!acct) return { ok: false, data: [], error: "META_AD_ACCOUNT_ID not configured", httpStatus: 0 };
  if (!process.env.META_ACCESS_TOKEN) return { ok: false, data: [], error: "META_ACCESS_TOKEN not configured", httpStatus: 0 };

  const fields = "id,name,status,campaign_id,daily_budget,lifetime_budget,targeting,billing_event,bid_amount,created_time";
  const url = buildUrl(`/${acct}/adsets`, { fields, limit: String(limit) });

  const { status, data } = await graphGet(url);
  if (data?.error) {
    console.warn(`[MetaMarketing] getAdSets error — code=${data.error.code} type=${data.error.type}`);
    return { ok: false, data: [], error: data.error.message, httpStatus: status };
  }
  return { ok: true, data: Array.isArray(data?.data) ? data.data : [], error: null, httpStatus: status };
}

/** GET ads for the configured ad account */
export async function getAds(limit = 25): Promise<MetaReadResult> {
  const acct = resolveAdAccountId();
  if (!acct) return { ok: false, data: [], error: "META_AD_ACCOUNT_ID not configured", httpStatus: 0 };
  if (!process.env.META_ACCESS_TOKEN) return { ok: false, data: [], error: "META_ACCESS_TOKEN not configured", httpStatus: 0 };

  const fields = "id,name,status,adset_id,campaign_id,created_time,effective_status";
  const url = buildUrl(`/${acct}/ads`, { fields, limit: String(limit) });

  const { status, data } = await graphGet(url);
  if (data?.error) {
    console.warn(`[MetaMarketing] getAds error — code=${data.error.code} type=${data.error.type}`);
    return { ok: false, data: [], error: data.error.message, httpStatus: status };
  }
  return { ok: true, data: Array.isArray(data?.data) ? data.data : [], error: null, httpStatus: status };
}

export interface InsightsParams {
  datePreset?: string;  // e.g. "last_30d", "last_7d", "last_14d"
  level?:      string;  // "account" | "campaign" | "adset" | "ad"
  limit?:      number;
}

/** GET insights for the configured ad account — read-only performance data */
export async function getInsights(params: InsightsParams = {}): Promise<MetaReadResult> {
  const acct = resolveAdAccountId();
  if (!acct) return { ok: false, data: [], error: "META_AD_ACCOUNT_ID not configured", httpStatus: 0 };
  if (!process.env.META_ACCESS_TOKEN) return { ok: false, data: [], error: "META_ACCESS_TOKEN not configured", httpStatus: 0 };

  const fields = [
    "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
    "impressions", "reach", "clicks", "spend", "cpc", "cpm", "ctr",
    "actions", "cost_per_action_type", "date_start", "date_stop",
  ].join(",");

  const url = buildUrl(`/${acct}/insights`, {
    fields,
    date_preset:  params.datePreset ?? "last_30d",
    level:        params.level      ?? "campaign",
    limit:        String(params.limit ?? 25),
  });

  const { status, data } = await graphGet(url);
  if (data?.error) {
    console.warn(`[MetaMarketing] getInsights error — code=${data.error.code} type=${data.error.type}`);
    return { ok: false, data: [], error: data.error.message, httpStatus: status };
  }
  return { ok: true, data: Array.isArray(data?.data) ? data.data : [], error: null, httpStatus: status };
}

// ── Diagnostic: verifies all four reads without exposing credentials ──────────

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

  // Run all four reads in parallel — fastest possible diagnostic
  const [campaigns, insights, adsets, ads] = await Promise.all([
    getCampaigns(10),
    getInsights({ datePreset: "last_7d", level: "campaign", limit: 10 }),
    getAdSets(10),
    getAds(10),
  ]);

  const success =
    campaigns.ok && insights.ok && adsets.ok && ads.ok;

  console.log(
    `[MetaMarketing] read-test — campaigns=${campaigns.ok} insights=${insights.ok} ` +
    `adsets=${adsets.ok} ads=${ads.ok}`
  );

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
