import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSafeKayEvaluatorRunner, evaluateRescueWindow, rescueSettingsSchema, recommendRescueEmployee } from "./kayService";

const now = new Date("2026-01-02T12:00:00.000Z");
const entered = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

test("Phase B evaluator: no-answer-1 below threshold is not eligible", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_1", statusEnteredAt: entered(1439), now, thresholdHours: 24 }).eligible, false));
test("Phase B evaluator: no-answer-1 at threshold is active", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_1", statusEnteredAt: entered(1440), now, thresholdHours: 24 }).state, "ACTIVE"));
test("Phase B evaluator: no-answer-2 below threshold is not eligible", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_2", statusEnteredAt: entered(1439), now, thresholdHours: 24 }).eligible, false));
test("Phase B evaluator: no-answer-2 at threshold is active", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_2", statusEnteredAt: entered(1440), now, thresholdHours: 24 }).state, "ACTIVE"));
test("Phase B evaluator: non-rescue statuses never activate", () =>
  assert.equal(evaluateRescueWindow({ status: "interested", statusEnteredAt: entered(3000), now, thresholdHours: 24 }).state, null));
test("Phase B evaluator: protected lead blocks a due rescue", () =>
  assert.deepEqual(evaluateRescueWindow({ status: "no_answer_1", statusEnteredAt: entered(1440), now, thresholdHours: 24, blockers: ["PROTECTED_LEAD"] }).blockers, ["PROTECTED_LEAD"]));
test("Phase B evaluator: future callback blocker is blocked", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_1", statusEnteredAt: entered(1440), now, thresholdHours: 24, blockers: ["FOLLOWUP_SCHEDULED"] }).state, "BLOCKED"));
test("Phase B evaluator: active task blocker is blocked", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_1", statusEnteredAt: entered(1440), now, thresholdHours: 24, blockers: ["ACTIVE_TASK"] }).state, "BLOCKED"));
test("Phase B evaluator: limit creates simulation-only limit state", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_1", statusEnteredAt: entered(1440), now, thresholdHours: 24, rescueAttempts: 2, maxAttempts: 2 }).state, "SIMULATED_LIMIT_REACHED"));
test("Phase B evaluator: elapsed duration is based on entry instant", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_1", statusEnteredAt: entered(1501), now, thresholdHours: 24 }).elapsedMinutes, 1501));
test("Phase B settings reject activation", () =>
  assert.equal(rescueSettingsSchema.safeParse({ no_answer_1_threshold_hours: 24, no_answer_2_threshold_hours: 24, max_human_rescue_attempts: 2, rescue_warning_minutes: 30, rescue_enabled: true }).success, false));
test("Phase B settings reject invalid threshold", () =>
  assert.equal(rescueSettingsSchema.safeParse({ no_answer_1_threshold_hours: 0, no_answer_2_threshold_hours: 24, max_human_rescue_attempts: 2, rescue_warning_minutes: 30, rescue_enabled: false }).success, false));
test("Phase B evaluator: absent status entry cannot infer lead age", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_1", statusEnteredAt: null, now, thresholdHours: 24 }).eligible, false));
test("Phase B evaluator: owner unavailable is an explicit observed blocker", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_2", statusEnteredAt: entered(1440), now, thresholdHours: 24, blockers: ["OWNER_UNAVAILABLE"] }).state, "BLOCKED"));
test("Phase B evaluator: future entry cannot produce negative duration", () =>
  assert.equal(evaluateRescueWindow({ status: "no_answer_1", statusEnteredAt: new Date(now.getTime() + 1), now, thresholdHours: 24 }).elapsedMinutes, 0));
test("Phase B setting limits reject arbitrary properties", () =>
  assert.equal(rescueSettingsSchema.safeParse({ no_answer_1_threshold_hours: 24, no_answer_2_threshold_hours: 24, max_human_rescue_attempts: 2, rescue_warning_minutes: 30, rescue_enabled: false, execute: true }).success, false));
test("Phase B service has no CRM status, assignment, task, or communication execution", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /update\(crmLeads\)|sendWhatsApp|sendEmail|send.*Message|assignedTo:\s*(?!.*observation)/);
});
const team = [
  { id: 1, name: "Current", activeLeadCount: 0, overdueTaskCount: 0 },
  { id: 2, name: "Balanced", activeLeadCount: 3, overdueTaskCount: 1 },
  { id: 3, name: "Busy", activeLeadCount: 4, overdueTaskCount: 2 },
];
test("recommendation excludes current owner", () => assert.equal(recommendRescueEmployee(team, 1).candidate?.id, 2));
test("recommendation selects lowest documented workload", () => assert.equal(recommendRescueEmployee(team, 99).candidate?.id, 1));
test("capacity score uses active plus double overdue", () => assert.equal(recommendRescueEmployee(team, 1).capacityScore, 5));
test("recent prior owner is avoided when alternative exists", () => assert.equal(recommendRescueEmployee([{ ...team[1], recentPreviousOwner: true }, team[2]], 99).candidate?.id, 3));
test("recent prior owner remains possible when only candidate", () => assert.equal(recommendRescueEmployee([{ ...team[1], recentPreviousOwner: true }], 99).candidate?.id, 2));
test("no candidates requests manager review", () => assert.equal(recommendRescueEmployee([], 1).managerReview, true));
test("only current owner requests manager review", () => assert.equal(recommendRescueEmployee([team[0]], 1).explanation, "NO_ELIGIBLE_EMPLOYEE"));
test("recommendation has deterministic id tie break", () => assert.equal(recommendRescueEmployee([{ id: 4, name: "b", activeLeadCount: 1, overdueTaskCount: 0 }, { id: 3, name: "a", activeLeadCount: 1, overdueTaskCount: 0 }], 99).candidate?.id, 3));
test("recommendation explanation discloses workload", () => assert.match(recommendRescueEmployee(team, 1).explanation, /3 active leads/));
test("protected blocker remains noneligible with recommendation data separate", () => assert.equal(evaluateRescueWindow({ status: "no_answer_1", statusEnteredAt: entered(1440), now, thresholdHours: 24, blockers: ["PROTECTED_LEAD"] }).eligible, false));
test("limit wins over otherwise active eligibility", () => assert.equal(evaluateRescueWindow({ status: "no_answer_2", statusEnteredAt: entered(1440), now, thresholdHours: 24, rescueAttempts: 9, maxAttempts: 2 }).state, "SIMULATED_LIMIT_REACHED"));
test("threshold accepts maximum one week", () => assert.equal(rescueSettingsSchema.safeParse({ no_answer_1_threshold_hours: 168, no_answer_2_threshold_hours: 168, max_human_rescue_attempts: 2, rescue_warning_minutes: 30, rescue_enabled: false }).success, true));
test("threshold rejects over one week", () => assert.equal(rescueSettingsSchema.safeParse({ no_answer_1_threshold_hours: 169, no_answer_2_threshold_hours: 24, max_human_rescue_attempts: 2, rescue_warning_minutes: 30, rescue_enabled: false }).success, false));
test("queue uses PostgreSQL skip-locked claims and stable window decisions", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  assert.match(source, /FOR UPDATE SKIP LOCKED/); assert.match(source, /rescue:\$\{lead\.id\}:\$\{lead\.status\}/);
});
test("schema/bootstrap preserve deleted-lead Kay history", () => {
  const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  assert.match(source, /ON DELETE SET NULL/); assert.match(source, /kay_evaluator_queue/);
});
test("Kay routes remain admin gated for evaluator settings and protection", () => {
  const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  assert.match(source, /kay\/rescue\/evaluate", requireKayAdmin/);
  assert.match(source, /kay\/leads\/:leadId\/protection", requireKayAdmin/);
});
test("status history uses exception-isolated database trigger, not route observation", () => {
  const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  assert.match(dbSource, /CREATE TRIGGER kay_crm_lead_status_entry_trigger/);
  assert.match(dbSource, /EXCEPTION WHEN OTHERS/);
  assert.match(dbSource, /payload->>'status' IS DISTINCT FROM NEW\.status/);
  assert.doesNotMatch(routeSource, /observeLeadStatusAfterCommit\(lead/);
});
test("incomplete overdue tasks remain active blockers", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  assert.match(source, /t\.completed_at IS NULL\) AS active_task/);
  assert.match(source, /FOLLOWUP_SCHEDULED/);
});
test("only simulated Kay rescue assignments count toward attempt limit", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  assert.match(source, /ah\.automatic=true AND ah\.reason='kay_rescue'/);
});
test("stale queue leases have bounded pending and failed transitions", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  assert.match(source, /attempts < 3/); assert.match(source, /status='failed'/);
});
test("deleted queue leads are completed rather than stranded", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  assert.match(source, /!job\.lead_id[\s\S]*status='completed'/);
});
test("same-window rescue decisions are reconciled", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  assert.match(source, /target: kayDecisions\.eventId/);
  const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  assert.match(dbSource, /kay_decisions_event_id_unique_idx/);
});
test("forced evaluator enqueue failure is isolated", async () => {
  let warned = false;
  await createSafeKayEvaluatorRunner({
    enqueue: async () => { throw new Error("forced"); },
    evaluate: async () => assert.fail("evaluation must not run"),
    warn: () => { warned = true; },
  })();
  assert.equal(warned, true);
});
test("forced evaluator processing failure is isolated", async () => {
  let warned = false;
  await createSafeKayEvaluatorRunner({
    enqueue: async () => {},
    evaluate: async () => { throw new Error("forced"); },
    warn: () => { warned = true; },
  })();
  assert.equal(warned, true);
});
test("status observation serializes concurrent windows", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  assert.match(source, /pg_advisory_xact_lock/);
});
test("protection state and audit are atomic", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  const section = source.slice(source.indexOf("export async function setLeadProtection"), source.indexOf("type QueueLead"));
  assert.match(section, /db\.transaction/);
  assert.match(section, /lead_protected/);
  assert.match(section, /lead_unprotected/);
});
test("obsolete rescue and orphan decisions become stale without deletion", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  assert.match(source, /jsonb_set\(payload, '\{state\}', '\"STALE\"'/);
  assert.doesNotMatch(source, /DELETE FROM kay_decisions/i);
});
test("rescue attempts are read from assignment history", () => {
  const source = readFileSync(new URL("./kayService.ts", import.meta.url), "utf8");
  assert.match(source, /FROM lead_assignment_history ah/);
  assert.match(source, /rescueAttempts: Number\(lead\.rescue_attempts/);
});