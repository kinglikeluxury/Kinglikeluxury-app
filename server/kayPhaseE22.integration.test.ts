import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pool } from "./db";
import {
  getLegacyBaselineReadiness,
  getLegacyCapacitySensitivity,
  getLegacyLeadAgeBuckets,
  getLegacyOwnerDiagnostics,
  initializeLegacyBaselines,
  previewLegacyBaselineInitialization,
  repairLegacyBaselineContinuityDuplicates,
  resolveKayStatusWindow,
} from "./kayLegacyBaselineService";

const enabled = process.env.KAY_E22_POSTGRES_TESTS === "true";
const marker = `KAY_E22:${Date.now()}`;
const scope = { marker };
const leadIds: number[] = [];
const userIds: number[] = [];
let adminId = 0;
let secondAdminId = 0;
let ownerId = 0;
let targetId = 0;

async function canonicalFingerprints() {
  const expressions: Record<string,string> = {
    lead_assignment_history: `id||'|'||COALESCE(lead_id::text,'')||'|'||reason||'|'||automatic`,
    crm_tasks: `id||'|'||lead_id||'|'||COALESCE(completed_at::text,'')||'|'||COALESCE(due_date,'')`,
    kay_missions: `id||'|'||COALESCE(lead_id::text,'')||'|'||status||'|'||updated_at`,
    kay_commitments: `id||'|'||COALESCE(lead_id::text,'')||'|'||status||'|'||updated_at`,
    kay_promises: `id||'|'||lead_id||'|'||status||'|'||updated_at`,
    kay_auto_rescue_queue: `id||'|'||COALESCE(lead_id::text,'')||'|'||status||'|'||updated_at`,
    user_notifications: `id||'|'||user_id||'|'||type||'|'||is_read||'|'||created_at`,
  };
  const communication = await pool.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
      AND (table_name ILIKE '%communication%' OR table_name ILIKE '%conversation%' OR table_name ILIKE '%message%')`);
  const output: Record<string,{count:number;hash:string}> = {};
  for (const [table, expression] of Object.entries(expressions)) {
    const rows = await pool.query(`SELECT ${expression} value FROM "${table}" ORDER BY id`);
    output[table] = { count: rows.rows.length, hash: createHash("sha256").update(JSON.stringify(rows.rows)).digest("hex") };
  }
  for (const row of communication.rows) {
    const table = String(row.table_name);
    if (!/^[a-z_]+$/.test(table)) continue;
    const columns = await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
        AND column_name=ANY($2::text[]) ORDER BY ordinal_position`, [
          table, ["id","status","state","sent_at","delivered_at","read_at","updated_at","created_at","type","channel","direction","failed_at"],
        ]);
    const selected = columns.rows.map((x:any)=>String(x.column_name)).filter(x=>/^[a-z_]+$/.test(x));
    if (!selected.length) continue;
    const values = await pool.query(`SELECT ${selected.map(c=>`COALESCE("${c}"::text,'')`).join("||'|'||")} value FROM "${table}" ORDER BY 1`);
    output[table] = { count: values.rows.length, hash: createHash("sha256").update(JSON.stringify(values.rows)).digest("hex") };
  }
  return output;
}

async function addLead(status: string, old = false) {
  const row = await pool.query(`INSERT INTO crm_leads
    (lead_source,full_name,status,notes,assigned_to,created_at,updated_at)
    VALUES('manual',$1,$2,$1,$3,
      CASE WHEN $4 THEN NOW()-interval '400 days' ELSE NOW() END,
      CASE WHEN $4 THEN NOW()-interval '300 days' ELSE NOW() END)
    RETURNING id`, [marker, status, ownerId, old]);
  const id = Number(row.rows[0].id);
  leadIds.push(id);
  return id;
}

async function clearHistory(...ids: number[]) {
  await pool.query(`DELETE FROM kay_lead_status_history WHERE lead_id=ANY($1::int[])`, [ids]);
}

async function initializePreview(token: string) {
  const preview = await previewLegacyBaselineInitialization(500, scope);
  const counts = await initializeLegacyBaselines(
    adminId,
    token,
    preview.limit,
    preview.fingerprint,
    preview.candidates,
    scope,
  );
  return { preview, counts };
}

async function cleanup() {
  await pool.query(`DROP TRIGGER IF EXISTS kay_e22_forced_failure ON kay_legacy_rescue_baselines`).catch(() => {});
  await pool.query(`DROP FUNCTION IF EXISTS kay_e22_forced_failure()`).catch(() => {});
  if (leadIds.length) {
    const p = [leadIds];
    await pool.query(`DELETE FROM kay_auto_rescue_queue WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_manager_reviews WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_promise_handoffs WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_rescue_executions WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_internal_briefings WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_commitments WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_promises WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_missions WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM crm_tasks WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_lead_protection WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM lead_assignment_history WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_decisions WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_events WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_legacy_rescue_baselines WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM kay_lead_status_history WHERE lead_id=ANY($1::int[])`, p);
    await pool.query(`DELETE FROM crm_leads WHERE id=ANY($1::int[]) AND notes=$2`, [leadIds, marker]);
  }
  if (adminId || secondAdminId) {
    await pool.query(`DELETE FROM kay_legacy_baseline_init_runs WHERE admin_id=ANY($1::int[])`, [[adminId, secondAdminId].filter(Boolean)]);
  }
  if (userIds.length) {
    await pool.query(`DELETE FROM kay_settings WHERE key=ANY($1::text[])`, [
      userIds.map(id => `phase_c_availability:${id}`),
    ]);
    await pool.query(`DELETE FROM users WHERE id=ANY($1::int[])`, [userIds]);
  }
}

test("E22 PostgreSQL service integration", { skip: !enabled }, async t => {
  const required = await pool.query(`SELECT count(*)::int n
    FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name=ANY($1::text[])`, [[
        "kay_legacy_rescue_baselines",
        "kay_legacy_baseline_init_runs",
      ]]);
  assert.equal(required.rows[0].n, 2, "schema must pre-exist; test never bootstraps");

  const safetyBefore = await pool.query(`SELECT key,value
    FROM kay_settings
    WHERE key=ANY($1::text[])
    ORDER BY key`, [["mode", "rescue_rules"]]);
  const safety = Object.fromEntries(safetyBefore.rows.map((r: any) => [r.key, r.value]));
  assert.equal(safety.mode?.mode, "shadow");
  assert.equal(safety.rescue_rules?.auto_rescue_no_answer_1_enabled, false);
  assert.equal(safety.rescue_rules?.auto_rescue_no_answer_2_enabled, false);
  assert.equal(safety.rescue_rules?.auto_rescue_kill_switch, true);

  const catalog = await pool.query(`SELECT indexname,indexdef
    FROM pg_indexes
    WHERE indexname=ANY($1::text[])
    ORDER BY indexname`, [[
      "kay_legacy_baseline_continuity_unique_idx",
      "kay_legacy_baseline_one_active_idx",
    ]]);
  assert.ok(catalog.rows.length >= 1);
  const continuityDefinition = catalog.rows.find((r: any) => r.indexname.endsWith("continuity_unique_idx"))?.indexdef;
  if (continuityDefinition) assert.match(continuityDefinition, /UNIQUE.*lead_id, observed_status, continuity_event_key/i);
  assert.match(catalog.rows.find((r: any) => r.indexname.endsWith("one_active_idx"))?.indexdef || "", /UNIQUE.*lead_id, observed_status.*WHERE.*ACTIVE/i);
  const defaults = await pool.query(`SELECT table_name,column_name,
    pg_get_expr(d.adbin,d.adrelid) expression
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
    JOIN information_schema.columns c ON c.table_name=d.adrelid::regclass::text
      AND c.column_name=a.attname
    WHERE (c.table_name,c.column_name) IN (
      ('kay_legacy_rescue_baselines','observation_started_at'),
      ('kay_legacy_baseline_init_runs','created_at')
    )`);
  assert.equal(defaults.rows.length, 2);
  defaults.rows.forEach((r: any) => assert.match(r.expression, /clock_timestamp\(\)/));

  const users = await pool.query(`INSERT INTO users
    (username,password,is_admin,role,is_active)
    VALUES
      ($1,'x',true,'admin',true),
      ($2,'x',false,'sub_agent',true),
      ($3,'x',false,'sub_agent',true),
      ($4,'x',true,'admin',true)
    RETURNING id,username`, [
      `${marker}:admin`,
      `${marker}:owner`,
      `${marker}:target`,
      `${marker}:admin2`,
    ]);
  for (const row of users.rows) {
    userIds.push(Number(row.id));
    if (row.username.endsWith(":admin")) adminId = Number(row.id);
    if (row.username.endsWith(":owner")) ownerId = Number(row.id);
    if (row.username.endsWith(":target")) targetId = Number(row.id);
    if (row.username.endsWith(":admin2")) secondAdminId = Number(row.id);
  }

  try {
    await t.test("preview and confirm create only NA1 and NA2 with DB clock", async () => {
      const before = new Date((await pool.query(`SELECT clock_timestamp() now`)).rows[0].now);
      const na1 = await addLead("no_answer_1", true);
      const na2 = await addLead("no_answer_2", true);
      const trusted = await addLead("no_answer_1", true);
      await addLead("no_answer_4", true);
      await addLead("unknown_status", true);
      await clearHistory(na1, na2, trusted);
      await pool.query(`INSERT INTO kay_lead_status_history
        (lead_id,status,entered_at,event_key)
        VALUES($1,'no_answer_1',clock_timestamp(),$2)`, [trusted, `${marker}:trusted`]);
      const preview = await previewLegacyBaselineInitialization(500, scope);
      assert.equal(preview.inspected, 3);
      assert.equal(preview.eligible, 2);
      assert.equal(preview.counts.skippedTrusted, 1);
      const effectsBefore = await canonicalFingerprints();
      const result = await initializeLegacyBaselines(
        adminId, "a".repeat(24), preview.limit,
        preview.fingerprint, preview.candidates, scope,
      );
      assert.deepEqual(result, {
        inspected: 3,
        created: 2,
        skippedTrusted: 1,
        skippedChanged: 0,
        skippedInvalid: 0,
        skippedExisting: 0,
      });
      const after = new Date((await pool.query(`SELECT clock_timestamp() now`)).rows[0].now);
      const baselines = await pool.query(`SELECT b.id,b.lead_id,b.observation_started_at,
        l.created_at,l.updated_at,l.assigned_to,l.status
        FROM kay_legacy_rescue_baselines b
        JOIN crm_leads l ON l.id=b.lead_id
        WHERE b.lead_id=ANY($1::int[])
        ORDER BY b.lead_id`, [[na1, na2]]);
      assert.equal(baselines.rows.length, 2);
      for (const row of baselines.rows) {
        const observed = new Date(row.observation_started_at);
        assert.ok(observed >= before && observed <= after);
        assert.notEqual(observed.getTime(), new Date(row.created_at).getTime());
        assert.notEqual(observed.getTime(), new Date(row.updated_at).getTime());
        assert.equal(Number(row.assigned_to), ownerId);
      }
      await getLegacyBaselineReadiness(scope);
      const effectsAfter = await canonicalFingerprints();
      assert.deepEqual(effectsAfter, effectsBefore);
    });

    await t.test("fresh preview rerun preserves ids and timestamps", async () => {
      const before = await pool.query(`SELECT id,lead_id,observation_started_at
        FROM kay_legacy_rescue_baselines
        WHERE lead_id=ANY($1::int[])
        ORDER BY lead_id`, [leadIds]);
      const { counts } = await initializePreview("b".repeat(24));
      assert.equal(counts.created, 0);
      assert.equal(counts.skippedExisting, 2);
      assert.equal(counts.skippedTrusted, 1);
      const after = await pool.query(`SELECT id,lead_id,observation_started_at
        FROM kay_legacy_rescue_baselines
        WHERE lead_id=ANY($1::int[])
        ORDER BY lead_id`, [leadIds]);
      assert.deepEqual(after.rows, before.rows);
    });

    await t.test("concurrent confirms produce one active baseline", async () => {
      const lead = await addLead("no_answer_2");
      await clearHistory(lead);
      const p1 = await previewLegacyBaselineInitialization(500, scope);
      const p2 = await previewLegacyBaselineInitialization(500, scope);
      let arrived = 0;
      let releaseBarrier!: () => void;
      const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });
      const barrierTimeout = setTimeout(() => releaseBarrier(), 5000);
      const arrive = async () => {
        arrived++;
        if (arrived === 2) releaseBarrier();
        await Promise.race([
          barrier,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("bounded barrier timeout")), 5500)),
        ]);
      };
      let settled: PromiseSettledResult<Awaited<ReturnType<typeof initializeLegacyBaselines>>>[];
      try {
        settled = await Promise.allSettled([
          initializeLegacyBaselines(adminId, "c".repeat(24), p1.limit, p1.fingerprint, p1.candidates, scope, { afterAdminLockForTest: arrive }),
          initializeLegacyBaselines(secondAdminId, "d".repeat(24), p2.limit, p2.fingerprint, p2.candidates, scope, { afterAdminLockForTest: arrive }),
        ]);
      } finally {
        clearTimeout(barrierTimeout);
        releaseBarrier();
      }
      assert.equal(settled.filter(x => x.status === "rejected").length, 0);
      const results = settled.map(x => (x as PromiseFulfilledResult<Awaited<ReturnType<typeof initializeLegacyBaselines>>>).value);
      const active = await pool.query(`SELECT count(*)::int n
        FROM kay_legacy_rescue_baselines
        WHERE lead_id=$1 AND state='ACTIVE'`, [lead]);
      assert.equal(active.rows[0].n, 1);
      assert.equal(results[0].created + results[1].created, 1);
      assert.ok(results[0].skippedExisting + results[1].skippedExisting >= 1);
    });

    await t.test("snapshot race is audited as changed", async () => {
      const lead = await addLead("no_answer_1");
      await clearHistory(lead);
      const preview = await previewLegacyBaselineInitialization(500, scope);
      const locker = await pool.connect();
      let initializerPid = 0;
      let pendingSettled = false;
      let signalPid!: () => void;
      const pidSignal = new Promise<void>(resolve => { signalPid = resolve; });
      let pending: Promise<Awaited<ReturnType<typeof initializeLegacyBaselines>>> | undefined;
      let result!: Awaited<ReturnType<typeof initializeLegacyBaselines>>;
      try {
        await locker.query("BEGIN");
        const lockerPid = Number((await locker.query(`SELECT pg_backend_pid() pid`)).rows[0].pid);
        await locker.query(`SELECT id FROM crm_leads WHERE id=$1 FOR UPDATE`, [lead]);
        pending = initializeLegacyBaselines(
          adminId, "e".repeat(24), preview.limit,
          preview.fingerprint, preview.candidates, scope,
          { beforeLeadLocksForTest: info => { initializerPid = info.backendPid; signalPid(); } },
        ).finally(() => { pendingSettled = true; });
        await Promise.race([
          pidSignal,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("initializer PID signal timeout")), 5000)),
        ]);
        let exactWaitObserved = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const activity = await pool.query(`SELECT wait_event_type,
            pg_blocking_pids($1::int) blockers
            FROM pg_stat_activity WHERE pid=$1`, [initializerPid]);
          const row = activity.rows[0];
          if (row?.wait_event_type === "Lock" || (row?.blockers || []).map(Number).includes(lockerPid)) {
            exactWaitObserved = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(exactWaitObserved, true, "exact initializer backend is blocked by locker backend");
        await locker.query(`UPDATE crm_leads SET status='interested' WHERE id=$1`, [lead]);
        await locker.query("COMMIT");
        result = await Promise.race([
          pending,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("initializer settle timeout")), 5000)),
        ]);
      } finally {
        await locker.query("ROLLBACK").catch(() => {});
        locker.release();
        if (pending && !pendingSettled) {
          if (initializerPid) await pool.query(`SELECT pg_cancel_backend($1)`, [initializerPid]).catch(() => {});
          await Promise.race([
            pending.catch(() => undefined),
            new Promise(resolve => setTimeout(resolve, 5000)),
          ]);
        }
      }
      assert.equal(result.skippedChanged, 1);
      const active = await pool.query(`SELECT count(*)::int n
        FROM kay_legacy_rescue_baselines
        WHERE lead_id=$1 AND state='ACTIVE'`, [lead]);
      assert.equal(active.rows[0].n, 0);
      const audit = await pool.query(`SELECT skipped_changed
        FROM kay_legacy_baseline_init_runs
        WHERE confirmation_token=$1`, ["e".repeat(24)]);
      assert.equal(audit.rows[0].skipped_changed, 1);
    });

    await t.test("invalid admin, token, expiry and audit failure reject safely", async () => {
      const lead = await addLead("no_answer_1");
      await clearHistory(lead);
      const preview = await previewLegacyBaselineInitialization(500, scope);
      await assert.rejects(() => initializeLegacyBaselines(
        ownerId, "f".repeat(24), preview.limit,
        preview.fingerprint, preview.candidates, scope,
      ), /Kay Admin required/);
      await assert.rejects(() => initializeLegacyBaselines(
        adminId, "short", preview.limit,
        preview.fingerprint, preview.candidates, scope,
      ), /confirmation token/);
      await assert.rejects(() => initializeLegacyBaselines(
        adminId, "g".repeat(24), preview.limit,
        preview.fingerprint, preview.candidates, scope,
        { expiresAt: 1, nowForTest: 2 },
      ), /expired/);
      const before = await pool.query(`SELECT count(*)::int n
        FROM kay_legacy_rescue_baselines WHERE lead_id=$1`, [lead]);
      await assert.rejects(() => initializeLegacyBaselines(
        adminId, "h".repeat(24), preview.limit,
        preview.fingerprint, preview.candidates, scope,
        { failAuditInsertForTest: true },
      ), /SYNTHETIC_AUDIT_INSERT_FAILURE/);
      const after = await pool.query(`SELECT count(*)::int n
        FROM kay_legacy_rescue_baselines WHERE lead_id=$1`, [lead]);
      assert.equal(after.rows[0].n, before.rows[0].n);
    });

    await t.test("status transition invalidates and return is trusted", async () => {
      const lead = await addLead("no_answer_1");
      await clearHistory(lead);
      await initializePreview("i".repeat(24));
      await pool.query(`UPDATE crm_leads SET status='interested' WHERE id=$1`, [lead]);
      assert.equal((await pool.query(`SELECT state
        FROM kay_legacy_rescue_baselines
        WHERE lead_id=$1`, [lead])).rows[0].state, "INVALIDATED");
      await pool.query(`UPDATE crm_leads SET status='no_answer_1' WHERE id=$1`, [lead]);
      const resolved = await resolveKayStatusWindow(pool, lead, "no_answer_1");
      assert.equal(resolved?.source, "STATUS_TRANSITION");
      assert.equal(resolved?.trusted, true);
    });

    await t.test("readiness and diagnostics use scoped real services", async () => {
      const lead = await addLead("no_answer_2");
      await clearHistory(lead);
      await initializePreview("j".repeat(24));
      let report = await getLegacyBaselineReadiness(scope);
      assert.ok(report.statuses.no_answer_2.underThreshold >= 1);
      await pool.query(`UPDATE kay_legacy_rescue_baselines
        SET observation_started_at=clock_timestamp()-interval '25 hours'
        WHERE lead_id=$1`, [lead]);
      report = await getLegacyBaselineReadiness(scope);
      assert.equal(report.statuses.no_answer_2.reachedThreshold, 1);
      assert.equal(report.statuses.no_answer_2.wouldRescue, 1);
      assert.equal(report.statuses.no_answer_2.noEligible, 0);
      await pool.query(`INSERT INTO crm_tasks(lead_id,title) VALUES($1,$2)`, [lead, marker]);
      report = await getLegacyBaselineReadiness(scope);
      const taskBlocked = report.statuses.no_answer_2.blocked;
      assert.equal(taskBlocked, 1);
      await pool.query(`DELETE FROM crm_tasks WHERE lead_id=$1`, [lead]);
      await pool.query(`INSERT INTO kay_settings(key,value)
        VALUES($1,'{"availability":"LEAVE"}'::jsonb)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [`phase_c_availability:${targetId}`]);
      report = await getLegacyBaselineReadiness(scope);
      assert.equal(report.statuses.no_answer_2.noEligible, 1);
      assert.equal(report.statuses.no_answer_2.wouldRescue, 0);
      await pool.query(`UPDATE kay_settings SET value='{"availability":"AVAILABLE"}'::jsonb
        WHERE key=$1`, [`phase_c_availability:${targetId}`]);
      await pool.query(`INSERT INTO lead_assignment_history
        (lead_id,from_user_id,to_user_id,reason,automatic,metadata)
        VALUES($1,$2,$3,'crm_assignment',false,'{}')`, [lead, targetId, ownerId]);
      report = await getLegacyBaselineReadiness(scope);
      assert.equal(report.statuses.no_answer_2.noEligible, 1);
      assert.equal(report.statuses.no_answer_2.wouldRescue, 0);
      await pool.query(`DELETE FROM lead_assignment_history WHERE lead_id=$1`, [lead]);
      await pool.query(`INSERT INTO kay_promises
        (lead_id,employee_id,promise_text,due_at,owner_review_required_at,idempotency_key)
        VALUES($1,$2,$3,NOW()+interval '1 day',NOW(),$4)`, [
          lead, ownerId, marker, `${marker}:promise:${lead}`,
        ]);
      report = await getLegacyBaselineReadiness(scope);
      assert.equal(report.statuses.no_answer_2.managerReview, 1);
      assert.equal(report.statuses.no_answer_2.wouldRescue, 0);
      await pool.query(`DELETE FROM kay_promises WHERE lead_id=$1`, [lead]);
      await pool.query(`INSERT INTO lead_assignment_history
        (lead_id,from_user_id,to_user_id,reason,automatic,metadata)
        VALUES
          ($1,$2,$3,'kay_rescue_automatic',true,'{"mode":"automatic"}'),
          ($1,$2,$3,'kay_rescue_automatic',true,'{"mode":"automatic"}')`, [
            lead, ownerId, targetId,
          ]);
      report = await getLegacyBaselineReadiness(scope);
      assert.equal(report.statuses.no_answer_2.blocked, 1);
      assert.equal(report.statuses.no_answer_2.wouldRescue, 0);
      await pool.query(`DELETE FROM lead_assignment_history WHERE lead_id=$1`, [lead]);
      const owners = await getLegacyOwnerDiagnostics(scope);
      const owner = owners.find((x: any) => x.account === `${marker}:owner`);
      assert.equal(owner.classification, "SALES_OWNER");
      assert.ok(owner.statusMix.some((x: any) => x.status === "no_answer_2"));
      const ages = await getLegacyLeadAgeBuckets(scope);
      assert.equal(typeof ages["180+"], "number");
      const capacity = await getLegacyCapacitySensitivity(scope);
      assert.ok(capacity.some((x: any) => x.employee === `${marker}:owner`));
    });

    await t.test("duplicate continuity repair preserves both ledger rows", async () => {
      const lead = await addLead("no_answer_1");
      await clearHistory(lead);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${marker}:migration`]);
        await client.query(`DROP INDEX IF EXISTS kay_legacy_baseline_continuity_unique_idx`);
        await client.query(`ALTER TABLE kay_legacy_rescue_baselines
          DROP CONSTRAINT IF EXISTS kay_legacy_rescue_baselines_lead_id_observed_status_continuity_event_key_key`);
        await client.query(`ALTER TABLE kay_legacy_rescue_baselines
          DROP CONSTRAINT IF EXISTS kay_legacy_rescue_baselines_lead_id_observed_status_continu_key`);
        await client.query(`DROP INDEX IF EXISTS kay_legacy_baseline_one_active_idx`);
        await client.query(`INSERT INTO kay_legacy_rescue_baselines
          (lead_id,observed_status,state,continuity_event_key)
          VALUES($1,'no_answer_1','ACTIVE',$2),
            ($1,'no_answer_1','SUPERSEDED',$2)`, [lead, `${marker}:duplicate`]);
        await repairLegacyBaselineContinuityDuplicates(client);
        const repaired = await client.query(`SELECT id,state,continuity_event_key
          FROM kay_legacy_rescue_baselines
          WHERE lead_id=$1 ORDER BY id`, [lead]);
        assert.equal(repaired.rows.length, 2);
        assert.equal(repaired.rows[0].continuity_event_key, `${marker}:duplicate`);
        assert.equal(repaired.rows[1].state, "SUPERSEDED");
        assert.equal(repaired.rows[1].continuity_event_key, `${marker}:duplicate:superseded:${repaired.rows[1].id}`);
        await client.query(`CREATE UNIQUE INDEX kay_e22_test_continuity_unique
          ON kay_legacy_rescue_baselines(lead_id,observed_status,continuity_event_key)`);
        await client.query("ROLLBACK");
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    });

    await t.test("production status trigger propagates baseline update failure atomically", async () => {
      const lead = await addLead("no_answer_1");
      await clearHistory(lead);
      await initializePreview("k".repeat(24));
      const baseline = (await pool.query(`SELECT id,state
        FROM kay_legacy_rescue_baselines WHERE lead_id=$1`, [lead])).rows[0];
      const historyBefore = Number((await pool.query(`SELECT count(*)::int n
        FROM kay_lead_status_history WHERE lead_id=$1`, [lead])).rows[0].n);
      await pool.query(`CREATE OR REPLACE FUNCTION kay_e22_forced_failure()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'forced E22 baseline failure';
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await pool.query(`CREATE TRIGGER kay_e22_forced_failure
        BEFORE UPDATE OF state ON kay_legacy_rescue_baselines
        FOR EACH ROW WHEN (OLD.id=${Number(baseline.id)})
        EXECUTE FUNCTION kay_e22_forced_failure()`);
      try {
        await assert.rejects(() => pool.query(`UPDATE crm_leads
          SET status='interested' WHERE id=$1`, [lead]), /forced E22 baseline failure/);
        assert.equal((await pool.query(`SELECT status FROM crm_leads WHERE id=$1`, [lead])).rows[0].status, "no_answer_1");
        assert.equal((await pool.query(`SELECT state FROM kay_legacy_rescue_baselines WHERE id=$1`, [baseline.id])).rows[0].state, baseline.state);
        assert.equal(Number((await pool.query(`SELECT count(*)::int n
          FROM kay_lead_status_history WHERE lead_id=$1`, [lead])).rows[0].n), historyBefore);
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS kay_e22_forced_failure ON kay_legacy_rescue_baselines`);
        await pool.query(`DROP FUNCTION IF EXISTS kay_e22_forced_failure()`);
      }
    });

    await t.test("production safety settings are byte-for-byte unchanged", async () => {
      const after = await pool.query(`SELECT key,value
        FROM kay_settings
        WHERE key=ANY($1::text[])
        ORDER BY key`, [["mode", "rescue_rules"]]);
      assert.deepEqual(after.rows, safetyBefore.rows);
    });
  } finally {
    await cleanup();
  }
});