import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isKayCrmFieldProtected, isKayOwnedTable } from "./kayActionPolicy";
import { denyKayWrite, evaluateKayAction } from "./kayActionGateway";

const permanentModes = ["shadow", "assisted", "controlled_automation", "unknown", undefined] as const;
const crmMutations = [
  "crm.write",
  "crm.insert",
  "crm.update",
  "crm.delete",
  "tasks.create",
  "tasks.update",
  "tasks.complete",
  "tasks.delete",
  "leads.reassign",
  "rescue.execute",
  "http.write",
] as const;

function request(action: string, mode: string, overrides: Record<string, unknown> = {}) {
  return {
    action,
    actionKind: "write" as const,
    environment: "test",
    mode,
    killSwitch: false,
    dryRun: false,
    actorCapabilities: ["kay.crm.write", "kay.leads.reassign", "kay.rescue.execute", "kay.tasks.create"],
    ...overrides,
  };
}

test("the permanent policy blocks every CRM mutation across modes and settings", () => {
  for (const action of crmMutations) {
    for (const mode of permanentModes) {
      for (const settings of [
        { killSwitch: true, dryRun: false, canary: false },
        { killSwitch: false, dryRun: true, canary: false },
        { killSwitch: false, dryRun: false, canary: true, canaryEnabled: true, canaryTarget: true },
        { killSwitch: false, dryRun: true, canary: true, canaryEnabled: false, canaryTarget: false },
      ]) {
        const result = evaluateKayAction(request(action, mode as any, settings));
        assert.equal(result.ok, false, `${action} ${mode}`);
        assert.equal(result.audit.action, "CRM_MUTATION_BLOCKED");
        assert.equal(result.audit.policy.reason, "KAY_CRM_READ_ONLY_POLICY");
      }
    }
  }
});

test("future CRM mutation action names remain blocked by namespace", () => {
  for (const action of ["crm.future_update", "crm.future.bulk_edit", "tasks.future_complete", "leads.future_reassign"]) {
    const result = evaluateKayAction(request(action, "shadow"));
    assert.equal(result.ok, false, action);
    assert.equal(result.audit.policy.reason, "KAY_CRM_READ_ONLY_POLICY");
  }
});

test("unknown and future CRM fields are protected by default", () => {
  for (const field of [
    "name", "phone", "email", "metaLeadId", "whatsappIdentity", "leadSource",
    "status", "assignedTo", "tags", "notes", "projectInterest", "futureCrmField",
    "kay_owner_epoch",
  ]) {
    assert.equal(isKayCrmFieldProtected(field), true, field);
  }
  assert.equal(isKayCrmFieldProtected("recommendation"), true);
  assert.equal(isKayCrmFieldProtected("recommendation", "kay_decisions"), false);
  assert.equal(isKayCrmFieldProtected("kay_owner_epoch", "crm_leads"), true);
});

test("Kay-owned tables remain an explicit, finite write allowlist", () => {
  for (const table of ["kay_events", "kay_decisions", "kay_missions", "kay_commitments", "kay_promises"]) {
    assert.equal(isKayOwnedTable(table), true, table);
  }
  for (const table of ["crm_leads", "crm_tasks", "crm_notes", "lead_assignment_history", "users", "future_kay_table"]) {
    assert.equal(isKayOwnedTable(table), false, table);
  }
});

test("direct Kay mutation calls throw before any caller can reach a transaction", () => {
  assert.throws(
    () => denyKayWrite("crm.update", 7, "crm_lead", 42),
    (error: any) => error?.code === "KAY_CRM_MUTATION_DENIED" &&
      error?.reason === "KAY_CRM_READ_ONLY_POLICY" &&
      error?.status === 423,
  );
});

test("legacy execution entry points have a guard before their write-capable pool", () => {
  const files = [
    "kayRescueService.ts",
    "kayAutoRescueService.ts",
    "kayMissionService.ts",
    "kayPhaseDService.ts",
    "kayPhaseE24Service.ts",
    "kayLegacyBaselineService.ts",
    "kayLeadScopeService.ts",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(source, /denyKayWrite\(/, file);
  }
});

test("the analysis connection has no generic production fallback", () => {
  const source = readFileSync(new URL("./kayAnalysisDatabase.ts", import.meta.url), "utf8");
  assert.match(source, /KAY_ANALYSIS_DATABASE_URL/);
  assert.doesNotMatch(source, /(?<!KAY_ANALYSIS_)\b(?:DATABASE_URL|NEON_DATABASE_URL)\b/);
  assert.doesNotMatch(source, /from "\.\/db"/);
});

test("normal human CRM routes are outside the Kay route namespace", () => {
  const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const kayMiddleware = source.indexOf('app.use(["/api/kay", "/api/admin/kay"]');
  const humanCrm = source.search(/app\.(post|put|patch|delete)\(["']\/api\/(?:admin\/)?crm/);
  assert.ok(humanCrm >= 0 && kayMiddleware >= 0);
  assert.match(source.slice(humanCrm, humanCrm + 120), /\/api\/admin\/crm/);
  assert.doesNotMatch(source.slice(kayMiddleware, kayMiddleware + 120), /\/api\/admin\/crm/);
});

test("CRM recommendation and promise history reads use dedicated analysis only", () => {
  const rescue = readFileSync(new URL("./kayRescueService.ts", import.meta.url), "utf8");
  const scope = readFileSync(new URL("./kayLeadScopeService.ts", import.meta.url), "utf8");
  assert.match(rescue, /getAssistedRescuePreview[\s\S]*withKayReadonlyAnalysis/);
  assert.match(rescue, /listPromiseHandoffs[\s\S]*withKayReadonlyAnalysis/);
  assert.doesNotMatch(rescue.slice(rescue.indexOf("export async function getAssistedRescuePreview"), rescue.indexOf("export async function acceptPromiseHandoff")), /pool\.query/);
  assert.doesNotMatch(scope, /getKayScopeForLead\(\s*(?:executor|client|pool)/);
  assert.match(scope, /export async function getKayScopeForLead\(leadId: number\)/);
});

test("readonly diagnostics cannot receive caller-supplied executors", () => {
  const legacy = readFileSync(new URL("./kayLegacyBaselineService.ts", import.meta.url), "utf8");
  assert.match(legacy, /export async function resolveKayStatusWindow\(leadId: number, status\?: string\)/);
  assert.match(legacy, /export async function getLegacyBaselineReadiness\(scope\?: E22TestScope\)/);
  assert.match(legacy, /export async function getLegacyOwnerDiagnostics\(scope\?: E22TestScope\)/);
  assert.match(legacy, /export async function getLegacyCapacitySensitivity\(scope\?: E22TestScope\)/);
  const e23 = readFileSync(new URL("./kayPhaseE23Service.ts", import.meta.url), "utf8");
  assert.match(e23, /export async function getE23CapacitySnapshot\(\): Promise<any>/);
  const phaseD = readFileSync(new URL("./kayPhaseDService.ts", import.meta.url), "utf8");
  assert.match(phaseD, /export async function listCommitments\(employeeId: number, admin: boolean\) \{[\s\S]*withKayReadonlyAnalysis/);
  assert.match(phaseD, /export async function listPromises\(employeeId: number, admin: boolean\) \{[\s\S]*withKayReadonlyAnalysis/);
});

test("legacy continuity repair is unconditionally denied before any executor", () => {
  const source = readFileSync(new URL("./kayLegacyBaselineService.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function repairLegacyBaselineContinuityDuplicates");
  const end = source.indexOf("\n\nasync function readKayStatusWindow", start + 1);
  const repair = source.slice(start, end < 0 ? source.length : end);
  assert.match(repair, /await denyKayWrite\(/);
  assert.doesNotMatch(repair, /executor|pool\.query|UPDATE\s+/i);
});
