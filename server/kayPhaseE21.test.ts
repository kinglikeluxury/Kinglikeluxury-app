import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRescueWindow, recommendRescueEmployee, simulateDailyLimits } from "./kayAutoRescuePlanner";
import { rescueAttemptPredicate } from "./kayAutoRescuePlanner";
import { COMMUNICATION_FINGERPRINT_COLUMNS, selectCanaryCandidate } from "./kayAutoRescueAuditService";
import { renderKayE21AuditMarkdown } from "../scripts/kay-e21-readonly-audit";

test("E.2.1 planner uses production ranking, attempt limit and deterministic daily limits", () => {
  const now = new Date("2026-01-02T12:00:00.000Z");
  assert.equal(evaluateRescueWindow({
    status: "no_answer_1", statusEnteredAt: new Date("2026-01-01T10:00:00.000Z"), now,
    thresholdHours: 24, rescueAttempts: 2, maxAttempts: 2,
  }).state, "SIMULATED_LIMIT_REACHED");
  const chosen = recommendRescueEmployee([
    { id: 2, name: "A", activeLeadCount: 1, overdueTaskCount: 0, recentPreviousOwner: true },
    { id: 3, name: "B", activeLeadCount: 4, overdueTaskCount: 0 },
  ], 1);
  assert.equal(chosen.candidate?.id, 3);
  const simulation = simulateDailyLimits([{ ownerId: 1 }, { ownerId: 1 }, { ownerId: 2 }], 2, 1);
  assert.equal(simulation.executable.length, 2);
  assert.equal(simulation.deferredEmployee, 1);
});

test("E.2.1 canary rejects dynamic risks and selects only bounded candidate", () => {
  const loads=[{employeeId:1,employee:"safe",currentCapacity:4,projectedCapacity:4,availability:"AVAILABLE",wouldLose:1},{employeeId:2,employee:"risky",currentCapacity:8,projectedCapacity:12,availability:"LEAVE",wouldLose:4}];
  const result=selectCanaryCandidate(loads,{1:{relevant:2,blocked:0,complex:0},2:{relevant:4,blocked:3,complex:3}},{3:1});
  assert.equal(result.safe?.employee,"safe");
  assert.deepEqual(result.evaluated[1].riskFlags.sort(),["COMPLEX_ASSIGNMENT_HISTORY","HIGH_BLOCKER_RATE","HIGH_VOLUME","OWNER_UNAVAILABLE"].sort());
  assert.equal(selectCanaryCandidate([loads[1]],{2:{relevant:4,blocked:3,complex:3}},{3:1}).safe,undefined);
});

test("E.2.1 communication and CLI integrity contracts expose no content columns", () => {
  assert.equal(COMMUNICATION_FINGERPRINT_COLUMNS.some(x=>/message|phone|email|body|content/.test(x)),false);
  const markdown=renderKayE21AuditMarkdown({simulations:{},fullPopulation:{},blockerAnalysis:{},employeeLoad:[],transferMatrix:{},pingPongPrevented:0,attempts:{},dailyLimitSimulation:{},protectedLeadAudit:{},availabilityAudit:{},historicalReplay:{status:"INSUFFICIENT_RELIABLE_HISTORY",reasons:[]},canary:{employee:null,reason:"NO MEANINGFUL CANARY CANDIDATE CURRENTLY EXISTS",estimatedRescueVolume:0,receivingEmployees:[],riskFlags:[],metrics:null},examples:[],integrity:{ownershipWrites:0,crmStatusWrites:0,crmTaskWrites:0,promiseWrites:0,commitmentWrites:0,customerCommunicationWrites:0,notifications:0,queueExecutedWrites:0,readOnlyWriteRejectionProven:true,integrityFailed:false,customerCommunicationEvidence:"path=0"},safetyState:{mode:"SHADOW",autoNoAnswer1:"DISABLED",autoNoAnswer2:"DISABLED",killSwitch:"ON",canaryEmployeeCount:0,realAutomaticReassignments:0}} as any);
  for(const label of ["Ownership writes: 0","CRM status writes: 0","CRM Task changes: 0","Promise changes: 0","Commitment changes: 0","Customer communication: 0","Notifications: 0","Auto Rescue queue EXECUTED changes: 0"]) assert.match(markdown,new RegExp(label));
});

test("E.2.1 static contract keeps exact attempt predicate and ping-pong exclusion", () => {
  assert.match(rescueAttemptPredicate, /automatic=true/);
  const pick = recommendRescueEmployee([
    { id: 2, name: "pingpong", activeLeadCount: 0, overdueTaskCount: 0, pingPongPrevented: true },
    { id: 3, name: "safe", activeLeadCount: 50, overdueTaskCount: 0 },
  ], 1);
  assert.equal(pick.candidate?.id, 3);
  assert.equal(recommendRescueEmployee([{ id: 2, name: "blocked", activeLeadCount: 0, overdueTaskCount: 0, pingPongPrevented: true }], 1).explanation, "NO_ELIGIBLE_EMPLOYEE");
});

test("E.2.1 retains prior-owner penalty while ping-pong remains an exclusion", () => {
  const withoutPenalty = recommendRescueEmployee([
    { id: 2, name: "low", activeLeadCount: 1, overdueTaskCount: 0 },
    { id: 3, name: "higher", activeLeadCount: 2, overdueTaskCount: 0 },
  ], 1);
  const withPenalty = recommendRescueEmployee([
    { id: 2, name: "low", activeLeadCount: 1, overdueTaskCount: 0, recentPreviousOwner: true },
    { id: 3, name: "higher", activeLeadCount: 2, overdueTaskCount: 0 },
  ], 1);
  assert.equal(withoutPenalty.candidate?.id, 2);
  assert.equal(withPenalty.candidate?.id, 3);
  const daily = simulateDailyLimits([{ ownerId: 2 }], 5, 3, 0, new Map([[2, 3]]));
  assert.equal(daily.deferredEmployee, 1);
});