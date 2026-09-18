import { enqueueKayEvaluationScan, runKayShadowEvaluator } from "../server/kayService";
import { generateKayMissions } from "../server/kayMissionService";
import { runPhaseDEvaluator } from "../server/kayPhaseDService";
import { withKayReadonlyAnalysis } from "../server/kayAnalysisDatabase";
import { verifyKayInternalDatabase, withKayInternalClient } from "../server/kayInternalDatabase";
import { assertKayProductionEntry } from "../server/kaySyntheticSafety";

const CRM_FINGERPRINTS = {
  crm_leads: ["id", "lead_source", "assigned_to", "lead_score", "status", "created_at", "updated_at", "last_contact_at", "business_received_at", "business_received_at_source", "wa_stage"],
  crm_tasks: ["id", "lead_id", "due_date", "due_time", "priority", "created_by", "completed_at", "reminder_sent_at", "created_at"],
  lead_assignment_history: ["id", "lead_id", "from_user_id", "to_user_id", "reason", "automatic", "kay_decision_id", "assigned_at", "ended_at"],
  crm_notes: ["id", "lead_id", "user_id", "created_at"],
  crm_projects: ["id", "is_active", "sort_order", "created_at"],
  users: ["id", "auth_method", "is_verified", "is_admin", "is_active", "role", "created_at"],
} as const;

type Fingerprint = { rowCount: number; structuralHash: string };
type Fingerprints = Record<keyof typeof CRM_FINGERPRINTS, Fingerprint>;

function requireConfiguration(): void {
  for (const key of ["KAY_ANALYSIS_DATABASE_URL", "KAY_INTERNAL_DATABASE_URL"] as const) {
    if (!process.env[key]?.trim()) throw new Error(`${key}_NOT_CONFIGURED`);
  }
}

async function captureCrmFingerprints(): Promise<Fingerprints> {
  return withKayReadonlyAnalysis(async client => {
    const output = {} as Fingerprints;
    for (const [table, columns] of Object.entries(CRM_FINGERPRINTS) as Array<
      [keyof typeof CRM_FINGERPRINTS, readonly string[]]
    >) {
      const values = columns.map(column => `"${column}"`).join(",");
      const result = await client.query(`
        SELECT COUNT(*)::int AS row_count,
          md5(COALESCE(
            string_agg(md5(jsonb_build_array(${values})::text), '' ORDER BY id),
            ''
          )) AS structural_hash
        FROM "${table}"
      `);
      output[table] = {
        rowCount: Number(result.rows[0]?.row_count ?? 0),
        structuralHash: String(result.rows[0]?.structural_hash ?? ""),
      };
    }
    return output;
  });
}

async function captureInternalCounts() {
  return withKayInternalClient(async client => {
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM kay_evaluator_queue) AS evaluation_jobs,
        (SELECT COUNT(*)::int FROM kay_internal_briefings) AS briefings,
        (SELECT COUNT(*)::int FROM kay_manager_reviews) AS manager_reviews
    `);
    return {
      evaluationJobs: Number(result.rows[0]?.evaluation_jobs ?? 0),
      briefings: Number(result.rows[0]?.briefings ?? 0),
      managerReviews: Number(result.rows[0]?.manager_reviews ?? 0),
    };
  });
}

function compareFingerprints(before: Fingerprints, after: Fingerprints) {
  return (Object.keys(CRM_FINGERPRINTS) as Array<keyof typeof CRM_FINGERPRINTS>)
    .filter(table =>
      before[table].rowCount !== after[table].rowCount ||
      before[table].structuralHash !== after[table].structuralHash
    )
    .map(table => ({ table, before: before[table], after: after[table] }));
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .slice(0, 300);
}

function diagnosticErrors(values: unknown[]) {
  const serialized = values.map(value => JSON.stringify(value ?? {}));
  return {
    lease: serialized.filter(value => /lease_busy|lease_lost|fence_lost/i.test(value)),
    scope: serialized.filter(value => /KAY_SCOPE_|UNKNOWN_IDENTITY|SCOPE_/i.test(value)),
    duplicateOrIdempotency: serialized.filter(value => /duplicate|unique|idempoten/i.test(value)),
  };
}

async function main() {
  requireConfiguration();
  assertKayProductionEntry(undefined);
  await verifyKayInternalDatabase();

  const before = await captureCrmFingerprints();
  const internalBefore = await captureInternalCounts();
  const stages: Record<string, unknown> = {};
  let stageError: string | null = null;

  try {
    await enqueueKayEvaluationScan();
    const afterEnqueue = await captureInternalCounts();
    stages.evaluationJobsEnqueued = Math.max(0, afterEnqueue.evaluationJobs - internalBefore.evaluationJobs);

    stages.evaluator = await runKayShadowEvaluator();
    stages.evaluationJobsProcessed = Number((stages.evaluator as any)?.checked ?? 0);
    stages.missions = await generateKayMissions(200, "manual", null);
    stages.phaseD = await runPhaseDEvaluator();
  } catch (error) {
    stageError = safeError(error);
  }

  const after = await captureCrmFingerprints();
  const internalAfter = await captureInternalCounts();
  const crmDifferences = compareFingerprints(before, after);
  const diagnostics = diagnosticErrors([stageError, stages.evaluator, stages.missions, stages.phaseD]);
  const passed = !stageError && crmDifferences.length === 0 &&
    diagnostics.lease.length === 0 && diagnostics.scope.length === 0 &&
    diagnostics.duplicateOrIdempotency.length === 0;

  return {
    cycleVerification: passed ? "PASS" : "FAIL",
    fingerprints: { before, after, differences: crmDifferences },
    results: {
      evaluationJobsEnqueued: Number(stages.evaluationJobsEnqueued ?? 0),
      evaluationJobsProcessed: Number(stages.evaluationJobsProcessed ?? 0),
      evaluator: stages.evaluator ?? null,
      missions: stages.missions ?? null,
      phaseD: stages.phaseD ?? null,
      newBriefings: Math.max(0, internalAfter.briefings - internalBefore.briefings),
      newManagerReviews: Math.max(0, internalAfter.managerReviews - internalBefore.managerReviews),
    },
    errors: { stage: stageError, ...diagnostics },
    safety: {
      crmWritesAllowed: false,
      customerCommunicationAllowed: false,
      longLivedWorkersStarted: false,
    },
  };
}

main()
  .then(report => {
    const code = report.cycleVerification === "PASS" ? 0 : 1;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, () => process.exit(code));
  })
  .catch(error => {
    const report = {
      cycleVerification: "FAIL",
      error: safeError(error),
      safety: {
        crmWritesAllowed: false,
        customerCommunicationAllowed: false,
        longLivedWorkersStarted: false,
      },
    };
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`, () => process.exit(1));
  });