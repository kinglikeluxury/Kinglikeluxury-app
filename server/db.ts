import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

/**
 * Resolve the single canonical production DATABASE_URL.
 *
 * Priority:
 *  1. PG* environment variables (PGHOST / PGDATABASE / PGUSER / PGPASSWORD)
 *     — these are set by Replit / Neon and always point to the real production DB.
 *  2. DATABASE_URL — used as fallback if PG* vars are absent.
 *
 * This eliminates split-brain situations where DATABASE_URL pointed to a stale
 * or empty database while PG* vars correctly pointed to the production one.
 */
function resolveProductionDatabaseUrl(): string {
  const pgHost     = process.env.PGHOST;
  const pgDatabase = process.env.PGDATABASE;
  const pgUser     = process.env.PGUSER;
  const pgPassword = process.env.PGPASSWORD;
  const pgPort     = process.env.PGPORT || '5432';

  if (pgHost && pgDatabase && pgUser && pgPassword) {
    const url = `postgresql://${pgUser}:${encodeURIComponent(pgPassword)}@${pgHost}:${pgPort}/${pgDatabase}?sslmode=require`;
    const dbUrlHost = (process.env.DATABASE_URL || '').includes(pgHost);
    if (!dbUrlHost) {
      console.warn(
        `[DB] DATABASE_URL host differs from PGHOST — using PGHOST (${pgHost}) as the canonical production source.`
      );
    }
    return url;
  }

  const fallback = process.env.DATABASE_URL;
  if (!fallback) {
    throw new Error(
      "No database configured. Set DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD environment variables."
    );
  }
  return fallback;
}

const ACTIVE_DB_URL = resolveProductionDatabaseUrl();

export const pool = new Pool({
  connectionString: ACTIVE_DB_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err);
});

export const db = drizzle({ client: pool, schema });

/**
 * Returns the active database host (masked password) for logging.
 */
export function getActiveDbHost(): string {
  try {
    const url = new URL(ACTIVE_DB_URL);
    return url.hostname;
  } catch {
    return process.env.PGHOST || 'unknown';
  }
}

/**
 * Returns the active database name for logging.
 */
export function getActiveDbName(): string {
  try {
    const url = new URL(ACTIVE_DB_URL);
    return url.pathname.replace('/', '');
  } catch {
    return process.env.PGDATABASE || 'unknown';
  }
}

/**
 * Logs startup DB info: host, database, live table counts.
 * Called once after the server starts.
 */
export async function logDatabaseStatus(): Promise<void> {
  const client = await pool.connect();
  try {
    const tablesRes = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tables = tablesRes.rows.map((r: any) => r.table_name as string);

    const counts: Record<string, number> = {};
    for (const tbl of ['properties', 'projects', 'users', 'blog_posts']) {
      if (tables.includes(tbl)) {
        const r = await client.query(`SELECT COUNT(*) FROM "${tbl}"`);
        counts[tbl] = parseInt(r.rows[0].count, 10);
      }
    }

    console.log('');
    console.log('┌─────────────────────────────────────────────────────┐');
    console.log('│              DATABASE CONNECTION ACTIVE              │');
    console.log('├─────────────────────────────────────────────────────┤');
    console.log(`│  Host:       ${getActiveDbHost().padEnd(38)}│`);
    console.log(`│  Database:   ${getActiveDbName().padEnd(38)}│`);
    console.log(`│  Tables:     ${String(tables.length).padEnd(38)}│`);
    console.log('├─────────────────────────────────────────────────────┤');
    for (const [tbl, cnt] of Object.entries(counts)) {
      console.log(`│  ${tbl.padEnd(16)}  ${String(cnt).padStart(4)} rows${' '.repeat(27)}│`);
    }
    console.log('└─────────────────────────────────────────────────────┘');
    console.log('');
  } finally {
    client.release();
  }
}

export async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      const isConnectionError =
        error.code === '57P01' ||
        error.code === '57P03' ||
        error.code === '08006' ||
        error.code === '08S01' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'EAI_AGAIN' ||
        error.message?.includes('Connection terminated') ||
        error.message?.includes('WebSocket closed') ||
        error.message?.includes('SQL client must be connected') ||
        error.message?.includes('server closed the connection unexpectedly');

      if (isConnectionError && attempt < maxRetries) {
        console.warn(`[DB] Operation failed (attempt ${attempt}/${maxRetries}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        continue;
      }

      throw error;
    }
  }

  throw lastError!;
}

console.log(`[DB] Connecting to: ${getActiveDbHost()} / ${getActiveDbName()}`);
