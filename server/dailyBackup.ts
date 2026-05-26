/**
 * DAILY AUTOMATIC BACKUP SERVICE
 * Runs every day at 2:00 AM and exports a full SQL + JSON backup
 * of all production tables to the /backups directory.
 *
 * READ-ONLY — never modifies any data.
 */
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { pool, getActiveDbHost, getActiveDbName } from "./db";

const BACKUP_DIR = path.join(process.cwd(), "backups");

const esc = (v: any): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === "object") {
    return `'${JSON.stringify(v).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
  }
  return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
};

export async function runBackup(): Promise<string> {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const sqlFile   = path.join(BACKUP_DIR, `auto-backup-${timestamp}.sql`);

  const client = await pool.connect();
  const lines: string[] = [];

  try {
    const dbHost = getActiveDbHost();
    const dbName = getActiveDbName();

    lines.push(`-- ================================================================`);
    lines.push(`-- KINGLIKE LUXURY — AUTOMATIC DAILY BACKUP`);
    lines.push(`-- Date:     ${new Date().toISOString()}`);
    lines.push(`-- Host:     ${dbHost}`);
    lines.push(`-- Database: ${dbName}`);
    lines.push(`-- ================================================================`);
    lines.push(``);
    lines.push(`SET client_encoding = 'UTF8';`);
    lines.push(`SET standard_conforming_strings = on;`);
    lines.push(``);
    lines.push(`BEGIN;`);
    lines.push(``);

    // Tables to back up (ordered to respect FK dependencies)
    const backupTables = [
      "users", "properties", "projects", "blog_posts",
      "payments", "contact_logs", "notification_templates",
      "notification_logs", "verification_codes",
      "consultation_time_slots", "consultation_bookings",
      "ai_conversations", "ai_messages", "investor_profiles",
      "ai_lead_scores", "user_notifications", "push_subscriptions",
    ];

    // Get actual existing tables
    const existingRes = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const existing = new Set(existingRes.rows.map((r: any) => r.table_name));

    const rowCounts: Record<string, number> = {};
    let totalRows = 0;
    let totalInserts = 0;

    for (const tbl of backupTables) {
      if (!existing.has(tbl)) continue;

      const dataRes = await client.query(`SELECT * FROM "${tbl}" ORDER BY 1`);
      rowCounts[tbl] = dataRes.rows.length;
      totalRows += dataRes.rows.length;

      lines.push(`-- ── ${tbl} (${dataRes.rows.length} rows) ──`);

      if (dataRes.rows.length === 0) {
        lines.push(`-- (no data)`);
        lines.push(``);
        continue;
      }

      const cols = Object.keys(dataRes.rows[0]);
      for (const row of dataRes.rows) {
        const safeRow: any = { ...row };
        if ("password" in safeRow && safeRow.password && safeRow.password !== "[REDACTED]") {
          safeRow.password = "[REDACTED]";
        }
        const vals = cols.map(c => esc(safeRow[c]));
        lines.push(
          `INSERT INTO "${tbl}" (${cols.map(c => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")}) ON CONFLICT DO NOTHING;`
        );
        totalInserts++;
      }
      lines.push(``);
    }

    lines.push(`COMMIT;`);
    lines.push(``);

    // Reset sequences
    const seqRes = await client.query(`
      SELECT sequencename, last_value, start_value
      FROM pg_sequences WHERE schemaname = 'public'
    `);
    if (seqRes.rows.length > 0) {
      lines.push(`-- ── Sequences ──`);
      for (const seq of seqRes.rows) {
        const val = seq.last_value ?? seq.start_value;
        lines.push(`SELECT setval('"${seq.sequencename}"', ${val}, true);`);
      }
      lines.push(``);
    }

    lines.push(`-- ================================================================`);
    lines.push(`-- SUMMARY: ${totalInserts} INSERT statements | ${totalRows} total rows`);
    for (const [tbl, cnt] of Object.entries(rowCounts)) {
      lines.push(`--   ${tbl.padEnd(35)} ${String(cnt).padStart(4)} rows`);
    }
    lines.push(`-- ================================================================`);

    fs.writeFileSync(sqlFile, lines.join("\n"), "utf-8");

    // Keep only last 7 daily backups to save disk space
    const allBackups = fs
      .readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("auto-backup-") && f.endsWith(".sql"))
      .sort()
      .reverse();

    for (const old of allBackups.slice(7)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
      console.log(`[DailyBackup] Removed old backup: ${old}`);
    }

    const sizeKB = (fs.statSync(sqlFile).size / 1024).toFixed(1);
    console.log(`[DailyBackup] ✅ Backup saved: ${path.basename(sqlFile)} (${sizeKB} KB, ${totalInserts} INSERTs)`);
    return sqlFile;

  } finally {
    client.release();
  }
}

export function startDailyBackup(): void {
  // Run every day at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    console.log("[DailyBackup] Starting scheduled backup...");
    try {
      await runBackup();
    } catch (err) {
      console.error("[DailyBackup] Backup failed:", err);
    }
  });

  console.log("[DailyBackup] Scheduled — runs daily at 2:00 AM");
}
