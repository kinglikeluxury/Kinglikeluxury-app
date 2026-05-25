/**
 * PRODUCTION SAFETY GUARD
 * Import this at the top of any file that performs destructive DB operations.
 * It blocks all deletes, truncates, and resets when connected to Railway (production).
 */

const PRODUCTION_DB_KEYWORDS = ['rlwy.net', 'railway'];

export function assertNotProduction(operation: string): void {
  const dbUrl = process.env.DATABASE_URL || '';
  const isRailway = PRODUCTION_DB_KEYWORDS.some(kw => dbUrl.includes(kw));
  const isNodeProduction = process.env.NODE_ENV === 'production';

  if (isRailway || isNodeProduction) {
    const msg = `🚫 BLOCKED: "${operation}" is forbidden on the production (Railway) database.`;
    console.error(msg);
    throw new Error(msg);
  }
}

export function isProductionDatabase(): boolean {
  const dbUrl = process.env.DATABASE_URL || '';
  return PRODUCTION_DB_KEYWORDS.some(kw => dbUrl.includes(kw)) ||
    process.env.NODE_ENV === 'production';
}

export function logDatabaseEnvironment(): void {
  const prod = isProductionDatabase();
  console.log(`[DB] Environment: ${prod ? '🔴 PRODUCTION (Railway)' : '🟢 DEVELOPMENT'}`);
  if (prod) {
    console.log('[DB] Destructive operations (seed, truncate, mass delete) are BLOCKED.');
  }
}
