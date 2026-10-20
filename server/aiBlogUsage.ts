import type { Pool, PoolClient } from "pg";

const TbilisiZone = "Asia/Tbilisi";

export type AiBlogUsageLimits = { maxDailyArticles: number; maxDailyRequests: number };
export type AiBlogUsageReservation = {
  key: string;
  usageDate: string;
  reserved: true;
};
export type AiBlogUsageReserveResult =
  | { ok: true; reservation: AiBlogUsageReservation }
  | { ok: false; reason: "daily_request_limit" | "daily_article_limit" | "duplicate_operation" | "invalid_limits" };

export interface AiBlogUsageGate {
  reserve(operationKey: string): Promise<AiBlogUsageReserveResult>;
  settle(reservation: AiBlogUsageReservation, outcome: "completed" | "failed"): Promise<void>;
}

export function getTbilisiUsageDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TbilisiZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getNextTbilisiResetAt(now = new Date()): string {
  const current = getTbilisiUsageDate(now);
  const next = new Date(`${current}T00:00:00+04:00`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

async function inTransaction<T>(pool: Pick<Pool, "connect">, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresAiBlogUsageGate implements AiBlogUsageGate {
  constructor(private readonly pool: Pick<Pool, "connect">, private readonly now: () => Date = () => new Date()) {}

  async reserve(operationKey: string): Promise<AiBlogUsageReserveResult> {
    if (!operationKey || operationKey.length > 200) throw new Error("AI_BLOG_OPERATION_KEY_INVALID");
    const usageDate = getTbilisiUsageDate(this.now());
    return inTransaction(this.pool, async (client) => {
      await client.query(
        "INSERT INTO ai_blog_usage_limits (id,max_daily_articles,max_daily_requests) VALUES (1,0,0) ON CONFLICT (id) DO NOTHING",
      );
      const limits = await client.query(
        "SELECT max_daily_articles,max_daily_requests FROM ai_blog_usage_limits WHERE id=1 FOR UPDATE",
      );
      const maxArticles = Number(limits.rows[0]?.max_daily_articles ?? 0);
      const maxRequests = Number(limits.rows[0]?.max_daily_requests ?? 0);
      if (
        !Number.isSafeInteger(maxArticles) || maxArticles < 0 || maxArticles > 100 ||
        !Number.isSafeInteger(maxRequests) || maxRequests < 0 || maxRequests > 500
      ) {
        return { ok: false, reason: "invalid_limits" };
      }
      await client.query(
        "INSERT INTO ai_blog_usage_daily (usage_date) VALUES ($1::date) ON CONFLICT (usage_date) DO NOTHING",
        [usageDate],
      );
      const usage = await client.query(
        "SELECT requests_used,articles_completed,articles_reserved FROM ai_blog_usage_daily WHERE usage_date=$1::date FOR UPDATE",
        [usageDate],
      );
      const existing = await client.query(
        "SELECT status FROM ai_blog_usage_reservations WHERE operation_key=$1 FOR UPDATE",
        [operationKey],
      );
      if (existing.rowCount) return { ok: false, reason: "duplicate_operation" };
      const row = usage.rows[0];
      const requestsUsed = Number(row?.requests_used);
      const articlesCompleted = Number(row?.articles_completed);
      const articlesReserved = Number(row?.articles_reserved);
      if (
        !row ||
        !Number.isSafeInteger(requestsUsed) || requestsUsed < 0 ||
        !Number.isSafeInteger(articlesCompleted) || articlesCompleted < 0 ||
        !Number.isSafeInteger(articlesReserved) || articlesReserved < 0
      ) {
        return { ok: false, reason: "invalid_limits" };
      }
      if (requestsUsed >= maxRequests) return { ok: false, reason: "daily_request_limit" };
      if (articlesCompleted + articlesReserved >= maxArticles) {
        return { ok: false, reason: "daily_article_limit" };
      }
      await client.query(
        "INSERT INTO ai_blog_usage_reservations (operation_key,usage_date,status) VALUES ($1,$2::date,'reserved')",
        [operationKey, usageDate],
      );
      await client.query(
        "UPDATE ai_blog_usage_daily SET requests_used=requests_used+1,articles_reserved=articles_reserved+1,updated_at=NOW() WHERE usage_date=$1::date",
        [usageDate],
      );
      return { ok: true, reservation: { key: operationKey, usageDate, reserved: true } };
    });
  }

  async settle(reservation: AiBlogUsageReservation, outcome: "completed" | "failed"): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const claimed = await client.query(
        "UPDATE ai_blog_usage_reservations SET status=$2,settled_at=NOW() WHERE operation_key=$1 AND status='reserved' RETURNING usage_date",
        [reservation.key, outcome],
      );
      if (!claimed.rowCount) return;
      await client.query(
        `UPDATE ai_blog_usage_daily
         SET articles_reserved=GREATEST(0,articles_reserved-1),
             articles_completed=articles_completed + CASE WHEN $2='completed' THEN 1 ELSE 0 END,
             updated_at=NOW()
         WHERE usage_date=$1::date`,
        [reservation.usageDate, outcome],
      );
    });
  }
}

export async function getAiBlogUsageSummary(pool: Pick<Pool, "query">, now = new Date()) {
  const usageDate = getTbilisiUsageDate(now);
  const { rows } = await pool.query(
    `SELECT l.max_daily_articles,l.max_daily_requests,
            COALESCE(u.requests_used,0) AS requests_used,
            COALESCE(u.articles_completed,0) AS articles_completed,
            COALESCE(u.articles_reserved,0) AS articles_reserved
     FROM ai_blog_usage_limits l
     LEFT JOIN ai_blog_usage_daily u ON u.usage_date=$1::date
     WHERE l.id=1`,
    [usageDate],
  );
  const row = rows[0] ?? {
    max_daily_articles: 0, max_daily_requests: 0,
    requests_used: 0, articles_completed: 0, articles_reserved: 0,
  };
  const maxArticles = Number(row.max_daily_articles);
  const maxRequests = Number(row.max_daily_requests);
  const usedArticles = Number(row.articles_completed);
  const reservedArticles = Number(row.articles_reserved);
  const usedRequests = Number(row.requests_used);
  return {
    usageDate,
    maxDailyArticles: maxArticles,
    maxDailyRequests: maxRequests,
    requestsUsed: usedRequests,
    articlesCompleted: usedArticles,
    articlesReserved: reservedArticles,
    remainingRequests: Math.max(0, maxRequests - usedRequests),
    remainingArticles: Math.max(0, maxArticles - usedArticles - reservedArticles),
    resetAt: getNextTbilisiResetAt(now),
    providerQuotaVerified: false,
    billingVerified: false,
  };
}

export async function updateAiBlogUsageLimits(
  pool: Pick<Pool, "query">,
  limits: AiBlogUsageLimits,
) {
  const { maxDailyArticles, maxDailyRequests } = limits;
  if (!Number.isSafeInteger(maxDailyArticles) || maxDailyArticles < 0 || maxDailyArticles > 100) {
    throw new Error("AI_BLOG_ARTICLE_LIMIT_INVALID");
  }
  if (!Number.isSafeInteger(maxDailyRequests) || maxDailyRequests < 0 || maxDailyRequests > 500) {
    throw new Error("AI_BLOG_REQUEST_LIMIT_INVALID");
  }
  const { rows } = await pool.query(
    `INSERT INTO ai_blog_usage_limits (id,max_daily_articles,max_daily_requests,updated_at)
     VALUES (1,$1,$2,NOW())
     ON CONFLICT (id) DO UPDATE
       SET max_daily_articles=EXCLUDED.max_daily_articles,
           max_daily_requests=EXCLUDED.max_daily_requests,
           updated_at=NOW()
     RETURNING max_daily_articles,max_daily_requests`,
    [maxDailyArticles, maxDailyRequests],
  );
  return {
    maxDailyArticles: Number(rows[0].max_daily_articles),
    maxDailyRequests: Number(rows[0].max_daily_requests),
    generationEnabled: false as const,
  };
}
