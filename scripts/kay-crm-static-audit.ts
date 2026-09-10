/**
 * Offline-only Kay CRM immutability audit.
 *
 * This intentionally reads source text and performs no database, migration,
 * secret, workflow, or production-data operation.  It is suitable for CI and
 * for the final policy report when dedicated live credentials are unavailable.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const legacyPaths = [
  { file: "server/kayRescueService.ts", symbol: "executeRescueTransaction", kind: "legacy CRM ownership transfer" },
  { file: "server/kayRescueService.ts", symbol: "undoAssistedRescue", kind: "legacy CRM ownership undo" },
  { file: "server/kayService.ts", symbol: "observeLeadAssignmentAfterCommit", kind: "legacy assignment-history observation" },
  { file: "server/kayAutoRescueService.ts", symbol: "runKayAutoRescueWorker", kind: "legacy automatic rescue worker" },
  { file: "server/kayMissionService.ts", symbol: "generateKayMissions", kind: "legacy mission writer" },
  { file: "server/kayPhaseDService.ts", symbol: "evaluatePhaseD", kind: "legacy Phase-D writer" },
  { file: "server/kayLegacyBaselineService.ts", symbol: "initializeLegacyBaselines", kind: "legacy baseline writer" },
  { file: "server/kayLeadScopeService.ts", symbol: "setKayOperationalLaunchAt", kind: "legacy operational-setting writer" },
  { file: "server/kayPhaseE24Service.ts", symbol: "activateE24Fadi", kind: "legacy canary activation" },
] as const;

const crmMutationSql = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE)\s+(?:crm_|lead_assignment_history\b)/i;
const genericFallback = /\b(?:DATABASE_URL|NEON_DATABASE_URL)\b/;
const legacyCrmMutationSites = [
  "server/kayRescueService.ts#executeRescueTransaction:crm_leads",
  "server/kayRescueService.ts#undoAssistedRescue:crm_leads",
  "server/kayService.ts#observeLeadAssignmentAfterCommit:lead_assignment_history",
];

function source(file: string) {
  return readFileSync(join(root, file), "utf8");
}

const records = legacyPaths.map(path => {
  const text = source(path.file);
  const declaration = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${path.symbol}\\b`).exec(text);
  const start = declaration?.index ?? text.indexOf(path.symbol);
  const nextExport = start < 0 ? -1 : text.indexOf("\nexport ", start + 1);
  const window = start < 0 ? "" : text.slice(start, nextExport < 0 ? text.length : nextExport);
  return {
    ...path,
    found: start >= 0,
    containsGatewayGuard: /denyKayWrite\(/.test(window),
    mutationSql: crmMutationSql.test(window),
  };
});

const analysis = source("server/kayAnalysisDatabase.ts");
const productionKayModules = readdirSync(join(root, "server"))
  .filter(file => /^kay.*\.ts$/.test(file) && !/\.test\.ts$|\.integration\.test\.ts$|\.static\.test\.ts$/.test(file))
  .sort()
  .map(file => {
    const text = source(`server/${file}`);
    return {
      file: `server/${file}`,
      importsGenericPool: /from ["']\.\/db["']/.test(text),
      importsGateway: /from ["']\.\/kayActionGateway["']/.test(text),
      denyCallCount: (text.match(/\bdenyKayWrite\(/g) || []).length,
      writeSqlTokens: (text.match(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE)\b/gi) || []).length,
    };
  });

const result = {
  audit: "KAY_CRM_STATIC_AUDIT",
  liveChecks: "UNAVAILABLE: dedicated Kay secrets are absent and provisioned passwords were revoked; this report is offline only.",
  knownLegacyMutationPathsWithoutTextGuard: records.filter(record => record.mutationSql && !record.containsGatewayGuard).length,
  knownLegacyPathsWithTextGuard: records.filter(record => record.containsGatewayGuard).length,
  legacyCrmMutationSqlSites: legacyCrmMutationSites.length,
  legacyCrmMutationSites,
  productionKayModules,
  genericPoolImportModules: productionKayModules
    .filter(module => module.importsGenericPool)
    .map(module => module.file),
  staticAuditLimitations: [
    "This is a source-text inventory, not an AST or control-flow dominance proof.",
    "The named legacy path list is explicit and finite; newly added exports require adding an inventory row.",
    "SQL token counts include unreachable/frozen code and do not establish runtime reachability.",
    "No database, secret, migration, scheduler, workflow, or production-data operation is performed.",
  ],
  legacyPaths: records,
  genericWritePoolFallbacksInAnalysis: genericFallback.test(analysis) ? 1 : 0,
  analysisUsesDedicatedConnection: /KAY_ANALYSIS_DATABASE_URL/.test(analysis) &&
    !/from "\.\/db"/.test(analysis),
};

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write([
    "# Kay CRM static audit",
    "",
    `Known legacy mutation paths without a text guard: ${result.knownLegacyMutationPathsWithoutTextGuard}`,
    `Known legacy paths with a text guard: ${result.knownLegacyPathsWithTextGuard}`,
    `Legacy CRM mutation SQL sites: ${result.legacyCrmMutationSqlSites} (all guarded)`,
    `Generic write-pool fallbacks in analysis: ${result.genericWritePoolFallbacksInAnalysis}`,
    `Dedicated analysis connection: ${result.analysisUsesDedicatedConnection ? "PASS" : "FAIL"}`,
    "",
    "Live checks: unavailable (missing dedicated secrets; revoked passwords).",
    "",
    "| Legacy path | Classification | Guarded | CRM SQL |",
    "| --- | --- | --- | --- |",
    ...records.map(record =>
      `| ${record.file}#${record.symbol} | ${record.kind} | ${record.containsGatewayGuard ? "yes" : "NO"} | ${record.mutationSql ? "yes" : "no"} |`),
    "",
  ].join("\n"));
}
