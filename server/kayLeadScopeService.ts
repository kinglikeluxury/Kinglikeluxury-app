import { pool } from "./db";

/** Kay's fixed, non-rolling operational boundary. */
export const KAY_OPERATIONAL_LAUNCH_AT = "2026-09-09T00:00:00+04:00";
export const KAY_OPERATIONAL_TIMEZONE = "Asia/Tbilisi";
export const KAY_OPERATIONAL_SETTING_KEY = "kay_operational_launch_at";
export const KAY_TRUSTED_BUSINESS_DATE_SOURCES = ["ORIGINAL_BUSINESS_TIMESTAMP", "TRUSTED_SOURCE_CREATED_AT"] as const;
export const KAY_SCOPE_OUTCOMES = [
  "IN_KAY_SCOPE",
  "OUT_OF_SCOPE_LEGACY",
  "EXCLUDED_OWNER",
  "LEGACY_DATE_UNCERTAIN",
  "CONFIGURATION_MISSING",
  "CONFIGURATION_INVALID",
] as const;
export type KayScopeOutcome = typeof KAY_SCOPE_OUTCOMES[number];

export type KayScopeConfig = {
  launchAt: Date;
  launchAtIso: string;
  cutoffAt: Date;
  cutoffAtIso: string;
  timezone: typeof KAY_OPERATIONAL_TIMEZONE;
};
export type KayLeadForScope = {
  createdAt?: Date | string | null;
  businessReceivedAt?: Date | string | null;
  businessReceivedAtSource?: string | null;
  leadSource?: string | null;
  owner?: { username?: string | null; role?: string | null; isActive?: boolean | null; isAdmin?: boolean | null } | null;
};

const ISO_WITH_TBILISI_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+04:00$/;
const TRUSTED_DIRECT_SOURCES = new Set(["meta", "website", "whatsapp", "manual", "phone", "referral"]);
const IMPORT_LIKE = /(?:^|[_\-\s])(excel|csv|import|migration|admin|legacy|backfill|seed|system)(?:$|[_\-\s])/i;
const TERMINAL = ["lost", "converted", "purchased", "sold_by_kinglike_luxury", "junk_lead", "not_qualified"];

/** Calendar arithmetic, deliberately not a duration/90-day subtraction. */
export function kayCalendarMonthsBefore(value: Date, months: number): Date {
  const d = new Date(value.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

function parseLaunch(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_WITH_TBILISI_OFFSET.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildKayScopeConfig(value: unknown): KayScopeConfig | null {
  const launch = parseLaunch(value);
  if (!launch) return null;
  const cutoff = kayCalendarMonthsBefore(launch, 3);
  return {
    launchAt: launch,
    launchAtIso: launch.toISOString(),
    cutoffAt: cutoff,
    cutoffAtIso: cutoff.toISOString(),
    timezone: KAY_OPERATIONAL_TIMEZONE,
  };
}

export function classifyKayOwner(owner: KayLeadForScope["owner"]): boolean {
  return !!owner && owner.isActive !== false && owner.isAdmin !== true &&
    owner.username?.toLowerCase() !== "kinglike_admin" && owner.role === "sub_agent";
}

function authoritativeDate(lead: KayLeadForScope): Date | null {
  const source = String(lead.leadSource || "").trim().toLowerCase();
  if (lead.businessReceivedAt != null) {
    const value = new Date(lead.businessReceivedAt);
    // Provenance is mandatory when a business date overrides CRM creation.
    if ((KAY_TRUSTED_BUSINESS_DATE_SOURCES as readonly string[]).includes(String(lead.businessReceivedAtSource)) && !Number.isNaN(value.getTime())) return value;
    return null;
  }
  if (IMPORT_LIKE.test(source) || (source && !TRUSTED_DIRECT_SOURCES.has(source) && /(?:file|upload|admin)/i.test(source))) return null;
  return lead.createdAt == null ? null : (() => {
    const value = new Date(lead.createdAt!);
    return Number.isNaN(value.getTime()) ? null : value;
  })();
}

export function classifyKayLead(lead: KayLeadForScope, config: KayScopeConfig | null): KayScopeOutcome {
  if (!config) return "CONFIGURATION_MISSING";
  if (!classifyKayOwner(lead.owner)) return "EXCLUDED_OWNER";
  const received = authoritativeDate(lead);
  if (!received) return "LEGACY_DATE_UNCERTAIN";
  // The initial cohort is fixed forever: cutoff <= received, with no upper bound.
  return received >= config.cutoffAt ? "IN_KAY_SCOPE" : "OUT_OF_SCOPE_LEGACY";
}

export type KayScopeExecutor = { query: (sql: string, values?: unknown[]) => Promise<any> };

export async function getKayScopeConfig(executor: KayScopeExecutor = pool): Promise<KayScopeConfig | null> {
  const result = await executor.query(
    `SELECT value FROM kay_settings WHERE key=$1`,
    [KAY_OPERATIONAL_SETTING_KEY],
  );
  return buildKayScopeConfig(result.rows[0]?.value);
}

export async function getKayScopeConfiguration(executor: KayScopeExecutor = pool) {
  const result = await executor.query(`SELECT value FROM kay_settings WHERE key=$1`, [KAY_OPERATIONAL_SETTING_KEY]);
  if (!result.rows[0]) return { status: "CONFIGURATION_MISSING" as const, config: null };
  const config = buildKayScopeConfig(result.rows[0].value);
  return config
    ? { status: "OK" as const, config }
    : { status: "CONFIGURATION_INVALID" as const, config: null };
}

export async function getKayOperationalScopeAdminView(executor: KayScopeExecutor = pool) {
  const configuration = await getKayScopeConfiguration(executor);
  const audit = await executor.query(`SELECT a.id,a.old_value,a.new_value,a.launch_at,a.timezone,a.cutoff_at,a.created_at,
      u.username AS actor_username
    FROM kay_operational_launch_audit a LEFT JOIN users u ON u.id=a.actor_admin_id
    ORDER BY a.created_at DESC,a.id DESC LIMIT 100`);
  return {
    status: configuration.status,
    config: configuration.config,
    audit: audit.rows.map((row: any) => ({
      id: row.id, oldValue: row.old_value, newValue: row.new_value,
      launchAt: row.launch_at, timezone: row.timezone, cutoffAt: row.cutoff_at,
      createdAt: row.created_at, actor: row.actor_username || "Admin",
    })),
  };
}

/** SQL fragments used by every Kay lead query. Never replace this with NOW()-90 days. */
export function kayScopeSql(alias = "l", ownerAlias = "owner", launchParam = "$1") {
  const date = `(CASE WHEN ${alias}.business_received_at IS NOT NULL AND ${alias}.business_received_at_source IN ('ORIGINAL_BUSINESS_TIMESTAMP','TRUSTED_SOURCE_CREATED_AT') THEN ${alias}.business_received_at WHEN COALESCE(lower(${alias}.lead_source),'') !~ '(excel|csv|import|migration|admin|legacy|backfill|seed|system)' THEN (${alias}.created_at AT TIME ZONE 'UTC') ELSE NULL END)`;
  const owner = `${ownerAlias}.is_active=true AND ${ownerAlias}.is_admin=false AND ${ownerAlias}.role='sub_agent' AND lower(${ownerAlias}.username) <> 'kinglike_admin'`;
  return {
    ownerEligible: owner, authoritativeDate: date,
    inScope: `(${date} >= ${launchParam}::timestamptz)`,
    outcomeCase: `(CASE WHEN NOT (${owner}) THEN 'EXCLUDED_OWNER' WHEN ${date} IS NULL THEN 'LEGACY_DATE_UNCERTAIN' WHEN ${date} < ${launchParam}::timestamptz THEN 'OUT_OF_SCOPE_LEGACY' ELSE 'IN_KAY_SCOPE' END)`,
    terminal: TERMINAL,
  };
}

export async function getKayScopeForLead(executor: KayScopeExecutor, leadId: number): Promise<{ outcome: KayScopeOutcome; config: KayScopeConfig | null }> {
  const configuration = await getKayScopeConfiguration(executor);
  const config = configuration.config;
  const result = await executor.query(`SELECT l.created_at,l.business_received_at,l.business_received_at_source,l.lead_source,
      u.username,u.role,u.is_active,u.is_admin
    FROM crm_leads l LEFT JOIN users u ON u.id=l.assigned_to WHERE l.id=$1`, [leadId]);
  if (configuration.status !== "OK") return { outcome: configuration.status, config };
  if (!result.rows[0]) return { outcome: "LEGACY_DATE_UNCERTAIN", config };
  const row = result.rows[0];
  return {
    config,
    outcome: classifyKayLead({
      createdAt: row.created_at, businessReceivedAt: row.business_received_at,
      businessReceivedAtSource: row.business_received_at_source, leadSource: row.lead_source,
      owner: { username: row.username, role: row.role, isActive: row.is_active, isAdmin: row.is_admin },
    }, config),
  };
}

export async function setKayOperationalLaunchAt(adminId: number, value: unknown, confirmChange = false) {
  const config = buildKayScopeConfig(value);
  if (!config) throw Object.assign(new Error("Launch date must be an ISO timestamp with the Asia/Tbilisi +04:00 offset."), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('kay:e24-control'))`);
    const admin = await client.query(
      `SELECT id FROM users WHERE id=$1 AND is_admin=true AND is_active=true FOR SHARE`, [adminId],
    );
    if (!admin.rows[0]) throw Object.assign(new Error("Kay Admin required."), { status: 403 });
    const existing = await client.query(
      `SELECT value FROM kay_settings WHERE key=$1 FOR UPDATE`, [KAY_OPERATIONAL_SETTING_KEY],
    );
    const oldValue = existing.rows[0]?.value ?? null;
    const oldConfig = buildKayScopeConfig(typeof oldValue === "string" ? oldValue : null);
    if (oldConfig?.launchAtIso === config.launchAtIso) {
      await client.query("COMMIT");
      return { ...config, changed: false, idempotent: true };
    }
    if (oldValue !== null && !confirmChange) {
      throw Object.assign(new Error("Changing the operational launch date requires explicit confirmation."), { status: 409 });
    }
    await client.query(
      `INSERT INTO kay_settings(key,value,updated_by,updated_at) VALUES($1,$2::jsonb,$3,NOW())
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [KAY_OPERATIONAL_SETTING_KEY, JSON.stringify(value), adminId],
    );
    await client.query(
      `INSERT INTO kay_operational_launch_audit(actor_admin_id,old_value,new_value,launch_at,timezone,cutoff_at)
       VALUES($1,$2::jsonb,$3::jsonb,$4,$5,$6)`,
      [adminId, JSON.stringify(oldValue), JSON.stringify(value), config.launchAt, config.timezone, config.cutoffAt],
    );
    await client.query("COMMIT");
    return { ...config, changed: true, idempotent: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
