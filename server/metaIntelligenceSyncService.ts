/**
 * metaIntelligenceSyncService.ts
 *
 * READ-ONLY Meta Marketing Intelligence sync service.
 * Pulls Meta campaign data and stores snapshots in meta_intelligence_* tables.
 *
 * ALL Meta API calls are GET-only. No writes to Meta whatsoever.
 * No CRM, WhatsApp, email, or any other system is touched.
 */

import { pool } from "./db";
import {
  getCampaigns,
  getAdSets,
  getAds,
  getInsights,
  getInsightsBreakdowns,
  parseAdSetTargeting,
  parseLeadCount,
  parseLeadCPL,
  type BreakdownType,
} from "./metaMarketingService";

// ── Table creation ─────────────────────────────────────────────────────────────

export async function ensureMetaIntelligenceTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_intelligence_campaigns (
      id               SERIAL PRIMARY KEY,
      meta_campaign_id TEXT NOT NULL UNIQUE,
      name             TEXT,
      status           TEXT,
      objective        TEXT,
      daily_budget     BIGINT,
      lifetime_budget  BIGINT,
      start_time       TIMESTAMPTZ,
      stop_time        TIMESTAMPTZ,
      created_time     TIMESTAMPTZ,
      updated_time     TIMESTAMPTZ,
      synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_json         JSONB
    );

    CREATE TABLE IF NOT EXISTS meta_intelligence_adsets (
      id                  SERIAL PRIMARY KEY,
      meta_adset_id       TEXT NOT NULL UNIQUE,
      meta_campaign_id    TEXT,
      name                TEXT,
      status              TEXT,
      daily_budget        BIGINT,
      lifetime_budget     BIGINT,
      billing_event       TEXT,
      bid_amount          BIGINT,
      optimization_goal   TEXT,
      age_min             INT,
      age_max             INT,
      genders             TEXT,
      countries           TEXT,
      regions             TEXT,
      cities              TEXT,
      languages           TEXT,
      interests           TEXT,
      excluded_interests  TEXT,
      publisher_platforms TEXT,
      facebook_positions  TEXT,
      instagram_positions TEXT,
      device_platforms    TEXT,
      created_time        TIMESTAMPTZ,
      updated_time        TIMESTAMPTZ,
      synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_targeting_json  JSONB,
      raw_json            JSONB
    );

    CREATE TABLE IF NOT EXISTS meta_intelligence_ads (
      id                SERIAL PRIMARY KEY,
      meta_ad_id        TEXT NOT NULL UNIQUE,
      meta_adset_id     TEXT,
      meta_campaign_id  TEXT,
      name              TEXT,
      status            TEXT,
      effective_status  TEXT,
      creative_id       TEXT,
      creative_name     TEXT,
      body              TEXT,
      title             TEXT,
      image_url         TEXT,
      image_hash        TEXT,
      video_id          TEXT,
      link_url          TEXT,
      call_to_action    TEXT,
      thumbnail_url     TEXT,
      created_time      TIMESTAMPTZ,
      updated_time      TIMESTAMPTZ,
      synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_creative_json JSONB,
      raw_json          JSONB
    );

    CREATE TABLE IF NOT EXISTS meta_intelligence_insights (
      id                   SERIAL PRIMARY KEY,
      entity_type          TEXT NOT NULL,
      meta_campaign_id     TEXT NOT NULL DEFAULT '',
      meta_adset_id        TEXT NOT NULL DEFAULT '',
      meta_ad_id           TEXT NOT NULL DEFAULT '',
      date_start           DATE,
      date_stop            DATE,
      impressions          BIGINT,
      reach                BIGINT,
      clicks               BIGINT,
      spend                NUMERIC(14,4),
      cpc                  NUMERIC(14,4),
      cpm                  NUMERIC(14,4),
      ctr                  NUMERIC(10,4),
      leads                INT,
      cost_per_lead        NUMERIC(14,4),
      actions_json         JSONB,
      cost_per_action_json JSONB,
      synced_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_json             JSONB,
      UNIQUE(entity_type, meta_campaign_id, meta_adset_id, meta_ad_id, date_start, date_stop)
    );

    CREATE TABLE IF NOT EXISTS meta_intelligence_breakdowns (
      id              SERIAL PRIMARY KEY,
      entity_type     TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      breakdown_type  TEXT NOT NULL,
      breakdown_value TEXT NOT NULL,
      date_start      DATE,
      date_stop       DATE,
      impressions     BIGINT,
      reach           BIGINT,
      clicks          BIGINT,
      spend           NUMERIC(14,4),
      leads           INT,
      cost_per_lead   NUMERIC(14,4),
      synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_json        JSONB,
      UNIQUE(entity_type, entity_id, breakdown_type, breakdown_value, date_start, date_stop)
    );

    CREATE TABLE IF NOT EXISTS meta_intelligence_sync_log (
      id               SERIAL PRIMARY KEY,
      sync_started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sync_finished_at TIMESTAMPTZ,
      status           TEXT NOT NULL DEFAULT 'running',
      campaigns_count  INT DEFAULT 0,
      adsets_count     INT DEFAULT 0,
      ads_count        INT DEFAULT 0,
      insights_count   INT DEFAULT 0,
      breakdowns_count INT DEFAULT 0,
      error_message    TEXT,
      duration_ms      INT
    );
  `);

  console.log("[MetaIntelligence] Tables ensured.");
}

// ── Sync result type ───────────────────────────────────────────────────────────

export interface MetaSyncResult {
  ok:              boolean;
  campaigns_count: number;
  adsets_count:    number;
  ads_count:       number;
  insights_count:  number;
  breakdowns_count:number;
  duration_ms:     number;
  errors:          string[];
  sync_log_id:     number | null;
}

// ── Main sync function (idempotent UPSERT) ─────────────────────────────────────

export async function syncMetaIntelligence(): Promise<MetaSyncResult> {
  const startedAt   = Date.now();
  const errors:string[] = [];
  let logId: number | null = null;

  let campaigns_count  = 0;
  let adsets_count     = 0;
  let ads_count        = 0;
  let insights_count   = 0;
  let breakdowns_count = 0;

  // ── Write sync log start row ────────────────────────────────────────────────
  try {
    const logRow = await pool.query(
      `INSERT INTO meta_intelligence_sync_log (status) VALUES ('running') RETURNING id`
    );
    logId = logRow.rows[0]?.id ?? null;
  } catch (e: any) {
    console.error("[MetaIntelligence] Sync log insert failed:", e.message);
  }

  // ── Step 1: Campaigns ───────────────────────────────────────────────────────
  console.log("[MetaIntelligence] Step 1 — pulling campaigns…");
  try {
    const result = await getCampaigns(200);
    if (!result.ok) {
      errors.push(`campaigns: ${result.error}`);
    } else {
      for (const c of result.data) {
        await pool.query(`
          INSERT INTO meta_intelligence_campaigns
            (meta_campaign_id, name, status, objective,
             daily_budget, lifetime_budget,
             start_time, stop_time, created_time, updated_time,
             synced_at, raw_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
          ON CONFLICT (meta_campaign_id) DO UPDATE SET
            name            = EXCLUDED.name,
            status          = EXCLUDED.status,
            objective       = EXCLUDED.objective,
            daily_budget    = EXCLUDED.daily_budget,
            lifetime_budget = EXCLUDED.lifetime_budget,
            start_time      = EXCLUDED.start_time,
            stop_time       = EXCLUDED.stop_time,
            created_time    = EXCLUDED.created_time,
            updated_time    = EXCLUDED.updated_time,
            synced_at       = NOW(),
            raw_json        = EXCLUDED.raw_json
        `, [
          String(c.id),
          c.name ?? null,
          c.status ?? null,
          c.objective ?? null,
          c.daily_budget    ? parseInt(c.daily_budget,    10) : null,
          c.lifetime_budget ? parseInt(c.lifetime_budget, 10) : null,
          c.start_time  ? new Date(c.start_time)  : null,
          c.stop_time   ? new Date(c.stop_time)   : null,
          c.created_time? new Date(c.created_time): null,
          c.updated_time? new Date(c.updated_time): null,
          JSON.stringify(c),
        ]);
        campaigns_count++;
      }
      console.log(`[MetaIntelligence] Campaigns upserted: ${campaigns_count}`);
    }
  } catch (e: any) {
    errors.push(`campaigns exception: ${e.message}`);
    console.error("[MetaIntelligence] Campaigns error:", e.message);
  }

  // ── Step 2: Ad Sets with targeting parse ────────────────────────────────────
  console.log("[MetaIntelligence] Step 2 — pulling ad sets…");
  try {
    const result = await getAdSets(200);
    if (!result.ok) {
      errors.push(`adsets: ${result.error}`);
    } else {
      for (const s of result.data) {
        const t = parseAdSetTargeting(s.targeting);
        await pool.query(`
          INSERT INTO meta_intelligence_adsets
            (meta_adset_id, meta_campaign_id, name, status,
             daily_budget, lifetime_budget, billing_event, bid_amount, optimization_goal,
             age_min, age_max, genders, countries, regions, cities, languages,
             interests, excluded_interests, publisher_platforms,
             facebook_positions, instagram_positions, device_platforms,
             created_time, updated_time,
             synced_at, raw_targeting_json, raw_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW(),$25,$26)
          ON CONFLICT (meta_adset_id) DO UPDATE SET
            meta_campaign_id    = EXCLUDED.meta_campaign_id,
            name                = EXCLUDED.name,
            status              = EXCLUDED.status,
            daily_budget        = EXCLUDED.daily_budget,
            lifetime_budget     = EXCLUDED.lifetime_budget,
            billing_event       = EXCLUDED.billing_event,
            bid_amount          = EXCLUDED.bid_amount,
            optimization_goal   = EXCLUDED.optimization_goal,
            age_min             = EXCLUDED.age_min,
            age_max             = EXCLUDED.age_max,
            genders             = EXCLUDED.genders,
            countries           = EXCLUDED.countries,
            regions             = EXCLUDED.regions,
            cities              = EXCLUDED.cities,
            languages           = EXCLUDED.languages,
            interests           = EXCLUDED.interests,
            excluded_interests  = EXCLUDED.excluded_interests,
            publisher_platforms = EXCLUDED.publisher_platforms,
            facebook_positions  = EXCLUDED.facebook_positions,
            instagram_positions = EXCLUDED.instagram_positions,
            device_platforms    = EXCLUDED.device_platforms,
            created_time        = EXCLUDED.created_time,
            updated_time        = EXCLUDED.updated_time,
            synced_at           = NOW(),
            raw_targeting_json  = EXCLUDED.raw_targeting_json,
            raw_json            = EXCLUDED.raw_json
        `, [
          String(s.id),
          s.campaign_id ? String(s.campaign_id) : null,
          s.name ?? null,
          s.status ?? null,
          s.daily_budget    ? parseInt(s.daily_budget,    10) : null,
          s.lifetime_budget ? parseInt(s.lifetime_budget, 10) : null,
          s.billing_event   ?? null,
          s.bid_amount      ? parseInt(s.bid_amount, 10) : null,
          s.optimization_goal ?? null,
          t.age_min,
          t.age_max,
          t.genders,
          t.countries,
          t.regions,
          t.cities,
          t.languages,
          t.interests,
          t.excluded_interests,
          t.publisher_platforms,
          t.facebook_positions,
          t.instagram_positions,
          t.device_platforms,
          s.created_time ? new Date(s.created_time) : null,
          s.updated_time ? new Date(s.updated_time) : null,
          s.targeting ? JSON.stringify(s.targeting) : null,
          JSON.stringify(s),
        ]);
        adsets_count++;
      }
      console.log(`[MetaIntelligence] Ad sets upserted: ${adsets_count}`);
    }
  } catch (e: any) {
    errors.push(`adsets exception: ${e.message}`);
    console.error("[MetaIntelligence] Ad sets error:", e.message);
  }

  // ── Step 3: Ads with creative details ───────────────────────────────────────
  console.log("[MetaIntelligence] Step 3 — pulling ads + creatives…");
  try {
    const result = await getAds(200);
    if (!result.ok) {
      errors.push(`ads: ${result.error}`);
    } else {
      for (const a of result.data) {
        const cr = a.creative ?? {};
        const cta = cr.call_to_action
          ? (typeof cr.call_to_action === "object"
              ? (cr.call_to_action.type ?? JSON.stringify(cr.call_to_action))
              : String(cr.call_to_action))
          : null;

        await pool.query(`
          INSERT INTO meta_intelligence_ads
            (meta_ad_id, meta_adset_id, meta_campaign_id, name, status, effective_status,
             creative_id, creative_name, body, title,
             image_url, image_hash, video_id, link_url, call_to_action, thumbnail_url,
             created_time, updated_time,
             synced_at, raw_creative_json, raw_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),$19,$20)
          ON CONFLICT (meta_ad_id) DO UPDATE SET
            meta_adset_id    = EXCLUDED.meta_adset_id,
            meta_campaign_id = EXCLUDED.meta_campaign_id,
            name             = EXCLUDED.name,
            status           = EXCLUDED.status,
            effective_status = EXCLUDED.effective_status,
            creative_id      = EXCLUDED.creative_id,
            creative_name    = EXCLUDED.creative_name,
            body             = EXCLUDED.body,
            title            = EXCLUDED.title,
            image_url        = EXCLUDED.image_url,
            image_hash       = EXCLUDED.image_hash,
            video_id         = EXCLUDED.video_id,
            link_url         = EXCLUDED.link_url,
            call_to_action   = EXCLUDED.call_to_action,
            thumbnail_url    = EXCLUDED.thumbnail_url,
            created_time     = EXCLUDED.created_time,
            updated_time     = EXCLUDED.updated_time,
            synced_at        = NOW(),
            raw_creative_json= EXCLUDED.raw_creative_json,
            raw_json         = EXCLUDED.raw_json
        `, [
          String(a.id),
          a.adset_id    ? String(a.adset_id)    : null,
          a.campaign_id ? String(a.campaign_id) : null,
          a.name ?? null,
          a.status ?? null,
          a.effective_status ?? null,
          cr.id   ? String(cr.id)   : null,
          cr.name ?? null,
          cr.body ?? null,
          cr.title ?? null,
          cr.image_url  ?? null,
          cr.image_hash ?? null,
          cr.video_id   ?? null,
          cr.link_url   ?? null,
          cta,
          cr.thumbnail_url ?? null,
          a.created_time ? new Date(a.created_time) : null,
          a.updated_time ? new Date(a.updated_time) : null,
          cr.id ? JSON.stringify(cr) : null,
          JSON.stringify(a),
        ]);
        ads_count++;
      }
      console.log(`[MetaIntelligence] Ads upserted: ${ads_count}`);
    }
  } catch (e: any) {
    errors.push(`ads exception: ${e.message}`);
    console.error("[MetaIntelligence] Ads error:", e.message);
  }

  // ── Step 4: Insights at campaign / adset / ad level ─────────────────────────
  console.log("[MetaIntelligence] Step 4 — pulling insights…");
  const insightLevels: Array<{ level: "campaign"|"adset"|"ad"; entityType: string; idField: string }> = [
    { level: "campaign", entityType: "campaign", idField: "campaign_id" },
    { level: "adset",    entityType: "adset",    idField: "adset_id" },
    { level: "ad",       entityType: "ad",       idField: "ad_id" },
  ];
  for (const { level, entityType, idField } of insightLevels) {
    try {
      const result = await getInsights({ datePreset: "last_30d", level, limit: 200 });
      if (!result.ok) {
        errors.push(`insights(${level}): ${result.error}`);
        continue;
      }
      for (const row of result.data) {
        const leads = parseLeadCount(row.actions ?? []);
        const cpl   = parseLeadCPL(row.cost_per_action_type ?? []);
        await pool.query(`
          INSERT INTO meta_intelligence_insights
            (entity_type, meta_campaign_id, meta_adset_id, meta_ad_id,
             date_start, date_stop,
             impressions, reach, clicks, spend, cpc, cpm, ctr,
             leads, cost_per_lead,
             actions_json, cost_per_action_json,
             synced_at, raw_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),$18)
          ON CONFLICT (entity_type, meta_campaign_id, meta_adset_id, meta_ad_id, date_start, date_stop)
          DO UPDATE SET
            impressions          = EXCLUDED.impressions,
            reach                = EXCLUDED.reach,
            clicks               = EXCLUDED.clicks,
            spend                = EXCLUDED.spend,
            cpc                  = EXCLUDED.cpc,
            cpm                  = EXCLUDED.cpm,
            ctr                  = EXCLUDED.ctr,
            leads                = EXCLUDED.leads,
            cost_per_lead        = EXCLUDED.cost_per_lead,
            actions_json         = EXCLUDED.actions_json,
            cost_per_action_json = EXCLUDED.cost_per_action_json,
            synced_at            = NOW(),
            raw_json             = EXCLUDED.raw_json
        `, [
          entityType,
          row.campaign_id ? String(row.campaign_id) : '',
          row.adset_id    ? String(row.adset_id)    : '',
          row.ad_id       ? String(row.ad_id)       : '',
          row.date_start ? new Date(row.date_start) : null,
          row.date_stop  ? new Date(row.date_stop)  : null,
          row.impressions ? parseInt(row.impressions, 10) : null,
          row.reach       ? parseInt(row.reach,       10) : null,
          row.clicks      ? parseInt(row.clicks,      10) : null,
          row.spend       ? parseFloat(row.spend)         : null,
          row.cpc         ? parseFloat(row.cpc)           : null,
          row.cpm         ? parseFloat(row.cpm)           : null,
          row.ctr         ? parseFloat(row.ctr)           : null,
          leads,
          cpl,
          row.actions               ? JSON.stringify(row.actions)               : null,
          row.cost_per_action_type  ? JSON.stringify(row.cost_per_action_type)  : null,
          JSON.stringify(row),
        ]);
        insights_count++;
      }
      console.log(`[MetaIntelligence] Insights(${level}) upserted: ${result.data.length}`);
    } catch (e: any) {
      errors.push(`insights(${level}) exception: ${e.message}`);
      console.error(`[MetaIntelligence] Insights(${level}) error:`, e.message);
    }
  }

  // ── Step 5: Breakdowns — age, gender, country, device_platform ──────────────
  console.log("[MetaIntelligence] Step 5 — pulling breakdowns…");
  const breakdownTypes: BreakdownType[] = ["age", "gender", "country", "device_platform"];
  for (const bk of breakdownTypes) {
    try {
      const result = await getInsightsBreakdowns(bk, "last_30d", "campaign", 200);
      if (!result.ok) {
        errors.push(`breakdown(${bk}): ${result.error}`);
        continue;
      }
      for (const row of result.data) {
        const entityId = row.campaign_id ? String(row.campaign_id) : "unknown";
        const bkValue  = row[bk] ?? "unknown";
        const leads    = parseLeadCount(row.actions ?? []);
        const cpl      = parseLeadCPL(row.cost_per_action_type ?? []);
        await pool.query(`
          INSERT INTO meta_intelligence_breakdowns
            (entity_type, entity_id, breakdown_type, breakdown_value,
             date_start, date_stop,
             impressions, reach, clicks, spend,
             leads, cost_per_lead,
             synced_at, raw_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),$13)
          ON CONFLICT (entity_type, entity_id, breakdown_type, breakdown_value, date_start, date_stop)
          DO UPDATE SET
            impressions   = EXCLUDED.impressions,
            reach         = EXCLUDED.reach,
            clicks        = EXCLUDED.clicks,
            spend         = EXCLUDED.spend,
            leads         = EXCLUDED.leads,
            cost_per_lead = EXCLUDED.cost_per_lead,
            synced_at     = NOW(),
            raw_json      = EXCLUDED.raw_json
        `, [
          "campaign",
          entityId,
          bk,
          String(bkValue),
          row.date_start ? new Date(row.date_start) : null,
          row.date_stop  ? new Date(row.date_stop)  : null,
          row.impressions ? parseInt(row.impressions, 10) : null,
          row.reach       ? parseInt(row.reach,       10) : null,
          row.clicks      ? parseInt(row.clicks,      10) : null,
          row.spend       ? parseFloat(row.spend)         : null,
          leads,
          cpl,
          JSON.stringify(row),
        ]);
        breakdowns_count++;
      }
      console.log(`[MetaIntelligence] Breakdown(${bk}) upserted: ${result.data.length}`);
    } catch (e: any) {
      errors.push(`breakdown(${bk}) exception: ${e.message}`);
      console.error(`[MetaIntelligence] Breakdown(${bk}) error:`, e.message);
    }
  }

  // ── Finalise sync log ────────────────────────────────────────────────────────
  const duration_ms = Date.now() - startedAt;
  const ok = errors.length === 0;

  if (logId) {
    try {
      await pool.query(`
        UPDATE meta_intelligence_sync_log SET
          sync_finished_at = NOW(),
          status           = $1,
          campaigns_count  = $2,
          adsets_count     = $3,
          ads_count        = $4,
          insights_count   = $5,
          breakdowns_count = $6,
          error_message    = $7,
          duration_ms      = $8
        WHERE id = $9
      `, [
        ok ? "completed" : "completed_with_errors",
        campaigns_count,
        adsets_count,
        ads_count,
        insights_count,
        breakdowns_count,
        errors.length > 0 ? errors.join(" | ") : null,
        duration_ms,
        logId,
      ]);
    } catch (e: any) {
      console.error("[MetaIntelligence] Sync log update failed:", e.message);
    }
  }

  console.log(
    `[MetaIntelligence] Sync complete — ` +
    `campaigns=${campaigns_count} adsets=${adsets_count} ads=${ads_count} ` +
    `insights=${insights_count} breakdowns=${breakdowns_count} ` +
    `duration=${duration_ms}ms errors=${errors.length}`
  );

  return {
    ok,
    campaigns_count,
    adsets_count,
    ads_count,
    insights_count,
    breakdowns_count,
    duration_ms,
    errors,
    sync_log_id: logId,
  };
}

// ── Latest sync status helper ─────────────────────────────────────────────────

export async function getLatestSyncStatus(): Promise<any | null> {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM meta_intelligence_sync_log ORDER BY id DESC LIMIT 1`
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function getSyncCounts(): Promise<Record<string, number>> {
  try {
    const queries = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM meta_intelligence_campaigns`),
      pool.query(`SELECT COUNT(*) FROM meta_intelligence_adsets`),
      pool.query(`SELECT COUNT(*) FROM meta_intelligence_ads`),
      pool.query(`SELECT COUNT(*) FROM meta_intelligence_insights`),
      pool.query(`SELECT COUNT(*) FROM meta_intelligence_breakdowns`),
    ]);
    return {
      campaigns:  parseInt(queries[0].rows[0].count, 10),
      adsets:     parseInt(queries[1].rows[0].count, 10),
      ads:        parseInt(queries[2].rows[0].count, 10),
      insights:   parseInt(queries[3].rows[0].count, 10),
      breakdowns: parseInt(queries[4].rows[0].count, 10),
    };
  } catch {
    return { campaigns: 0, adsets: 0, ads: 0, insights: 0, breakdowns: 0 };
  }
}
