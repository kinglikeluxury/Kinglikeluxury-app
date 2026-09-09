import test from "node:test";
import assert from "node:assert/strict";
import { classifyE23Owner, isE23TargetEligible, routeE23TenLeads, simulateE23SourcePolicy, E23_RECOMMENDED_FORMULA, E23_SAFETY_STATE } from "./kayPhaseE23Service";

test("E23 source classification is deterministic, Kay-only, and fail safe", () => {
  assert.equal(classifyE23Owner({ username: "kinglike_admin", role: "admin", isActive: true, isAdmin: true }), "ADMIN_OWNER_EXCLUDED");
  assert.equal(classifyE23Owner({ username: "Fadi", role: "sub_agent", isActive: true }), "SALES_OWNER");
  assert.equal(classifyE23Owner({ username: "unknown", role: "manager", isActive: true }), "UNKNOWN_OWNER");
  assert.equal(classifyE23Owner(undefined), "UNKNOWN_OWNER");
});
test("E23 target policy is separate and strict", () => {
  const base = { id: 2, active: true, role: "sub_agent", availability: "AVAILABLE" };
  assert.equal(isE23TargetEligible({ ...base, id: 1 }, 1), false);
  assert.equal(isE23TargetEligible({ ...base, id: 2 }, 1), true);
  for (const availability of ["LEAVE", "DO_NOT_ASSIGN"]) assert.equal(isE23TargetEligible({ ...base, availability }, 1), false);
  assert.equal(isE23TargetEligible({ ...base, active: false }, 1), false);
  assert.equal(isE23TargetEligible({ ...base, role: "admin" }, 1), false);
  assert.equal(isE23TargetEligible({ ...base, id: 3 }, 1, { pingPong: true }), false);
  assert.equal(isE23TargetEligible({ ...base, id: 3, receivedToday: 10 }, 1, { dailyLimit: 10 }), false);
});
test("E23 source scenarios never treat unknown or system as employee failure", () => {
  const rows = [
    { classification: "SALES_OWNER" as const, thresholdQualified: true },
    { classification: "ADMIN_OWNER" as const, account:"kinglike_admin", thresholdQualified: true },
    { classification: "UNKNOWN_OWNER" as const, thresholdQualified: true },
    { classification: "SYSTEM_OWNER" as const, thresholdQualified: true },
  ];
  assert.equal(simulateE23SourcePolicy(rows, "SALES_ONLY"), 1);
  assert.equal(simulateE23SourcePolicy(rows, "SALES_AND_ADMIN_INTAKE"), 0);
  assert.equal(simulateE23SourcePolicy(rows, "ALL_NON_SYSTEM"), 1);
});
test("E23 ten-lead simulation is pure, sequential, and deterministic", () => {
  const targets = [{ id: 3, active:true, role:"sub_agent", availability:"AVAILABLE", operationalLoad: 1, receivedToday: 0 }, { id: 2, active:true, role:"sub_agent", availability:"AVAILABLE", operationalLoad: 1, receivedToday: 0 }];
  const first = routeE23TenLeads(targets, 10);
  const second = routeE23TenLeads(targets, 10);
  assert.deepEqual(first, second);
  assert.equal(first.assignments.length, 10);
  assert.equal(first.writes, 0);
  assert.deepEqual(targets, [{ id: 3, active:true, role:"sub_agent", availability:"AVAILABLE", operationalLoad: 1, receivedToday: 0 }, { id: 2, active:true, role:"sub_agent", availability:"AVAILABLE", operationalLoad: 1, receivedToday: 0 }]);
});
test("E23 keeps production safety closed and capacity is not performance", () => {
  assert.equal(E23_SAFETY_STATE.mode, "SHADOW");
  assert.equal(E23_SAFETY_STATE.killSwitch, "ON");
  assert.equal(E23_SAFETY_STATE.canaryEmployeeCount, 0);
  assert.match(E23_RECOMMENDED_FORMULA, /nonterminal_0_30/);
});
test("E23 formula includes only non-duplicating hybrid terms", () => assert.equal(E23_RECOMMENDED_FORMULA, "recommended_operational_load = nonterminal_0_30 + 0.5*nonterminal_31_60 + 0.25*nonterminal_61_90 + 2*overdue_tasks + active_kay_missions + active_commitments + open_promises"));
test("E23 admin is never target even with sales role", () => assert.equal(isE23TargetEligible({id:4,username:"kinglike_admin",active:true,role:"sub_agent",availability:"AVAILABLE"},1), false));
test("E23 unknown candidate is excluded", () => assert.equal(isE23TargetEligible({id:4,active:true,role:"manager",availability:"AVAILABLE"},1), false));
test("E23 current owner is excluded", () => assert.equal(isE23TargetEligible({id:4,active:true,role:"sub_agent",availability:"AVAILABLE"},4), false));
test("E23 do not assign is excluded", () => assert.equal(isE23TargetEligible({id:4,active:true,role:"sub_agent",availability:"AVAILABLE",doNotAssign:true},1), false));
test("E23 max ceiling is inactive in simulation unless supplied", () => assert.equal(isE23TargetEligible({id:4,active:true,role:"sub_agent",availability:"AVAILABLE",operationalLoad:4},1,{maxLoad:4}), false));
test("E23 candidate prior-owner pingpong is excluded", () => assert.equal(isE23TargetEligible({id:4,active:true,role:"sub_agent",availability:"AVAILABLE",priorOwnerIds:[1]},1), false));
test("E23 daily limit is enforced", () => assert.equal(isE23TargetEligible({id:4,active:true,role:"sub_agent",availability:"AVAILABLE",receivedToday:3},1,{dailyLimit:3}), false));
test("E23 global limit is enforced sequentially", () => assert.equal(routeE23TenLeads([{id:1,active:true,role:"sub_agent",availability:"AVAILABLE",operationalLoad:0,receivedToday:0}],10,null,{globalLimit:2}).assignments.length,2));
test("E23 tie breaks on stable id", () => assert.equal(routeE23TenLeads([{id:9,active:true,role:"sub_agent",availability:"AVAILABLE",operationalLoad:0,receivedToday:0},{id:2,active:true,role:"sub_agent",availability:"AVAILABLE",operationalLoad:0,receivedToday:0}],1).assignments[0].id,2));
test("E23 routing reports counts by id", () => {
  const r=routeE23TenLeads([{id:1,active:true,role:"sub_agent",availability:"AVAILABLE",operationalLoad:0,receivedToday:0},{id:2,active:true,role:"sub_agent",availability:"AVAILABLE",operationalLoad:0,receivedToday:0}],3);
  assert.equal(r.counts["1"]+r.counts["2"],3);
});
test("E23 policy B is rejected and excludes admin", () => assert.equal(simulateE23SourcePolicy([{classification:"ADMIN_OWNER_EXCLUDED",account:"kinglike_admin",thresholdQualified:true}], "SALES_AND_ADMIN_INTAKE"),0));
test("E23 policy three excludes unknown inactive system", () => assert.equal(simulateE23SourcePolicy([{classification:"UNKNOWN_OWNER",thresholdQualified:true},{classification:"INACTIVE_OWNER",thresholdQualified:true},{classification:"SYSTEM_OWNER",thresholdQualified:true}], "ALL_NON_SYSTEM"),0));
test("E23 inactive owner classification wins", () => assert.equal(classifyE23Owner({username:"Fadi",role:"sub_agent",isActive:false}),"INACTIVE_OWNER"));
test("E23 intake classification is explicit for unassigned", () => assert.equal(classifyE23Owner({username:null,role:null,isActive:true}),"INTAKE_OWNER"));
test("E23 source and target APIs are distinct", () => assert.notEqual(classifyE23Owner({username:"x",role:"sub_agent",isActive:true}), isE23TargetEligible as any));
test("E23 simulation declares zero writes", () => assert.equal(routeE23TenLeads([],10).writes,0));