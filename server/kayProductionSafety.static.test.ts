import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

test("Kay production startup does not start any write-capable scheduler", () => {
  const source = read("index.ts");
  const startup = source.slice(source.indexOf("for (const step of bootSteps)"));
  assert.doesNotMatch(startup, /startKay(?:ShadowEvaluator|MissionGenerator|AutoRescueWorker)\(\)/);
  assert.doesNotMatch(startup, /startPhaseDEvaluator\(\)/);
  assert.match(startup, /all Kay schedulers disabled/);
  assert.doesNotMatch(startup, /ensureKayTables\(\)/);
  assert.match(source, /enforceKayProductionSafetyFreeze/);
});

test("all Kay HTTP mutations pass through the centralized denial middleware", () => {
  const source = read("routes.ts");
  const middleware = source.indexOf('app.use(["/api/kay", "/api/admin/kay"]');
  const firstMutation = source.indexOf('app.put("/api/admin/kay/');
  assert.ok(middleware >= 0 && middleware < firstMutation);
  assert.match(source.slice(middleware, firstMutation), /denyKayWrite\("http\.write"/);
});

test("legacy Kay execution entry points cannot bypass the Action Gateway", () => {
  const expectations: Array<[string, RegExp]> = [
    ["kayRescueService.ts", /executeRescueTransaction[\s\S]{0,500}assertRescueMutation\("rescue\.execute"/],
    ["kayAutoRescueService.ts", /runKayAutoRescueWorker[\s\S]{0,250}assertAutoRescueMutation\("rescue\.execute"/],
    ["kayPhaseE24Service.ts", /activateE24Fadi[\s\S]{0,250}denyKayWrite\("settings\.update"/],
    ["kayLegacyBaselineService.ts", /initializeLegacyBaselines[\s\S]{0,500}denyKayWrite\("crm\.write"/],
  ];
  for (const [file, pattern] of expectations) assert.match(read(file), pattern, file);
  assert.match(read("kayRescueService.ts"), /assertRescueMutation[\s\S]{0,800}denyKayWrite\(action/);
  assert.match(read("kayRescueService.ts"), /KAY_E1_POSTGRES_TESTS[\s\S]*KAY_E1_TEST_HOOKS[\s\S]*assertSafeKayMutationTestDatabase/);
  assert.match(read("kayAutoRescueService.ts"), /assertAutoRescueMutation[\s\S]{0,800}denyKayWrite\(action/);
  assert.match(read("kayMissionService.ts"), /generateKayMissions[\s\S]{0,500}assertKayInternalWriteAllowed/);
  assert.match(read("kayPhaseDService.ts"), /evaluatePhaseD[\s\S]{0,500}assertKayInternalWriteAllowed/);
  const gate = read("kayInternalWriteGate.ts");
  assert.match(gate, /KAY_INTERNAL_WRITE_TARGETS/);
  assert.doesNotMatch(gate, /\bcrm_(?:leads|tasks|notes|projects)\b/);
});

test("read-only analysis has no production writer-pool fallback", () => {
  const source = read("kayAnalysisDatabase.ts");
  assert.match(source, /KAY_ANALYSIS_DATABASE_URL/);
  assert.doesNotMatch(source, /from "\.\/db"/);
  assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /has_table_privilege/);
});

test("audit runtime uses a non-owner insert-only connection and performs no DDL", () => {
  const source = read("kayActionGateway.ts");
  assert.match(source, /KAY_AUDIT_DATABASE_URL/);
  assert.match(source, /has_table_privilege/);
  assert.match(source, /owns_ledger/);
  assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|ROLE|TRIGGER|FUNCTION)/i);
});

test("uncertain-reconciliation helper requires full DB preflight and the isolated E2 gate", () => {
  const source = read("kayAutoRescueService.ts");
  const helper = source.slice(source.indexOf("export async function reconcileAutoRescueUncertainForTest"), source.indexOf("export async function getAutoRescueHealth"));
  assert.match(helper, /assertSafeKayMutationTestDatabase/);
  assert.match(helper, /isolatedE2Test\(\)/);
  assert.match(helper, /return reconcileUncertain/);
});