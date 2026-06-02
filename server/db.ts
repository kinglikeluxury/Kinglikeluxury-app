import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

/**
 * Production database connection.
 *
 * Uses ONLY the NEON_DATABASE_URL secret — a custom name that Replit's
 * deployment platform never overrides. DATABASE_URL and PG* variables
 * injected by Replit are intentionally ignored.
 */
const neonDatabaseUrl = process.env.NEON_DATABASE_URL;

// Safe startup log — confirms var is set without exposing credentials
{
  const url = process.env.NEON_DATABASE_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      console.log("[DB] ACTIVE_DB: SET");
      console.log("[DB] Host:", parsed.hostname);
      console.log("[DB] Database:", parsed.pathname.replace(/^\//, ""));
    } catch {
      console.log("[DB] ACTIVE_DB: SET (URL parse failed)");
    }
  } else {
    console.log("[DB] ACTIVE_DB: NOT SET");
  }
}

if (!neonDatabaseUrl) {
  throw new Error(
    'NEON_DATABASE_URL is not set. ' +
    'Add it to Replit Secrets with the full Neon connection string for ' +
    'ep-winter-paper-a4q7e6vy.us-east-1.aws.neon.tech.'
  );
}

export const pool = new Pool({
  connectionString: neonDatabaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err);
});

export const db = drizzle({ client: pool, schema });

/** Returns the active database host for logging. */
export function getActiveDbHost(): string {
  try {
    return new URL(neonDatabaseUrl!).hostname;
  } catch {
    return 'unknown';
  }
}

/** Returns the active database name for logging. */
export function getActiveDbName(): string {
  try {
    return new URL(neonDatabaseUrl!).pathname.replace('/', '');
  } catch {
    return 'unknown';
  }
}

/** Logs startup DB info: host, database, live table counts. */
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
