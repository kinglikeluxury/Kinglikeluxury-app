import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

/**
 * Production database connection.
 *
 * Uses ONLY the NEON_DATABASE_URL secret — a custom name that Replit's
 * deployment platform never overrides. DATABASE_URL and PG* variables
 * injected by Replit are intentionally ignored.
 */
const neonDatabaseUrl = process.env.NEON_DATABASE_URL;

// Safe startup log — confirms var is set without exposing credentials
{
  const url = process.env.NEON_DATABASE_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      console.log("[DB] ACTIVE_DB: SET");
      console.log("[DB] Host:", parsed.hostname);
      console.log("[DB] Database:", parsed.pathname.replace(/^\//, ""));
    } catch {
      console.log("[DB] ACTIVE_DB: SET (URL parse failed)");
    }
  } else {
    console.log("[DB] ACTIVE_DB: NOT SET");
  }
}

if (!neonDatabaseUrl) {
  throw new Error(
    'NEON_DATABASE_URL is not set. ' +
    'Add it to Replit Secrets with the full Neon connection string for ' +
    'ep-winter-paper-a4q7e6vy.us-east-1.aws.neon.tech.'
  );
}

export const pool = new Pool({
  connectionString: neonDatabaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err);
});

export const db = drizzle({ client: pool, schema });

/** Returns the active database host for logging. */
export function getActiveDbHost(): string {
  try {
    return new URL(neonDatabaseUrl!).hostname;
  } catch {
    return 'unknown';
  }
}

/** Returns the active database name for logging. */
export function getActiveDbName(): string {
  try {
    return new URL(neonDatabaseUrl!).pathname.replace('/', '');
  } catch {
    return 'unknown';
  }
}

/** Logs startup DB info: host, database, live table counts. */
export async function logDatabaseStatus(): Promise<void> {
  const client = await pool.connect();
  try {
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tables = tablesRes.rows.map((r: any) => r.table_name as string);

    const counts: Record<string, number> = {};
    for (const tbl of ['properties', 'projects', 'users', 'blog_posts']) {
      if (tables.includes(tbl)) {
        const r = await client.query(`SELECT COUNT(*) FROM "${tbl}"`);
        counts[tbl] = parseInt(r.rows[0].count, 10);
      }
    }

    console.log('');
    console.log('┌─────────────────────────────────────────────────────┐');
    console.log('│              DATABASE CONNECTION ACTIVE              │');
    console.log('├─────────────────────────────────────────────────────┤');
    console.log(`│  Host:       ${getActiveDbHost().padEnd(38)}│`);
    console.log(`│  Database:   ${getActiveDbName().padEnd(38)}│`);
    console.log(`│  Tables:     ${String(tables.length).padEnd(38)}│`);
    console.log('├─────────────────────────────────────────────────────┤');
    for (const [tbl, cnt] of Object.entries(counts)) {
      console.log(`│  ${tbl.padEnd(16)}  ${String(cnt).padStart(4)} rows${' '.repeat(27)}│`);
    }
    console.log('└─────────────────────────────────────────────────────┘');
    console.log('');
  } finally {
    client.release();
  }
}

/**
 * Creates performance indexes on crm_leads if they don't already exist.
 * Safe to run on every startup — all statements use IF NOT EXISTS.
 */
export async function ensureCrmIndexes(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE INDEX IF NOT EXISTS crm_leads_assigned_to_idx ON crm_leads(assigned_to);
      CREATE INDEX IF NOT EXISTS crm_leads_status_idx      ON crm_leads(status);
      CREATE INDEX IF NOT EXISTS crm_leads_phone_idx       ON crm_leads(phone);
      CREATE INDEX IF NOT EXISTS crm_leads_email_idx       ON crm_leads(email);
      CREATE INDEX IF NOT EXISTS crm_leads_lead_source_idx ON crm_leads(lead_source);
      CREATE INDEX IF NOT EXISTS crm_leads_created_at_idx  ON crm_leads(created_at DESC);
    `);
    console.log("[DB] CRM indexes ensured");
  } catch (err: any) {
    console.warn("[DB] Could not create CRM indexes:", err.message);
  } finally {
    client.release();
  }
}

/**
 * Creates the Meta Lead Ads import tables if they don't exist.
 * Safe to run on every startup — all statements use IF NOT EXISTS.
 */
export async function ensureMetaLeadsTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_import_queue (
        id               SERIAL PRIMARY KEY,
        meta_lead_id     TEXT NOT NULL UNIQUE,
        leadgen_id       TEXT NOT NULL,
        form_id          TEXT,
        page_id          TEXT,
        ad_id            TEXT,
        adgroup_id       TEXT,
        campaign_id      TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        retry_count      INTEGER NOT NULL DEFAULT 0,
        max_retries      INTEGER NOT NULL DEFAULT 3,
        raw_webhook_payload JSONB,
        lead_data        JSONB,
        crm_lead_id      INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
        error_message    TEXT,
        next_retry_at    TIMESTAMP,
        received_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        processed_at     TIMESTAMP,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS lead_import_audit_log (
        id               SERIAL PRIMARY KEY,
        queue_entry_id   INTEGER NOT NULL REFERENCES lead_import_queue(id) ON DELETE CASCADE,
        meta_lead_id     TEXT NOT NULL,
        action           TEXT NOT NULL,
        details          JSONB,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS lead_import_queue_meta_lead_id_idx  ON lead_import_queue(meta_lead_id);
      CREATE INDEX IF NOT EXISTS lead_import_queue_status_idx        ON lead_import_queue(status);
      CREATE INDEX IF NOT EXISTS lead_import_queue_received_at_idx   ON lead_import_queue(received_at DESC);
      CREATE INDEX IF NOT EXISTS lead_import_audit_log_queue_id_idx  ON lead_import_audit_log(queue_entry_id);
      CREATE INDEX IF NOT EXISTS lead_import_audit_log_meta_id_idx   ON lead_import_audit_log(meta_lead_id);
      CREATE INDEX IF NOT EXISTS lead_import_audit_log_created_at_idx ON lead_import_audit_log(created_at DESC);
    `);
    console.log("[DB] Meta leads tables ensured");
  } catch (err: any) {
    console.warn("[DB] Could not create meta leads tables:", err.message);
  } finally {
    client.release();
  }
}

/**
 * Creates the WhatsApp AI qualification tables and adds assignment-tracking
 * columns to crm_leads if they don't already exist.
 * Safe to run on every startup — all statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 */
export async function ensureWhatsappAiTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Assignment tracking columns on existing crm_leads table
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_at      TIMESTAMP;
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assigned_by      INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS assignment_history_json JSONB;

      -- WhatsApp AI conversations
      CREATE TABLE IF NOT EXISTS whatsapp_ai_conversations (
        id               SERIAL PRIMARY KEY,
        lead_id          INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
        client_phone     TEXT,
        status           TEXT NOT NULL DEFAULT 'draft',
        language         TEXT NOT NULL DEFAULT 'ar',
        qualification_json JSONB,
        priority_score   TEXT,
        handoff_reason   TEXT,
        last_message_at  TIMESTAMP,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- WhatsApp AI messages
      CREATE TABLE IF NOT EXISTS whatsapp_ai_messages (
        id               SERIAL PRIMARY KEY,
        conversation_id  INTEGER NOT NULL REFERENCES whatsapp_ai_conversations(id) ON DELETE CASCADE,
        sender           TEXT NOT NULL,
        message_text     TEXT NOT NULL,
        raw_payload_json JSONB,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- WhatsApp AI agent reports
      CREATE TABLE IF NOT EXISTS whatsapp_ai_agent_reports (
        id                       SERIAL PRIMARY KEY,
        lead_id                  INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
        assigned_agent_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        summary_text             TEXT,
        client_interest          TEXT,
        country                  TEXT,
        city                     TEXT,
        budget                   TEXT,
        property_type            TEXT,
        payment_method           TEXT,
        investment_goal          TEXT,
        buying_timeframe         TEXT,
        best_call_time           TEXT,
        priority_score           TEXT,
        recommended_next_action  TEXT,
        created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS whatsapp_ai_conv_lead_id_idx    ON whatsapp_ai_conversations(lead_id);
      CREATE INDEX IF NOT EXISTS whatsapp_ai_msg_conv_id_idx     ON whatsapp_ai_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS whatsapp_ai_report_lead_id_idx  ON whatsapp_ai_agent_reports(lead_id);
    `);
    console.log("[DB] WhatsApp AI tables ensured");
  } catch (err: any) {
    console.warn("[DB] Could not create WhatsApp AI tables:", err.message);
  } finally {
    client.release();
  }
}

/**
 * Creates all Developer Registration Center tables.
 * Safe to run on every startup — all statements use IF NOT EXISTS.
 */
export async function ensureDeveloperRegistrationTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Developer companies directory
      CREATE TABLE IF NOT EXISTS developer_companies (
        id                         SERIAL PRIMARY KEY,
        name                       TEXT NOT NULL,
        form_url                   TEXT,
        is_active                  BOOLEAN NOT NULL DEFAULT true,
        registration_interval_days INTEGER NOT NULL DEFAULT 40,
        registration_mode          TEXT NOT NULL DEFAULT 'manual',
        created_at                 TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at                 TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- Per-company field configuration (JSON-driven, no code change needed for new devs)
      CREATE TABLE IF NOT EXISTS developer_form_configs (
        id                    SERIAL PRIMARY KEY,
        developer_company_id  INTEGER NOT NULL REFERENCES developer_companies(id) ON DELETE CASCADE,
        config_json           JSONB,
        is_active             BOOLEAN NOT NULL DEFAULT true,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- One record per lead per developer company
      CREATE TABLE IF NOT EXISTS developer_registration_records (
        id                        SERIAL PRIMARY KEY,
        crm_lead_id               INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
        developer_company_id      INTEGER NOT NULL REFERENCES developer_companies(id) ON DELETE CASCADE,
        status                    TEXT NOT NULL DEFAULT 'pending',
        registration_payload_json JSONB,
        last_registered_at        TIMESTAMP,
        next_registration_at      TIMESTAMP,
        attempt_count             INTEGER NOT NULL DEFAULT 0,
        last_error                TEXT,
        protection_status         TEXT NOT NULL DEFAULT 'protected',
        created_at                TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- Audit log for every registration attempt
      CREATE TABLE IF NOT EXISTS developer_registration_attempts (
        id                    SERIAL PRIMARY KEY,
        registration_record_id INTEGER NOT NULL REFERENCES developer_registration_records(id) ON DELETE CASCADE,
        crm_lead_id           INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
        developer_company_id  INTEGER NOT NULL REFERENCES developer_companies(id) ON DELETE CASCADE,
        attempt_type          TEXT NOT NULL DEFAULT 'manual',
        status                TEXT NOT NULL DEFAULT 'success',
        payload_json          JSONB,
        result_message        TEXT,
        created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS dev_reg_records_lead_id_idx    ON developer_registration_records(crm_lead_id);
      CREATE INDEX IF NOT EXISTS dev_reg_records_company_id_idx ON developer_registration_records(developer_company_id);
      CREATE INDEX IF NOT EXISTS dev_reg_records_status_idx     ON developer_registration_records(status);
      CREATE INDEX IF NOT EXISTS dev_reg_attempts_record_idx    ON developer_registration_attempts(registration_record_id);
    `);

    // Seed Silk Development if not present
    const existing = await client.query(`SELECT id FROM developer_companies WHERE name='Silk Development' LIMIT 1`);
    if (existing.rows.length === 0) {
      const compResult = await client.query(`
        INSERT INTO developer_companies (name, form_url, is_active, registration_interval_days, registration_mode, created_at, updated_at)
        VALUES ('Silk Development', 'https://system.silkdevelopment.ge/custom/Broker/', true, 40, 'manual', NOW(), NOW())
        RETURNING id
      `);
      const silkId = compResult.rows[0].id;

      const silkConfig = {
        field_mappings: {
          clientType:    "Company",
          companyName:   "Kinglike Luxury",
          companyId:     "383838388383838383",
          companyPhone:  "591000058",
          companyEmail:  "info@kinglikeluxury.com",
          projectName:   "Silk Towers",
          totalBudget:   "150000",
          comment:       "We are in touch with him",
          contactEmail:  "info@kinglikeluxury.com",
          representative: "Aslan Glonti",
        },
        required_fields: ["contactName", "contactPhone"],
        default_values: { apartmentType: "" },
        payload_rules: {
          use_lead_full_name_as_contact_name: true,
          use_lead_phone_as_contact_phone:    true,
          generate_stable_contact_id:          true,
          contact_email_override:              "info@kinglikeluxury.com",
        },
        representative_settings: { name: "Aslan Glonti" },
        compatibility_checker_result: {
          can_auto_fill:             false,
          captcha_detected:          null,
          cloudflare_detected:       null,
          submit_button_detected:    null,
          required_fields_detected:  null,
          success_message_detected:  null,
          risk_level:                "medium",
          last_checked_at:           null,
          notes:                     "Phase 1 — manual workflow only",
        },
        risk_level: "medium",
        notes: "Silk Development — Broker registration portal (manual Phase 1)",
      };

      await client.query(`
        INSERT INTO developer_form_configs (developer_company_id, config_json, is_active, created_at, updated_at)
        VALUES ($1, $2, true, NOW(), NOW())
      `, [silkId, JSON.stringify(silkConfig)]);

      console.log("[DeveloperRegistration] Seeded Silk Development");
    }

    console.log("[DB] Developer registration tables ensured");
  } catch (err: any) {
    console.warn("[DB] Could not create developer registration tables:", err.message);
  } finally {
    client.release();
  }
}

/**
 * Creates the WhatsApp API Chat History tables.
 * Additive only — never drops or modifies existing tables.
 */
export async function ensureWhatsAppApiTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_api_conversations (
        id                  SERIAL PRIMARY KEY,
        phone_number        TEXT NOT NULL UNIQUE,
        contact_name        TEXT,
        lead_id             INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,
        last_message_at     TIMESTAMP,
        last_message_preview TEXT,
        unread_count        INTEGER NOT NULL DEFAULT 0,
        source              TEXT NOT NULL DEFAULT 'unknown',
        assigned_agent_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS whatsapp_api_messages (
        id                SERIAL PRIMARY KEY,
        conversation_id   INTEGER NOT NULL REFERENCES whatsapp_api_conversations(id) ON DELETE CASCADE,
        direction         TEXT NOT NULL DEFAULT 'outbound',
        message_text      TEXT,
        message_type      TEXT NOT NULL DEFAULT 'text',
        wamid             TEXT,
        status            TEXT NOT NULL DEFAULT 'sent',
        context_label     TEXT,
        error_message     TEXT,
        raw_payload       JSONB,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS wa_api_conv_phone_idx        ON whatsapp_api_conversations(phone_number);
      CREATE INDEX IF NOT EXISTS wa_api_conv_last_msg_idx     ON whatsapp_api_conversations(last_message_at DESC);
      CREATE INDEX IF NOT EXISTS wa_api_conv_lead_idx         ON whatsapp_api_conversations(lead_id);
      CREATE INDEX IF NOT EXISTS wa_api_messages_conv_idx     ON whatsapp_api_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS wa_api_messages_created_idx  ON whatsapp_api_messages(created_at DESC);
      CREATE INDEX IF NOT EXISTS wa_api_messages_wamid_idx    ON whatsapp_api_messages(wamid);
    `);
    console.log("[DB] WhatsApp API chat tables ensured");
  } catch (err: any) {
    console.warn("[DB] Could not create WhatsApp API chat tables:", err.message);
  } finally {
    client.release();
  }
}

// ── WA Qualification Tables ───────────────────────────────────────────────────

export async function ensureWaQualTables(): Promise<void> {
  const client = await pool.connect();
  try {
    // Sessions table — one row per lead
    await client.query(`
      CREATE TABLE IF NOT EXISTS wa_qual_sessions (
        id                   SERIAL PRIMARY KEY,
        lead_id              INTEGER NOT NULL UNIQUE REFERENCES crm_leads(id) ON DELETE CASCADE,
        phone                TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'idle',
        current_question     TEXT,
        last_message_at      TIMESTAMPTZ,
        last_outbound_wamid  TEXT,
        retry_count          INTEGER NOT NULL DEFAULT 0,
        invalid_input_count  INTEGER NOT NULL DEFAULT 0,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at         TIMESTAMPTZ
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_qual_sessions_phone  ON wa_qual_sessions (phone)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_wa_qual_sessions_status ON wa_qual_sessions (status)`);

    // Answers table — one row per question per session (upsert by session_id+question_key)
    await client.query(`
      CREATE TABLE IF NOT EXISTS wa_qual_answers (
        id                SERIAL PRIMARY KEY,
        session_id        INTEGER NOT NULL REFERENCES wa_qual_sessions(id) ON DELETE CASCADE,
        question_key      TEXT NOT NULL,
        raw_input         TEXT,
        normalised_value  TEXT,
        input_method      TEXT NOT NULL DEFAULT 'text',
        received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (session_id, question_key)
      )
    `);

    // Summaries table — computed on completion
    await client.query(`
      CREATE TABLE IF NOT EXISTS wa_qual_summaries (
        id            SERIAL PRIMARY KEY,
        session_id    INTEGER NOT NULL UNIQUE REFERENCES wa_qual_sessions(id) ON DELETE CASCADE,
        qual_score    TEXT NOT NULL,
        score_reason  TEXT,
        summary_text  TEXT,
        generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Extra columns on crm_leads (idempotent)
    await client.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS qualification_status    TEXT    DEFAULT 'none'`);
    await client.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS qualification_score     TEXT`);
    await client.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS qualification_summary   TEXT`);
    await client.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS preferred_contact_time  TEXT`);
    await client.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS qualified_at          TIMESTAMPTZ`);
    await client.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS opt_out_wa            BOOLEAN NOT NULL DEFAULT FALSE`);
    // AI Lead Scoring columns (safe — idempotent)
    await client.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS ai_score            INTEGER`);
    await client.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS ai_score_category   TEXT`);
    await client.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS ai_score_reason     TEXT`);
    await client.query(`ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS ai_score_updated_at TIMESTAMPTZ`);

    console.log("[DB] ensureWaQualTables ✓");
  } catch (err: any) {
    console.error("[DB] ensureWaQualTables error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureAiMarketingTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_campaign_plans (
        id                  SERIAL PRIMARY KEY,
        name                TEXT NOT NULL,
        related_project_id  INTEGER,
        related_property_id INTEGER,
        target_country      TEXT,
        language            TEXT,
        daily_budget        NUMERIC,
        objective           TEXT DEFAULT 'Lead Form',
        status              TEXT DEFAULT 'draft',
        notes               TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_creatives (
        id                SERIAL PRIMARY KEY,
        campaign_plan_id  INTEGER REFERENCES ai_marketing_campaign_plans(id) ON DELETE SET NULL,
        primary_text      TEXT,
        headline          TEXT,
        description       TEXT,
        image_notes       TEXT,
        video_notes       TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_audiences (
        id                SERIAL PRIMARY KEY,
        campaign_plan_id  INTEGER REFERENCES ai_marketing_campaign_plans(id) ON DELETE SET NULL,
        country           TEXT,
        city_region       TEXT,
        language          TEXT,
        age_min           INTEGER DEFAULT 18,
        age_max           INTEGER DEFAULT 65,
        interests         TEXT,
        exclusions        TEXT,
        notes             TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_performance_snapshots (
        id                    SERIAL PRIMARY KEY,
        campaign_plan_id      INTEGER REFERENCES ai_marketing_campaign_plans(id) ON DELETE SET NULL,
        meta_campaign_id      TEXT,
        meta_ad_set_id        TEXT,
        meta_ad_id            TEXT,
        campaign_name         TEXT,
        ad_set_name           TEXT,
        ad_name               TEXT,
        spend                 NUMERIC DEFAULT 0,
        leads_count           INTEGER DEFAULT 0,
        cpl                   NUMERIC DEFAULT 0,
        ctr                   NUMERIC DEFAULT 0,
        cpc                   NUMERIC DEFAULT 0,
        hot_leads             INTEGER DEFAULT 0,
        warm_leads            INTEGER DEFAULT 0,
        cold_leads            INTEGER DEFAULT 0,
        no_answer_count       INTEGER DEFAULT 0,
        appointments_count    INTEGER DEFAULT 0,
        sales_count           INTEGER DEFAULT 0,
        cost_per_hot_lead     NUMERIC DEFAULT 0,
        cost_per_appointment  NUMERIC DEFAULT 0,
        cost_per_sale         NUMERIC DEFAULT 0,
        snapshot_date         DATE DEFAULT CURRENT_DATE,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_recommendations (
        id                      SERIAL PRIMARY KEY,
        performance_snapshot_id INTEGER REFERENCES ai_marketing_performance_snapshots(id) ON DELETE SET NULL,
        type                    TEXT NOT NULL,
        title                   TEXT NOT NULL,
        message                 TEXT NOT NULL,
        severity                TEXT DEFAULT 'info',
        is_dismissed            BOOLEAN DEFAULT FALSE,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_safety_settings (
        id                        SERIAL PRIMARY KEY,
        manual_approval_required  BOOLEAN NOT NULL DEFAULT TRUE,
        auto_launch               BOOLEAN NOT NULL DEFAULT FALSE,
        auto_pause                BOOLEAN NOT NULL DEFAULT FALSE,
        auto_budget_increase      BOOLEAN NOT NULL DEFAULT FALSE,
        max_daily_budget_limit    NUMERIC DEFAULT 100,
        require_admin_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO ai_marketing_safety_settings (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);
    console.log("[DB] ensureAiMarketingTables ✓");
  } catch (err: any) {
    console.error("[DB] ensureAiMarketingTables error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureAiMarketingRevenueTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_lead_attribution (
        id                  SERIAL PRIMARY KEY,
        lead_id             INTEGER NOT NULL,
        source_type         TEXT DEFAULT 'meta_lead',
        meta_campaign_id    TEXT,
        meta_campaign_name  TEXT,
        meta_adset_id       TEXT,
        meta_adset_name     TEXT,
        meta_ad_id          TEXT,
        meta_ad_name        TEXT,
        creative_name       TEXT,
        audience_name       TEXT,
        language            TEXT,
        country             TEXT,
        city                TEXT,
        notes               TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_lead_journey_events (
        id          SERIAL PRIMARY KEY,
        lead_id     INTEGER NOT NULL,
        event_type  TEXT NOT NULL,
        event_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        old_value   TEXT,
        new_value   TEXT,
        created_by  TEXT,
        notes       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_sales_outcomes (
        id                    SERIAL PRIMARY KEY,
        lead_id               INTEGER NOT NULL UNIQUE,
        appointment_scheduled BOOLEAN DEFAULT FALSE,
        appointment_date      DATE,
        site_visit_completed  BOOLEAN DEFAULT FALSE,
        sale_closed           BOOLEAN DEFAULT FALSE,
        sale_amount           NUMERIC DEFAULT 0,
        sale_currency         TEXT DEFAULT 'USD',
        sale_date             DATE,
        notes                 TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_quality_snapshots (
        id                       SERIAL PRIMARY KEY,
        lead_id                  INTEGER NOT NULL,
        lead_score               TEXT,
        lead_temperature         TEXT,
        lead_status              TEXT,
        no_answer_count          INTEGER DEFAULT 0,
        qualification_completed  BOOLEAN DEFAULT FALSE,
        whatsapp_started         BOOLEAN DEFAULT FALSE,
        whatsapp_completed       BOOLEAN DEFAULT FALSE,
        snapshot_time            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_marketing_learning_history (
        id                   SERIAL PRIMARY KEY,
        entity_type          TEXT NOT NULL,
        entity_name          TEXT NOT NULL,
        entity_id            TEXT,
        leads_count          INTEGER DEFAULT 0,
        hot_count            INTEGER DEFAULT 0,
        warm_count           INTEGER DEFAULT 0,
        cold_count           INTEGER DEFAULT 0,
        no_answer_count      INTEGER DEFAULT 0,
        appointments_count   INTEGER DEFAULT 0,
        sales_count          INTEGER DEFAULT 0,
        revenue_total        NUMERIC DEFAULT 0,
        spend                NUMERIC DEFAULT 0,
        cpl                  NUMERIC DEFAULT 0,
        cost_per_hot_lead    NUMERIC DEFAULT 0,
        cost_per_appointment NUMERIC DEFAULT 0,
        cost_per_sale        NUMERIC DEFAULT 0,
        quality_score        NUMERIC DEFAULT 0,
        period_start         DATE,
        period_end           DATE,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("[DB] ensureAiMarketingRevenueTables ✓");
  } catch (err: any) {
    console.error("[DB] ensureAiMarketingRevenueTables error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureAiCampaignAttributionTables(): Promise<void> {
  const client = await pool.connect();
  try {
    // Table 1 — per-lead attribution snapshot (campaign data captured from CRM leads)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_campaign_attribution (
        id              SERIAL PRIMARY KEY,
        crm_lead_id     INTEGER REFERENCES crm_leads(id) ON DELETE CASCADE,
        campaign_id     TEXT,
        campaign_name   TEXT,
        adset_id        TEXT,
        adset_name      TEXT,
        ad_id           TEXT,
        ad_name         TEXT,
        form_name       TEXT,
        lead_source     TEXT DEFAULT 'meta_lead',
        attributed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ai_camp_attr_crm_lead_id_idx
        ON ai_campaign_attribution(crm_lead_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ai_camp_attr_campaign_name_idx
        ON ai_campaign_attribution(campaign_name)
    `);

    // Table 2 — cached aggregated performance per campaign entity
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_campaign_performance (
        id                  SERIAL PRIMARY KEY,
        entity_type         TEXT NOT NULL DEFAULT 'campaign',
        entity_name         TEXT NOT NULL,
        entity_id           TEXT,
        leads_count         INTEGER DEFAULT 0,
        hot_leads           INTEGER DEFAULT 0,
        warm_leads          INTEGER DEFAULT 0,
        cold_leads          INTEGER DEFAULT 0,
        no_answer_count     INTEGER DEFAULT 0,
        appointments_count  INTEGER DEFAULT 0,
        sales_count         INTEGER DEFAULT 0,
        revenue_total       NUMERIC DEFAULT 0,
        last_computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ai_camp_perf_entity_type_idx
        ON ai_campaign_performance(entity_type)
    `);

    // Table 3 — per-lead outcome snapshot for attribution analysis
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_campaign_outcomes (
        id              SERIAL PRIMARY KEY,
        attribution_id  INTEGER REFERENCES ai_campaign_attribution(id) ON DELETE CASCADE,
        crm_lead_id     INTEGER REFERENCES crm_leads(id) ON DELETE CASCADE,
        outcome_status  TEXT,
        outcome_score   TEXT,
        is_hot          BOOLEAN DEFAULT FALSE,
        is_appointment  BOOLEAN DEFAULT FALSE,
        is_sale         BOOLEAN DEFAULT FALSE,
        sale_value      NUMERIC DEFAULT 0,
        recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ai_camp_outcomes_crm_lead_id_idx
        ON ai_campaign_outcomes(crm_lead_id)
    `);

    console.log("[DB] ensureAiCampaignAttributionTables ✓");
  } catch (err: any) {
    console.error("[DB] ensureAiCampaignAttributionTables error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureAiCreativeAttributionTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_creative_attribution (
        id              SERIAL PRIMARY KEY,
        creative_id     TEXT,
        creative_name   TEXT,
        ad_id           TEXT NOT NULL,
        ad_name         TEXT,
        adset_id        TEXT,
        adset_name      TEXT,
        campaign_id     TEXT,
        campaign_name   TEXT,
        thumbnail_url   TEXT,
        status          TEXT,
        last_synced_at  TIMESTAMPTZ DEFAULT NOW(),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT ai_creative_attribution_ad_id_uq UNIQUE (ad_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS ai_creative_attr_campaign_id_idx ON ai_creative_attribution(campaign_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS ai_creative_attr_creative_id_idx ON ai_creative_attribution(creative_id)`);
    console.log("[DB] ensureAiCreativeAttributionTable ✓");
  } catch (err: any) {
    console.error("[DB] ensureAiCreativeAttributionTable error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureAiCreativeDraftsTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_creative_drafts (
        id                  SERIAL PRIMARY KEY,
        draft_type          TEXT NOT NULL,
        project_name        TEXT,
        target_market       TEXT,
        language            TEXT,
        draft_text          TEXT NOT NULL,
        inspiration_source  TEXT,
        related_campaign_id TEXT,
        related_creative_id TEXT,
        quality_reason      TEXT,
        goal                TEXT,
        confidence_level    TEXT DEFAULT 'low',
        status              TEXT NOT NULL DEFAULT 'draft',
        created_by          TEXT DEFAULT 'admin',
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS ai_creative_drafts_status_idx ON ai_creative_drafts(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS ai_creative_drafts_created_at_idx ON ai_creative_drafts(created_at DESC)`);
    console.log("[DB] ensureAiCreativeDraftsTable ✓");
  } catch (err: any) {
    console.error("[DB] ensureAiCreativeDraftsTable error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      const isConnectionError =
        error.code === '57P01' ||
        error.code === '57P03' ||
        error.code === '08006' ||
        error.code === '08S01' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'EAI_AGAIN' ||
        error.message?.includes('Connection terminated') ||
        error.message?.includes('WebSocket closed') ||
        error.message?.includes('SQL client must be connected') ||
        error.message?.includes('server closed the connection unexpectedly');

      if (isConnectionError && attempt < maxRetries) {
        console.warn(`[DB] Operation failed (attempt ${attempt}/${maxRetries}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        continue;
      }

      throw error;
    }
  }

  throw lastError!;
}
