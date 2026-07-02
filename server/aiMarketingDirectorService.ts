// ── Phase 4: AI Marketing Director — READ-ONLY ANALYSIS ENGINE ─────────────
//
// Safety contract (do not violate):
//   - Meta API access in this file is READ-ONLY: a single GET call to fetch the
//     ad account's `currency` field. No campaign/adset/ad/insight data is ever
//     fetched here directly — that remains the job of the existing Phase 2/3
//     sync (metaIntelligenceSyncService.ts), which this file never modifies.
//   - No POST/PUT/DELETE is ever issued against the Meta Graph API.
//   - SELECT-only against: meta_intelligence_campaigns/adsets/ads/insights/breakdowns,
//     crm_leads, ai_campaign_attribution, ai_marketing_sales_outcomes.
//   - The ONLY tables this file ever INSERTs/CREATEs/ALTERs are the two tables
//     it owns: ai_director_snapshots and ai_director_recommendations.
//   - Never touches WhatsApp, Email, Task Reminders, Lead Assignment, Auth,
//     Permissions, or any existing AI Marketing table/route.

import { pool } from "./db";

// ── Table bootstrap (new tables only, additive columns only) ───────────────

export async function ensureAiMarketingDirectorTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_director_snapshots (
        id                    SERIAL PRIMARY KEY,
        health_score          NUMERIC,
        kpis_json             JSONB,
        executive_report      TEXT,
        audience_json         JSONB,
        creative_json         JSONB,
        project_json          JSONB,
        budget_json           JSONB,
        funnel_json           JSONB,
        predictions_json      JSONB,
        sales_json            JSONB,
        base_currency         TEXT,
        exchange_rates_json   JSONB,
        rates_stale           BOOLEAN,
        rates_fetched_at      TIMESTAMPTZ,
        generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Additive columns for snapshots created before this refinement pass.
    await client.query(`ALTER TABLE ai_director_snapshots ADD COLUMN IF NOT EXISTS sales_json JSONB`);
    await client.query(`ALTER TABLE ai_director_snapshots ADD COLUMN IF NOT EXISTS base_currency TEXT`);
    await client.query(`ALTER TABLE ai_director_snapshots ADD COLUMN IF NOT EXISTS exchange_rates_json JSONB`);
    await client.query(`ALTER TABLE ai_director_snapshots ADD COLUMN IF NOT EXISTS rates_stale BOOLEAN`);
    await client.query(`ALTER TABLE ai_director_snapshots ADD COLUMN IF NOT EXISTS rates_fetched_at TIMESTAMPTZ`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_director_recommendations (
        id                              SERIAL PRIMARY KEY,
        snapshot_id                     INTEGER REFERENCES ai_director_snapshots(id) ON DELETE CASCADE,
        category                        TEXT,
        action                          TEXT,
        title                           TEXT,
        reason                          TEXT,
        supporting_metrics_json         JSONB,
        expected_impact                 TEXT,
        suggested_action                TEXT,
        estimated_financial_impact      NUMERIC,
        estimated_financial_impact_label TEXT,
        business_impact                 TEXT,
        confidence                      TEXT,
        priority                        TEXT,
        entity_type                     TEXT,
        entity_id                       TEXT,
        entity_name                     TEXT,
        created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE ai_director_recommendations ADD COLUMN IF NOT EXISTS suggested_action TEXT`);
    await client.query(`ALTER TABLE ai_director_recommendations ADD COLUMN IF NOT EXISTS estimated_financial_impact NUMERIC`);
    await client.query(`ALTER TABLE ai_director_recommendations ADD COLUMN IF NOT EXISTS estimated_financial_impact_label TEXT`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ai_director_recs_snapshot_idx
        ON ai_director_recommendations(snapshot_id)
    `);
    console.log("[DB] ensureAiMarketingDirectorTables ✓");
  } catch (err: any) {
    console.error("[DB] ensureAiMarketingDirectorTables error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

type Confidence = "Low" | "Medium" | "High" | "Very High";
type Priority = "Low" | "Medium" | "High";

interface Recommendation {
  category: string;
  action: string;
  title: string;
  reason: string;
  supportingMetrics: Record<string, any>;
  expectedImpact: string;
  suggestedAction: string;
  estimatedFinancialImpact: number | null;
  estimatedFinancialImpactLabel: string;
  businessImpact: string;
  confidence: Confidence;
  priority: Priority;
  entityType?: string;
  entityId?: string;
  entityName?: string;
}

interface CampaignAgg {
  metaCampaignId: string;
  name: string;
  status: string;
  dailyBudget: number;
  lifetimeBudget: number;
  spend: number;
  impressions: number;
  clicks: number;
  metaLeads: number;
  cpl: number;
  cpc: number;
  cpm: number;
  ctr: number;
  crmLeads: number;
  hotLeads: number;
  qualifiedLeads: number;
  appointments: number;
  siteVisits: number;
  purchases: number;
  revenue: number;
  profit: number;
  roi: number | null;
  costPerPurchase: number | null;
  revenuePerLead: number | null;
}

// ── Currency & FX (read-only, self-contained to this file) ─────────────────

export const SUPPORTED_DISPLAY_CURRENCIES = ["USD", "EUR", "GBP", "AED", "TRY"] as const;
const FALLBACK_USD_RATES: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, AED: 3.67, TRY: 39.5 };

let accountCurrencyCache: { value: string; ts: number } | null = null;
let usdRatesCache: { rates: Record<string, number>; ts: number; stale: boolean } | null = null;

// Single read-only GET against the Meta Graph API to discover the ad
// account's native reporting currency. No campaign/insight data is touched.
async function fetchMetaAccountCurrency(): Promise<string> {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  if (accountCurrencyCache && Date.now() - accountCurrencyCache.ts < SIX_HOURS) {
    return accountCurrencyCache.value;
  }
  try {
    const raw = process.env.META_AD_ACCOUNT_ID;
    const token = process.env.META_ACCESS_TOKEN;
    if (!raw || !token) return "USD";
    const acct = raw.startsWith("act_") ? raw : `act_${raw}`;
    const url = `https://graph.facebook.com/v19.0/${acct}?fields=currency&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const json: any = await res.json();
    if (json?.currency && typeof json.currency === "string") {
      accountCurrencyCache = { value: json.currency, ts: Date.now() };
      return json.currency;
    }
  } catch (err: any) {
    console.error("[AiMarketingDirector] fetchMetaAccountCurrency failed:", err.message);
  }
  return "USD";
}

// Fetches USD-based FX rates from a free, no-key public API, with a static
// fallback if the request fails (flagged as stale so the UI can warn).
async function fetchUsdRates(): Promise<{ rates: Record<string, number>; stale: boolean }> {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  if (usdRatesCache && Date.now() - usdRatesCache.ts < SIX_HOURS) {
    return { rates: usdRatesCache.rates, stale: usdRatesCache.stale };
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const json: any = await res.json();
    if (json?.result === "success" && json.rates) {
      usdRatesCache = { rates: json.rates, ts: Date.now(), stale: false };
      return { rates: json.rates, stale: false };
    }
  } catch (err: any) {
    console.error("[AiMarketingDirector] fetchUsdRates failed:", err.message);
  }
  usdRatesCache = { rates: FALLBACK_USD_RATES, ts: Date.now(), stale: true };
  return { rates: FALLBACK_USD_RATES, stale: true };
}

// Converts USD-based rates into "1 unit of `base` currency = X units of target"
// for each of the 5 supported display currencies.
function buildDisplayRates(usdRates: Record<string, number>, base: string): Record<string, number> {
  const baseUnitsPerUsd = usdRates[base] ?? 1; // e.g. 39.5 TRY per 1 USD
  const out: Record<string, number> = {};
  for (const c of SUPPORTED_DISPLAY_CURRENCIES) {
    const targetUnitsPerUsd = usdRates[c] ?? FALLBACK_USD_RATES[c] ?? 1;
    out[c] = targetUnitsPerUsd / baseUnitsPerUsd;
  }
  return out;
}

// Converts a monetary amount from `fromCurrency` into `baseCurrency`, using the
// same USD-anchored rate table. Used to normalize CRM sale amounts (which may
// be recorded in a different currency than the Meta ad account) into the
// report's base currency before summing revenue.
function convertToBase(amount: number, fromCurrency: string, usdRates: Record<string, number>, base: string): number {
  const from = (fromCurrency || "USD").toUpperCase();
  const fromUnitsPerUsd = usdRates[from] ?? FALLBACK_USD_RATES[from] ?? 1;
  const baseUnitsPerUsd = usdRates[base] ?? 1;
  const amountUsd = amount / fromUnitsPerUsd;
  return amountUsd * baseUnitsPerUsd;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function safeDiv(a: number, b: number): number | null {
  if (!b) return null;
  return a / b;
}
function round2(v: number | null): number | null {
  if (v === null) return null;
  return Math.round(v * 100) / 100;
}
function safeParseArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
// Embeds a raw base-currency amount as a `{{money:VALUE}}` token in generated
// text. The frontend replaces these tokens with the amount formatted in the
// user's selected display currency, so no server-side text is ever "hardcoded"
// to a specific currency.
function moneyToken(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "N/A";
  return `{{money:${v}}}`;
}

// ── Data gathering (SELECT-only) ────────────────────────────────────────────
//
// Lead → campaign attribution uses BOTH linkage paths present in the CRM:
//   1. crm_leads.meta_campaign_id (direct, populated for Meta Lead Ads forms)
//   2. ai_campaign_attribution.campaign_id (populated by the attribution engine
//      for leads not directly tagged) — used as a fallback only, never duplicated.
const LINKED_LEADS_CTE = `
  WITH linked_leads AS (
    SELECT id, meta_campaign_id AS campaign_id, ai_score_category
    FROM crm_leads
    WHERE meta_campaign_id IS NOT NULL AND meta_campaign_id <> ''
    UNION
    SELECT l.id, a.campaign_id, l.ai_score_category
    FROM crm_leads l
    JOIN ai_campaign_attribution a ON a.crm_lead_id = l.id
    WHERE (l.meta_campaign_id IS NULL OR l.meta_campaign_id = '')
      AND a.campaign_id IS NOT NULL AND a.campaign_id <> ''
  )
`;

async function loadCampaignAggregates(usdRates: Record<string, number>, baseCurrency: string): Promise<CampaignAgg[]> {
  const { rows: campaigns } = await pool.query(`
    SELECT meta_campaign_id, name, status, daily_budget, lifetime_budget
    FROM meta_intelligence_campaigns
  `);

  const { rows: insightRows } = await pool.query(`
    SELECT meta_campaign_id,
           COALESCE(SUM(spend), 0)       AS spend,
           COALESCE(SUM(impressions), 0) AS impressions,
           COALESCE(SUM(clicks), 0)      AS clicks,
           COALESCE(SUM(leads), 0)       AS meta_leads
    FROM meta_intelligence_insights
    WHERE entity_type = 'campaign'
    GROUP BY meta_campaign_id
  `);
  const insightsByCampaign = new Map<string, any>();
  for (const r of insightRows) insightsByCampaign.set(r.meta_campaign_id, r);

  const { rows: crmRows } = await pool.query(`
    ${LINKED_LEADS_CTE}
    SELECT campaign_id,
           COUNT(*) AS crm_leads,
           COUNT(*) FILTER (WHERE UPPER(ai_score_category) = 'HOT') AS hot_leads,
           COUNT(*) FILTER (WHERE UPPER(ai_score_category) IN ('HOT','WARM')) AS qualified_leads
    FROM linked_leads
    GROUP BY campaign_id
  `);
  const crmByCampaign = new Map<string, any>();
  for (const r of crmRows) crmByCampaign.set(r.campaign_id, r);

  const { rows: outcomeRows } = await pool.query(`
    ${LINKED_LEADS_CTE}
    SELECT ll.campaign_id,
           COUNT(*) FILTER (WHERE so.appointment_scheduled) AS appointments,
           COUNT(*) FILTER (WHERE so.site_visit_completed)  AS site_visits,
           COUNT(*) FILTER (WHERE so.sale_closed)           AS purchases,
           COALESCE(json_agg(so.sale_amount) FILTER (WHERE so.sale_closed), '[]') AS sale_amounts,
           COALESCE(json_agg(so.sale_currency) FILTER (WHERE so.sale_closed), '[]') AS sale_currencies
    FROM ai_marketing_sales_outcomes so
    JOIN linked_leads ll ON ll.id = so.lead_id
    GROUP BY ll.campaign_id
  `);
  const outcomesByCampaign = new Map<string, any>();
  for (const r of outcomeRows) outcomesByCampaign.set(r.campaign_id, r);

  return campaigns.map((c: any) => {
    const ins = insightsByCampaign.get(c.meta_campaign_id) || {};
    const crm = crmByCampaign.get(c.meta_campaign_id) || {};
    const out = outcomesByCampaign.get(c.meta_campaign_id) || {};
    const spend = num(ins.spend);
    const impressions = num(ins.impressions);
    const clicks = num(ins.clicks);
    const metaLeads = num(ins.meta_leads);
    const crmLeads = num(crm.crm_leads);
    const purchases = num(out.purchases);

    // Sale amounts may be recorded in a different currency than the ad
    // account — normalize every sale into the report's base currency.
    const amounts: number[] = safeParseArray(out.sale_amounts);
    const currencies: string[] = safeParseArray(out.sale_currencies);
    let revenue = 0;
    amounts.forEach((amt, i) => {
      if (amt == null) return;
      revenue += convertToBase(num(amt), currencies[i] || "USD", usdRates, baseCurrency);
    });

    return {
      metaCampaignId: c.meta_campaign_id,
      name: c.name || c.meta_campaign_id,
      status: c.status || "UNKNOWN",
      dailyBudget: num(c.daily_budget) / 100,
      lifetimeBudget: num(c.lifetime_budget) / 100,
      spend,
      impressions,
      clicks,
      metaLeads,
      cpl: safeDiv(spend, metaLeads) ?? 0,
      cpc: safeDiv(spend, clicks) ?? 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      ctr: safeDiv(clicks, impressions) ? safeDiv(clicks, impressions)! * 100 : 0,
      crmLeads,
      hotLeads: num(crm.hot_leads),
      qualifiedLeads: num(crm.qualified_leads),
      appointments: num(out.appointments),
      siteVisits: num(out.site_visits),
      purchases,
      revenue: round2(revenue) ?? 0,
      profit: round2(revenue - spend) ?? 0,
      roi: safeDiv(revenue - spend, spend),
      costPerPurchase: safeDiv(spend, purchases),
      revenuePerLead: safeDiv(revenue, crmLeads),
    };
  });
}

// ── Section 1: Executive Summary (KPIs) ─────────────────────────────────────

function buildExecutiveSummary(campaigns: CampaignAgg[], baseCurrency: string, displayRates: Record<string, number>, ratesStale: boolean) {
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalLeads = campaigns.reduce((s, c) => s + c.crmLeads, 0);
  const totalQualified = campaigns.reduce((s, c) => s + c.qualifiedLeads, 0);
  const totalHot = campaigns.reduce((s, c) => s + c.hotLeads, 0);
  const totalAppointments = campaigns.reduce((s, c) => s + c.appointments, 0);
  const totalSiteVisits = campaigns.reduce((s, c) => s + c.siteVisits, 0);
  const totalPurchases = campaigns.reduce((s, c) => s + c.purchases, 0);
  const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalMetaLeads = campaigns.reduce((s, c) => s + c.metaLeads, 0);

  const withRoi = campaigns.filter((c) => c.spend > 0);
  const best = withRoi.length
    ? withRoi.reduce((a, b) => ((b.roi ?? -Infinity) > (a.roi ?? -Infinity) ? b : a))
    : null;
  const worst = withRoi.length
    ? withRoi.reduce((a, b) => ((b.roi ?? Infinity) < (a.roi ?? Infinity) ? b : a))
    : null;

  const hasOutcomeData = totalAppointments + totalSiteVisits + totalPurchases + totalRevenue > 0;

  const qualifiedRate = safeDiv(totalQualified, totalLeads) ?? 0;
  const ctrScore = Math.min(totalImpressions ? (totalClicks / totalImpressions) * 100 : 0, 5) / 5;
  const roiScore = hasOutcomeData ? Math.max(0, Math.min(1, ((safeDiv(totalRevenue, totalSpend) ?? 0)) / 3)) : 0.5;
  const healthScore = Math.round((qualifiedRate * 0.4 + ctrScore * 0.3 + roiScore * 0.3) * 100);

  return {
    healthScore,
    baseCurrency,
    displayRates,
    ratesStale,
    totalSpend: round2(totalSpend),
    totalLeads,
    qualifiedLeads: totalQualified,
    hotLeads: totalHot,
    appointments: totalAppointments,
    siteVisits: totalSiteVisits,
    purchases: totalPurchases,
    revenue: round2(totalRevenue),
    estimatedRoi: hasOutcomeData ? round2(safeDiv(totalRevenue - totalSpend, totalSpend)) : null,
    avgCpl: round2(safeDiv(totalSpend, totalMetaLeads)),
    avgCpc: round2(safeDiv(totalSpend, totalClicks)),
    avgCpm: round2(totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0),
    avgCtr: round2(safeDiv(totalClicks, totalImpressions) ? safeDiv(totalClicks, totalImpressions)! * 100 : 0),
    costPerPurchase: hasOutcomeData ? round2(safeDiv(totalSpend, totalPurchases)) : null,
    revenuePerLead: hasOutcomeData ? round2(safeDiv(totalRevenue, totalLeads)) : null,
    bestCampaign: best ? { name: best.name, roi: round2(best.roi) } : null,
    worstCampaign: worst ? { name: worst.name, roi: round2(worst.roi) } : null,
    hasOutcomeData,
    dataWindow: { campaigns: campaigns.length },
  };
}

// ── Section 2: AI Executive Report (natural language, template-driven) ─────
// Monetary values are embedded as {{money:X}} tokens (X = base-currency
// number) so the frontend can render them in whichever display currency the
// admin has selected — the server never hardcodes a currency symbol.

function buildExecutiveReport(kpis: any, campaigns: CampaignAgg[], audience: any): string {
  const lines: string[] = [];

  const healthLabel =
    kpis.healthScore >= 80 ? "Excellent" :
    kpis.healthScore >= 60 ? "Good" :
    kpis.healthScore >= 40 ? "Fair" : "Needs Attention";

  lines.push(
    `Overall marketing health is ${healthLabel} (score ${kpis.healthScore}/100), based on ${kpis.totalLeads} leads captured across ${campaigns.length} tracked campaigns.`
  );

  if (kpis.bestCampaign && kpis.hasOutcomeData) {
    lines.push(
      `"${kpis.bestCampaign.name}" is the strongest performer with an estimated ROI of ${kpis.bestCampaign.roi != null ? (kpis.bestCampaign.roi * 100).toFixed(0) + "%" : "N/A"}.`
    );
  } else if (!kpis.hasOutcomeData) {
    lines.push(
      `Sales outcome data (appointments, site visits, purchases) has not yet been recorded in the CRM for Meta-attributed leads — ROI and revenue-based ranking will activate automatically once sales are logged against these leads.`
    );
  }

  if (kpis.worstCampaign && kpis.hasOutcomeData && kpis.worstCampaign.name !== kpis.bestCampaign?.name) {
    lines.push(
      `"${kpis.worstCampaign.name}" is underperforming relative to spend and is the best candidate for budget reduction or a creative refresh.`
    );
  }

  if (audience?.countries?.best) {
    lines.push(
      `${audience.countries.best.value} continues to generate the highest-quality audience, with a cost per lead of ${moneyToken(audience.countries.best.cpl)}.`
    );
  }
  if (audience?.countries?.worst && audience.countries.worst.value !== audience?.countries?.best?.value) {
    lines.push(
      `${audience.countries.worst.value} is showing the weakest efficiency and should be reviewed for exclusion or reduced allocation.`
    );
  }

  lines.push(
    kpis.avgCtr > 2
      ? `Average click-through rate of ${kpis.avgCtr}% is healthy, indicating creatives are resonating with the audience.`
      : `Average click-through rate of ${kpis.avgCtr}% is below the 2% benchmark, suggesting creative fatigue may be setting in.`
  );

  lines.push(`Average cost per lead stands at ${moneyToken(kpis.avgCpl)}, and average CPM is ${moneyToken(kpis.avgCpm)} across all active campaigns.`);

  return lines.join(" ");
}

// ── Section 4: Sales Intelligence — real profit ranking ─────────────────────

function buildSalesIntelligence(campaigns: CampaignAgg[]) {
  const withActivity = campaigns.filter((c) => c.spend > 0 || c.crmLeads > 0);
  const table = withActivity
    .map((c) => ({
      metaCampaignId: c.metaCampaignId,
      name: c.name,
      spend: round2(c.spend),
      leads: c.crmLeads,
      appointments: c.appointments,
      siteVisits: c.siteVisits,
      purchases: c.purchases,
      revenue: round2(c.revenue),
      profit: round2(c.profit),
      roi: round2(c.roi),
    }))
    .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0));

  const hasOutcomeData = campaigns.some((c) => c.appointments + c.siteVisits + c.purchases > 0);

  return {
    hasOutcomeData,
    rankedByProfit: table,
    mostProfitable: hasOutcomeData ? table[0] || null : null,
    leastProfitable: hasOutcomeData ? table[table.length - 1] || null : null,
  };
}

// ── Section 5: Audience Intelligence ────────────────────────────────────────
// Countries/ages/genders/devices come from real per-value Meta breakdown data.
// Cities/interests are estimated by distributing each ad set's spend/leads
// equally across its targeted cities/interests (Meta does not expose a
// native per-city or per-interest performance breakdown) — this is clearly
// labeled as an estimate. Placements report their availability status
// honestly rather than fabricating numbers.

function bestWorstFromMap(agg: Map<string, { spend: number; leads: number; clicks: number; impressions: number }>) {
  const list = Array.from(agg.entries())
    .map(([value, v]) => ({
      value,
      spend: round2(v.spend),
      leads: Math.round(v.leads),
      cpl: v.leads > 0 ? round2(v.spend / v.leads) : null,
      ctr: v.impressions > 0 ? round2((v.clicks / v.impressions) * 100) : null,
    }))
    .filter((e) => e.leads > 0 && e.cpl !== null);
  if (!list.length) return { best: null, worst: null, all: Array.from(agg.entries()).map(([value]) => ({ value })) };
  const sorted = [...list].sort((a, b) => (a.cpl as number) - (b.cpl as number));
  return { best: sorted[0], worst: sorted[sorted.length - 1], all: list };
}

async function buildAudienceIntelligence() {
  const { rows } = await pool.query(`
    SELECT breakdown_type, breakdown_value,
           COALESCE(SUM(spend), 0) AS spend,
           COALESCE(SUM(leads), 0) AS leads,
           COALESCE(SUM(clicks), 0) AS clicks,
           COALESCE(SUM(impressions), 0) AS impressions
    FROM meta_intelligence_breakdowns
    GROUP BY breakdown_type, breakdown_value
  `);

  const byType = new Map<string, Map<string, { spend: number; leads: number; clicks: number; impressions: number }>>();
  for (const r of rows) {
    const m = byType.get(r.breakdown_type) || new Map();
    m.set(r.breakdown_value, { spend: num(r.spend), leads: num(r.leads), clicks: num(r.clicks), impressions: num(r.impressions) });
    byType.set(r.breakdown_type, m);
  }

  const countries = bestWorstFromMap(byType.get("country") || new Map());
  const ages = bestWorstFromMap(byType.get("age") || new Map());
  const genders = bestWorstFromMap(byType.get("gender") || new Map());
  const devices = bestWorstFromMap(byType.get("device_platform") || new Map());

  // Cities & interests — estimated attribution from ad set targeting configuration.
  const { rows: adsetRows } = await pool.query(`
    SELECT a.meta_adset_id, a.cities, a.interests,
           COALESCE(i.spend, 0) AS spend, COALESCE(i.leads, 0) AS leads,
           COALESCE(i.clicks, 0) AS clicks, COALESCE(i.impressions, 0) AS impressions,
           a.publisher_platforms, a.facebook_positions, a.instagram_positions
    FROM meta_intelligence_adsets a
    LEFT JOIN (
      SELECT meta_adset_id, SUM(spend) AS spend, SUM(leads) AS leads,
             SUM(clicks) AS clicks, SUM(impressions) AS impressions
      FROM meta_intelligence_insights
      WHERE entity_type = 'adset'
      GROUP BY meta_adset_id
    ) i ON i.meta_adset_id = a.meta_adset_id
  `);

  const cityAgg = new Map<string, { spend: number; leads: number; clicks: number; impressions: number }>();
  const interestAgg = new Map<string, { spend: number; leads: number; clicks: number; impressions: number }>();
  let anyPlacementData = false;

  for (const r of adsetRows) {
    const cities: string[] = safeParseArray(r.cities);
    const interestsRaw: any[] = safeParseArray(r.interests);
    const platforms: string[] = safeParseArray(r.publisher_platforms);
    const fbPositions: string[] = safeParseArray(r.facebook_positions);
    const igPositions: string[] = safeParseArray(r.instagram_positions);
    if (platforms.length || fbPositions.length || igPositions.length) anyPlacementData = true;

    const spend = num(r.spend), leads = num(r.leads), clicks = num(r.clicks), impressions = num(r.impressions);

    if (cities.length) {
      const share = 1 / cities.length;
      for (const city of cities) {
        const cur = cityAgg.get(city) || { spend: 0, leads: 0, clicks: 0, impressions: 0 };
        cur.spend += spend * share; cur.leads += leads * share; cur.clicks += clicks * share; cur.impressions += impressions * share;
        cityAgg.set(city, cur);
      }
    }
    if (interestsRaw.length) {
      const share = 1 / interestsRaw.length;
      for (const it of interestsRaw) {
        const name = typeof it === "string" ? it : it?.name;
        if (!name) continue;
        const cur = interestAgg.get(name) || { spend: 0, leads: 0, clicks: 0, impressions: 0 };
        cur.spend += spend * share; cur.leads += leads * share; cur.clicks += clicks * share; cur.impressions += impressions * share;
        interestAgg.set(name, cur);
      }
    }
  }

  const cities = bestWorstFromMap(cityAgg);
  const interests = bestWorstFromMap(interestAgg);

  return {
    countries,
    ages,
    genders,
    devices,
    cities: { ...cities, estimated: true },
    interests: { ...interests, estimated: true },
    placements: anyPlacementData
      ? { available: true, note: "Placement-level performance detected from ad set targeting configuration." }
      : { available: false, note: "All ad sets are using Automatic Placements — Meta does not report placement-level performance unless manual placement selection is enabled in Ads Manager." },
    // Backward-compatible aliases used by the current UI.
    bestCountry: countries.best, worstCountry: countries.worst,
    bestAgeGroup: ages.best, worstAgeGroup: ages.worst,
    bestGender: genders.best, bestDevice: devices.best,
  };
}

// ── Section 6: Creative Intelligence ────────────────────────────────────────

function explainCreative(ad: { ctr: number | null; cpl: number | null; impressions: number; hasVideo: boolean; hasImage: boolean; body: string | null; callToAction: string | null }, avgCtr: number, avgCpl: number): string {
  const ctr = ad.ctr ?? 0;
  const bodyLen = (ad.body || "").length;
  const reasons: string[] = [];

  if (ctr >= avgCtr * 1.3) {
    reasons.push(ad.hasVideo ? "Video format is driving above-average engagement" : "The creative hook is resonating strongly with the audience");
    if (bodyLen > 0 && bodyLen < 125) reasons.push("short, punchy copy likely helps stop the scroll");
  } else if (ctr > 0 && ctr <= avgCtr * 0.5 && ad.impressions > 1000) {
    reasons.push("audience fatigue is likely — high impressions with below-average CTR");
    if (bodyLen > 200) reasons.push("long body copy may be reducing scroll-stopping power");
  } else if (ctr > 0 && ctr <= avgCtr * 0.5) {
    reasons.push("early signs of weak audience-message fit");
  }

  if (ad.cpl != null && avgCpl > 0) {
    if (ad.cpl <= avgCpl * 0.7) reasons.push("efficient lead capture relative to the account average");
    else if (ad.cpl >= avgCpl * 1.5) reasons.push("lead cost is significantly above the account average, suggesting a targeting or offer mismatch");
  }

  if (!reasons.length) reasons.push("performance is in line with the account average");
  return reasons.join("; ") + ".";
}

async function buildCreativeIntelligence() {
  const { rows } = await pool.query(`
    SELECT a.meta_ad_id, a.name, a.title, a.body, a.call_to_action, a.image_url, a.video_id,
           COALESCE(i.spend, 0) AS spend,
           COALESCE(i.impressions, 0) AS impressions,
           COALESCE(i.clicks, 0) AS clicks,
           COALESCE(i.leads, 0) AS leads
    FROM meta_intelligence_ads a
    LEFT JOIN (
      SELECT meta_ad_id, SUM(spend) AS spend, SUM(impressions) AS impressions,
             SUM(clicks) AS clicks, SUM(leads) AS leads
      FROM meta_intelligence_insights
      WHERE entity_type = 'ad'
      GROUP BY meta_ad_id
    ) i ON i.meta_ad_id = a.meta_ad_id
  `);

  const ranked = rows.map((r: any) => {
    const spend = num(r.spend);
    const impressions = num(r.impressions);
    const clicks = num(r.clicks);
    const leads = num(r.leads);
    return {
      metaAdId: r.meta_ad_id,
      name: r.name,
      title: r.title,
      body: r.body,
      callToAction: r.call_to_action,
      hasImage: !!r.image_url,
      hasVideo: !!r.video_id,
      spend: round2(spend),
      impressions,
      clicks,
      leads,
      ctr: impressions > 0 ? round2((clicks / impressions) * 100) : null,
      cpl: leads > 0 ? round2(spend / leads) : null,
    };
  });

  const withData = ranked.filter((r) => r.impressions > 0);
  const avgCtr = withData.length ? withData.reduce((s, r) => s + (r.ctr ?? 0), 0) / withData.length : 0;
  const withLeadData = withData.filter((r) => r.cpl != null);
  const avgCpl = withLeadData.length ? withLeadData.reduce((s, r) => s + (r.cpl ?? 0), 0) / withLeadData.length : 0;

  const withExplanations = withData.map((r) => ({ ...r, why: explainCreative(r, avgCtr, avgCpl) }));
  const sortedByCtr = [...withExplanations].sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0));
  const top10 = sortedByCtr.slice(0, 10);
  const bottom10 = [...sortedByCtr].reverse().slice(0, 10);
  const fatigued = withExplanations.filter((r) => r.impressions > 1000 && (r.ctr ?? 0) < avgCtr * 0.5);

  const ctaGroups: Record<string, { count: number; totalCtr: number }> = {};
  for (const r of withData) {
    if (!r.callToAction) continue;
    ctaGroups[r.callToAction] ||= { count: 0, totalCtr: 0 };
    ctaGroups[r.callToAction].count++;
    ctaGroups[r.callToAction].totalCtr += r.ctr ?? 0;
  }
  const bestCta = Object.entries(ctaGroups)
    .map(([cta, v]) => ({ cta, avgCtr: round2(v.totalCtr / v.count) }))
    .sort((a, b) => (b.avgCtr ?? 0) - (a.avgCtr ?? 0))[0] || null;

  return {
    totalAds: ranked.length,
    top10,
    bottom10,
    fatigued: fatigued.map((f) => ({ name: f.name, ctr: f.ctr, impressions: f.impressions, why: f.why })),
    bestCta,
    avgCtr: round2(avgCtr),
    avgCpl: round2(avgCpl),
  };
}

// ── Section 7: Project Intelligence ─────────────────────────────────────────

async function buildProjectIntelligence() {
  const { rows } = await pool.query(`
    SELECT l.project_interest AS project,
           COUNT(*) AS leads,
           COUNT(*) FILTER (WHERE so.appointment_scheduled) AS appointments,
           COUNT(*) FILTER (WHERE so.sale_closed) AS purchases,
           COALESCE(SUM(so.sale_amount) FILTER (WHERE so.sale_closed), 0) AS revenue
    FROM crm_leads l
    LEFT JOIN ai_marketing_sales_outcomes so ON so.lead_id = l.id
    WHERE l.project_interest IS NOT NULL AND l.project_interest <> ''
    GROUP BY l.project_interest
    ORDER BY leads DESC
    LIMIT 100
  `);

  const projects = rows.map((r: any) => ({
    project: r.project,
    leads: num(r.leads),
    appointments: num(r.appointments),
    purchases: num(r.purchases),
    revenue: round2(num(r.revenue)),
  }));

  const bestLead = [...projects].sort((a, b) => b.leads - a.leads)[0] || null;
  const bestRevenue = [...projects].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0] || null;
  const bestAppointment = [...projects].sort((a, b) => b.appointments - a.appointments)[0] || null;
  const bestPurchase = [...projects].sort((a, b) => b.purchases - a.purchases)[0] || null;

  return { projects, bestLead, bestRevenue, bestAppointment, bestPurchase };
}

// ── Section 8: Budget Intelligence — per-campaign action + $ impact ─────────

function recommendBudgetAction(c: CampaignAgg, avgCpl: number): { action: "increase" | "decrease" | "pause" | "maintain"; estimatedImpact: number | null; impactLabel: string } {
  if (c.status === "ACTIVE" && c.spend > avgCpl * 15 && c.crmLeads >= 10 && c.qualifiedLeads === 0) {
    return { action: "pause", estimatedImpact: round2(c.spend * 0.5), impactLabel: "Estimated monthly spend recoverable by pausing (based on 50% of observed spend)" };
  }
  if (c.roi !== null && c.roi > 0.5 && c.purchases > 0) {
    return { action: "increase", estimatedImpact: round2(c.revenue * 0.3), impactLabel: "Estimated additional monthly revenue from a 20-50% budget increase" };
  }
  if (c.metaLeads > 0 && c.cpl > avgCpl * 1.4) {
    return { action: "decrease", estimatedImpact: round2(c.spend * 0.25), impactLabel: "Estimated monthly savings from a 25% budget reduction" };
  }
  return { action: "maintain", estimatedImpact: null, impactLabel: "No budget change recommended at this time" };
}

function buildBudgetIntelligence(campaigns: CampaignAgg[]) {
  const withSpend = campaigns.filter((c) => c.spend > 0);
  const withRoi = withSpend.filter((c) => c.roi !== null);

  const sortedByRoi = [...withRoi].sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0));
  const highestRoi = sortedByRoi[0] || null;
  const lowestRoi = sortedByRoi[sortedByRoi.length - 1] || null;

  const sortedByCpl = [...withSpend].filter((c) => c.metaLeads > 0).sort((a, b) => a.cpl - b.cpl);
  const mostEfficient = sortedByCpl[0] || null;
  const leastEfficient = sortedByCpl[sortedByCpl.length - 1] || null;

  const totalSpend = withSpend.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = withSpend.reduce((s, c) => s + c.revenue, 0);
  const efficiencyScore = totalSpend > 0
    ? Math.round(Math.max(0, Math.min(100, ((totalRevenue - totalSpend) / totalSpend + 1) * 50)))
    : null;

  const avgCpl = sortedByCpl.length ? sortedByCpl.reduce((s, c) => s + c.cpl, 0) / sortedByCpl.length : 0;
  const actionTable = withSpend.map((c) => {
    const rec = recommendBudgetAction(c, avgCpl);
    return {
      metaCampaignId: c.metaCampaignId,
      name: c.name,
      spend: round2(c.spend),
      cpl: round2(c.cpl),
      roi: round2(c.roi),
      recommendedAction: rec.action,
      estimatedImpact: rec.estimatedImpact,
      estimatedImpactLabel: rec.impactLabel,
    };
  });

  return {
    highestRoiCampaign: highestRoi ? { name: highestRoi.name, roi: round2(highestRoi.roi) } : null,
    lowestRoiCampaign: lowestRoi ? { name: lowestRoi.name, roi: round2(lowestRoi.roi) } : null,
    mostEfficientCampaign: mostEfficient ? { name: mostEfficient.name, cpl: round2(mostEfficient.cpl) } : null,
    leastEfficientCampaign: leastEfficient ? { name: leastEfficient.name, cpl: round2(leastEfficient.cpl) } : null,
    budgetEfficiencyScore: efficiencyScore,
    actionTable,
  };
}

// ── Section 9: Sales Funnel Intelligence ────────────────────────────────────

async function buildSalesFunnel(kpis: any) {
  const stages = [
    { stage: "Leads", count: kpis.totalLeads },
    { stage: "Qualified Leads", count: kpis.qualifiedLeads },
    { stage: "Appointments", count: kpis.appointments },
    { stage: "Site Visits", count: kpis.siteVisits },
    { stage: "Purchases", count: kpis.purchases },
  ];

  let biggestDropoff: { from: string; to: string; dropRate: number } | null = null;
  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i];
    const to = stages[i + 1];
    if (from.count > 0) {
      const dropRate = round2((1 - to.count / from.count) * 100) ?? 0;
      if (!biggestDropoff || dropRate > biggestDropoff.dropRate) {
        biggestDropoff = { from: from.stage, to: to.stage, dropRate };
      }
    }
  }

  return { stages, biggestDropoff };
}

// ── Section 10: Predictions ──────────────────────────────────────────────────

function buildPredictions(kpis: any, campaigns: CampaignAgg[]) {
  const qualifiedRate = safeDiv(kpis.qualifiedLeads, kpis.totalLeads) ?? 0;
  const purchaseRate = kpis.totalLeads > 0 ? safeDiv(kpis.purchases, kpis.totalLeads) ?? 0 : 0;
  const avgRevenuePerPurchase = kpis.purchases > 0 ? kpis.revenue / kpis.purchases : 0;

  const projectedLeads = kpis.totalLeads;
  const projectedQualified = Math.round(projectedLeads * qualifiedRate);
  const projectedPurchases = Math.round(projectedLeads * purchaseRate);
  const projectedRevenue = round2(projectedPurchases * avgRevenuePerPurchase);
  const projectedRoi = kpis.totalSpend > 0 ? round2(safeDiv((projectedRevenue ?? 0) - kpis.totalSpend, kpis.totalSpend)) : null;

  const confidence: Confidence = kpis.hasOutcomeData && kpis.totalLeads > 50 ? "Medium" : "Low";

  return {
    projectedLeads,
    projectedQualifiedLeads: projectedQualified,
    projectedPurchases,
    projectedRevenue,
    projectedRoi,
    confidence,
    basis: `Projection based on ${kpis.totalLeads} historically observed leads and current conversion rates. Accuracy will improve as more CRM sales outcomes are recorded.`,
  };
}

// ── Recommendations Engine ──────────────────────────────────────────────────

function buildRecommendations(
  campaigns: CampaignAgg[],
  audience: any,
  creative: any
): Recommendation[] {
  const recs: Recommendation[] = [];
  const withSpend = campaigns.filter((c) => c.spend > 0);
  if (!withSpend.length) return recs;

  const avgCpl = withSpend.reduce((s, c) => s + c.cpl, 0) / withSpend.length;
  const avgCtr = withSpend.reduce((s, c) => s + c.ctr, 0) / withSpend.length;

  for (const c of withSpend) {
    if (c.cpl > avgCpl * 1.5 && c.metaLeads > 0) {
      recs.push({
        category: "budget",
        action: "decrease_budget",
        title: `High CPL detected — "${c.name}"`,
        reason: `Cost per lead (${moneyToken(c.cpl)}) is ${Math.round((c.cpl / avgCpl - 1) * 100)}% above the account average (${moneyToken(avgCpl)}).`,
        supportingMetrics: { cpl: round2(c.cpl), avgCpl: round2(avgCpl), spend: round2(c.spend), leads: c.metaLeads },
        expectedImpact: "Reducing budget by 20-30% or pausing underperforming ad sets should lower blended CPL toward the account average within 1-2 weeks.",
        suggestedAction: "Reduce the daily budget by 25% and pause the lowest-performing ad set within this campaign.",
        estimatedFinancialImpact: round2(c.spend * 0.25),
        estimatedFinancialImpactLabel: "Estimated monthly savings from a 25% budget cut",
        businessImpact: "Frees up budget to reallocate toward higher-performing campaigns, improving overall lead efficiency.",
        confidence: c.metaLeads > 10 ? "High" : "Medium",
        priority: "High",
        entityType: "campaign",
        entityId: c.metaCampaignId,
        entityName: c.name,
      });
    }

    if (c.impressions > 500 && c.ctr < avgCtr * 0.5) {
      recs.push({
        category: "creative",
        action: "low_ctr_warning",
        title: `Low CTR — "${c.name}"`,
        reason: `Click-through rate (${c.ctr.toFixed(2)}%) is significantly below the account average (${avgCtr.toFixed(2)}%), indicating the creative or targeting is not resonating.`,
        supportingMetrics: { ctr: round2(c.ctr), avgCtr: round2(avgCtr), impressions: c.impressions },
        expectedImpact: "Refreshing the creative (headline, image, or hook) typically restores CTR to the account average within 1-2 weeks.",
        suggestedAction: "Launch 2-3 new creative variants (new hook, new visual) and pause the lowest-CTR ad once results are in.",
        estimatedFinancialImpact: round2(c.spend * Math.min(0.3, 1 - c.ctr / (avgCtr || 1))),
        estimatedFinancialImpactLabel: "Estimated monthly cost inefficiency attributable to below-average CTR",
        businessImpact: "Higher CTR reduces cost per click and increases lead volume at the same spend level.",
        confidence: "Medium",
        priority: "Medium",
        entityType: "campaign",
        entityId: c.metaCampaignId,
        entityName: c.name,
      });
    }

    if (c.roi !== null && c.roi > 1 && c.purchases > 0) {
      recs.push({
        category: "opportunity",
        action: "increase_budget",
        title: `Excellent campaign — "${c.name}"`,
        reason: `This campaign shows an estimated ROI of ${(c.roi * 100).toFixed(0)}% with ${c.purchases} recorded purchase(s), well above breakeven.`,
        supportingMetrics: { roi: round2(c.roi), purchases: c.purchases, revenue: round2(c.revenue), spend: round2(c.spend) },
        expectedImpact: "Increasing budget by 20-50% while monitoring CPL should scale revenue proportionally without saturating the audience immediately.",
        suggestedAction: "Increase the daily budget by 30% and monitor CPL daily for the first two weeks.",
        estimatedFinancialImpact: round2(c.revenue * 0.3),
        estimatedFinancialImpactLabel: "Estimated additional monthly revenue from a 30% budget increase",
        businessImpact: "Directly increases revenue by scaling a proven, profitable acquisition channel.",
        confidence: c.purchases >= 3 ? "Very High" : "High",
        priority: "High",
        entityType: "campaign",
        entityId: c.metaCampaignId,
        entityName: c.name,
      });
    }

    if (c.crmLeads >= 10 && c.qualifiedLeads === 0) {
      recs.push({
        category: "risk",
        action: "low_quality_leads",
        title: `Low quality leads — "${c.name}"`,
        reason: `${c.crmLeads} leads generated but none scored as qualified (Hot/Warm) by AI Lead Scoring.`,
        supportingMetrics: { crmLeads: c.crmLeads, qualifiedLeads: c.qualifiedLeads, spend: round2(c.spend) },
        expectedImpact: "Narrowing targeting (age, interests, geography) usually raises qualified-lead rate within 2 weeks.",
        suggestedAction: "Narrow audience targeting and add negative/exclusion criteria based on the lowest-performing segments.",
        estimatedFinancialImpact: round2(c.spend * 0.5),
        estimatedFinancialImpactLabel: "Estimated monthly spend currently wasted on non-converting leads",
        businessImpact: "Prevents wasted sales team effort on low-intent leads and protects overall CRM lead quality.",
        confidence: "Medium",
        priority: "Medium",
        entityType: "campaign",
        entityId: c.metaCampaignId,
        entityName: c.name,
      });
    }

    if (c.dailyBudget > 0 && c.spend > 0 && c.status === "ACTIVE" && c.spend >= c.dailyBudget * 0.95) {
      recs.push({
        category: "budget",
        action: "budget_exhaustion",
        title: `Budget exhaustion risk — "${c.name}"`,
        reason: `Observed spend is at or near the configured daily budget (${moneyToken(c.dailyBudget)}), which can cap delivery during peak hours.`,
        supportingMetrics: { spend: round2(c.spend), dailyBudget: c.dailyBudget },
        expectedImpact: "Raising the daily budget cap by 15-25% can capture additional high-intent traffic currently being missed.",
        suggestedAction: "Raise the daily budget cap by 20% and monitor CPL for the following week.",
        estimatedFinancialImpact: round2(c.spend * 0.2),
        estimatedFinancialImpactLabel: "Estimated additional monthly lead volume value from a 20% budget increase",
        businessImpact: "Avoids missed lead volume from an artificially capped campaign.",
        confidence: "Medium",
        priority: "Low",
        entityType: "campaign",
        entityId: c.metaCampaignId,
        entityName: c.name,
      });
    }
  }

  if (audience?.countries?.worst && audience?.countries?.best && audience.countries.worst.value !== audience.countries.best.value) {
    recs.push({
      category: "audience",
      action: "reduce_audience",
      title: `Underperforming geography — ${audience.countries.worst.value}`,
      reason: `Cost per lead in ${audience.countries.worst.value} (${moneyToken(audience.countries.worst.cpl)}) is significantly higher than in ${audience.countries.best.value} (${moneyToken(audience.countries.best.cpl)}).`,
      supportingMetrics: { worst: audience.countries.worst, best: audience.countries.best },
      expectedImpact: "Reducing or excluding this geography and reallocating spend to top-performing countries can lower blended CPL.",
      suggestedAction: `Exclude or reduce budget allocation to ${audience.countries.worst.value} and reallocate toward ${audience.countries.best.value}.`,
      estimatedFinancialImpact: round2((audience.countries.worst.spend || 0) * 0.4),
      estimatedFinancialImpactLabel: "Estimated monthly savings from reallocating spend away from this geography",
      businessImpact: "Improves overall lead acquisition efficiency without increasing total spend.",
      confidence: "Medium",
      priority: "Medium",
      entityType: "audience",
      entityId: audience.countries.worst.value,
      entityName: audience.countries.worst.value,
    });
  }

  if (creative?.fatigued?.length) {
    for (const f of creative.fatigued.slice(0, 5)) {
      recs.push({
        category: "creative",
        action: "creative_fatigue",
        title: `Creative fatigue detected — "${f.name}"`,
        reason: `This ad has ${f.impressions} impressions with a CTR of ${f.ctr ?? 0}%, well below the account average (${creative.avgCtr}%). ${f.why || ""}`,
        supportingMetrics: { ctr: f.ctr, impressions: f.impressions, accountAvgCtr: creative.avgCtr },
        expectedImpact: "Rotating in a new creative variant typically restores CTR within 1-2 weeks.",
        suggestedAction: "Pause this creative and launch a replacement with a new hook, image or video.",
        estimatedFinancialImpact: null,
        estimatedFinancialImpactLabel: "Not directly quantifiable — protects lead volume and prevents rising CPMs",
        businessImpact: "Prevents rising CPMs and declining lead volume caused by ad fatigue.",
        confidence: "Medium",
        priority: "Medium",
        entityType: "ad",
        entityId: f.name,
        entityName: f.name,
      });
    }
  }

  return recs;
}

// ── Orchestration ────────────────────────────────────────────────────────────

export async function generateAiMarketingDirectorReport() {
  const [baseCurrency, usdRatesResult] = await Promise.all([fetchMetaAccountCurrency(), fetchUsdRates()]);
  const displayRates = buildDisplayRates(usdRatesResult.rates, baseCurrency);

  const campaigns = await loadCampaignAggregates(usdRatesResult.rates, baseCurrency);
  const kpis = buildExecutiveSummary(campaigns, baseCurrency, displayRates, usdRatesResult.stale);
  const audience = await buildAudienceIntelligence();
  const creative = await buildCreativeIntelligence();
  const project = await buildProjectIntelligence();
  const budget = buildBudgetIntelligence(campaigns);
  const sales = buildSalesIntelligence(campaigns);
  const funnel = await buildSalesFunnel(kpis);
  const predictions = buildPredictions(kpis, campaigns);
  const executiveReport = buildExecutiveReport(kpis, campaigns, audience);
  const recommendations = buildRecommendations(campaigns, audience, creative);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO ai_director_snapshots
         (health_score, kpis_json, executive_report, audience_json, creative_json,
          project_json, budget_json, funnel_json, predictions_json, sales_json,
          base_currency, exchange_rates_json, rates_stale, rates_fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       RETURNING id, generated_at`,
      [
        kpis.healthScore,
        JSON.stringify(kpis),
        executiveReport,
        JSON.stringify(audience),
        JSON.stringify(creative),
        JSON.stringify(project),
        JSON.stringify(budget),
        JSON.stringify(funnel),
        JSON.stringify(predictions),
        JSON.stringify(sales),
        baseCurrency,
        JSON.stringify(displayRates),
        usdRatesResult.stale,
      ]
    );
    const snapshotId = rows[0].id;

    for (const r of recommendations) {
      await client.query(
        `INSERT INTO ai_director_recommendations
           (snapshot_id, category, action, title, reason, supporting_metrics_json,
            expected_impact, suggested_action, estimated_financial_impact,
            estimated_financial_impact_label, business_impact, confidence, priority,
            entity_type, entity_id, entity_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          snapshotId,
          r.category,
          r.action,
          r.title,
          r.reason,
          JSON.stringify(r.supportingMetrics),
          r.expectedImpact,
          r.suggestedAction,
          r.estimatedFinancialImpact,
          r.estimatedFinancialImpactLabel,
          r.businessImpact,
          r.confidence,
          r.priority,
          r.entityType || null,
          r.entityId || null,
          r.entityName || null,
        ]
      );
    }
    await client.query("COMMIT");

    return {
      snapshotId,
      generatedAt: rows[0].generated_at,
      kpis,
      executiveReport,
      audience,
      creative,
      project,
      budget,
      sales,
      funnel,
      predictions,
      recommendations,
      baseCurrency,
      displayRates,
      ratesStale: usdRatesResult.stale,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getLatestSnapshot() {
  const { rows } = await pool.query(
    `SELECT * FROM ai_director_snapshots ORDER BY generated_at DESC LIMIT 1`
  );
  return rows[0] || null;
}

export async function getRecommendationsForSnapshot(snapshotId: number) {
  const { rows } = await pool.query(
    `SELECT * FROM ai_director_recommendations WHERE snapshot_id = $1 ORDER BY
       CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, id`,
    [snapshotId]
  );
  return rows;
}

export async function getSnapshotHistory(limit = 30) {
  const { rows } = await pool.query(
    `SELECT id, health_score, generated_at FROM ai_director_snapshots ORDER BY generated_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
