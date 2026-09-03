import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { ensureKayTables, pool } from "./db";
import { acquireKayMissionGeneratorLease, defaultPhaseCSettings, deliverPendingKayMissionNotifications, releaseKayMissionGeneratorLease, renewKayMissionGeneratorLease } from "./kayMissionService";

before(async () => { await ensureKayTables(); });
after(async () => { await pool.end(); });

test("C1 database persists notification state needed for atomic severity-version dedupe", async () => {
  const result = await pool.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='kay_missions' AND column_name='notification_sent_at') AS sent,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='kay_missions' AND column_name='notification_level') AS level,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='kay_missions' AND column_name='notification_version') AS version`);
  assert.deepEqual(result.rows[0], { sent:true, level:true, version:true });
});

test("C1 lease is singleton, token guarded, expires, and malformed values recover", async () => {
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES ('phase_c_generator_lease','{"locked_until":"malformed"}')
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
  const [a,b] = await Promise.all([acquireKayMissionGeneratorLease(), acquireKayMissionGeneratorLease()]);
  assert.equal([a,b].filter(Boolean).length, 1);
  const token = (a || b)!;
  assert.equal(await renewKayMissionGeneratorLease("wrong-token"), false);
  assert.equal(await releaseKayMissionGeneratorLease("wrong-token"), false);
  assert.equal(await renewKayMissionGeneratorLease(token), true);
  assert.equal(await releaseKayMissionGeneratorLease(token), true);
  await pool.query(`UPDATE kay_settings SET value='{"token":"crashed","locked_until":"2000-01-01T00:00:00.000Z"}' WHERE key='phase_c_generator_lease'`);
  const recovered = await acquireKayMissionGeneratorLease();
  assert.ok(recovered);
  assert.equal(await releaseKayMissionGeneratorLease(recovered!), true);
});

test("C1 concurrent notification delivery is exactly once and severity escalation creates one version", async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const user = await pool.query(`INSERT INTO users(username,role,is_admin) VALUES ($1,'sub_agent',false) RETURNING id`, [`c1-${suffix}`]);
  const uid = user.rows[0].id;
  const lead = await pool.query(`INSERT INTO crm_leads(first_name,status,assigned_to) VALUES ('SafeName','new',$1) RETURNING id`, [uid]);
  const lid = lead.rows[0].id;
  const mission = await pool.query(`INSERT INTO kay_missions
    (lead_id,employee_id,mission_type,priority,priority_score,reason_code,objective,suggested_action,idempotency_key)
    VALUES ($1,$2,'FOLLOW_UP_DUE','HIGH',50,'FOLLOW_UP_DUE','attention','open lead',$3) RETURNING id`,
    [lid,uid,`c1-notify-${suffix}`]);
  const mid = mission.rows[0].id;
  try {
    const settings = {...defaultPhaseCSettings, quiet_hours_enabled:false};
    const first = await Promise.all([deliverPendingKayMissionNotifications(settings), deliverPendingKayMissionNotifications(settings)]);
    assert.equal(first.reduce((a,b)=>a+b,0), 1);
    let counts = await pool.query(`SELECT
      (SELECT count(*)::int FROM user_notifications WHERE type='kay_mission' AND data->>'missionId'=$1) notifications,
      (SELECT count(*)::int FROM kay_events WHERE event_type='mission_notification_created' AND metadata->>'missionId'=$1) markers,
      (SELECT notification_version FROM kay_missions WHERE id=$1::int) version`, [String(mid)]);
    assert.deepEqual(counts.rows[0], { notifications:1, markers:1, version:1 });
    await pool.query(`UPDATE kay_missions SET priority='CRITICAL',priority_score=80 WHERE id=$1`,[mid]);
    const second = await Promise.all([deliverPendingKayMissionNotifications(settings), deliverPendingKayMissionNotifications(settings)]);
    assert.equal(second.reduce((a,b)=>a+b,0), 1);
    counts = await pool.query(`SELECT
      (SELECT count(*)::int FROM user_notifications WHERE type='kay_mission' AND data->>'missionId'=$1) notifications,
      (SELECT count(*)::int FROM kay_events WHERE event_type='mission_notification_created' AND metadata->>'missionId'=$1) markers,
      (SELECT notification_version FROM kay_missions WHERE id=$1::int) version`, [String(mid)]);
    assert.deepEqual(counts.rows[0], { notifications:2, markers:2, version:2 });
  } finally {
    await pool.query(`DELETE FROM kay_events WHERE metadata->>'missionId'=$1`,[String(mid)]);
    await pool.query(`DELETE FROM kay_missions WHERE id=$1`,[mid]);
    await pool.query(`DELETE FROM crm_leads WHERE id=$1`,[lid]);
    await pool.query(`DELETE FROM users WHERE id=$1`,[uid]);
  }
});