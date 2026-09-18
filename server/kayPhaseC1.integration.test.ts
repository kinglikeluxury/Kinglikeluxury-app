import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db";
import { assertSafeKayMutationTestDatabase, kaySyntheticMarker } from "./kayTestDatabaseSafety";
assertSafeKayMutationTestDatabase("kayPhaseC1.integration");
import { acquireKayMissionGeneratorLease, defaultPhaseCSettings, deliverPendingKayMissionNotifications, releaseKayMissionGeneratorLease, renewKayMissionGeneratorLease, staleKayMissionIfStillScopedForTest } from "./kayMissionService";

const enabled = process.env.KAY_C1_POSTGRES_TESTS === "true";
const marker = kaySyntheticMarker("KAY_C1_TEST");
let priorLaunch: unknown;
let hadPriorLaunch = false;

before(async () => {
  if (!enabled) return;
  const schema = await pool.query(`SELECT
    to_regclass('public.kay_runtime_state') IS NOT NULL runtime_state,
    to_regclass('public.kay_missions') IS NOT NULL missions`);
  assert.deepEqual(schema.rows[0], { runtime_state: true, missions: true }, "C1 schema must be pre-provisioned");
  const launch = await pool.query(`SELECT value FROM kay_settings WHERE key='kay_operational_launch_at'`);
  hadPriorLaunch = launch.rowCount === 1;
  priorLaunch = launch.rows[0]?.value;
  await pool.query(`INSERT INTO kay_settings(key,value) VALUES('kay_operational_launch_at',$1::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
  [JSON.stringify("2026-09-09T00:00:00+04:00")]);
});
after(async () => {
  if (!enabled) {
    await pool.end();
    return;
  }
  if (hadPriorLaunch) {
    await pool.query(`UPDATE kay_settings SET value=$1::jsonb WHERE key='kay_operational_launch_at'`,
      [JSON.stringify(priorLaunch)]);
  } else {
    await pool.query(`DELETE FROM kay_settings WHERE key='kay_operational_launch_at'`);
  }
  await pool.end();
});

test("C1 database persists notification state needed for atomic severity-version dedupe", { skip: !enabled }, async () => {
  const result = await pool.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='kay_missions' AND column_name='notification_sent_at') AS sent,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='kay_missions' AND column_name='notification_level') AS level,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='kay_missions' AND column_name='notification_version') AS version`);
  assert.deepEqual(result.rows[0], { sent:true, level:true, version:true });
});

test("C1 lease is singleton, token guarded, expires, and malformed values recover", { skip: !enabled }, async () => {
  try {
    await pool.query(`DELETE FROM kay_runtime_state WHERE key='phase_c_generator_lease'`);
    const fresh = await acquireKayMissionGeneratorLease();
    assert.ok(fresh);
    assert.equal(await acquireKayMissionGeneratorLease(), null);
    assert.equal(await releaseKayMissionGeneratorLease(fresh!), true);
    for (const malformed of ["malformed", "2026-99-99Tbad"]) {
      await pool.query(`INSERT INTO kay_runtime_state(key,value)
        VALUES ('phase_c_generator_lease',jsonb_build_object('locked_until',$1::text))
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [malformed]);
      const [a,b] = await Promise.all([acquireKayMissionGeneratorLease(), acquireKayMissionGeneratorLease()]);
      assert.equal([a,b].filter(Boolean).length, 1);
      const token = (a || b)!;
      assert.equal(await renewKayMissionGeneratorLease("wrong-token"), false);
      assert.equal(await releaseKayMissionGeneratorLease("wrong-token"), false);
      assert.equal(await renewKayMissionGeneratorLease(token), true);
      assert.equal(await releaseKayMissionGeneratorLease(token), true);
    }
    await pool.query(`UPDATE kay_runtime_state SET value='{"token":"crashed","locked_until":"2000-01-01T00:00:00.000Z"}' WHERE key='phase_c_generator_lease'`);
    const recovered = await acquireKayMissionGeneratorLease();
    assert.ok(recovered);
    assert.equal(await releaseKayMissionGeneratorLease(recovered!), true);
  } finally {
    await pool.query(`DELETE FROM kay_runtime_state WHERE key='phase_c_generator_lease'`);
  }
});

test("C1 concurrent notification delivery is exactly once and severity escalation creates one version", { skip: !enabled }, async () => {
  const suffix = `${marker}:${Date.now()}-${Math.random()}`;
  const user = await pool.query(`INSERT INTO users(username,role,is_admin,is_active)
    VALUES ($1,'sub_agent',false,true) RETURNING id`, [suffix]);
  const uid = user.rows[0].id;
  await pool.query(`INSERT INTO kay_runtime_state(key,value)
    VALUES($1,'{"availability":"AVAILABLE"}'::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [`phase_c_availability:${uid}`]);
  const lead = await pool.query(`INSERT INTO crm_leads(first_name,status,assigned_to,notes) VALUES ('Synthetic','new',$1,$2) RETURNING id`, [uid, marker]);
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
    await pool.query(`DELETE FROM kay_runtime_state WHERE key=$1`, [`phase_c_availability:${uid}`]);
    await pool.query(`DELETE FROM users WHERE id=$1`,[uid]);
  }
});

test("C1 STALE mutation rechecks assignment, employee eligibility, and cohort after discovery", { skip: !enabled }, async () => {
  const suffix = `${marker}:${Date.now()}-${Math.random()}`;
  const idBase = 3_000_000 + Math.floor(Date.now() % 100_000) * 3;
  const users = await pool.query(`INSERT INTO users(id,username,role,is_admin,is_active) VALUES
    ($1,$3,'sub_agent',false,true),($2,$4,'sub_agent',false,true) RETURNING id`,
  [idBase, idBase + 1, `c1-stale-owner-${suffix}`, `c1-stale-other-${suffix}`]);
  const ownerId = Number(users.rows[0].id);
  const otherId = Number(users.rows[1].id);
  const leadIds: number[] = [];
  const missionIds: number[] = [];
  const makeCandidate = async () => {
    const lead = await pool.query(`INSERT INTO crm_leads(first_name,status,assigned_to,lead_source,created_at,notes)
      VALUES('Synthetic','new',$1,'manual','2026-08-01T00:00:00',$2) RETURNING id`, [ownerId, marker]);
    const leadId = Number(lead.rows[0].id);
    leadIds.push(leadId);
    const mission = await pool.query(`INSERT INTO kay_missions
      (lead_id,employee_id,mission_type,priority,priority_score,reason_code,objective,suggested_action,idempotency_key)
      VALUES($1,$2,'FOLLOW_UP_DUE','HIGH',50,'FOLLOW_UP_DUE','test','test',$3) RETURNING id`,
    [leadId, ownerId, `phase-c:stale-race:${suffix}:${leadId}`]);
    const missionId = Number(mission.rows[0].id);
    missionIds.push(missionId);
    return { leadId, missionId };
  };
  const assertDenied = async (missionId: number) => {
    assert.equal(await staleKayMissionIfStillScopedForTest(missionId), false);
    assert.equal((await pool.query(`SELECT status FROM kay_missions WHERE id=$1`, [missionId])).rows[0].status, "NEW");
    assert.equal(Number((await pool.query(`SELECT count(*)::int n FROM kay_events
      WHERE event_type='mission_staled' AND metadata->>'missionId'=$1`, [String(missionId)])).rows[0].n), 0);
  };
  try {
    const assignment = await makeCandidate();
    await pool.query(`UPDATE crm_leads SET assigned_to=$1 WHERE id=$2`, [otherId, assignment.leadId]);
    await assertDenied(assignment.missionId);

    const inactive = await makeCandidate();
    await pool.query(`UPDATE users SET is_active=false WHERE id=$1`, [ownerId]);
    await assertDenied(inactive.missionId);
    await pool.query(`UPDATE users SET is_active=true WHERE id=$1`, [ownerId]);

    const role = await makeCandidate();
    await pool.query(`UPDATE users SET role='viewer' WHERE id=$1`, [ownerId]);
    await assertDenied(role.missionId);
    await pool.query(`UPDATE users SET role='sub_agent' WHERE id=$1`, [ownerId]);

    const cohort = await makeCandidate();
    await pool.query(`UPDATE crm_leads SET created_at='2020-01-01T00:00:00' WHERE id=$1`, [cohort.leadId]);
    await assertDenied(cohort.missionId);
  } finally {
    if (missionIds.length) {
      await pool.query(`DELETE FROM kay_events WHERE metadata->>'missionId'=ANY($1::text[])`, [missionIds.map(String)]);
      await pool.query(`DELETE FROM kay_missions WHERE id=ANY($1::int[])`, [missionIds]);
    }
    if (leadIds.length) await pool.query(`DELETE FROM crm_leads WHERE id=ANY($1::int[])`, [leadIds]);
    await pool.query(`DELETE FROM users WHERE id=ANY($1::int[])`, [[ownerId, otherId]]);
  }
});