import { runKayE21ReadonlyAudit } from "../server/kayAutoRescueAuditService";
import type { KayE21AuditReport } from "../server/kayAutoRescueAuditService";
import { fileURLToPath } from "node:url";

export function renderKayE21AuditMarkdown(report: KayE21AuditReport) {
  const sim = (status: string) => report.simulations[status] || {};
  const simulationLines = (status: string) => {
    const values = sim(status);
    const blocked = Object.entries(values)
      .filter(([key]) => key.startsWith("BLOCKED_"))
      .reduce((total, [, value]) => total + Number(value || 0), 0);
    return [
      `NOT_YET_ELIGIBLE: ${values.NOT_YET_ELIGIBLE || 0}`,
      `WOULD_RESCUE: ${values.WOULD_RESCUE || 0}`,
      `BLOCKED: ${blocked}`,
      `NO_ELIGIBLE_EMPLOYEE: ${values.NO_ELIGIBLE_EMPLOYEE || 0}`,
      `LIMIT_REACHED: ${values.LIMIT_REACHED || values.SIMULATED_LIMIT_REACHED || 0}`,
      `MANAGER_REVIEW: ${values.MANAGER_REVIEW || 0}`,
    ];
  };
  const lines = [
    "## Full Population",
    `Total CRM Leads: ${report.fullPopulation.totalCrmLeads}`, `Relevant Leads Evaluated: ${report.fullPopulation.relevantEvaluated}`,
    `No Answer 1: ${report.fullPopulation.noAnswer1}`, `No Answer 2: ${report.fullPopulation.noAnswer2}`,
    `No Answer 3 compatibility: ${report.fullPopulation.noAnswer3Compatibility}`, `No Answer 4: ${report.fullPopulation.noAnswer4}`, `Unknown relevant statuses: ${report.fullPopulation.unknownReview}`,
    "## No Answer 1 Simulation", ...simulationLines("no_answer_1"),
    "## No Answer 2 Simulation", ...simulationLines("no_answer_2"),
    "## Blocker Analysis", ...Object.entries(report.blockerAnalysis).map(([k,v]) => `${k}: ${v}`),
    "## Employee Load Simulation", ...report.employeeLoad.map(x => `${x.employee}: Current active ${x.currentActive}; Current capacity ${x.currentCapacity}; Would lose ${x.wouldLose}; Would receive ${x.wouldReceive}; Projected capacity ${x.projectedCapacity}`),
    "## Simulated Transfer Matrix", ...Object.entries(report.transferMatrix).map(([k,v]) => `${k}: ${v}`),
    "## Ping-Pong Prevention", `Count prevented: ${report.pingPongPrevented}`,
    "## Rescue Attempt Limits", ...Object.entries(report.attempts).map(([k,v]) => `${k} prior: ${v}`),
    "## Daily Limit Simulation", `Raw eligible: ${report.dailyLimitSimulation.rawEligible}`, `Executable under limits: ${report.dailyLimitSimulation.executable}`, `Deferred global: ${report.dailyLimitSimulation.deferredGlobal}`, `Deferred employee: ${report.dailyLimitSimulation.deferredEmployee}`, `Manager Review: ${report.dailyLimitSimulation.managerReview}`,
    "## Protected Lead Audit", ...Object.entries(report.protectedLeadAudit).map(([k,v]) => `${k}: ${v}`),
    "## Availability Audit", ...Object.entries(report.availabilityAudit).map(([k,v]) => `${k}: ${v}`),
    "## Historical 7-Day Replay", `${report.historicalReplay.status}: ${report.historicalReplay.reasons.join("; ")}`,
    "## Recommended First Canary", `Employee: ${report.canary.employee || "NO MEANINGFUL CANARY CANDIDATE CURRENTLY EXISTS"}`, `Why: ${report.canary.reason}`, `Estimated Rescue volume: ${report.canary.estimatedRescueVolume}`, `Risk flags: ${report.canary.riskFlags.join(", ") || "none"}`, `Receiving employees: ${report.canary.receivingEmployees.join(", ") || "none"}`,
    "## Anonymized Examples", ...report.examples.map(x => `${x.lead}: ${x.status}; ${x.outcome}; ${x.elapsedMinutes}m; target ${x.recommendedTarget || "none"}`),
    "## Integrity Verification",
    `Ownership writes: ${report.integrity.ownershipWrites}`,
    `CRM status writes: ${report.integrity.crmStatusWrites}`,
    `CRM Task changes: ${report.integrity.crmTaskWrites}`,
    `Promise changes: ${report.integrity.promiseWrites}`,
    `Commitment changes: ${report.integrity.commitmentWrites}`,
    `Customer communication: ${report.integrity.customerCommunicationWrites}`,
    `Notifications: ${report.integrity.notifications}`,
    `Auto Rescue queue EXECUTED changes: ${report.integrity.queueExecutedWrites}`,
    `Read-only write rejection proven: ${report.integrity.readOnlyWriteRejectionProven === true}`,
    `Integrity failed: ${report.integrity.integrityFailed}`,
    `Communication evidence: ${report.integrity.customerCommunicationEvidence}`,
    "## Current Production Safety State", `MODE = ${report.safetyState.mode}`, `AUTO NO ANSWER 1 = ${report.safetyState.autoNoAnswer1}`, `AUTO NO ANSWER 2 = ${report.safetyState.autoNoAnswer2}`, `KILL SWITCH = ${report.safetyState.killSwitch}`, `CANARY EMPLOYEE COUNT = ${report.safetyState.canaryEmployeeCount}`, `REAL AUTOMATIC REASSIGNMENTS = ${report.safetyState.realAutomaticReassignments}`,
  ];
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runKayE21ReadonlyAudit().then(report => {
    process.stdout.write(process.argv.includes("--json") ? `${JSON.stringify(report)}\n` : renderKayE21AuditMarkdown(report));
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : "Read-only audit failed" })}\n`);
    process.exitCode = 1;
  });
}