import pg from "pg";
const { Pool } = pg;

const connString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const pool = new Pool({ connectionString: connString });

async function run() {
  const client = await pool.connect();
  try {
    console.log("[migrate-crm-v2] Starting migration...");

    // 1. Add new columns to crm_leads
    await client.query(`
      ALTER TABLE crm_leads
        ADD COLUMN IF NOT EXISTS interested_country TEXT,
        ADD COLUMN IF NOT EXISTS budget TEXT,
        ADD COLUMN IF NOT EXISTS expected_purchase_month TEXT,
        ADD COLUMN IF NOT EXISTS description TEXT;
    `);
    console.log("[migrate-crm-v2] ✅ crm_leads columns added");

    // 2. Create crm_projects table
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_projects (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order  INTEGER DEFAULT 0,
        created_at  TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    console.log("[migrate-crm-v2] ✅ crm_projects table created");

    // 3. Create crm_tasks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_tasks (
        id           SERIAL PRIMARY KEY,
        lead_id      INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
        title        TEXT NOT NULL,
        description  TEXT,
        due_date     TEXT,
        due_time     TEXT,
        priority     TEXT DEFAULT 'medium',
        created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        completed_at TIMESTAMP,
        created_at   TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    console.log("[migrate-crm-v2] ✅ crm_tasks table created");

    console.log("[migrate-crm-v2] ✅ Migration complete!");
  } catch (err) {
    console.error("[migrate-crm-v2] ❌ Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
