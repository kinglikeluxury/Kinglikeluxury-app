// ── Phase 4: AI Marketing Director — READ-ONLY ANALYSIS ENGINE ─────────────
//
// Safety contract (do not violate):
//   - NO Meta API calls of any kind (this file never imports metaMarketingService
//     or makes any HTTP request). It only reads data already synced into the
//     local meta_intelligence_* tables by the existing Phase 2/3 sync.
//   - SELECT-only against: meta_intelligence_campaigns/adsets/ads/insights/breakdowns,
//     crm_leads, ai_marketing_sales_outcomes.
//   - The ONLY tables this file ever INSERTs/CREATEs into are the two new tables
//     it owns: ai_director_snapshots and ai_director_recommendations.
//   - Never touches WhatsApp, Email, Task Reminders, Lead Assignment, Auth,
//     Permissions, or any existing AI Marketing table/route.

import { pool } from "./db";

// ── Table bootstrap (new tables only) ──────────────────────────────────────

export async function ensureAiMarketingDirectorTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_director_snapshots (
        id                SERIAL PRIMARY KEY,
        health_score      NUMERIC,
        kpis_json         JSONB,
        executive_report  TEXT,
        audience_json     JSONB,
        creative_json     JSONB,
        project_json      JSONB,
        budget_json       JSONB,
        funnel_json       JSONB,
        predictions_json  JSONB,
        generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_director_recommendations (
        id                      SERIAL PRIMARY KEY,
        snapshot_id             INTEGER REFERENCES ai_director_snapshots(id) ON DELETE CASCADE,
        category                TEXT,
        action                  TEXT,
        title                   TEXT,
        reason                  TEXT,
        supporting_metrics_json JSONB,
        expected_impact         TEXT,
        business_impact         TEXT,
        confidence              TEXT,
        priority                TEXT,
        entity_type             TEXT,
        entity_id               TEXT,
        entity_name             TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
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
  ctr: number;
  crmLeads: number;
  hotLeads: number;
  qualifiedLeads: number;
  appointments: number;
  siteVisits: number;
  purchases: number;
  revenue: number;
  roi: number | null;
  costPerPurchase: number | null;
  revenuePerLead: number | null;
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

// ── Data gathering (SELECT-only) ────────────────────────────────────────────

async function loadCampaignAggregates(): Promise<CampaignAgg[]> {
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
    SELECT meta_campaign_id,
           COUNT(*) AS crm_leads,
           COUNT(*) FILTER (WHERE UPPER(ai_score_category) = 'HOT') AS hot_leads,
           COUNT(*) FILTER (WHERE UPPER(ai_score_category) IN ('HOT','WARM')) AS qualified_leads
    FROM crm_leads
    WHERE meta_campaign_id IS NOT NULL AND meta_campaign_id <> ''
    GROUP BY meta_campaign_id
  `);
  const crmByCampaign = new Map<string, any>();
  for (const r of crmRows) crmByCampaign.set(r.meta_campaign_id, r);

  const { rows: outcomeRows } = await pool.query(`
    SELECT l.meta_campaign_id,
           COUNT(*) FILTER (WHERE so.appointment_scheduled) AS appointments,
           COUNT(*) FILTER (WHERE so.site_visit_completed)  AS site_visits,
           COUNT(*) FILTER (WHERE so.sale_closed)           AS purchases,
           COALESCE(SUM(so.sale_amount) FILTER (WHERE so.sale_closed), 0) AS revenue
    FROM ai_marketing_sales_outcomes so
    JOIN crm_leads l ON l.id = so.lead_id
    WHERE l.meta_campaign_id IS NOT NULL AND l.meta_campaign_id <> ''
    GROUP BY l.meta_campaign_id
  `);
  const outcomesByCampaign = new Map<string, any>();
  for (const r of outcomeRows) outcomesByCampaign.set(r.meta_campaign_id, r);

  return campaigns.map((c: any) => {
    const ins = insightsByCampaign.get(c.meta_campaign_id) || {};
    const crm = crmByCampaign.get(c.meta_campaign_id) || {};
    const out = outcomesByCampaign.get(c.meta_campaign_id) || {};
    const spend = num(ins.spend);
    const impressions = num(ins.impressions);
    const clicks = num(ins.clicks);
    const metaLeads = num(ins.meta_leads);
    const revenue = num(out.revenue);
    const purchases = num(out.purchases);
    const crmLeads = num(crm.crm_leads);

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
      ctr: safeDiv(clicks, impressions) ? safeDiv(clicks, impressions)! * 100 : 0,
      crmLeads,
      hotLeads: num(crm.hot_leads),
      qualifiedLeads: num(crm.qualified_leads),
      appointments: num(out.appointments),
      siteVisits: num(out.site_visits),
      purchases,
      revenue,
      roi: safeDiv(revenue - spend, spend),
      costPerPurchase: safeDiv(spend, purchases),
      revenuePerLead: safeDiv(revenue, crmLeads),
    };
  });
}

// ── Section 1: Executive Summary (KPIs) ─────────────────────────────────────

function buildExecutiveSummary(campaigns: CampaignAgg[]) {
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

  // Health score: weighted blend of lead quality rate, CTR, and (if available) ROI.
  const qualifiedRate = safeDiv(totalQualified, totalLeads) ?? 0;
  const ctrScore = Math.min(totalImpressions ? (totalClicks / totalImpressions) * 100 : 0, 5) / 5; // cap at 5% CTR = perfect
  const roiScore = hasOutcomeData ? Math.max(0, Math.min(1, ((safeDiv(totalRevenue, totalSpend) ?? 0)) / 3)) : 0.5;
  const healthScore = Math.round((qualifiedRate * 0.4 + ctrScore * 0.3 + roiScore * 0.3) * 100);

  return {
    healthScore,
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

  if (audience?.bestCountry) {
    lines.push(
      `${audience.bestCountry.value} continues to generate the highest-quality audience, with a cost per lead of $${audience.bestCountry.cpl?.toFixed(2) ?? "N/A"}.`
    );
  }
  if (audience?.worstCountry && audience.worstCountry.value !== audience?.bestCountry?.value) {
    lines.push(
      `${audience.worstCountry.value} is showing the weakest efficiency and should be reviewed for exclusion or reduced allocation.`
    );
  }

  lines.push(
    kpis.avgCtr > 2
      ? `Average click-through rate of ${kpis.avgCtr}% is healthy, indicating creatives are resonating with the audience.`
      : `Average click-through rate of ${kpis.avgCtr}% is below the 2% benchmark, suggesting creative fatigue may be setting in.`
  );

  lines.push(`Average cost per lead stands at $${kpis.avgCpl ?? "N/A"} across all active campaigns.`);

  return lines.join(" ");
}

// ── Section 5: Audience Intelligence ────────────────────────────────────────

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

  const byType: Record<string, any[]> = {};
  for (const r of rows) {
    const spend = num(r.spend);
    const leads = num(r.leads);
    const clicks = num(r.clicks);
    const impressions = num(r.impressions);
    const entry = {
      value: r.breakdown_value,
      spend: round2(spend),
      leads,
      cpl: leads > 0 ? round2(spend / leads) : null,
      ctr: impressions > 0 ? round2((clicks / impressions) * 100) : null,
    };
    (byType[r.breakdown_type] ||= []).push(entry);
  }

  function bestWorst(type: string) {
    const list = (byType[type] || []).filter((e) => e.leads > 0 && e.cpl !== null);
    if (!list.length) return { best: null, worst: null, all: byType[type] || [] };
    const sorted = [...list].sort((a, b) => a.cpl - b.cpl);
    return { best: sorted[0], worst: sorted[sorted.length - 1], all: byType[type] || [] };
  }

  const countries = bestWorst("country");
  const ages = bestWorst("age");
  const genders = bestWorst("gender");
  const devices = bestWorst("device_platform");

  return {
    bestCountry: countries.best,
    worstCountry: countries.worst,
    countries: countries.all,
    bestAgeGroup: ages.best,
    worstAgeGroup: ages.worst,
    ageGroups: ages.all,
    bestGender: genders.best,
    genders: genders.all,
    bestDevice: devices.best,
    devices: devices.all,
  };
}

// ── Section 6: Creative Intelligence ────────────────────────────────────────

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
  const sortedByCtr = [...withData].sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0));
  const top10 = sortedByCtr.slice(0, 10);
  const bottom10 = [...sortedByCtr].reverse().slice(0, 10);

  const avgCtr = withData.length
    ? withData.reduce((s, r) => s + (r.ctr ?? 0), 0) / withData.length
    : 0;
  const fatigued = withData.filter((r) => r.impressions > 1000 && (r.ctr ?? 0) < avgCtr * 0.5);

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
    fatigued: fatigued.map((f) => ({ name: f.name, ctr: f.ctr, impressions: f.impressions })),
    bestCta,
    avgCtr: round2(avgCtr),
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

// ── Section 8: Budget Intelligence ──────────────────────────────────────────

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

  return {
    highestRoiCampaign: highestRoi ? { name: highestRoi.name, roi: round2(highestRoi.roi) } : null,
    lowestRoiCampaign: lowestRoi ? { name: lowestRoi.name, roi: round2(lowestRoi.roi) } : null,
    mostEfficientCampaign: mostEfficient ? { name: mostEfficient.name, cpl: round2(mostEfficient.cpl) } : null,
    leastEfficientCampaign: leastEfficient ? { name: leastEfficient.name, cpl: round2(leastEfficient.cpl) } : null,
    budgetEfficiencyScore: efficiencyScore,
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
  // Simple heuristic projection based on a ~30-day observed window (see date range
  // captured during sync) extrapolated forward 30 days using observed conversion rates.
  const qualifiedRate = safeDiv(kpis.qualifiedLeads, kpis.totalLeads) ?? 0;
  const purchaseRate = kpis.totalLeads > 0 ? safeDiv(kpis.purchases, kpis.totalLeads) ?? 0 : 0;
  const avgRevenuePerPurchase = kpis.purchases > 0 ? kpis.revenue / kpis.purchases : 0;

  const projectedLeads = kpis.totalLeads; // next-period projection assumes similar spend/velocity
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
    // High CPL warning / decrease budget
    if (c.cpl > avgCpl * 1.5 && c.metaLeads > 0) {
      recs.push({
        category: "budget",
        action: "decrease_budget",
        title: `High CPL detected — "${c.name}"`,
        reason: `Cost per lead ($${c.cpl.toFixed(2)}) is ${Math.round((c.cpl / avgCpl - 1) * 100)}% above the account average ($${avgCpl.toFixed(2)}).`,
        supportingMetrics: { cpl: round2(c.cpl), avgCpl: round2(avgCpl), spend: round2(c.spend), leads: c.metaLeads },
        expectedImpact: "Reducing budget by 20-30% or pausing underperforming ad sets could lower blended CPL toward the account average.",
        businessImpact: "Frees up budget to reallocate toward higher-performing campaigns, improving overall lead efficiency.",
        confidence: c.metaLeads > 10 ? "High" : "Medium",
        priority: "High",
        entityType: "campaign",
        entityId: c.metaCampaignId,
        entityName: c.name,
      });
    }

    // Low CTR warning
    if (c.impressions > 500 && c.ctr < avgCtr * 0.5) {
      recs.push({
        category: "creative",
        action: "low_ctr_warning",
        title: `Low CTR — "${c.name}"`,
        reason: `Click-through rate (${c.ctr.toFixed(2)}%) is significantly below the account average (${avgCtr.toFixed(2)}%), indicating the creative or targeting is not resonating.`,
        supportingMetrics: { ctr: round2(c.ctr), avgCtr: round2(avgCtr), impressions: c.impressions },
        expectedImpact: "Refreshing the creative (headline, image, or hook) typically restores CTR to the account average within 1-2 weeks.",
        businessImpact: "Higher CTR reduces cost per click and increases lead volume at the same spend level.",
        confidence: "Medium",
        priority: "Medium",
        entityType: "campaign",
        entityId: c.metaCampaignId,
        entityName: c.name,
      });
    }

    // Excellent campaign — increase budget / duplicate
    if (c.roi !== null && c.roi > 1 && c.purchases > 0) {
      recs.push({
        category: "opportunity",
        action: "increase_budget",
        title: `Excellent campaign — "${c.name}"`,
        reason: `This campaign shows an estimated ROI of ${(c.roi * 100).toFixed(0)}% with ${c.purchases} recorded purchase(s), well above breakeven.`,
        supportingMetrics: { roi: round2(c.roi), purchases: c.purchases, revenue: round2(c.revenue), spend: round2(c.spend) },
        expectedImpact: "Increasing budget by 20-50% while monitoring CPL should scale revenue proportionally without saturating the audience immediately.",
        businessImpact: "Directly increases revenue by scaling a proven, profitable acquisition channel.",
        confidence: c.purchases >= 3 ? "Very High" : "High",
        priority: "High",
        entityType: "campaign",
        entityId: c.metaCampaignId,
        entityName: c.name,
      });
    }

    // Low quality leads: many leads but zero qualified/hot
    if (c.crmLeads >= 10 && c.qualifiedLeads === 0) {
      recs.push({
        category: "risk",
        action: "low_quality_leads",
        title: `Low quality leads — "${c.name}"`,
        reason: `${c.crmLeads} leads generated but none scored as qualified (Hot/Warm) by AI Lead Scoring.`,
        supportingMetrics: { crmLeads: c.crmLeads, qualifiedLeads: c.qualifiedLeads },
        expectedImpact: "Narrowing targeting (age, interests, geography) usually raises qualified-lead rate within 2 weeks.",
        businessImpact: "Prevents wasted sales team effort on low-intent leads and protects overall CRM lead quality.",
        confidence: "Medium",
        priority: "Medium",
        entityType: "campaign",
        entityId: c.metaCampaignId,
        entityName: c.name,
      });
    }

    // Budget exhaustion
    if (c.dailyBudget > 0 && c.spend > 0 && c.status === "ACTIVE" && c.spend >= c.dailyBudget * 0.95) {
      recs.push({
        category: "budget",
        action: "budget_exhaustion",
        title: `Budget exhaustion risk — "${c.name}"`,
        reason: `Observed spend is at or near the configured daily budget ($${c.dailyBudget.toFixed(2)}), which can cap delivery during peak hours.`,
        supportingMetrics: { spend: round2(c.spend), dailyBudget: c.dailyBudget },
        expectedImpact: "Raising the daily budget cap by 15-25% can capture additional high-intent traffic currently being missed.",
        businessImpact: "Avoids missed lead volume from an artificially capped campaign.",
        confidence: "Medium",
        priority: "Low",
        entityType: "campaign",
        entityId: c.metaCampaignId,
        entityName: c.name,
      });
    }
  }

  // Audience-level: hidden opportunity / worst country
  if (audience?.worstCountry && audience?.bestCountry && audience.worstCountry.value !== audience.bestCountry.value) {
    recs.push({
      category: "audience",
      action: "reduce_audience",
      title: `Underperforming geography — ${audience.worstCountry.value}`,
      reason: `Cost per lead in ${audience.worstCountry.value} ($${audience.worstCountry.cpl?.toFixed(2)}) is significantly higher than in ${audience.bestCountry.value} ($${audience.bestCountry.cpl?.toFixed(2)}).`,
      supportingMetrics: { worst: audience.worstCountry, best: audience.bestCountry },
      expectedImpact: "Reducing or excluding this geography and reallocating spend to top-performing countries can lower blended CPL.",
      businessImpact: "Improves overall lead acquisition efficiency without increasing total spend.",
      confidence: "Medium",
      priority: "Medium",
      entityType: "audience",
      entityId: audience.worstCountry.value,
      entityName: audience.worstCountry.value,
    });
  }

  // Creative fatigue
  if (creative?.fatigued?.length) {
    for (const f of creative.fatigued.slice(0, 5)) {
      recs.push({
        category: "creative",
        action: "creative_fatigue",
        title: `Creative fatigue detected — "${f.name}"`,
        reason: `This ad has ${f.impressions} impressions with a CTR of ${f.ctr ?? 0}%, well below the account average (${creative.avgCtr}%), a classic sign of audience fatigue.`,
        supportingMetrics: { ctr: f.ctr, impressions: f.impressions, accountAvgCtr: creative.avgCtr },
        expectedImpact: "Rotating in a new creative variant typically restores CTR within 1-2 weeks.",
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
  const campaigns = await loadCampaignAggregates();
  const kpis = buildExecutiveSummary(campaigns);
  const audience = await buildAudienceIntelligence();
  const creative = await buildCreativeIntelligence();
  const project = await buildProjectIntelligence();
  const budget = buildBudgetIntelligence(campaigns);
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
          project_json, budget_json, funnel_json, predictions_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
      ]
    );
    const snapshotId = rows[0].id;

    for (const r of recommendations) {
      await client.query(
        `INSERT INTO ai_director_recommendations
           (snapshot_id, category, action, title, reason, supporting_metrics_json,
            expected_impact, business_impact, confidence, priority, entity_type, entity_id, entity_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          snapshotId,
          r.category,
          r.action,
          r.title,
          r.reason,
          JSON.stringify(r.supportingMetrics),
          r.expectedImpact,
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
      funnel,
      predictions,
      recommendations,
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
