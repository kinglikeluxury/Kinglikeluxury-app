import { readFileSync } from "node:fs";
import pg from "pg";
import { assertSafeKayMutationTestDatabase } from "../server/kayTestDatabaseSafety";

type Inventory = {
  tables: string[];
  indexes: string[];
  functions: string[];
  triggers: string[];
  columns: string[];
};

const suite = "complete-kay-test-schema";
const forbiddenCredentialChannels = [
  "NEON_DATABASE_URL",
  "DATABASE_URL",
  "PGHOST",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "PGPORT",
];

for (const key of forbiddenCredentialChannels) {
  if (process.env[key]) {
    throw new Error(`[${suite}] ${key} must be removed from the schema executor environment`);
  }
}

const safe = assertSafeKayMutationTestDatabase(suite);
if (process.env.KAY_TEST_DATABASE_USER !== "kay_test_owner") {
  throw new Error(`[${suite}] KAY_TEST_DATABASE_USER must be exactly kay_test_owner`);
}

const source = readFileSync(new URL("../server/db.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function ensureKayTables");
const end = source.indexOf("export async function ensureMetaLeadsTables", start);
if (start < 0 || end < 0) throw new Error(`[${suite}] Kay bootstrap source boundary was not found`);
const bootstrap = source.slice(start, end);
const unique = (values: string[]) => [...new Set(values)].sort();
const inventory: Inventory = {
  tables: unique([
    ...[...bootstrap.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-zA-Z0-9_]+)/g)].map(match => match[1]),
    "kay_runtime_state",
    "crm_notes",
    "crm_projects",
    "crm_tasks",
    "user_notifications",
  ]),
  indexes: unique([...bootstrap.matchAll(/CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)?\s+([a-zA-Z0-9_]+)/g)].map(match => match[1])),
  functions: unique([...bootstrap.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-zA-Z0-9_]+)/g)].map(match => match[1])),
  triggers: unique([...bootstrap.matchAll(/CREATE TRIGGER\s+([a-zA-Z0-9_]+)/g)].map(match => match[1])),
  columns: unique([
    ...[...bootstrap.matchAll(/ALTER TABLE\s+([a-zA-Z0-9_]+)\s+ADD COLUMN IF NOT EXISTS\s+([a-zA-Z0-9_]+)/g)]
      .map(match => `${match[1]}.${match[2]}`),
    "users.password",
    "crm_leads.first_name",
    "crm_leads.full_name",
    "crm_leads.status",
    "crm_leads.notes",
    "crm_leads.updated_at",
    "crm_leads.wa_stage",
    "kay_settings.updated_by",
    "kay_settings.updated_at",
  ]),
};

const client = new pg.Pool({ connectionString: process.env.KAY_TEST_DATABASE_URL, max: 1 });

async function inspect() {
  const queries: Record<keyof Inventory, string> = {
    tables: `SELECT tablename name FROM pg_tables
      WHERE schemaname='public' AND tablename=ANY($1::text[])`,
    indexes: `SELECT indexname name FROM pg_indexes
      WHERE schemaname='public' AND indexname=ANY($1::text[])`,
    functions: `SELECT p.proname name FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=ANY($1::text[])`,
    triggers: `SELECT tgname name FROM pg_trigger
      WHERE NOT tgisinternal AND tgname=ANY($1::text[])`,
    columns: `SELECT table_name||'.'||column_name name FROM information_schema.columns
      WHERE table_schema='public' AND table_name||'.'||column_name=ANY($1::text[])`,
  };
  const missing = {} as Inventory;
  for (const category of Object.keys(inventory) as (keyof Inventory)[]) {
    const result = await client.query(queries[category], [inventory[category]]);
    const present = new Set(result.rows.map(row => String(row.name)));
    missing[category] = inventory[category].filter(name => !present.has(name));
  }
  const defaults = await client.query(`SELECT column_name,column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='crm_leads'
      AND column_name=ANY($1::text[])`, [["lead_source", "created_at", "updated_at"]]);
  const defaultByColumn = new Map(defaults.rows.map(row => [String(row.column_name), row.column_default]));
  const missingDefaults = ["lead_source", "created_at", "updated_at"]
    .filter(column => !defaultByColumn.get(column))
    .map(column => `crm_leads.${column}:default`);
  return {
    missing,
    missingDefaults,
    count: Object.values(missing).reduce((total, names) => total + names.length, 0) + missingDefaults.length,
  };
}

try {
  const identity = await client.query(`SELECT current_database() database, current_user username`);
  const active = identity.rows[0];
  if (active?.database !== "kay_testing") {
    throw new Error(`[${suite}] connected database must be exactly kay_testing`);
  }
  if (active?.username !== "kay_test_owner") {
    throw new Error(`[${suite}] connected user must be exactly kay_test_owner`);
  }

  const before = await inspect();
  if (before.count > 0) {
    await client.query("BEGIN");
    try {
      await client.query(`
        CREATE SEQUENCE IF NOT EXISTS kay_test_users_id_seq;
        ALTER SEQUENCE kay_test_users_id_seq OWNED BY users.id;
        SELECT setval('kay_test_users_id_seq', COALESCE((SELECT MAX(id) FROM users),0)+1, false);
        ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('kay_test_users_id_seq');
        ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS kay_test_users_username_unique_idx ON users(username);

        CREATE SEQUENCE IF NOT EXISTS kay_test_crm_leads_id_seq;
        ALTER SEQUENCE kay_test_crm_leads_id_seq OWNED BY crm_leads.id;
        SELECT setval('kay_test_crm_leads_id_seq', COALESCE((SELECT MAX(id) FROM crm_leads),0)+1, false);
        ALTER TABLE crm_leads ALTER COLUMN id SET DEFAULT nextval('kay_test_crm_leads_id_seq');
        ALTER TABLE crm_leads ALTER COLUMN lead_source SET DEFAULT 'manual';
        ALTER TABLE crm_leads ALTER COLUMN created_at SET DEFAULT NOW();
        ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS first_name TEXT;
        ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS full_name TEXT;
        ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new';
        ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
        ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS wa_stage TEXT DEFAULT 'new_lead';

        CREATE TABLE IF NOT EXISTS crm_tasks (
          id SERIAL PRIMARY KEY,
          lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          due_date TEXT,
          due_time TEXT,
          priority TEXT DEFAULT 'medium',
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          completed_at TIMESTAMP,
          reminder_sent_at TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS crm_notes (
          id SERIAL PRIMARY KEY,
          lead_id INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          note TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS crm_projects (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS user_notifications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          data JSONB,
          idempotency_key TEXT,
          is_read BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
        ALTER TABLE kay_settings ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE kay_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
      `);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    const { ensureKayTables, pool } = await import("../server/db");
    await ensureKayTables();
    await pool.query(`CREATE TABLE IF NOT EXISTS kay_runtime_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.end();
  }
  const after = await inspect();
  if (after.count !== 0) {
    throw new Error(`[${suite}] ${after.count} required schema objects remain missing`);
  }
  console.log(JSON.stringify({
    status: "PASS",
    database: safe.database,
    user: active.username,
    endpointOverlap: false,
    expectedObjectCount: Object.values(inventory).reduce((total, names) => total + names.length, 0) + 3,
    missingObjectCount: before.count,
    createdObjectCount: before.count - after.count,
    remainingMissingObjectCount: after.count,
  }));
} finally {
  await client.end();
}