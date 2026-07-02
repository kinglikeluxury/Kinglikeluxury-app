// ── Phase 5: Kinglike Quality Score (KQS) — READ-ONLY SCORING ENGINE ────────
//
// Safety contract (do not violate):
//   - SELECT-only against: crm_leads, crm_notes, whatsapp_ai_conversations,
//     whatsapp_ai_messages, ai_marketing_sales_outcomes, ai_campaign_attribution,
//     meta_intelligence_campaigns.
//   - The ONLY table this file ever INSERTs/CREATEs/ALTERs is the one it owns:
//     ai_kqs_lead_scores (an additive analytics table — it never modifies any
//     existing CRM record).
//   - No writes are ever made to crm_leads or any other CRM/WhatsApp table.
//   - No Meta Graph API calls of any kind happen in this file.
//
// Purpose: stop treating Meta metrics (CPL/CTR/CPM) as the source of truth.
// Every lead gets a single Kinglike Quality Score (KQS, 0-100) built mostly
// from what actually happened in the CRM (appointments, site visits, sales),
// with Meta-side signals (campaign/ad set/ad identity) contributing only a
// modest, *learned* weight. Group-level "quality" (per source/country/city/
// project/campaign/ad set/ad) is recalculated from ALL current data on every
// run using Bayesian-smoothed conversion rates, so the model keeps adapting
// automatically as new sales come in — no manual weight tuning required.

import { pool } from "./db";

export async function ensureKqsTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_kqs_lead_scores (
        lead_id                 INTEGER PRIMARY KEY REFERENCES crm_leads(id) ON DELETE CASCADE,
        kqs                     NUMERIC,
        qualification_score     NUMERIC,
        engagement_score        NUMERIC,
        funnel_score            NUMERIC,
        speed_score             NUMERIC,
        source_quality_score    NUMERIC,
        geo_quality_score       NUMERIC,
        project_quality_score   NUMERIC,
        campaign_quality_score  NUMERIC,
        trust_score             NUMERIC,
        is_duplicate            BOOLEAN DEFAULT FALSE,
        fake_probability        NUMERIC DEFAULT 0,
        components_json         JSONB,
        computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ai_kqs_lead_scores_kqs_idx ON ai_kqs_lead_scores(kqs)
    `);
    console.log("[DB] ensureKqsTables ✓");
  } catch (err: any) {
    console.error("[DB] ensureKqsTables error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function normalizePhone(p: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
}
function normalizeEmail(e: string | null): string | null {
  if (!e) return null;
  const t = e.trim().toLowerCase();
  return t.includes("@") ? t : null;
}

// Bayesian-smoothed rate: shrinks small-sample groups toward the global
// average so a group with 1 lead and 1 sale doesn't look "perfect".
function smoothedRate(hits: number, n: number, globalRate: number, k = 5): number {
  return (hits + k * globalRate) / (n + k);
}

// Min-max normalizes a set of {key, value} rates into 0-100 scores. Groups
// with very few leads are still included (already shrunk by smoothedRate)
// so this reflects *relative* quality across groups.
function rankToScore(rates: Map<string, number>): Map<string, number> {
  const values = Array.from(rates.values());
  if (values.length === 0) return new Map();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const out = new Map<string, number>();
  for (const [k, v] of Array.from(rates.entries())) {
    out.set(k, span > 0 ? clamp(((v - min) / span) * 100) : 50);
  }
  return out;
}

interface RawLeadRow {
  id: number;
  lead_source: string | null;
  country: string | null;
  city: string | null;
  project_interest: string | null;
  status: string | null;
  phone: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  created_at: string;
  last_contact_at: string | null;
  ai_score: number | null;
  ai_score_category: string | null;
  ai_score_updated_at: string | null;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  appointment_scheduled: boolean | null;
  site_visit_completed: boolean | null;
  sale_closed: boolean | null;
  sale_amount: number | null;
  sale_currency: string | null;
  notes_count: number;
  wa_conv_count: number;
  wa_inbound_count: number;
}

const STATUS_ENGAGEMENT_WEIGHT: Record<string, number> = {
  new: 0,
  no_answer: 5,
  follow_up: 20,
  interested: 40,
  qualified: 60,
  converted: 100,
  lost: 10,
};

async function loadRawLeads(): Promise<RawLeadRow[]> {
  const { rows } = await pool.query(`
    WITH linked AS (
      SELECT id, meta_campaign_id AS campaign_id, meta_adset_id AS adset_id, meta_ad_id AS ad_id
      FROM crm_leads
      WHERE meta_campaign_id IS NOT NULL AND meta_campaign_id <> ''
      UNION
      SELECT l.id, a.campaign_id, a.adset_id, a.ad_id
      FROM crm_leads l
      JOIN ai_campaign_attribution a ON a.crm_lead_id = l.id
      WHERE (l.meta_campaign_id IS NULL OR l.meta_campaign_id = '')
        AND a.campaign_id IS NOT NULL AND a.campaign_id <> ''
    )
    SELECT
      l.id, l.lead_source, l.country, l.city, l.project_interest, l.status,
      l.phone, l.email, l.first_name, l.last_name, l.full_name,
      l.created_at, l.last_contact_at,
      l.ai_score, l.ai_score_category, l.ai_score_updated_at,
      ln.campaign_id, ln.adset_id, ln.ad_id,
      so.appointment_scheduled, so.site_visit_completed, so.sale_closed,
      so.sale_amount, so.sale_currency,
      COALESCE((SELECT COUNT(*) FROM crm_notes n WHERE n.lead_id = l.id), 0) AS notes_count,
      COALESCE((SELECT COUNT(*) FROM whatsapp_ai_conversations wc WHERE wc.lead_id = l.id), 0) AS wa_conv_count,
      COALESCE((
        SELECT COUNT(*) FROM whatsapp_ai_messages wm
        JOIN whatsapp_ai_conversations wc2 ON wc2.id = wm.conversation_id
        WHERE wc2.lead_id = l.id AND wm.sender <> 'ai'
      ), 0) AS wa_inbound_count
    FROM crm_leads l
    LEFT JOIN linked ln ON ln.id = l.id
    LEFT JOIN ai_marketing_sales_outcomes so ON so.lead_id = l.id
  `);
  return rows;
}

// ── Group quality (the "continuous learning" part) ─────────────────────────
// Recomputed from ALL current CRM outcomes every time a report is generated.
// A group's "outcome points" weight sales far above site visits, and site
// visits above appointments, mirroring the required example: campaigns with
// many leads but almost no sales must score low, and campaigns with fewer
// leads but real sales must score high — this is independent of lead volume
// or Meta's own CPL/CTR numbers.
function buildGroupQuality(rows: RawLeadRow[], keyFn: (r: RawLeadRow) => string | null) {
  const groups = new Map<string, { n: number; points: number }>();
  let totalN = 0;
  let totalPoints = 0;
  for (const r of rows) {
    const key = keyFn(r);
    if (!key) continue;
    const points = (r.sale_closed ? 5 : 0) + (r.site_visit_completed ? 2 : 0) + (r.appointment_scheduled ? 1 : 0);
    const g = groups.get(key) || { n: 0, points: 0 };
    g.n += 1;
    g.points += points;
    groups.set(key, g);
    totalN += 1;
    totalPoints += points;
  }
  const globalRate = totalN > 0 ? totalPoints / totalN : 0;
  const smoothed = new Map<string, number>();
  for (const [key, g] of Array.from(groups.entries())) {
    smoothed.set(key, smoothedRate(g.points, g.n, globalRate, 5));
  }
  return { scores: rankToScore(smoothed), counts: groups, globalRate };
}

function speedScoreFor(createdAt: string, lastContactAt: string | null): number {
  if (!lastContactAt) return 30; // no contact yet — neutral-low, not penalized as harshly as a bad score
  const hours = (new Date(lastContactAt).getTime() - new Date(createdAt).getTime()) / 3_600_000;
  if (hours <= 1) return 100;
  if (hours <= 4) return 85;
  if (hours <= 24) return 65;
  if (hours <= 72) return 40;
  return 15;
}

function engagementScoreFor(r: RawLeadRow): number {
  let score = 0;
  if (r.wa_conv_count > 0) score += 20;
  score += Math.min(num(r.wa_inbound_count) * 10, 40);
  score += Math.min(num(r.notes_count) * 10, 20);
  score += (STATUS_ENGAGEMENT_WEIGHT[(r.status || "new").toLowerCase()] ?? 0) * 0.2;
  return clamp(score);
}

function funnelScoreFor(r: RawLeadRow): number {
  if (r.sale_closed) return 100;
  if (r.site_visit_completed) return 60;
  if (r.appointment_scheduled) return 35;
  return 0;
}

function fakeProbabilityFor(r: RawLeadRow, isDuplicate: boolean): number {
  let p = 0;
  const phoneOk = !!normalizePhone(r.phone);
  const hasName = !!(r.first_name || r.last_name || r.full_name);
  if (!phoneOk) p += 40;
  if (!hasName) p += 25;
  if (!r.email && !phoneOk) p += 15;
  if (isDuplicate) p += 20;
  return clamp(p);
}

export interface LeadKqsResult {
  leadId: number;
  kqs: number;
  qualificationScore: number;
  engagementScore: number;
  funnelScore: number;
  speedScore: number;
  sourceQualityScore: number;
  geoQualityScore: number;
  projectQualityScore: number;
  campaignQualityScore: number;
  trustScore: number;
  isDuplicate: boolean;
  fakeProbability: number;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
}

export interface KqsComputation {
  leadScores: LeadKqsResult[];
  byCampaign: Map<string, LeadKqsResult[]>;
  byAdset: Map<string, LeadKqsResult[]>;
  byAd: Map<string, LeadKqsResult[]>;
  learningStatus: {
    totalLeadsScored: number;
    totalSalesObserved: number;
    globalOutcomeRate: number;
    confidence: "Low" | "Medium" | "High";
  };
}

const WEIGHTS = {
  funnel: 0.35,
  campaign: 0.15,
  source: 0.08,
  geo: 0.07,
  project: 0.05,
  qualification: 0.10,
  engagement: 0.10,
  speed: 0.05,
  trust: 0.05,
};

export async function computeKqsForAllLeads(): Promise<KqsComputation> {
  const rows = await loadRawLeads();

  // Duplicate detection — cluster by normalized phone / email.
  const phoneCounts = new Map<string, number>();
  const emailCounts = new Map<string, number>();
  for (const r of rows) {
    const p = normalizePhone(r.phone);
    const e = normalizeEmail(r.email);
    if (p) phoneCounts.set(p, (phoneCounts.get(p) || 0) + 1);
    if (e) emailCounts.set(e, (emailCounts.get(e) || 0) + 1);
  }
  const isDuplicateLead = (r: RawLeadRow): boolean => {
    const p = normalizePhone(r.phone);
    const e = normalizeEmail(r.email);
    return (!!p && (phoneCounts.get(p) || 0) > 1) || (!!e && (emailCounts.get(e) || 0) > 1);
  };

  // Learned group-quality scores, recalculated fresh from current data.
  const sourceQuality = buildGroupQuality(rows, (r) => r.lead_source);
  const geoQuality = buildGroupQuality(rows, (r) => (r.country ? `${r.country}|${r.city || ""}` : null));
  const projectQuality = buildGroupQuality(rows, (r) => r.project_interest);
  const campaignQuality = buildGroupQuality(rows, (r) => r.campaign_id);
  const adsetQuality = buildGroupQuality(rows, (r) => r.adset_id);
  const adQuality = buildGroupQuality(rows, (r) => r.ad_id);

  const totalSales = rows.filter((r) => r.sale_closed).length;
  const confidence: "Low" | "Medium" | "High" = totalSales >= 20 ? "High" : totalSales >= 5 ? "Medium" : "Low";

  const leadScores: LeadKqsResult[] = rows.map((r) => {
    const dup = isDuplicateLead(r);
    const fakeProb = fakeProbabilityFor(r, dup);

    const qualificationScore = r.ai_score != null ? clamp(num(r.ai_score)) : 50;
    const engagementScore = engagementScoreFor(r);
    const funnelScore = funnelScoreFor(r);
    const speedScore = speedScoreFor(r.created_at, r.last_contact_at);
    const sourceQualityScore: number = (r.lead_source ? sourceQuality.scores.get(r.lead_source) : undefined) ?? 50;
    const geoKey = r.country ? `${r.country}|${r.city || ""}` : null;
    const geoQualityScore: number = (geoKey ? geoQuality.scores.get(geoKey) : undefined) ?? 50;
    const projectQualityScore: number = (r.project_interest ? projectQuality.scores.get(r.project_interest) : undefined) ?? 50;
    // Prefer the finest-grained Meta signal available (ad > ad set > campaign).
    const campaignQualityScore: number =
      (r.ad_id ? adQuality.scores.get(r.ad_id) : undefined) ??
      (r.adset_id ? adsetQuality.scores.get(r.adset_id) : undefined) ??
      (r.campaign_id ? campaignQuality.scores.get(r.campaign_id) : undefined) ??
      50;
    const trustScore = clamp(100 - (dup ? 30 : 0) - fakeProb * 0.5);

    const kqs = clamp(
      funnelScore * WEIGHTS.funnel +
        campaignQualityScore * WEIGHTS.campaign +
        sourceQualityScore * WEIGHTS.source +
        geoQualityScore * WEIGHTS.geo +
        projectQualityScore * WEIGHTS.project +
        qualificationScore * WEIGHTS.qualification +
        engagementScore * WEIGHTS.engagement +
        speedScore * WEIGHTS.speed +
        trustScore * WEIGHTS.trust
    );

    return {
      leadId: r.id,
      kqs: round1(kqs),
      qualificationScore: round1(qualificationScore),
      engagementScore: round1(engagementScore),
      funnelScore: round1(funnelScore),
      speedScore: round1(speedScore),
      sourceQualityScore: round1(sourceQualityScore),
      geoQualityScore: round1(geoQualityScore),
      projectQualityScore: round1(projectQualityScore),
      campaignQualityScore: round1(campaignQualityScore),
      trustScore: round1(trustScore),
      isDuplicate: dup,
      fakeProbability: round1(fakeProb),
      campaignId: r.campaign_id,
      adsetId: r.adset_id,
      adId: r.ad_id,
    };
  });

  const byCampaign = new Map<string, LeadKqsResult[]>();
  const byAdset = new Map<string, LeadKqsResult[]>();
  const byAd = new Map<string, LeadKqsResult[]>();
  for (const ls of leadScores) {
    if (ls.campaignId) {
      const arr = byCampaign.get(ls.campaignId) || [];
      arr.push(ls);
      byCampaign.set(ls.campaignId, arr);
    }
    if (ls.adsetId) {
      const arr = byAdset.get(ls.adsetId) || [];
      arr.push(ls);
      byAdset.set(ls.adsetId, arr);
    }
    if (ls.adId) {
      const arr = byAd.get(ls.adId) || [];
      arr.push(ls);
      byAd.set(ls.adId, arr);
    }
  }

  // Persist lead-level scores (additive analytics only — never touches crm_leads).
  if (leadScores.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const ls of leadScores) {
        await client.query(
          `INSERT INTO ai_kqs_lead_scores
             (lead_id, kqs, qualification_score, engagement_score, funnel_score, speed_score,
              source_quality_score, geo_quality_score, project_quality_score, campaign_quality_score,
              trust_score, is_duplicate, fake_probability, components_json, computed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
           ON CONFLICT (lead_id) DO UPDATE SET
             kqs = EXCLUDED.kqs,
             qualification_score = EXCLUDED.qualification_score,
             engagement_score = EXCLUDED.engagement_score,
             funnel_score = EXCLUDED.funnel_score,
             speed_score = EXCLUDED.speed_score,
             source_quality_score = EXCLUDED.source_quality_score,
             geo_quality_score = EXCLUDED.geo_quality_score,
             project_quality_score = EXCLUDED.project_quality_score,
             campaign_quality_score = EXCLUDED.campaign_quality_score,
             trust_score = EXCLUDED.trust_score,
             is_duplicate = EXCLUDED.is_duplicate,
             fake_probability = EXCLUDED.fake_probability,
             components_json = EXCLUDED.components_json,
             computed_at = NOW()`,
          [
            ls.leadId,
            ls.kqs,
            ls.qualificationScore,
            ls.engagementScore,
            ls.funnelScore,
            ls.speedScore,
            ls.sourceQualityScore,
            ls.geoQualityScore,
            ls.projectQualityScore,
            ls.campaignQualityScore,
            ls.trustScore,
            ls.isDuplicate,
            ls.fakeProbability,
            JSON.stringify(ls),
          ]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[KQS] Failed to persist lead scores:", (err as any)?.message);
    } finally {
      client.release();
    }
  }

  return {
    leadScores,
    byCampaign,
    byAdset,
    byAd,
    learningStatus: {
      totalLeadsScored: leadScores.length,
      totalSalesObserved: totalSales,
      globalOutcomeRate: round1(campaignQuality.globalRate * 20), // scaled for readability
      confidence,
    },
  };
}

// ── Campaign / ad set / ad level Meta Score vs CRM Score vs KQS ─────────────

export interface KqsEntityRow {
  entityId: string;
  name: string;
  leads: number;
  metaScore: number;
  crmScore: number;
  kqs: number;
  finalRecommendation: string;
  warning: string | null;
  supporting: Record<string, any>;
}

function percentileRank(map: Map<string, number>): Map<string, number> {
  return rankToScore(map);
}

export function buildKqsEntityTable(
  entities: Array<{
    id: string;
    name: string;
    spend: number;
    cpl: number;
    ctr: number;
    crmLeads: number;
    purchases: number;
    appointments: number;
    siteVisits: number;
    profit: number;
  }>,
  leadScoresByEntity: Map<string, LeadKqsResult[]>
): KqsEntityRow[] {
  if (entities.length === 0) return [];

  // Meta-only signal: lower CPL is better, higher CTR is better.
  const cplMap = new Map<string, number>();
  const ctrMap = new Map<string, number>();
  for (const e of entities) {
    cplMap.set(e.id, e.cpl > 0 ? -e.cpl : 0); // invert so lower cpl -> higher rank
    ctrMap.set(e.id, e.ctr);
  }
  const cplScore = percentileRank(cplMap);
  const ctrScore = percentileRank(ctrMap);

  // CRM-only signal: Bayesian-smoothed conversion rate + profit-per-lead + funnel rate.
  const totalLeads = entities.reduce((s, e) => s + e.crmLeads, 0);
  const totalPurchases = entities.reduce((s, e) => s + e.purchases, 0);
  const globalConvRate = totalLeads > 0 ? totalPurchases / totalLeads : 0;
  const convMap = new Map<string, number>();
  const profitMap = new Map<string, number>();
  const funnelMap = new Map<string, number>();
  for (const e of entities) {
    const rate = e.crmLeads > 0 ? e.purchases / e.crmLeads : 0;
    convMap.set(e.id, smoothedRate(e.purchases, e.crmLeads, globalConvRate, 3));
    profitMap.set(e.id, e.crmLeads > 0 ? e.profit / e.crmLeads : 0);
    const funnelRate = e.crmLeads > 0 ? (e.appointments * 1 + e.siteVisits * 2) / e.crmLeads : 0;
    funnelMap.set(e.id, funnelRate);
  }
  const convScore = percentileRank(convMap);
  const profitScore = percentileRank(profitMap);
  const funnelScore = percentileRank(funnelMap);

  return entities.map((e) => {
    const leadScores = leadScoresByEntity.get(e.id) || [];
    const avgLeadKqs = leadScores.length > 0 ? leadScores.reduce((s, l) => s + l.kqs, 0) / leadScores.length : 50;

    const metaScore = round1(0.6 * (cplScore.get(e.id) ?? 50) + 0.4 * (ctrScore.get(e.id) ?? 50));
    const crmScore = round1(
      0.45 * (convScore.get(e.id) ?? 50) +
        0.25 * (profitScore.get(e.id) ?? 50) +
        0.15 * (funnelScore.get(e.id) ?? 50) +
        0.15 * clamp(avgLeadKqs)
    );
    const kqs = round1(0.75 * crmScore + 0.25 * metaScore);

    let finalRecommendation: string;
    if (kqs >= 75) finalRecommendation = "Scale — increase budget. Real sales outcomes confirm this is a high-quality source.";
    else if (kqs >= 55) finalRecommendation = "Maintain — solid real-world performance. Keep monitoring.";
    else if (kqs >= 35) finalRecommendation = "Review — quality is below account average. Investigate targeting/creative before scaling.";
    else finalRecommendation = "Reduce or pause — low real-world quality. Reallocate this budget elsewhere.";

    let warning: string | null = null;
    if (metaScore - kqs > 25) {
      warning = "Meta metrics (CPL/CTR) look attractive, but real CRM outcomes are weak — do not scale on Meta data alone.";
    } else if (kqs - metaScore > 25) {
      warning = "Meta metrics look average, but real CRM outcomes are strong — consider increasing budget despite average CPL/CTR.";
    }

    return {
      entityId: e.id,
      name: e.name,
      leads: e.crmLeads,
      metaScore,
      crmScore,
      kqs,
      finalRecommendation,
      warning,
      supporting: {
        cpl: e.cpl,
        ctr: e.ctr,
        purchases: e.purchases,
        profit: e.profit,
        avgLeadKqs: round1(avgLeadKqs),
      },
    };
  }).sort((a, b) => b.kqs - a.kqs);
}
