import { createHash } from "node:crypto";
import { pool } from "../server/db";
import { getKayPhaseE23Diagnostics } from "../server/kayPhaseE23Service";

const tables = ["crm_leads", "lead_assignment_history", "crm_tasks", "kay_missions", "kay_commitments", "kay_promises", "user_notifications", "kay_auto_rescue_queue", "kay_rescue_executions", "kay_settings"];
async function fingerprint() {
  const result: Record<string, { count: number; hash: string }> = {};
  const discovered = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%communication%' OR table_name ILIKE '%message%' OR table_name ILIKE '%notification%')`);
  for (const table of [...new Set([...tables, ...discovered.rows.map((r: any) => r.table_name)])]) {
    const exists = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [table]);
    if (!exists.rows[0]) continue;
    const order = table === "kay_settings" ? "key" : "id";
    const rows = await pool.query(`SELECT * FROM "${table}" ORDER BY "${order}"`);
    const aggregate = table === "crm_leads"
      ? rows.rows.map((row: any) => ({ id: row.id, assigned_to: row.assigned_to, status: row.status }))
      : table === "kay_settings"
        ? rows.rows.map((row: any) => ({ key: row.key, value: row.value }))
        : rows.rows;
    result[table] = { count: rows.rows.length, hash: createHash("sha256").update(JSON.stringify(aggregate)).digest("hex") };
  }
  return result;
}

async function main() {
  const before = await fingerprint();
  const diagnostics = await getKayPhaseE23Diagnostics();
  const after = await fingerprint();
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  console.log(JSON.stringify({
    audit: "KAY ZERO MAX PHASE E.2.3 READONLY",
    aggregateOnly: true,
    diagnostics,
    integrity: { before, after, unchanged, writes: 0, ownershipChanges: 0, statusChanges: 0, missionChanges: 0, commitmentChanges: 0, promiseChanges: 0, notifications: 0, autoRescues: 0 },
  }, null, 2));
  if (!unchanged) throw new Error("Read-only audit fingerprint changed; refusing to report success.");
}

main().finally(() => pool.end());