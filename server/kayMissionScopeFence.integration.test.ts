import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertSafeKayMutationTestDatabase } from "./kayTestDatabaseSafety";
import { KAY_MISSION_SCOPE_FENCE_SQL } from "./kayMissionScopeFenceSql";

neonConfig.webSocketConstructor = ws;
assertSafeKayMutationTestDatabase("kayMissionScopeFence.integration");

const pool = new Pool({ connectionString: process.env.KAY_TEST_DATABASE_URL, max: 4 });
const suffix = Math.floor(Date.now() % 100_000);
const oldEmployeeId = 2_000_000 + suffix * 3;
const newEmployeeId = oldEmployeeId + 1;
const leadId = oldEmployeeId + 2;
let priorSetting: unknown = undefined;
let hadPriorSetting = false;
const staleTable = `kay_scope_fence_stale_${suffix}`;

before(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT, role TEXT, is_active BOOLEAN, is_admin BOOLEAN
    );
    CREATE TABLE IF NOT EXISTS crm_leads (
      id INTEGER PRIMARY KEY, assigned_to INTEGER, created_at TIMESTAMP,
      business_received_at TIMESTAMPTZ, business_received_at_source TEXT, lead_source TEXT
    );
    CREATE TABLE IF NOT EXISTS kay_settings (
      key TEXT PRIMARY KEY, value JSONB NOT NULL
    )
  `);
  const previous = await pool.query(`SELECT value FROM kay_settings WHERE key='kay_operational_launch_at'`);
  hadPriorSetting = previous.rowCount === 1;
  priorSetting = previous.rows[0]?.value;
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES ('kay_operational_launch_at',$1::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify("2026-09-09T00:00:00+04:00")]);
  await pool.query(`INSERT INTO users(id,username,role,is_active,is_admin) VALUES
    ($1,'scope_fence_old','sub_agent',true,false),($2,'scope_fence_new','sub_agent',true,false)`,
  [oldEmployeeId, newEmployeeId]);
  await pool.query(`INSERT INTO crm_leads(id,assigned_to,created_at,lead_source)
    VALUES ($1,$2,'2026-08-01T00:00:00','manual')`, [leadId, oldEmployeeId]);
  await pool.query(KAY_MISSION_SCOPE_FENCE_SQL);
  await pool.query(`CREATE TABLE ${staleTable} (
    id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL, employee_id INTEGER NOT NULL, status TEXT NOT NULL
  )`);
});

after(async () => {
  await pool.query(`DELETE FROM crm_leads WHERE id=$1`, [leadId]);
  await pool.query(`DELETE FROM users WHERE id IN ($1,$2)`, [oldEmployeeId, newEmployeeId]);
  if (hadPriorSetting) {
    await pool.query(`UPDATE kay_settings SET value=$1::jsonb WHERE key='kay_operational_launch_at'`,
      [JSON.stringify(priorSetting)]);
  } else {
    await pool.query(`DELETE FROM kay_settings WHERE key='kay_operational_launch_at'`);
  }
  await pool.query(`DROP TABLE IF EXISTS ${staleTable}`);
  await pool.end();
});

test("mission scope fence serializes reassignment and rejects the former employee", async () => {
  const kay = await pool.connect();
  const crm = await pool.connect();
  const observer = await pool.connect();
  try {
    await kay.query("BEGIN");
    const allowed = await kay.query(`SELECT public.kay_lock_mission_scope($1,$2) AS allowed`,
      [leadId, oldEmployeeId]);
    assert.equal(allowed.rows[0]?.allowed, true);

    const crmPid = Number((await crm.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid);
    let reassigned = false;
    const reassignment = crm.query(`UPDATE crm_leads SET assigned_to=$1 WHERE id=$2`,
      [newEmployeeId, leadId]).then(() => { reassigned = true; });

    let blocked = false;
    for (let attempt = 0; attempt < 30 && !blocked; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25));
      const state = await observer.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1`, [crmPid]);
      blocked = state.rows[0]?.wait_event_type === "Lock";
    }
    assert.equal(blocked, true);
    assert.equal(reassigned, false);

    await kay.query("COMMIT");
    await reassignment;
    assert.equal(reassigned, true);

    await kay.query("BEGIN");
    const oldOwner = await kay.query(`SELECT public.kay_lock_mission_scope($1,$2) AS allowed`,
      [leadId, oldEmployeeId]);
    const newOwner = await kay.query(`SELECT public.kay_lock_mission_scope($1,$2) AS allowed`,
      [leadId, newEmployeeId]);
    assert.equal(oldOwner.rows[0]?.allowed, false);
    assert.equal(newOwner.rows[0]?.allowed, true);
    await kay.query("ROLLBACK");
  } finally {
    await kay.query("ROLLBACK").catch(() => {});
    kay.release();
    crm.release();
    observer.release();
  }
});

test("STALE candidate fails closed when assignment, eligibility, role, or cohort changes before mutation", async () => {
  const reset = async () => {
    await pool.query(`UPDATE crm_leads SET assigned_to=$1,created_at='2026-08-01T00:00:00',
      business_received_at=NULL,business_received_at_source=NULL,lead_source='manual' WHERE id=$2`,
    [oldEmployeeId, leadId]);
    await pool.query(`UPDATE users SET role='sub_agent',is_active=true,is_admin=false,
      username='scope_fence_old' WHERE id=$1`, [oldEmployeeId]);
  };
  const attempt = async (id: number) => {
    await pool.query(`INSERT INTO ${staleTable}(id,lead_id,employee_id,status)
      VALUES($1,$2,$3,'NEW')`, [id, leadId, oldEmployeeId]);
    const changed = await pool.query(`UPDATE ${staleTable} m SET status='STALE'
      WHERE id=$1 AND status='NEW'
        AND public.kay_lock_mission_scope(m.lead_id,m.employee_id)
      RETURNING id`, [id]);
    assert.equal(changed.rowCount, 0);
    assert.equal((await pool.query(`SELECT status FROM ${staleTable} WHERE id=$1`, [id])).rows[0].status, "NEW");
  };

  await reset();
  await pool.query(`UPDATE crm_leads SET assigned_to=$1 WHERE id=$2`, [newEmployeeId, leadId]);
  await attempt(1);

  await reset();
  await pool.query(`UPDATE users SET is_active=false WHERE id=$1`, [oldEmployeeId]);
  await attempt(2);

  await reset();
  await pool.query(`UPDATE users SET role='viewer' WHERE id=$1`, [oldEmployeeId]);
  await attempt(3);

  await reset();
  await pool.query(`UPDATE crm_leads SET created_at='2020-01-01T00:00:00' WHERE id=$1`, [leadId]);
  await attempt(4);

  await reset();
});