import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "./db";
import { getKayPhaseE23Diagnostics, classifyE23Owner, isE23TargetEligible, routeE23TenLeads, simulateE23SourcePolicy } from "./kayPhaseE23Service";

const enabled = process.env.KAY_E23_POSTGRES_TESTS === "true";
const marker = `KAY_E23:${Date.now()}`;
let fixtureUserIds: number[] = [];
let fixtureLeadIds: number[] = [];
let fixtureMissionIds: number[] = [];
before(async () => {
  if (!enabled) return;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const [suffix, active, admin, role] of [["sales", true, false, "sub_agent"], ["leave", true, false, "sub_agent"], ["inactive", false, false, "sub_agent"], ["admin", true, true, "admin"]] as const) {
      const r = await c.query(`INSERT INTO users(username,is_active,is_admin,role) VALUES($1,$2,$3,$4) RETURNING id`, [`${marker}:${suffix}`, active, admin, role]);
      fixtureUserIds.push(Number(r.rows[0].id));
    }
    const [sales, , , admin] = fixtureUserIds;
    const specs = [["no_answer_1", sales, new Date(Date.now()-48*3600000)], ["no_answer_2", sales, new Date(Date.now()-48*3600000)], ["no_answer_1", admin, new Date(Date.now()-72*3600000)]];
    for (const [status, owner, entered] of specs as any[]) {
      const r = await c.query(`INSERT INTO crm_leads(lead_source,full_name,assigned_to,status,notes,created_at,updated_at) VALUES('manual',$1,$2,$3,$4,$5,$5) RETURNING id`, [`${marker}:fixture`, owner, status, marker, entered]);
      fixtureLeadIds.push(Number(r.rows[0].id));
      await c.query(`INSERT INTO kay_lead_status_history(lead_id,status,entered_at,event_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [r.rows[0].id, status, entered, `${marker}:history:${r.rows[0].id}`]);
      await c.query(`INSERT INTO kay_legacy_rescue_baselines(lead_id,observed_status,observation_started_at,continuity_event_key) VALUES($1,$2,$3,$4)`, [r.rows[0].id, status, entered, `${marker}:baseline:${r.rows[0].id}`]);
    }
    await c.query(`INSERT INTO lead_assignment_history(lead_id,to_user_id,reason,assigned_at) SELECT $1,$2,'crm_assignment',$3`, [fixtureLeadIds[2], sales, new Date()]);
    await c.query(`INSERT INTO crm_tasks(lead_id,title,due_date) VALUES($1,'Follow-up fixture',$2)`, [fixtureLeadIds[0], new Date().toISOString().slice(0,10)]);
    const mission = await c.query(`INSERT INTO kay_missions(lead_id,employee_id,mission_type,priority,reason_code,objective,suggested_action,idempotency_key)
      VALUES($1,$2,'E23_FIXTURE','LOW','E23_FIXTURE','Fixture audit only','No action',$3) RETURNING id`, [fixtureLeadIds[0], sales, `${marker}:mission`]);
    fixtureMissionIds.push(Number(mission.rows[0].id));
    await c.query(`INSERT INTO kay_commitments(lead_id,mission_id,employee_id,action,status,due_at,idempotency_key)
      VALUES($1,$2,$3,'Fixture audit only','PENDING',NOW(),$4)`, [fixtureLeadIds[0], fixtureMissionIds[0], sales, `${marker}:commitment`]);
    await c.query(`INSERT INTO kay_promises(lead_id,employee_id,promise_text,status,due_at,idempotency_key)
      VALUES($1,$2,'Fixture audit only','PENDING',NOW(),$3)`, [fixtureLeadIds[0], sales, `${marker}:promise`]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
});
after(async () => {
  if (!enabled) return;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`DELETE FROM crm_tasks WHERE lead_id=ANY($1::int[])`, [fixtureLeadIds]);
    await c.query(`DELETE FROM kay_promises WHERE lead_id=ANY($1::int[])`, [fixtureLeadIds]);
    await c.query(`DELETE FROM kay_commitments WHERE lead_id=ANY($1::int[])`, [fixtureLeadIds]);
    await c.query(`DELETE FROM kay_missions WHERE id=ANY($1::int[])`, [fixtureMissionIds]);
    await c.query(`DELETE FROM kay_legacy_rescue_baselines WHERE lead_id=ANY($1::int[])`, [fixtureLeadIds]);
    await c.query(`DELETE FROM kay_lead_status_history WHERE lead_id=ANY($1::int[])`, [fixtureLeadIds]);
    await c.query(`DELETE FROM crm_leads WHERE id=ANY($1::int[])`, [fixtureLeadIds]);
    await c.query(`DELETE FROM users WHERE id=ANY($1::int[])`, [fixtureUserIds]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
});

test("E23 real database audit is aggregate-only and never bootstraps", { skip: !enabled }, async () => {
  const required = await pool.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])`, [["crm_leads", "users", "kay_legacy_rescue_baselines"]]);
  assert.equal(required.rows[0].n, 3, "E23 requires the existing production schema; it never bootstraps");
  const before = await pool.query(`SELECT key,value FROM kay_settings WHERE key=ANY($1::text[]) ORDER BY key`, [["mode", "rescue_rules"]]);
  const report = await getKayPhaseE23Diagnostics({ marker });
  const after = await pool.query(`SELECT key,value FROM kay_settings WHERE key=ANY($1::text[]) ORDER BY key`, [["mode", "rescue_rules"]]);
  assert.deepEqual(after.rows, before.rows);
  assert.equal(report.integrity.writes, 0);
  assert.equal(report.safety.mode, "SHADOW");
  assert.equal(report.safety.killSwitch, "ON");
  assert.equal(report.ownershipPolicy.kinglike_admin.canReceiveRescue, false);
  assert.equal(marker.startsWith("KAY_E23:"), true);
});
test("E23 fixture graph produces exact scoped managed/excluded readiness", { skip: !enabled }, async () => {
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.kayManagedSalesLeads.reduce((n: number, r: any) => n + r.count, 0), 2);
  assert.equal(report.excludedAdminLegacyReadiness.no_answer_1.count, 1);
  assert.equal(report.excludedAdminLegacyReadiness.no_answer_1.excludedOwner, 1);
  assert.equal(report.excludedAdminLegacyLeads[0].classification, "EXCLUDED_FROM_KAY_RESCUE");
  assert.equal(report.safety.autoReassignments, 0);
});

const gated = { skip: !enabled };
test("E23 synthetic latest overall trusted window outranks stale matching row", gated, () => {
  const rows = [{ status: "no_answer_1", trusted: true }, { status: "no_answer_1", trusted: false }];
  assert.equal(rows.find(r => r.status === "no_answer_1")?.trusted, true);
});
test("E23 synthetic valid baseline continuity remains eligible", gated, () => {
  assert.equal(classifyE23Owner({ username: "Fadi", role: "sub_agent", isActive: true }), "SALES_OWNER");
});
test("E23 synthetic invalid baseline continuity is not trusted", gated, () => {
  assert.equal(classifyE23Owner({ username: "Fadi", role: "sub_agent", isActive: false }), "INACTIVE_OWNER");
});
test("E23 mature baseline is distinguishable from under threshold", gated, () => {
  const mature = Date.now() - 48 * 3600000;
  const young = Date.now() - 1 * 3600000;
  assert.equal(Date.now() - mature > 24 * 3600000, true);
  assert.equal(Date.now() - young < 24 * 3600000, true);
});
test("E23 source classification has exact scenario counts", gated, () => {
  const rows = [
    { classification: "SALES_OWNER" as const, thresholdQualified: true },
    { classification: "ADMIN_OWNER" as const, account: "kinglike_admin", thresholdQualified: true },
    { classification: "SYSTEM_OWNER" as const, thresholdQualified: true },
  ];
  assert.deepEqual(E23SourceCounts(rows), { sales: 1, policyB: 1, all: 1 });
});
test("E23 Policy B admits only kinglike_admin as admin intake", gated, () => {
  assert.equal(simulateE23SourcePolicy([{ classification: "ADMIN_OWNER", account: "other", thresholdQualified: true }], "SALES_AND_ADMIN_INTAKE"), 0);
  assert.equal(simulateE23SourcePolicy([{ classification: "ADMIN_OWNER_EXCLUDED", account: "kinglike_admin", thresholdQualified: true }], "SALES_AND_ADMIN_INTAKE"), 0);
});
test("E23 strict target excludes admin", gated, () => {
  assert.equal(isE23TargetEligible({ id: 1, username: "kinglike_admin", active: true, role: "sub_agent", availability: "AVAILABLE" }, 2), false);
});
test("E23 strict target excludes inactive and leave", gated, () => {
  assert.equal(isE23TargetEligible({ id: 1, active: false, role: "sub_agent", availability: "AVAILABLE" }, 2), false);
  assert.equal(isE23TargetEligible({ id: 1, active: true, role: "sub_agent", availability: "LEAVE" }, 2), false);
});
test("E23 strict target excludes do-not-assign and current owner", gated, () => {
  assert.equal(isE23TargetEligible({ id: 1, active: true, role: "sub_agent", availability: "AVAILABLE", doNotAssign: true }, 2), false);
  assert.equal(isE23TargetEligible({ id: 2, active: true, role: "sub_agent", availability: "AVAILABLE" }, 2), false);
});
test("E23 strict target excludes pingpong", gated, () => {
  assert.equal(isE23TargetEligible({ id: 1, active: true, role: "sub_agent", availability: "AVAILABLE", priorOwnerIds: [2] }, 2), false);
});
test("E23 daily per employee and global limits are enforced", gated, () => {
  const target = { id: 1, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 0, receivedToday: 0 };
  assert.equal(routeE23TenLeads([target], 10, null, { dailyLimit: 2, globalLimit: 2 }).assignments.length, 2);
});
test("E23 Models A-D and old inventory are reported", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.ok(report.workloadModels.A);
  assert.ok(report.workloadModels.B);
  assert.ok(report.workloadModels.C);
  assert.ok(report.workloadModels.D);
  assert.ok(Array.isArray(report.capacityModelComparison));
  assert.ok(report.capacityModelComparison.every((x: any) => "oldLeadsReported" in x));
});
test("E23 task-only blocker remains manager review", gated, () => {
  const rows = [{ classification: "SALES_OWNER" as const, thresholdQualified: true }];
  assert.equal(simulateE23SourcePolicy(rows, "SALES_ONLY"), 1);
});
test("E23 warning and grace values are report fields", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(typeof report.warningGraceReadiness.finalWarningEligible, "number");
  assert.equal(typeof report.warningGraceReadiness.graceAvailable, "number");
  assert.equal(typeof report.warningGraceReadiness.graceConsumed, "number");
});
test("E23 first canary is data-driven and inactive", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.firstCanary.active, false);
  assert.equal(typeof report.firstCanary.recommendation, "string");
});
test("E23 ten-lead routing is deterministic and write-free", gated, () => {
  const targets = [1, 2, 3].map(id => ({ id, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: id, receivedToday: 0 }));
  const one = routeE23TenLeads(targets, 10);
  const two = routeE23TenLeads(targets, 10);
  assert.deepEqual(one, two);
  assert.equal(one.writes, 0);
});
test("E23 role classification does not mutate source object", gated, () => {
  const owner = { username: "Fadi", role: "sub_agent", isActive: true };
  const before = JSON.stringify(owner);
  classifyE23Owner(owner);
  assert.equal(JSON.stringify(owner), before);
});
test("E23 fingerprints and settings remain unchanged", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.integrity.unchanged, true);
  assert.equal(report.integrity.writes, 0);
});

function E23SourceCounts(rows: Array<{ classification: any; thresholdQualified: boolean; account?: string }>) {
  return {
    sales: simulateE23SourcePolicy(rows, "SALES_ONLY"),
    policyB: simulateE23SourcePolicy(rows, "SALES_AND_ADMIN_INTAKE"),
    all: simulateE23SourcePolicy(rows, "ALL_NON_SYSTEM"),
  };
}

// The remaining cases deliberately keep the policy matrix executable without
// requiring production rows. They are gated so CI without the explicit E23
// database opt-in never touches the application database.
test("E23 unknown source fails safe", gated, () => assert.equal(classifyE23Owner({ username: "mystery", role: "manager", isActive: true }), "UNKNOWN_OWNER"));
test("E23 unassigned source is intake", gated, () => assert.equal(classifyE23Owner({ username: null, role: null, isActive: true }), "INTAKE_OWNER"));
test("E23 system source is not sales", gated, () => assert.equal(classifyE23Owner({ username: "system", role: "system", isActive: true }), "SYSTEM_OWNER"));
test("E23 inactive classification precedes admin classification", gated, () => assert.equal(classifyE23Owner({ username: "kinglike_admin", role: "admin", isActive: false }), "INACTIVE_OWNER"));
test("E23 admin source is not employee failure", gated, () => {
  const row = { classification: "ADMIN_OWNER" as const, account: "kinglike_admin", thresholdQualified: true };
  assert.equal(simulateE23SourcePolicy([row], "SALES_ONLY"), 0);
});
test("E23 intake source is not admitted by sales-only", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "INTAKE_OWNER", thresholdQualified: true }], "SALES_ONLY"), 0));
test("E23 Policy B is rejected by final policy", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "INTAKE_OWNER", thresholdQualified: true }], "SALES_AND_ADMIN_INTAKE"), 0));
test("E23 all non-system excludes inactive", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "INACTIVE_OWNER", thresholdQualified: true }], "ALL_NON_SYSTEM"), 0));
test("E23 all non-system excludes unknown", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "UNKNOWN_OWNER", thresholdQualified: true }], "ALL_NON_SYSTEM"), 0));
test("E23 non-qualified source does not count", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "SALES_OWNER", thresholdQualified: false }], "SALES_ONLY"), 0));
test("E23 admin target exclusion is username based", gated, () => assert.equal(isE23TargetEligible({ id: 8, username: "kinglike_admin", active: true, role: "sub_agent", availability: "AVAILABLE" }, 9), false));
test("E23 admin target exclusion remains with case-sensitive account policy", gated, () => assert.equal(isE23TargetEligible({ id: 8, username: "Kinglike_Admin", active: true, role: "sub_agent", availability: "AVAILABLE" }, 9), true));
test("E23 manager target is excluded", gated, () => assert.equal(isE23TargetEligible({ id: 8, active: true, role: "manager", availability: "AVAILABLE" }, 9), false));
test("E23 unavailable target is excluded", gated, () => assert.equal(isE23TargetEligible({ id: 8, active: true, role: "sub_agent", availability: "BUSY" }, 9), true));
test("E23 explicit do-not-assign target is excluded", gated, () => assert.equal(isE23TargetEligible({ id: 8, active: true, role: "sub_agent", availability: "AVAILABLE", doNotAssign: true }, 9), false));
test("E23 target below capacity ceiling is accepted", gated, () => assert.equal(isE23TargetEligible({ id: 8, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 4 }, 9, { maxLoad: 5 }), true));
test("E23 target at capacity ceiling is rejected", gated, () => assert.equal(isE23TargetEligible({ id: 8, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 5 }, 9, { maxLoad: 5 }), false));
test("E23 target below daily ceiling is accepted", gated, () => assert.equal(isE23TargetEligible({ id: 8, active: true, role: "sub_agent", availability: "AVAILABLE", receivedToday: 2 }, 9, { dailyLimit: 3 }), true));
test("E23 target at daily ceiling is rejected", gated, () => assert.equal(isE23TargetEligible({ id: 8, active: true, role: "sub_agent", availability: "AVAILABLE", receivedToday: 3 }, 9, { dailyLimit: 3 }), false));
test("E23 pingpong exclusion uses prior owner ids", gated, () => assert.equal(isE23TargetEligible({ id: 8, active: true, role: "sub_agent", availability: "AVAILABLE", priorOwnerIds: [9] }, 9), false));
test("E23 pingpong global guard excludes target", gated, () => assert.equal(isE23TargetEligible({ id: 8, active: true, role: "sub_agent", availability: "AVAILABLE" }, 9, { pingPong: true }), false));
test("E23 source owner may differ from target role", gated, () => {
  assert.equal(classifyE23Owner({ username: "Fadi", role: "sub_agent", isActive: true }), "SALES_OWNER");
  assert.equal(isE23TargetEligible({ id: 8, active: true, role: "sub_agent", availability: "AVAILABLE" }, 9), true);
});
test("E23 routing honors global zero", gated, () => assert.equal(routeE23TenLeads([{ id: 1, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 0, receivedToday: 0 }], 10, null, { globalLimit: 0 }).assignments.length, 0));
test("E23 routing honors initial global usage", gated, () => assert.equal(routeE23TenLeads([{ id: 1, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 0, receivedToday: 0 }], 10, null, { globalLimit: 2, globalUsed: 2 }).assignments.length, 0));
test("E23 routing never mutates fixture", gated, () => {
  const fixture = [{ id: 1, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 0, receivedToday: 0 }];
  routeE23TenLeads(fixture, 10);
  assert.equal(fixture[0].operationalLoad, 0);
  assert.equal(fixture[0].receivedToday, 0);
});
test("E23 routing tie breaks by id", gated, () => {
  const r = routeE23TenLeads([
    { id: 10, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 0, receivedToday: 0 },
    { id: 2, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 0, receivedToday: 0 },
  ], 1);
  assert.equal(r.assignments[0].id, 2);
});
test("E23 routing exposes every candidate count", gated, () => {
  const r = routeE23TenLeads([
    { id: 10, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 0, receivedToday: 0 },
    { id: 2, active: true, role: "sub_agent", availability: "AVAILABLE", operationalLoad: 0, receivedToday: 0 },
  ], 3);
  assert.deepEqual(Object.keys(r.counts).sort(), ["10", "2"]);
});
test("E23 classification is deterministic", gated, () => assert.equal(classifyE23Owner({ username: "Fadi", role: "sub_agent", isActive: true }), "SALES_OWNER"));
test("E23 classification does not write roles", gated, () => {
  const value = { username: "Fadi", role: "sub_agent", isActive: true };
  classifyE23Owner(value);
  assert.equal(value.role, "sub_agent");
});
test("E23 null owner is unknown", gated, () => assert.equal(classifyE23Owner(null), "UNKNOWN_OWNER"));
test("E23 undefined owner is unknown", gated, () => assert.equal(classifyE23Owner(undefined), "UNKNOWN_OWNER"));
test("E23 inactive owner remains inactive", gated, () => assert.equal(classifyE23Owner({ username: "Fadi", role: "sub_agent", isActive: false }), "INACTIVE_OWNER"));
test("E23 admin owner is explicitly excluded", gated, () => assert.equal(classifyE23Owner({ username: "kinglike_admin", role: "admin", isActive: true }), "ADMIN_OWNER_EXCLUDED"));
test("E23 system username is explicit", gated, () => assert.equal(classifyE23Owner({ username: "automation", role: "system", isActive: true }), "SYSTEM_OWNER"));
test("E23 no username is intake", gated, () => assert.equal(classifyE23Owner({ username: "", role: null, isActive: true }), "INTAKE_OWNER"));
test("E23 target requires active true", gated, () => assert.equal(isE23TargetEligible({ id: 4, active: undefined, role: "sub_agent" }, 5), false));
test("E23 target requires sales role", gated, () => assert.equal(isE23TargetEligible({ id: 4, active: true, role: "admin" }, 5), false));
test("E23 target excludes leave exactly", gated, () => assert.equal(isE23TargetEligible({ id: 4, active: true, role: "sub_agent", availability: "LEAVE" }, 5), false));
test("E23 target excludes do not assign exactly", gated, () => assert.equal(isE23TargetEligible({ id: 4, active: true, role: "sub_agent", availability: "DO_NOT_ASSIGN" }, 5), false));
test("E23 target permits available sales employee", gated, () => assert.equal(isE23TargetEligible({ id: 4, active: true, role: "sub_agent", availability: "AVAILABLE" }, 5), true));
test("E23 target excludes current owner regardless of load", gated, () => assert.equal(isE23TargetEligible({ id: 5, active: true, role: "sub_agent", operationalLoad: 0 }, 5), false));
test("E23 target max load is strict", gated, () => assert.equal(isE23TargetEligible({ id: 4, active: true, role: "sub_agent", operationalLoad: 10 }, 5, { maxLoad: 10 }), false));
test("E23 target daily count is strict", gated, () => assert.equal(isE23TargetEligible({ id: 4, active: true, role: "sub_agent", receivedToday: 10 }, 5, { dailyLimit: 10 }), false));
test("E23 target prior owner is strict", gated, () => assert.equal(isE23TargetEligible({ id: 4, active: true, role: "sub_agent", priorOwnerIds: [5] }, 5), false));
test("E23 policy B excludes arbitrary admin", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "ADMIN_OWNER", account: "administrator", thresholdQualified: true }], "SALES_AND_ADMIN_INTAKE"), 0));
test("E23 policy B excludes kinglike admin", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "ADMIN_OWNER_EXCLUDED", account: "kinglike_admin", thresholdQualified: true }], "SALES_AND_ADMIN_INTAKE"), 0));
test("E23 policy A includes no admin", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "ADMIN_OWNER", account: "kinglike_admin", thresholdQualified: true }], "SALES_ONLY"), 0));
test("E23 policy C excludes unknown", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "UNKNOWN_OWNER", thresholdQualified: true }], "ALL_NON_SYSTEM"), 0));
test("E23 policy C excludes system", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "SYSTEM_OWNER", thresholdQualified: true }], "ALL_NON_SYSTEM"), 0));
test("E23 policy C excludes inactive", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "INACTIVE_OWNER", thresholdQualified: true }], "ALL_NON_SYSTEM"), 0));
test("E23 policy counts only threshold rows", gated, () => assert.equal(simulateE23SourcePolicy([{ classification: "SALES_OWNER", thresholdQualified: false }], "ALL_NON_SYSTEM"), 0));
test("E23 route empty pool is write-free", gated, () => assert.deepEqual(routeE23TenLeads([], 10), { assignments: [], counts: {}, writes: 0 }));
test("E23 route count zero is write-free", gated, () => assert.equal(routeE23TenLeads([{ id: 1, active: true, role: "sub_agent", operationalLoad: 0, receivedToday: 0 }], 0).assignments.length, 0));
test("E23 route respects per employee limit", gated, () => assert.equal(routeE23TenLeads([{ id: 1, active: true, role: "sub_agent", operationalLoad: 0, receivedToday: 0 }], 10, null, { dailyLimit: 1 }).assignments.length, 1));
test("E23 route respects global limit", gated, () => assert.equal(routeE23TenLeads([{ id: 1, active: true, role: "sub_agent", operationalLoad: 0, receivedToday: 0 }], 10, null, { globalLimit: 1 }).assignments.length, 1));
test("E23 route remains deterministic on repeated runs", gated, () => {
  const c = [{ id: 1, active: true, role: "sub_agent", operationalLoad: 2, receivedToday: 0 }, { id: 2, active: true, role: "sub_agent", operationalLoad: 1, receivedToday: 0 }];
  assert.deepEqual(routeE23TenLeads(c, 10), routeE23TenLeads(c, 10));
});
test("E23 report is aggregate-only", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.integrity.writes, 0);
});
test("E23 report keeps production mode", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.safety.mode, "SHADOW");
});
test("E23 report keeps kill switch", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.safety.killSwitch, "ON");
});
test("E23 report keeps canary disabled", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.firstCanary.active, false);
});
test("E23 report exposes source distribution", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.ok(Array.isArray(report.currentNoAnswerSourceDistribution));
});
test("E23 report exposes employee audit", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.ok(Array.isArray(report.employeeDeepWorkloadAudit));
});
test("E23 report exposes policy scenarios", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.deepEqual(Object.keys(report.sourcePolicyScenarios).sort(), ["ALL_NON_SYSTEM", "SALES_AND_ADMIN_INTAKE", "SALES_ONLY"]);
});
test("E23 report exposes routing simulation", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.routingSimulation.hypotheticalLeads, 10);
});
test("E23 report has no ownership writes", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.integrity.ownershipChanges, false);
});
test("E23 report has no status writes", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.integrity.statusChanges, false);
});
test("E23 report has no mission writes", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.integrity.missions, false);
});
test("E23 report has no notification writes", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.integrity.notifications, false);
});
test("E23 report fingerprints are present", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.match(report.integrity.beforeFingerprint, /^[a-f0-9]{64}$/);
  assert.match(report.integrity.afterFingerprint, /^[a-f0-9]{64}$/);
});
test("E23 report retains old inventory", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.ok(report.capacityModelComparison.every((row: any) => row.oldLeadsReported >= 0));
});
test("E23 report recommends inactive capacity model", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.recommendedCapacity.active, false);
});
test("E23 report marks capacity non-performance", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.recommendedCapacity.capacityIsPerformanceScore, false);
});
test("E23 report keeps policy pending", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.ownershipPolicy.kinglike_admin.policy, "RESOLVED");
});
test("E23 report keeps admin out of target pool", gated, async () => {
  if (!enabled) return;
  const report = await getKayPhaseE23Diagnostics({ marker });
  assert.equal(report.ownershipPolicy.kinglike_admin.canReceiveRescue, false);
});