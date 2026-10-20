import test from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
  PostgresAiBlogUsageGate,
  getNextTbilisiResetAt,
  getTbilisiUsageDate,
  updateAiBlogUsageLimits,
} from "./aiBlogUsage";

type Daily = { requests_used: number; articles_completed: number; articles_reserved: number };
type Reservation = { usage_date: string; status: "reserved" | "completed" | "failed" };

function makeMockPool(options: {
  limits?: { max_daily_articles: unknown; max_daily_requests: unknown } | null;
  hideDailyRow?: boolean;
} = {}) {
  let limits = options.limits ?? null;
  const daily = new Map<string, Daily>();
  const reservations = new Map<string, Reservation>();
  let transactionTail: Promise<void> = Promise.resolve();

  const clone = () => ({
    limits: limits ? { ...limits } : null,
    daily: new Map([...daily].map(([date, value]) => [date, { ...value }])),
    reservations: new Map([...reservations].map(([key, value]) => [key, { ...value }])),
  });
  const restore = (snapshot: ReturnType<typeof clone>) => {
    limits = snapshot.limits;
    daily.clear();
    for (const [date, value] of snapshot.daily) daily.set(date, value);
    reservations.clear();
    for (const [key, value] of snapshot.reservations) reservations.set(key, value);
  };

  const pool = {
    async connect() {
      let unlock: (() => void) | undefined;
      let snapshot: ReturnType<typeof clone> | undefined;
      let held = false;
      const client = {
        async query(sqlOrConfig: string | { text: string }, values: unknown[] = []) {
          const sql = (typeof sqlOrConfig === "string" ? sqlOrConfig : sqlOrConfig.text)
            .replace(/\s+/g, " ").trim().toLowerCase();
          const result = (rows: unknown[] = [], rowCount = rows.length) =>
            ({ rows, rowCount, command: "", oid: 0, fields: [] }) as QueryResult;

          if (sql === "begin") {
            const previous = transactionTail;
            transactionTail = new Promise<void>((resolve) => { unlock = resolve; });
            await previous;
            held = true;
            snapshot = clone();
            return result();
          }
          if (sql === "commit") {
            if (held) unlock?.();
            held = false;
            return result();
          }
          if (sql === "rollback") {
            if (snapshot) restore(snapshot);
            if (held) unlock?.();
            held = false;
            return result();
          }
          if (sql.startsWith("insert into ai_blog_usage_limits")) {
            limits ??= { max_daily_articles: 0, max_daily_requests: 0 };
            return result();
          }
          if (sql.startsWith("select max_daily_articles,max_daily_requests")) {
            return result(limits ? [{ ...limits }] : []);
          }
          if (sql.startsWith("insert into ai_blog_usage_daily")) {
            const date = String(values[0]);
            if (!options.hideDailyRow && !daily.has(date)) {
              daily.set(date, { requests_used: 0, articles_completed: 0, articles_reserved: 0 });
            }
            return result();
          }
          if (sql.startsWith("select requests_used,articles_completed,articles_reserved")) {
            return result(daily.has(String(values[0])) ? [{ ...daily.get(String(values[0]))! }] : []);
          }
          if (sql.startsWith("select status from ai_blog_usage_reservations")) {
            const entry = reservations.get(String(values[0]));
            return result(entry ? [{ status: entry.status }] : []);
          }
          if (sql.startsWith("insert into ai_blog_usage_reservations")) {
            reservations.set(String(values[0]), { usage_date: String(values[1]), status: "reserved" });
            return result();
          }
          if (sql.startsWith("update ai_blog_usage_daily set requests_used=")) {
            const row = daily.get(String(values[0]));
            assert.ok(row, "daily row must exist before reservation");
            row.requests_used++;
            row.articles_reserved++;
            return result();
          }
          if (sql.startsWith("update ai_blog_usage_reservations set status=")) {
            const entry = reservations.get(String(values[0]));
            if (!entry || entry.status !== "reserved") return result([], 0);
            entry.status = values[1] as Reservation["status"];
            return result([{ usage_date: entry.usage_date }], 1);
          }
          if (sql.startsWith("update ai_blog_usage_daily set articles_reserved=")) {
            const row = daily.get(String(values[0]));
            assert.ok(row);
            row.articles_reserved = Math.max(0, row.articles_reserved - 1);
            if (values[1] === "completed") row.articles_completed++;
            return result();
          }
          throw new Error(`Unexpected mock SQL: ${sql}`);
        },
        release() {},
      };
      return client as unknown as PoolClient;
    },
  };

  return {
    pool: pool as Pick<Pool, "connect">,
    inspect: () => ({ limits, daily: new Map(daily), reservations: new Map(reservations) }),
  };
}

const now = () => new Date("2026-10-20T08:00:00.000Z");

test("missing limits are inserted as zero and reject the first reservation", async () => {
  const mock = makeMockPool();
  const gate = new PostgresAiBlogUsageGate(mock.pool, now);
  assert.deepEqual(await gate.reserve("op-zero"), { ok: false, reason: "daily_request_limit" });
  assert.deepEqual(mock.inspect().limits, { max_daily_articles: 0, max_daily_requests: 0 });
  assert.equal(mock.inspect().daily.get("2026-10-20")?.requests_used, 0);
});

test("concurrent reservations never exceed the article cap", async () => {
  const mock = makeMockPool({ limits: { max_daily_articles: 2, max_daily_requests: 20 } });
  const gate = new PostgresAiBlogUsageGate(mock.pool, now);
  const results = await Promise.all(Array.from({ length: 15 }, (_, i) => gate.reserve(`article-${i}`)));
  assert.equal(results.filter((r) => r.ok).length, 2);
  assert.equal(results.filter((r) => !r.ok && r.reason === "daily_article_limit").length, 13);
  const usage = mock.inspect().daily.get("2026-10-20")!;
  assert.equal(usage.articles_reserved, 2);
  assert.equal(usage.articles_completed + usage.articles_reserved, 2);
});

test("concurrent reservations never exceed the request cap", async () => {
  const mock = makeMockPool({ limits: { max_daily_articles: 20, max_daily_requests: 3 } });
  const gate = new PostgresAiBlogUsageGate(mock.pool, now);
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => gate.reserve(`request-${i}`)));
  assert.equal(results.filter((r) => r.ok).length, 3);
  assert.equal(results.filter((r) => !r.ok && r.reason === "daily_request_limit").length, 9);
  assert.equal(mock.inspect().daily.get("2026-10-20")?.requests_used, 3);
});

test("same idempotency key cannot reserve twice, including after retry", async () => {
  const mock = makeMockPool({ limits: { max_daily_articles: 5, max_daily_requests: 5 } });
  const gate = new PostgresAiBlogUsageGate(mock.pool, now);
  const first = await gate.reserve("same-operation");
  assert.equal(first.ok, true);
  if (first.ok) await gate.settle(first.reservation, "failed");
  assert.deepEqual(await gate.reserve("same-operation"), { ok: false, reason: "duplicate_operation" });
  const usage = mock.inspect().daily.get("2026-10-20")!;
  assert.equal(usage.requests_used, 1);
  assert.equal(usage.articles_reserved, 0);
});

test("success and failure settlement are idempotent and count completed articles once", async () => {
  const mock = makeMockPool({ limits: { max_daily_articles: 3, max_daily_requests: 5 } });
  const gate = new PostgresAiBlogUsageGate(mock.pool, now);
  const success = await gate.reserve("success");
  assert.equal(success.ok, true);
  if (success.ok) {
    await gate.settle(success.reservation, "completed");
    await gate.settle(success.reservation, "completed");
  }
  const failure = await gate.reserve("failure");
  assert.equal(failure.ok, true);
  if (failure.ok) {
    await gate.settle(failure.reservation, "failed");
    await gate.settle(failure.reservation, "failed");
  }
  const usage = mock.inspect().daily.get("2026-10-20")!;
  assert.equal(usage.requests_used, 2);
  assert.equal(usage.articles_completed, 1);
  assert.equal(usage.articles_reserved, 0);
});

test("Tbilisi daily date and reset boundary follow Asia/Tbilisi midnight", () => {
  const beforeMidnight = new Date("2026-10-20T19:59:59.000Z");
  const afterMidnight = new Date("2026-10-20T20:00:00.000Z");
  assert.equal(getTbilisiUsageDate(beforeMidnight), "2026-10-20");
  assert.equal(getTbilisiUsageDate(afterMidnight), "2026-10-21");
  assert.equal(getNextTbilisiResetAt(beforeMidnight), "2026-10-20T20:00:00.000Z");
});

test("invalid limits and missing daily usage rows fail closed", async () => {
  const invalid = makeMockPool({ limits: { max_daily_articles: Number.NaN, max_daily_requests: 3 } });
  const invalidGate = new PostgresAiBlogUsageGate(invalid.pool, now);
  assert.deepEqual(await invalidGate.reserve("bad-limit"), { ok: false, reason: "invalid_limits" });

  const missingDaily = makeMockPool({
    limits: { max_daily_articles: 3, max_daily_requests: 3 },
    hideDailyRow: true,
  });
  const missingDailyGate = new PostgresAiBlogUsageGate(missingDaily.pool, now);
  assert.deepEqual(await missingDailyGate.reserve("missing-row"), { ok: false, reason: "invalid_limits" });

  let queryCount = 0;
  const validationPool = {
    async query() { queryCount++; return { rows: [] }; },
  };
  await assert.rejects(
    updateAiBlogUsageLimits(validationPool as never, { maxDailyArticles: -1, maxDailyRequests: 1 }),
    /AI_BLOG_ARTICLE_LIMIT_INVALID/,
  );
  await assert.rejects(
    updateAiBlogUsageLimits(validationPool as never, { maxDailyArticles: 1, maxDailyRequests: 501 }),
    /AI_BLOG_REQUEST_LIMIT_INVALID/,
  );
  assert.equal(queryCount, 0, "invalid values must be rejected before storage access");
});
