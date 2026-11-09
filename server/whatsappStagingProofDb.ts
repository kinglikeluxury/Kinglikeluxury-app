import pg from "pg";
import { stagingDatabaseIsIsolated } from "./stagingExternalGuard";
import { stagingSignupPolicy } from "./whatsappStagingOnboardingRoutes";

/**
 * Only the separate Railway WhatsApp proof database is allowed.
 * Never reuse the app's Staging DB, Neon, or a browser-provided connection URL.
 */
export const EXPECTED_WA_PROOF_SERVICE_ID = "3991af5c-76a5-4739-926f-60c11f5cfd68";
export const WA_PROOF_SCHEMA = "kinglike_whatsapp";

export type ProofDbConfig = {
  url: string;
  expectedHost: string;
  expectedName: string;
};

function dbIdentity(raw: string | undefined): { host: string; name: string } | null {
  try {
    const url = new URL(raw ?? "");
    if (!["postgresql:", "postgres:"].includes(url.protocol)) return null;
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!name || !url.hostname) return null;
    return { host: url.hostname.toLowerCase(), name: name.toLowerCase() };
  } catch {
    return null;
  }
}

export function resolveWhatsappProofDbConfig(env: NodeJS.ProcessEnv = process.env): ProofDbConfig | null {
  if (env.APP_DEPLOYMENT_MODE !== "staging" || !stagingDatabaseIsIsolated(env) ||
      env.WHATSAPP_STAGING_PROOF_SERVICE_ID !== EXPECTED_WA_PROOF_SERVICE_ID) return null;

  const raw = env.WHATSAPP_STAGING_PROOF_DATABASE_URL;
  const parsed = dbIdentity(raw);
  const expectedHost = env.WHATSAPP_STAGING_PROOF_EXPECTED_HOST?.trim().toLowerCase();
  const expectedName = env.WHATSAPP_STAGING_PROOF_EXPECTED_NAME?.trim().toLowerCase();
  const app = dbIdentity(env.APP_STAGING_DATABASE_URL);
  const neon = dbIdentity(env.NEON_DATABASE_URL);

  if (!raw || !parsed || !expectedHost || !expectedName || !app ||
      !expectedHost.endsWith(".railway.internal") ||
      parsed.host !== expectedHost || parsed.name !== expectedName ||
      parsed.host === app.host || parsed.host === neon?.host ||
      parsed.host === env.PRODUCTION_DATABASE_HOST?.toLowerCase()) return null;

  try {
    const url = new URL(raw);
    if (!url.username || !url.password || url.searchParams.has("options")) return null;
    return { url: raw, expectedHost, expectedName };
  } catch {
    return null;
  }
}

type QueryRows = { rows: Array<Record<string, unknown>> };
export type ProofDbClient = {
  query(text: string): Promise<QueryRows>;
  end(): Promise<void>;
};

/**
 * Identity and least-privilege preflight, no migration or data writes.
 * An owner/superuser connection is deliberately refused.
 */
export async function openWhatsappStagingProofDb(
  env: NodeJS.ProcessEnv = process.env,
  poolFactory: (config: ProofDbConfig) => ProofDbClient = config =>
    new pg.Pool({
      connectionString: config.url,
      max: 2,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 10_000,
      ssl: false, // Railway private-network PostgreSQL; no public endpoint.
    }) as ProofDbClient,
): Promise<ProofDbClient | null> {
  if (!stagingSignupPolicy(env)) return null;
  const config = resolveWhatsappProofDbConfig(env);
  if (!config) return null;

  let pool: ProofDbClient | undefined;
  try {
    pool = poolFactory(config);
    const identity = await pool.query("SELECT current_database() AS database_name, current_user AS runtime_role");
    const name = String(identity.rows[0]?.database_name ?? "").toLowerCase();
    const role = String(identity.rows[0]?.runtime_role ?? "");
    if (name !== config.expectedName || !role || role === "postgres") throw new Error("DB identity");

    const tables = await pool.query(
      "SELECT tablename, tableowner FROM pg_tables WHERE schemaname='kinglike_whatsapp' ORDER BY tablename",
    );
    if (tables.rows.length !== 2 ||
        String(tables.rows[0]?.tablename) !== "whatsapp_onboarding_flows" ||
        String(tables.rows[1]?.tablename) !== "whatsapp_onboarding_proofs" ||
        tables.rows.some(row => String(row.tableowner) === role)) {
      throw new Error("Proof tables are missing or runtime owns them");
    }

    const grants = await pool.query(
      "SELECT has_schema_privilege(current_user, 'kinglike_whatsapp', 'USAGE') AS schema_usage, " +
      "has_table_privilege(current_user, 'kinglike_whatsapp.whatsapp_onboarding_flows', 'SELECT, INSERT, UPDATE') AS flow_access, " +
      "has_table_privilege(current_user, 'kinglike_whatsapp.whatsapp_onboarding_proofs', 'SELECT, INSERT, UPDATE') AS proof_access",
    );
    if (grants.rows[0]?.schema_usage !== true ||
        grants.rows[0]?.flow_access !== true || grants.rows[0]?.proof_access !== true) {
      throw new Error("Runtime grants are missing");
    }
    return pool;
  } catch {
    // No hostnames, SQL errors, password or connection strings in logs.
    if (pool) {
      try { await pool.end(); } catch { /* best-effort cleanup */ }
    }
    return null;
  }
}
