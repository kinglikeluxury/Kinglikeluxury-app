import assert from "node:assert/strict";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertSafeKayMutationTestDatabase } from "../server/kayTestDatabaseSafety";

neonConfig.webSocketConstructor = ws;

const safe = assertSafeKayMutationTestDatabase("kayRecommendationCycle.once");
assert.equal(process.env.KAY_RECOMMENDATION_SCHEDULER_ENABLED, "true", "isolated child process must opt in for this one-cycle test");
for (const key of [
  "DATABASE_URL", "NEON_DATABASE_URL", "KAY_ANALYSIS_DATABASE_URL", "KAY_INTERNAL_DATABASE_URL",
  "KAY_AUDIT_DATABASE_URL", "KAY_MIGRATION_DATABASE_URL",
]) {
  assert.equal(process.env[key], undefined, `${key} must not be available to the isolated test process`);
}
assert.equal(
  Object.keys(process.env).some(key => /WHATSAPP|TWILIO|SMTP|GMAIL|RESEND|SMS|VOICE|CALL/i.test(key)),
  false,
  "outbound transport credentials must not be available",
);

const pool = new Pool({ connectionString: process.env.KAY_TEST_DATABASE_URL, max: 1 });
const marker = `KAY_RECOMMENDATION_CYCLE_TEST:${safe.testRunId}`;
let fixtureLeadId: number | null = null;
let report: Record<string, unknown> | null = null;

async function readCounts(client: { query: (text: string, values?: unknown[]) => Promise<any> }) {
  const result = await client.query(
    `SELECT current_database() AS database_name,current_user AS database_user,
      (SELECT COUNT(*)::int FROM public.crm_leads) AS crm_leads,
      (SELECT COUNT(*)::int FROM public.kay_evaluator_queue) AS queue_rows,
      (SELECT COUNT(*)::int FROM public.kay_events) AS event_rows,
      (SELECT COUNT(*)::int FROM public.kay_decisions) AS decision_rows,
      (SELECT COUNT(*)::int FROM public.kay_decisions WHERE payload->>$1=$2) AS stale_rows`,
    ["state", "STALE"],
  );
  const row = result.rows[0];
  assert.equal(row.database_name, safe.database);
  assert.equal(row.database_user, process.env.KAY_TEST_DATABASE_USER);
  return {
    crmLeads: Number(row.crm_leads),
    evaluatorQueue: Number(row.queue_rows),
    events: Number(row.event_rows),
    decisions: Number(row.decision_rows),
    staleDecisions: Number(row.stale_rows),
  };
}

async function main() {
  const client = await pool.connect();
  let before: Awaited<ReturnType<typeof readCounts>>;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    before = await readCounts(client);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  // The evaluator scans all test CRM leads; require an empty fixture scope so it
  // cannot process rows belonging to another test run.
  assert.equal(before!.crmLeads, 0, "test CRM must be empty before this run");
  assert.equal(before!.evaluatorQueue, 0, "test evaluator queue must be empty before this run");

  const inserted = await pool.query(
    `INSERT INTO public.crm_leads (lead_source,full_name,status,notes)
     VALUES ('manual',$1,'new',$1) RETURNING id`,
    [marker],
  );
  fixtureLeadId = Number(inserted.rows[0].id);

  const { startKayRecommendationScheduler, getKayRecommendationSchedulerStatus } =
    await import("../server/kayRecommendationScheduler");
  startKayRecommendationScheduler();

  const deadline = Date.now() + 30_000;
  let status = getKayRecommendationSchedulerStatus();
  while (!status.lastCycleCompletedAt && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    status = getKayRecommendationSchedulerStatus();
  }
  assert.ok(status.lastCycleCompletedAt, "the immediate one-off cycle did not finish in 30 seconds");
  assert.equal(status.enabled, true);
  assert.equal(status.lastCycleError, null);
  assert.equal(status.reason, null);
  assert.equal(status.lastCycleResult?.checked, 1, "cycle must process only the single test fixture");

  const afterClient = await pool.connect();
  let after: Awaited<ReturnType<typeof readCounts>>;
  let fixtureCheck: any;
  try {
    await afterClient.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    after = await readCounts(afterClient);
    const fixture = await afterClient.query(
      "SELECT status,full_name,notes,assigned_to FROM public.crm_leads WHERE id=$1",
      [fixtureLeadId],
    );
    fixtureCheck = fixture.rows[0];
    await afterClient.query("ROLLBACK");
  } finally {
    afterClient.release();
  }

  assert.deepEqual(fixtureCheck, {
    status: "new",
    full_name: marker,
    notes: marker,
    assigned_to: null,
  });
  assert.equal(after!.crmLeads, 1, "only the tagged test lead should exist");
  assert.equal(after!.evaluatorQueue, 1);
  assert.ok(after!.events > before!.events, "evaluation should add Kay event evidence");
  assert.ok(after!.decisions > before!.decisions, "evaluation should add Kay decision evidence");
  assert.equal(after!.staleDecisions, before!.staleDecisions, "the fixture should not stale any pre-existing recommendation");
  report = {
    result: "PASS",
    testDatabase: safe.database,
    databaseIdentityVerified: true,
    isolatedRunId: safe.testRunId,
    schedulerFlagScope: "isolated test subprocess only",
    oneCycleCompleted: true,
    childProcessExitedBeforeNextTick: true,
    cycle: status.lastCycleResult,
    before,
    after,
    fixtureLeadUnchangedByEvaluator: true,
    productionCredentialsAvailable: false,
    outboundTransportCredentialsAvailable: false,
    customerMessagesOrCallsPossible: false,
    productionCrmContacted: false,
  };
}

try {
  await main();
} catch (error) {
  const err = error as { name?: unknown; code?: unknown; message?: unknown };
  report = {
    result: "FAIL",
    reasonCode: typeof err.code === "string" ? err.code.slice(0, 80) : "ISOLATED_CYCLE_TEST_FAILED",
    errorClass: typeof err.name === "string" ? err.name.slice(0, 80) : "Error",
    // Never print messages that could contain database connection details.
  };
  process.exitCode = 1;
} finally {
  if (fixtureLeadId !== null) {
    const cleanup = await pool.connect();
    try {
      await cleanup.query("BEGIN");
      await cleanup.query("DELETE FROM public.kay_decisions WHERE lead_id=$1", [fixtureLeadId]);
      await cleanup.query("DELETE FROM public.kay_events WHERE lead_id=$1", [fixtureLeadId]);
      await cleanup.query("DELETE FROM public.kay_evaluator_queue WHERE lead_id=$1", [fixtureLeadId]);
      await cleanup.query("DELETE FROM public.kay_lead_status_history WHERE lead_id=$1", [fixtureLeadId]);
      await cleanup.query("DELETE FROM public.crm_leads WHERE id=$1 AND full_name=$2 AND notes=$2", [fixtureLeadId, marker]);
      await cleanup.query("COMMIT");
      if (report) report.fixtureCleanup = "completed";
    } catch {
      await cleanup.query("ROLLBACK").catch(() => {});
      process.exitCode = 1;
      report = { ...(report ?? {}), fixtureCleanup: "FAILED" };
    } finally {
      cleanup.release();
    }
  }
  await pool.end();
  console.log(JSON.stringify(report ?? { result: "FAIL", reasonCode: "NO_RESULT" }));
  // The scheduler timer is unref'd; exiting here guarantees the 15-minute tick
  // cannot fire during this one-cycle test process.
  process.exit(process.exitCode ?? 0);
}
