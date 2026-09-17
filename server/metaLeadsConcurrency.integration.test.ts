import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const testUrl = process.env.META_QUEUE_TEST_DATABASE_URL;
const { Pool } = pg;
let testDbName = "";
try {
  testDbName = testUrl ? decodeURIComponent(new URL(testUrl).pathname.slice(1)) : "";
} catch {
  testDbName = "";
}
const runId = process.env.META_QUEUE_TEST_RUN_ID ?? "";
const hardGate =
  process.env.NODE_ENV === "test" &&
  !!testUrl &&
  /^meta_fencing_test[a-z0-9_-]*$/i.test(testDbName) &&
  /^[a-zA-Z0-9_-]{8,128}$/.test(runId);

const skipReason =
  "requires NODE_ENV=test, META_QUEUE_TEST_DATABASE_URL, test-only DB name " +
  "starting meta_fencing_test, and unique META_QUEUE_TEST_RUN_ID";

test("real PostgreSQL Meta claim fencing and contention", { skip: !hardGate ? skipReason : false }, async () => {
  const { claimQueueEntries, fencedQueueTransitionForTest } = await import("./metaLeadsService");
  const { createOrFindMetaLeadForTest } = await import("./metaLeadsService");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@shared/schema");
  // This is deliberately the only database URL used by this integration test.
  // In particular, DATABASE_URL and NEON_DATABASE_URL are never consulted.
  const setup = new Pool({ connectionString: testUrl });
  const workerA = new Pool({ connectionString: testUrl, max: 1 });
  const workerB = new Pool({ connectionString: testUrl, max: 1 });
  try {
    const client = await setup.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS lead_import_queue (
          id SERIAL PRIMARY KEY,
          meta_lead_id TEXT NOT NULL UNIQUE,
          leadgen_id TEXT NOT NULL,
          form_id TEXT,
          page_id TEXT,
          ad_id TEXT,
          adgroup_id TEXT,
          campaign_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          retry_count INTEGER NOT NULL DEFAULT 0,
          max_retries INTEGER NOT NULL DEFAULT 3,
          raw_webhook_payload JSONB,
          lead_data JSONB,
          crm_lead_id INTEGER,
          error_message TEXT,
          next_retry_at TIMESTAMP WITHOUT TIME ZONE,
          received_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT clock_timestamp(),
          processed_at TIMESTAMP WITHOUT TIME ZONE,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT clock_timestamp(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT clock_timestamp()
        );
        CREATE TABLE IF NOT EXISTS lead_import_audit_log (
          id SERIAL PRIMARY KEY,
          queue_entry_id INTEGER NOT NULL REFERENCES lead_import_queue(id) ON DELETE CASCADE,
          meta_lead_id TEXT NOT NULL,
          action TEXT NOT NULL,
          details JSONB,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT clock_timestamp()
        );
        CREATE TABLE IF NOT EXISTS crm_leads (
          id SERIAL PRIMARY KEY,
          lead_source TEXT NOT NULL DEFAULT 'manual',
          external_lead_id TEXT,
          first_name TEXT,
          last_name TEXT,
          full_name TEXT,
          phone TEXT,
          email TEXT,
          country TEXT,
          city TEXT,
          campaign_name TEXT,
          adset_name TEXT,
          ad_name TEXT,
          form_name TEXT,
          project_interest TEXT,
          assigned_to INTEGER,
          lead_score TEXT DEFAULT 'cold',
          status TEXT NOT NULL DEFAULT 'new',
          notes TEXT,
          interested_country TEXT,
          budget TEXT,
          expected_purchase_month TEXT,
          description TEXT,
          created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT clock_timestamp(),
          updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT clock_timestamp(),
          last_contact_at TIMESTAMP WITHOUT TIME ZONE,
          business_received_at TIMESTAMP WITH TIME ZONE,
          business_received_at_source TEXT,
          wa_stage TEXT DEFAULT 'new_lead',
          meta_campaign_id TEXT,
          meta_ad_id TEXT,
          meta_adset_id TEXT,
          meta_form_id TEXT
        );
      `);
      await client.query("TRUNCATE lead_import_audit_log, lead_import_queue, crm_leads RESTART IDENTITY");

      const insert = async (rows: Array<Record<string, unknown>>) => {
        for (const row of rows) {
          await client.query(
            `INSERT INTO lead_import_queue
             (meta_lead_id, leadgen_id, status, retry_count, max_retries,
              next_retry_at, received_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp(), clock_timestamp(), $7)`,
            [
              row.meta_lead_id,
              row.leadgen_id,
              row.status ?? "pending",
              row.retry_count ?? 0,
              row.max_retries ?? 3,
              row.next_retry_at ?? null,
              row.updated_at ?? new Date(),
            ],
          );
        }
      };

    await insert(Array.from({ length: 30 }, (_, i) => ({
        meta_lead_id: `${runId}-pending-${i}`,
        leadgen_id: `${runId}-pending-${i}`,
        status: "pending",
      })));
    } finally {
      client.release();
    }

    // Two independent clients must divide pending work without duplicates.
    const [a, b] = await Promise.all([
      claimQueueEntries(workerA),
      claimQueueEntries(workerB),
    ]);
    const extra = await claimQueueEntries(workerA);
    const claimedIds = [...a, ...b, ...extra].map((row) => row.id);
    assert.ok(a.length > 0);
    assert.ok(b.length > 0);
    assert.equal(claimedIds.length, 30);
    assert.equal(new Set(claimedIds).size, 30);
    assert.ok(a.every((row) => typeof row.claimUpdatedAt === "string"));
    assert.ok(a.every((row) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}$/.test(row.claimUpdatedAt)));

    const client2 = await setup.connect();
    try {
      await client2.query("TRUNCATE lead_import_audit_log, lead_import_queue, crm_leads RESTART IDENTITY");
      const stale = new Date(Date.now() - 16 * 60_000);
      const future = new Date(Date.now() + 60_000);
      await client2.query(
        `INSERT INTO lead_import_queue
         (meta_lead_id, leadgen_id, status, retry_count, max_retries, next_retry_at, updated_at)
         VALUES
         ($1, $1, 'retry', 1, 3, $2, clock_timestamp()),
         ($3, $3, 'retry', 1, 3, $4, clock_timestamp()),
         ($5, $5, 'completed', 0, 3, NULL, clock_timestamp()),
         ($6, $6, 'processing', 0, 3, NULL, clock_timestamp()),
         ($7, $7, 'processing', 1, 3, NULL, $8),
         ($9, $9, 'processing', 2, 3, NULL, $8)`,
        [
          `${runId}-due`, new Date(Date.now() - 60_000), `${runId}-future`, future,
          `${runId}-completed`, `${runId}-healthy`, `${runId}-stale`,
          stale, `${runId}-exhausted`,
        ],
      );
    } finally {
      client2.release();
    }

    const first = await claimQueueEntries(workerA);
    const firstIds = first.map((row) => row.metaLeadId);
    assert.ok(firstIds.includes(`${runId}-due`));
    assert.ok(firstIds.includes(`${runId}-stale`));
    assert.ok(!firstIds.includes(`${runId}-future`));
    assert.ok(!firstIds.includes(`${runId}-completed`));
    assert.ok(!firstIds.includes(`${runId}-healthy`));

    const staleClaim = first.find((row) => row.metaLeadId === `${runId}-stale`);
    assert.ok(staleClaim);
    // Make A's lease stale, then have B recover/reclaim it.
    const oldToken = staleClaim.claimUpdatedAt;
    await setup.query(
      "UPDATE lead_import_queue SET updated_at = clock_timestamp() - interval '16 minutes' WHERE id = $1",
      [staleClaim.id],
    );
    const bClaim = await claimQueueEntries(workerB);
    const newerClaim = bClaim.find((row) => row.id === staleClaim.id);
    assert.ok(newerClaim);
    assert.notEqual(newerClaim.claimUpdatedAt, oldToken);
    assert.equal(await fencedQueueTransitionForTest(workerA, staleClaim.id, oldToken, "completed"), false);
    assert.equal(await fencedQueueTransitionForTest(workerB, newerClaim.id, newerClaim.claimUpdatedAt, "completed"), true);
    assert.equal((await claimQueueEntries(workerA)).some((row) => row.id === staleClaim.id), false);

    const exhausted = await setup.query<{ status: string; retry_count: number }>(
      "SELECT status, retry_count FROM lead_import_queue WHERE meta_lead_id = $1",
      [`${runId}-exhausted`],
    );
    assert.equal(exhausted.rows[0].status, "needs_review");
    assert.equal(exhausted.rows[0].retry_count, 3);

    // Task 30 behavioral regression coverage through the real transaction:
    // external-id concurrency is idempotent, phone duplicates use the newest
    // canonical lead, notification claims serialize, and assignment advances
    // only for genuinely new leads.
    const testDb = drizzle(setup, { schema });
    const eventQueueIds: Record<string, number> = {};
    for (const event of [
      `${runId}-same-a`,
      `${runId}-same-b`,
      `${runId}-canonical-event`,
      `${runId}-notify-a`,
      `${runId}-notify-b`,
    ]) {
      const queued = await setup.query<{ id: number }>(
        `INSERT INTO lead_import_queue (meta_lead_id, leadgen_id, status)
         VALUES ($1, $1, 'pending') RETURNING id`,
        [event],
      );
      eventQueueIds[event] = queued.rows[0].id;
    }
    let assignmentCalls = 0;
    const dependencies = {
      database: testDb,
      pickNextSubAgentIdForTx: async () => ++assignmentCalls,
    };
    const payload = (externalLeadId: string, phone: string) => ({
      leadSource: "meta_ads",
      externalLeadId,
      firstName: "Synthetic",
      lastName: externalLeadId,
      fullName: `Synthetic ${externalLeadId}`,
      phone,
      email: `${externalLeadId}@example.test`,
      status: "new",
      leadScore: "cold",
    });

    const [sameA, sameB] = await Promise.all([
      createOrFindMetaLeadForTest(payload(`${runId}-same`, "100000001"), "Meta Webhook", { queueEntryId: eventQueueIds[`${runId}-same-a`] }, dependencies),
      createOrFindMetaLeadForTest(payload(`${runId}-same`, "100000001"), "Meta Webhook", { queueEntryId: eventQueueIds[`${runId}-same-b`] }, dependencies),
    ]);
    assert.equal(assignmentCalls, 1);
    assert.equal(sameA.lead.id, sameB.lead.id);
    assert.equal(sameA.kind === "created" || sameB.kind === "created", true);

    const canonicalRows = await setup.query<{ id: number }>(
      `INSERT INTO crm_leads (lead_source, external_lead_id, phone, full_name, updated_at)
       VALUES ('meta_ads', $1, $2, 'older', clock_timestamp() - interval '2 minutes')
       RETURNING id`,
      [`${runId}-canonical-old`, "100000002"],
    );
    const newerRows = await setup.query<{ id: number }>(
      `INSERT INTO crm_leads (lead_source, external_lead_id, phone, full_name, updated_at)
       VALUES ('meta_ads', $1, $2, 'newer', clock_timestamp())
       RETURNING id`,
      [`${runId}-canonical-new`, "100000002"],
    );
    const canonical = await createOrFindMetaLeadForTest(
      payload(`${runId}-canonical-event`, "100000002"),
      "Meta Webhook",
      { queueEntryId: eventQueueIds[`${runId}-canonical-event`] },
      dependencies,
    );
    assert.equal(canonical.kind, "duplicate");
    assert.equal(canonical.lead.id, newerRows.rows[0].id);
    assert.notEqual(canonical.lead.id, canonicalRows.rows[0].id);
    assert.equal(assignmentCalls, 1);

    const [notifyA, notifyB] = await Promise.all([
      createOrFindMetaLeadForTest(payload(`${runId}-notify-a`, "100000003"), "Meta Webhook", { queueEntryId: eventQueueIds[`${runId}-notify-a`] }, dependencies),
      createOrFindMetaLeadForTest(payload(`${runId}-notify-b`, "100000003"), "Meta Webhook", { queueEntryId: eventQueueIds[`${runId}-notify-b`] }, dependencies),
    ]);
    assert.equal(assignmentCalls, 2);
    assert.equal(notifyA.lead.id, notifyB.lead.id);
    const canonicalClaims = await setup.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM lead_import_audit_log
       WHERE action = 'duplicate_notification_claimed'
         AND meta_lead_id = $1`,
      [`${runId}-canonical-event`],
    );
    assert.equal(Number(canonicalClaims.rows[0].count), 1);
    const notificationClaims = await setup.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM lead_import_audit_log
       WHERE action = 'duplicate_notification_claimed'
         AND meta_lead_id IN ($1, $2)`,
      [`${runId}-notify-a`, `${runId}-notify-b`],
    );
    assert.equal(Number(notificationClaims.rows[0].count), 1);
  } finally {
    await setup.query("DROP TABLE IF EXISTS lead_import_audit_log, lead_import_queue, crm_leads").catch(() => {});
    await Promise.allSettled([workerA.end(), workerB.end(), setup.end()]);
  }
});