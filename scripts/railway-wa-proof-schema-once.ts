import { SQL } from "bun";

/**
 * Isolated one-time migration of EMPTY WhatsApp proof tables only.
 * Runs as a private, short-lived Railway Function with a reference to the
 * dedicated Staging database, never to Kinglike's production Neon.
 * No web server, no external HTTP calls, no customer or employee data.
 */
const PROJECT_ID = "8386a5b5-4964-4b37-b2fa-e7177d78111e";
const ENV_ID = "6f8c2ee9-c6b5-47a9-9df1-f1b1aa632a78";
const DB_SERVICE_ID = "3991af5c-76a5-4739-926f-60c11f5cfd68";
const ENABLE_KEY = "KINGLIKE_WA_PROOF_SCHEMA_V1_APPLY";
const SCHEMA = "kinglike_whatsapp";

function stop(message: string): never {
  console.error("WA_PROOF_MIGRATION_REFUSED: " + message);
  process.exit(1);
}

if (Bun.env.WA_PROOF_MIGRATION_MODE !== ENABLE_KEY) {
  console.log("WA_PROOF_MIGRATION_DISABLED");
  process.exit(0);
}
if (Bun.env.RAILWAY_PROJECT_ID !== PROJECT_ID ||
    Bun.env.RAILWAY_ENVIRONMENT_ID !== ENV_ID ||
    Bun.env.WA_PROOF_DB_SERVICE_ID !== DB_SERVICE_ID) {
  stop("railway resource identity mismatch");
}

const urlString = Bun.env.WA_PROOF_DATABASE_URL;
const privateDomain = Bun.env.WA_PROOF_DB_PRIVATE_DOMAIN;
const dbName = Bun.env.WA_PROOF_DB_NAME;
if (!urlString || !privateDomain || !dbName) stop("dedicated private database reference missing");

let url: URL;
try { url = new URL(urlString); } catch { stop("invalid database connection reference"); }
if (!(url.protocol === "postgres:" || url.protocol === "postgresql:") ||
    url.hostname.toLowerCase() !== privateDomain.toLowerCase() ||
    !url.hostname.endsWith(".railway.internal") ||
    decodeURIComponent(url.pathname.replace(/^\/+/, "")) !== dbName ||
    !url.username || !url.password || !dbName || dbName === "neondb") {
  stop("database URL is not the exact dedicated private PostgreSQL service");
}

const sql = new SQL(urlString);
try {
  const identity = await sql`SELECT current_database() AS name`;
  if (identity.length !== 1 || identity[0].name !== dbName) {
    stop("database identity check failed");
  }
  const existing = await sql`
    SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'kinglike_whatsapp' AND table_type = 'BASE TABLE'
  `;
  if (existing.length > 0) {
    const actual = existing.map(x => String(x.table_name)).sort().join(",");
    if (actual !== "whatsapp_onboarding_flows,whatsapp_onboarding_proofs") {
      stop("unexpected existing objects; migration will not overwrite");
    }
    console.log("WA_PROOF_SCHEMA_ALREADY_PRESENT: validating existing schema only");
  } else {
    await sql.begin(async tx => {
      await tx.unsafe("CREATE SCHEMA IF NOT EXISTS kinglike_whatsapp");
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS kinglike_whatsapp.whatsapp_onboarding_proofs (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          business_portfolio_id TEXT NOT NULL CHECK (business_portfolio_id ~ '^[0-9]{5,80}$'),
          waba_id TEXT NOT NULL CHECK (waba_id ~ '^[0-9]{5,80}$'),
          phone_number_id TEXT NOT NULL UNIQUE CHECK (phone_number_id ~ '^[0-9]{5,80}$'),
          display_phone_number TEXT NOT NULL CHECK (display_phone_number ~ '^[+][1-9][0-9]{7,14}$'),
          ownership_verified BOOLEAN NOT NULL CHECK (ownership_verified),
          coexistence_verified BOOLEAN NOT NULL CHECK (coexistence_verified),
          permissions TEXT[] NOT NULL,
          verified_by BIGINT NOT NULL CHECK (verified_by > 0),
          verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ,
          revoked_by BIGINT,
          revocation_reason TEXT CHECK (revocation_reason IN ('owner_revoked','permission_lost')),
          CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
        )
      `);
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS kinglike_whatsapp.whatsapp_onboarding_flows (
          flow_id UUID PRIMARY KEY,
          actor_id BIGINT NOT NULL CHECK (actor_id > 0),
          session_hash TEXT NOT NULL CHECK (session_hash ~ '^[a-f0-9]{64}$'),
          origin TEXT NOT NULL,
          state_hash TEXT NOT NULL CHECK (state_hash ~ '^[a-f0-9]{64}$'),
          csrf_hash TEXT NOT NULL CHECK (csrf_hash ~ '^[a-f0-9]{64}$'),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ,
          CHECK (expires_at > created_at)
        )
      `);
      await tx.unsafe("CREATE INDEX IF NOT EXISTS whatsapp_onboarding_flows_expiry_idx ON kinglike_whatsapp.whatsapp_onboarding_flows(expires_at)");
    });
  }

  const checked = await sql`
    SELECT
       (SELECT count(*) FROM kinglike_whatsapp.whatsapp_onboarding_flows) AS flows,
       (SELECT count(*) FROM kinglike_whatsapp.whatsapp_onboarding_proofs) AS proofs,
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema='kinglike_whatsapp' AND table_type='BASE TABLE') AS tables
  `;
  if (checked.length !== 1 ||
      Number(checked[0].flows) !== 0 ||
      Number(checked[0].proofs) !== 0 ||
      Number(checked[0].tables) !== 2) {
    stop("post-migration empty-schema verification failed");
  }
  console.log("WA_PROOF_SCHEMA_V1_OK tables=2 flows=0 proofs=0 no_employee_numbers_connected=true");
} catch (error) {
  // Do not print provider/connection details, SQL errors or secrets.
  stop("database migration/query failed; inspect schema with an authorized database administrator");
} finally {
  await sql.close();
}
