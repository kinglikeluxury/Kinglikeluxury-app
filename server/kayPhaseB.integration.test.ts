import test, { after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db";
import { claimKayEvaluationQueue } from "./kayService";

after(async () => {
  await pool.end();
});

test("Phase B database has the isolated status trigger and unique decision event index", async () => {
  const result = await pool.query(`
    SELECT
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='kay_crm_lead_status_entry_trigger' AND NOT tgisinternal) AS trigger_ready,
      EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='kay_decisions_event_id_unique_idx') AS unique_index_ready
  `);
  assert.deepEqual(result.rows[0], { trigger_ready: true, unique_index_ready: true });
});

test("concurrent queue claims cannot claim the same Kay job", async () => {
  const seed = Math.floor(Date.now() % 100_000_000);
  const ids = [-2_000_000_000 + seed * 2, -2_000_000_000 + seed * 2 + 1];
  const keys = ids.map(id => `integration-claim:${id}`);
  try {
    await pool.query(
      `INSERT INTO kay_evaluator_queue (id, queue_key, lead_id, status, available_at)
       VALUES ($1,$2,NULL,'pending',NOW()-interval '1 hour'),($3,$4,NULL,'pending',NOW()-interval '1 hour')`,
      [ids[0], keys[0], ids[1], keys[1]],
    );
    const [a, b] = await Promise.all([claimKayEvaluationQueue(1), claimKayEvaluationQueue(1)]);
    const claimed = [a[0]?.id, b[0]?.id].sort((x, y) => Number(x) - Number(y));
    assert.deepEqual(claimed, [...ids].sort((x, y) => x - y));
  } finally {
    await pool.query(`DELETE FROM kay_evaluator_queue WHERE queue_key = ANY($1::text[])`, [keys]);
  }
});