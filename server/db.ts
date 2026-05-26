import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

/**
 * Resolve the canonical production database URL.
 *
 * Priority order:
 *
 *  1. NEON_DATABASE_URL — a custom secret that Replit's deployment platform
 *     will never override. This is the most reliable source and must be set
 *     to the full Neon connection string for ep-winter-paper-a4q7e6vy.
 *
 *  2. PGHOST / PGUSER / PGPASSWORD / PGDATABASE — used ONLY when PGHOST is a
 *     genuine Neon hostname (ends with .neon.tech). In Replit's deployed
 *     containers these vars are overridden to point at the built-in Postgres,
 *     so they are only trusted in development environments where they still
 *     hold the real Neon values.
 *
 *  3. DATABASE_URL — LAST resort, ONLY if it targets a real Neon host.
 *     In Replit deployments DATABASE_URL is overridden with ep-young-forest
 *     (an empty built-in database) and must be ignored.
 *
 * Explicitly rejected:
 *  - PGHOST="neondb"       — Replit's placeholder for its built-in Postgres
 *  - DATABASE_URL containing "ep-young-forest" — Replit's empty built-in DB
 */
function resolveProductionDatabaseUrl(): string {
  // ── 1. Custom secret — never touched by Replit deployment ─────────────────
  const neonDbUrl = process.env.NEON_DATABASE_URL || '';
  if (neonDbUrl) {
    try {
      const parsed = new URL(neonDbUrl);
      console.log(`[DB] Using NEON_DATABASE_URL → ${parsed.hostname}`);
      return neonDbUrl;
    } catch {
      console.warn('[DB] NEON_DATABASE_URL is set but could not be parsed — skipping.');
    }
  }

  // ── 2. PG* secrets — reliable in dev, overridden in production ───────────
  const pgHost     = process.env.PGHOST     || '';
  const pgUser     = process.env.PGUSER     || '';
  const pgPassword = process.env.PGPASSWORD || '';
  const pgDatabase = process.env.PGDATABASE || 'neondb';
  const pgPort     = process.env.PGPORT     || '5432';

  if (pgHost.endsWith('.neon.tech') && pgUser && pgPassword) {
    const url = `postgresql://${pgUser}:${encodeURIComponent(pgPassword)}@${pgHost}:${pgPort}/${pgDatabase}?sslmode=require`;
    console.log(`[DB] Using PG* secrets → PGHOST=${pgHost}`);
    return url;
  }

  if (pgHost && !pgHost.endsWith('.neon.tech')) {
    console.warn(`[DB] PGHOST="${pgHost}" is not a valid Neon host — ignored.`);
  }

  // ── 3. DATABASE_URL — last resort, reject Replit's empty built-in DB ──────
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl && !dbUrl.includes('ep-young-forest')) {
    try {
      const parsed = new URL(dbUrl);
      console.log(`[DB] Using DATABASE_URL → ${parsed.hostname}`);
      return dbUrl;
    } catch {
      console.warn('[DB] DATABASE_URL could not be parsed — skipping.');
    }
  }

  if (dbUrl.includes('ep-young-forest')) {
    console.warn('[DB] DATABASE_URL targets Replit\'s empty built-in database — ignored.');
  }

  throw new Error(
    'No valid production database configured. ' +
    'Set NEON_DATABASE_URL in Replit Secrets to the full Neon connection string for ' +
    'ep-winter-paper-a4q7e6vy.us-east-1.aws.neon.tech.'
  );
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

/** Returns the active database host for logging. */
export function getActiveDbHost(): string {
  try {
    return new URL(ACTIVE_DB_URL).hostname;
  } catch {
    return 'unknown';
  }
}

/** Returns the active database name for logging. */
export function getActiveDbName(): string {
  try {
    return new URL(ACTIVE_DB_URL).pathname.replace('/', '');
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
