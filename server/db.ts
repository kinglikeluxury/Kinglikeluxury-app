import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

/**
 * Align process.env.DATABASE_URL with the real production host.
 *
 * PGHOST is set as a Replit secret to ep-winter-paper-a4q7e6vy.us-east-1.aws.neon.tech.
 * DATABASE_URL is a stale Replit-managed variable pointing to an empty database.
 *
 * When PGHOST is a genuine Neon hostname (ends with .neon.tech) and DATABASE_URL
 * does NOT already contain that host, we override DATABASE_URL so that every
 * consumer of process.env.DATABASE_URL (routes, storage, etc.) gets the right URL.
 *
 * PGHOST="neondb" is Replit's placeholder for its built-in Postgres and is
 * deliberately ignored — it is not a resolvable hostname.
 */
(function alignDatabaseUrl() {
  const pgHost     = process.env.PGHOST     || '';
  const pgUser     = process.env.PGUSER     || '';
  const pgPassword = process.env.PGPASSWORD || '';
  const pgDatabase = process.env.PGDATABASE || 'neondb';
  const pgPort     = process.env.PGPORT     || '5432';

  // Reject Replit's injected placeholder and anything else that isn't a real Neon host
  if (!pgHost.endsWith('.neon.tech')) {
    if (pgHost) {
      console.warn(`[DB] PGHOST="${pgHost}" is not a Neon hostname — ignored.`);
    }
    return;
  }

  // Nothing to do if DATABASE_URL already targets the same host
  const current = process.env.DATABASE_URL || '';
  if (current.includes(pgHost)) return;

  if (!pgUser || !pgPassword) return;

  const correct = `postgresql://${pgUser}:${encodeURIComponent(pgPassword)}@${pgHost}:${pgPort}/${pgDatabase}?sslmode=require`;
  process.env.DATABASE_URL = correct;
  console.log(`[DB] DATABASE_URL aligned to PGHOST → ${pgHost}`);
})();

// ── From here all code uses only process.env.DATABASE_URL ──────────────────

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. ' +
    'Configure it in Replit Secrets to point to the Neon production database.'
  );
}

export const pool = new Pool({
  connectionString: databaseUrl,
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
    return new URL(process.env.DATABASE_URL!).hostname;
  } catch {
    return 'unknown';
  }
}

/** Returns the active database name for logging. */
export function getActiveDbName(): string {
  try {
    return new URL(process.env.DATABASE_URL!).pathname.replace('/', '');
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

console.log(`[DB] Connecting to: ${getActiveDbHost()} / ${getActiveDbName()}`);
