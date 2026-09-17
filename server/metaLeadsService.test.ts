import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import https from "node:https";
import { pool } from "./db";
import {
  claimQueueEntries,
  fencedQueueTransitionForTest,
  createOrFindMetaLeadForTest,
  fetchLeadFromGraph,
  META_QUEUE_STALE_AFTER_MS,
} from "./metaLeadsService";
import { sendQualTextMessage } from "./interactiveMessageHelper";

// The service module creates a pg pool at import time.  Close that idle pool
// after this fully offline suite so node:test never waits for its idle timeout
// (and never leaves a live handle that can turn a timeout into cancellation).
test.after(async () => {
  await pool.end();
});

type QueueRow = {
  id: number;
  meta_lead_id: string;
  leadgen_id: string;
  form_id: string | null;
  page_id: string | null;
  ad_id: string | null;
  adgroup_id: string | null;
  campaign_id: string | null;
  status: string;
  retry_count: number;
  max_retries: number;
  raw_webhook_payload: unknown;
  lead_data: unknown;
  crm_lead_id: number | null;
  error_message: string | null;
  next_retry_at: Date | null;
  received_at: Date;
  processed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function row(
  id: number,
  status: string,
  now: number,
  overrides: Partial<QueueRow> = {},
): QueueRow {
  const createdAt = new Date(now - id * 1000);
  return {
    id,
    meta_lead_id: `meta-${id}`,
    leadgen_id: `leadgen-${id}`,
    form_id: null,
    page_id: null,
    ad_id: null,
    adgroup_id: null,
    campaign_id: null,
    status,
    retry_count: 0,
    max_retries: 3,
    raw_webhook_payload: null,
    lead_data: null,
    crm_lead_id: null,
    error_message: null,
    next_retry_at: null,
    received_at: createdAt,
    processed_at: null,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

class FakeQueuePool {
  readonly sql: string[] = [];

  constructor(
    readonly rows: QueueRow[],
    private readonly now: number,
  ) {}

  private nextClaimTimestamp(previous: Date): Date {
    return new Date(Math.max(this.now, previous.getTime() + 1));
  }

  private claimToken(value: Date): string {
    return value.toISOString().slice(0, 23);
  }

  async connect() {
    return {
      query: async (text: string, params: any[] = []) => {
        this.sql.push(text);
        if (
          text === "BEGIN" ||
          text === "COMMIT" ||
          text === "ROLLBACK" ||
          text.includes("set_config(") ||
          text.includes("INSERT INTO lead_import_audit_log")
        ) {
          return { rows: [], rowCount: 0 };
        }

        if (text.includes("retry limit reached")) {
          const cutoff = this.now - META_QUEUE_STALE_AFTER_MS;
          const limit = Number(params[0]);
          const selected = this.rows
            .filter((item) =>
              item.status === "processing" &&
              item.updated_at.getTime() <= cutoff &&
              item.retry_count + 1 >= item.max_retries)
            .sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime() || a.id - b.id)
            .slice(0, limit);
          for (const item of selected) {
            item.status = "needs_review";
            item.retry_count += 1;
            item.next_retry_at = null;
            item.updated_at = this.nextClaimTimestamp(item.updated_at);
          }
          return {
            rows: selected.map((item) => ({ id: item.id, meta_lead_id: item.meta_lead_id })),
            rowCount: selected.length,
          };
        }

        if (text.includes("WHERE status = 'pending'")) {
          const limit = Number(params[0]);
          const selected = this.rows
            .filter((item) => item.status === "pending")
            .sort((a, b) => a.received_at.getTime() - b.received_at.getTime() || a.id - b.id)
            .slice(0, limit);
          for (const item of selected) {
            item.status = "processing";
            item.updated_at = this.nextClaimTimestamp(item.updated_at);
          }
          return {
            rows: selected.map((item) => ({ ...item, claim_updated_at: this.claimToken(item.updated_at) })),
            rowCount: selected.length,
          };
        }

        if (text.includes("recovered_stale")) {
          const cutoff = this.now - META_QUEUE_STALE_AFTER_MS;
          const limit = Number(params[0]);
          const selected = this.rows
            .filter((item) =>
              (item.status === "retry" && !!item.next_retry_at && item.next_retry_at.getTime() <= this.now) ||
              (item.status === "processing" &&
                item.updated_at.getTime() <= cutoff &&
                item.retry_count + 1 < item.max_retries))
            .sort((a, b) => a.id - b.id)
            .slice(0, limit);
          for (const item of selected) {
            if (item.status === "processing") item.retry_count += 1;
            item.status = "processing";
            item.next_retry_at = null;
            item.updated_at = this.nextClaimTimestamp(item.updated_at);
          }
          return {
            rows: selected.map((item) => ({ ...item, claim_updated_at: this.claimToken(item.updated_at) })),
            rowCount: selected.length,
          };
        }

        throw new Error(`Unexpected SQL in fake queue client: ${text.slice(0, 80)}`);
      },
      release() {},
    };
  }
}

test("two workers claim one pending row only once", async () => {
  const now = Date.now();
  const fake = new FakeQueuePool([row(1, "pending", now)], now);
  const [workerA, workerB] = await Promise.all([
    claimQueueEntries(fake),
    claimQueueEntries(fake),
  ]);

  assert.equal(workerA.length + workerB.length, 1);
  assert.equal(new Set([...workerA, ...workerB].map((item) => item.id)).size, 1);
  assert.ok(fake.sql.filter((sql) => sql.includes("FOR UPDATE SKIP LOCKED")).length >= 4);
  assert.ok(fake.sql.some((sql) => sql.includes("'statement_timeout'")));
  assert.ok(fake.sql.some((sql) => sql.includes("'lock_timeout'")));
});

test("two workers divide pending rows without duplicate claims", async () => {
  const now = Date.now();
  const fake = new FakeQueuePool(
    Array.from({ length: 12 }, (_, index) => row(index + 1, "pending", now)),
    now,
  );
  const [workerA, workerB] = await Promise.all([
    claimQueueEntries(fake),
    claimQueueEntries(fake),
  ]);
  const ids = [...workerA, ...workerB].map((item) => item.id);

  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12);
});

test("completed and future retry rows are not reclaimed", async () => {
  const now = Date.now();
  const fake = new FakeQueuePool([
    row(1, "completed", now),
    row(2, "retry", now, { next_retry_at: new Date(now + 60_000) }),
  ], now);

  assert.deepEqual(await claimQueueEntries(fake), []);
});

test("due retry is claimed and a crashed worker becomes recoverable after 15 minutes", async () => {
  const now = Date.now();
  const rows = [
    row(1, "retry", now, { retry_count: 1, next_retry_at: new Date(now - 1) }),
    row(2, "processing", now, {
      updated_at: new Date(now - META_QUEUE_STALE_AFTER_MS - 1),
    }),
  ];
  const fake = new FakeQueuePool(rows, now);
  const claimed = await claimQueueEntries(fake);

  assert.deepEqual(claimed.map((item) => item.id).sort(), [1, 2]);
  assert.equal(rows[1].retry_count, 1);
});

test("two workers recover the same stale row only once", async () => {
  const now = Date.now();
  const fake = new FakeQueuePool([
    row(1, "processing", now, {
      updated_at: new Date(now - META_QUEUE_STALE_AFTER_MS - 1),
    }),
  ], now);
  const [workerA, workerB] = await Promise.all([
    claimQueueEntries(fake),
    claimQueueEntries(fake),
  ]);

  assert.equal(workerA.length + workerB.length, 1);
  assert.equal(fake.rows[0].retry_count, 1);
});

test("claim returns an exact strictly newer millisecond fencing token", async () => {
  const now = Date.now();
  const previous = new Date(now);
  const fake = new FakeQueuePool([row(1, "pending", now, { updated_at: previous })], now);
  const [claimed] = await claimQueueEntries(fake);
  assert.equal(typeof claimed.claimUpdatedAt, "string");
  assert.match(claimed.claimUpdatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}$/);
  assert.equal(claimed.claimUpdatedAt, claimed.updatedAt.toISOString().slice(0, 23));
  assert.ok(claimed.updatedAt.getTime() > previous.getTime());
  assert.match(
    fake.sql.filter((sql) => sql.includes("GREATEST(")).join("\n"),
    /date_trunc\('milliseconds', clock_timestamp\(\)\)[\s\S]*updated_at \+ interval '1 millisecond'/,
  );
});

test("claim token remains canonical text across a non-UTC process timezone", async () => {
  const previousTz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const now = Date.now();
    const fake = new FakeQueuePool([row(1, "pending", now)], now);
    const [claimed] = await claimQueueEntries(fake);
    const token = claimed.claimUpdatedAt;
    assert.equal(typeof token, "string");
    assert.match(token, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}$/);
    // The exact text is what the fenced UPDATE receives; it is never parsed
    // through a JavaScript Date (which could reinterpret a timestamp zone).
    assert.equal(token, String(token));
    const source = readFileSync(new URL("./metaLeadsService.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /new Date\(row\.claim_updated_at\)/);
    assert.match(source, /entry\.claimUpdatedAt,\s*\n\s*\],/);
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

test("stale worker A cannot complete after worker B reclaims, while B can", async () => {
  const now = Date.now();
  const source = readFileSync(new URL("./metaLeadsService.ts", import.meta.url), "utf8");
  assert.match(source, /AND id = \$8|WHERE id = \$8/);
  assert.match(source, /AND status = 'processing'\s+AND updated_at = \$9/);

  // This is the database UPDATE predicate reduced to an offline fake: the
  // newer claim token makes A's UPDATE affect zero rows, while B succeeds.
  const state = { status: "processing", updatedAt: now + 1 };
  const fencedUpdate = (token: number, status: string): number => {
    if (state.status !== "processing" || state.updatedAt !== token) return 0;
    state.status = status;
    state.updatedAt += 1;
    return 1;
  };
  const tokenA = state.updatedAt;
  state.updatedAt += 1; // stale recovery/reclaim by B
  const tokenB = state.updatedAt;
  assert.equal(fencedUpdate(tokenA, "completed"), 0);
  assert.equal(fencedUpdate(tokenB, "completed"), 1);
  assert.equal(state.status, "completed");
});

test("fenced integration transition hook is test-environment gated", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      fencedQueueTransitionForTest({ connect: async () => { throw new Error("must not connect"); } }, 1, "token", "completed"),
      /only in NODE_ENV=test/,
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("create/duplicate integration hook is test-environment gated", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      createOrFindMetaLeadForTest({}, "Meta Webhook", {}, { database: {} }),
      /only in NODE_ENV=test/,
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("claim rules cover completed, future/due retry, healthy/stale recovery, exhaustion and bounded retries", async () => {
  const now = Date.now();
  const rows = [
    row(1, "completed", now),
    row(2, "retry", now, { next_retry_at: new Date(now + 1000) }),
    row(3, "retry", now, { next_retry_at: new Date(now - 1), retry_count: 1 }),
    row(4, "processing", now, { updated_at: new Date(now - 1000) }),
    row(5, "processing", now, {
      updated_at: new Date(now - META_QUEUE_STALE_AFTER_MS - 1),
      retry_count: 1,
    }),
    row(6, "processing", now, {
      updated_at: new Date(now - META_QUEUE_STALE_AFTER_MS - 1),
      retry_count: 2,
      max_retries: 3,
    }),
  ];
  const fake = new FakeQueuePool(rows, now);
  const first = await claimQueueEntries(fake);
  assert.deepEqual(first.map((item) => item.id).sort((a, b) => a - b), [3, 5]);
  assert.equal(rows[4].retry_count, 2);
  assert.equal(rows[5].status, "needs_review");
  assert.equal(rows[5].retry_count, 3);
  assert.equal(rows[3].status, "processing"); // healthy lease untouched
  assert.equal(rows[1].status, "retry"); // future retry untouched

  // A second claim cannot loop over the already recovered row.
  assert.deepEqual((await claimQueueEntries(fake)).map((item) => item.id), []);
});

test("Meta Graph timeout actively aborts the HTTPS request", async () => {
  const originalGet = https.get;
  const originalToken = process.env.META_ACCESS_TOKEN;
  let aborted = false;
  process.env.META_ACCESS_TOKEN = "test-token";

  (https as any).get = (_url: string, options: { signal: AbortSignal }) => {
    const request = new EventEmitter();
    options.signal.addEventListener("abort", () => {
      aborted = true;
      request.emit("error", options.signal.reason);
    }, { once: true });
    return request;
  };

  try {
    await assert.rejects(fetchLeadFromGraph("test-lead", 5));
    assert.equal(aborted, true);
  } finally {
    (https as any).get = originalGet;
    process.env.META_ACCESS_TOKEN = originalToken;
  }
});

test("Meta queue WhatsApp timeout aborts fetch without a real message", async () => {
  const originalFetch = globalThis.fetch;
  const originalConnect = pool.connect;
  const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
  let aborted = false;
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(new Error("test timeout")), 5);

  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(init.signal?.reason);
      }, { once: true });
    })) as typeof fetch;
  (pool as any).connect = async () => ({
    query: async () => ({ rows: [{ id: 1 }], rowCount: 1 }),
    release() {},
  });

  try {
    const result = await sendQualTextMessage("15555550123", "test", {
      signal: controller.signal,
      dbStatementTimeoutMs: 10,
    });
    assert.equal(result.success, false);
    assert.equal(aborted, true);
  } finally {
    clearTimeout(abortTimer);
    globalThis.fetch = originalFetch;
    (pool as any).connect = originalConnect;
    process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
  }
});

test("Task 30 locks, canonical selection, notification claim, and round-robin remain present", () => {
  const source = readFileSync(new URL("./metaLeadsService.ts", import.meta.url), "utf8");
  assert.match(source, /meta-external:/);
  assert.match(source, /meta-phone:/);
  assert.match(source, /orderBy\(desc\(crmLeads\.updatedAt\), desc\(crmLeads\.id\)\)/);
  assert.match(source, /duplicate_notification_claimed/);
  assert.match(source, /pickAssignment\(tx, assignmentSource\)/);
  assert.match(source, /AND status = 'processing'\s+AND updated_at = \$9/);
  assert.match(source, /claimPullSyncEntry/);
  assert.match(source, /pull_sync_claim_lost/);
  assert.match(source, /stale_processing_needs_review/);
  assert.match(source, /recovered_stale/);
});

test("dedicated flag is the only startup gate for the Meta queue processor", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /ENABLE_META_LEADS_PROCESSOR === "true"/);
  assert.equal((source.match(/startMetaLeadsProcessor\(\)/g) ?? []).length, 1);
  assert.match(source, /if \(metaLeadsProcessorEnabled\) \{\s*startMetaLeadsProcessor\(\)/);
  const serviceSource = readFileSync(new URL("./metaLeadsService.ts", import.meta.url), "utf8");
  assert.match(serviceSource, /if \(queueProcessorStarted\) \{/);
});