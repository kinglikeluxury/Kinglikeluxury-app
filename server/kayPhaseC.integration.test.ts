import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { ensureKayTables, pool } from "./db";
import { assertSafeKayMutationTestDatabase } from "./kayTestDatabaseSafety";
assertSafeKayMutationTestDatabase("kayPhaseC.integration");

before(async () => { await ensureKayTables(); });
after(async () => { await pool.end(); });

test("Phase C database has mission table and required idempotency/index contracts", async () => {
  const result = await pool.query(`SELECT
    to_regclass('public.kay_missions') IS NOT NULL AS table_ready,
    EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='kay_missions_employee_status_due_priority_idx') AS employee_index,
    EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='kay_missions_lead_type_status_idx') AS lead_index`);
  assert.deepEqual(result.rows[0], { table_ready:true, employee_index:true, lead_index:true });
});

test("Phase C concurrent mission creation has one idempotent winner", async () => {
  const key = `phase-c-integration:${Date.now()}:${Math.random()}`;
  try {
    const insert = () => pool.query(`INSERT INTO kay_missions
      (mission_type,priority,priority_score,reason_code,objective,suggested_action,idempotency_key)
      VALUES ('FOLLOW_UP_DUE','NORMAL',20,'test','test objective','open CRM', $1)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`, [key]);
    const [a,b] = await Promise.all([insert(),insert()]);
    assert.equal(a.rowCount! + b.rowCount!, 1);
  } finally { await pool.query(`DELETE FROM kay_missions WHERE idempotency_key=$1`, [key]); }
});