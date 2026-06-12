/**
 * Ambassadori Browser Session Store
 * Persists authenticated browser cookies in PostgreSQL so the headless browser
 * can restore the logged-in session across restarts without a new OTP.
 *
 * Cookie data is stored server-side only — never returned to the frontend.
 */

import { pool } from "./db";

export interface StoredCookie {
  name:     string;
  value:    string;
  domain?:  string;
  path?:    string;
  expires?: number;
  httpOnly?: boolean;
  secure?:  boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface SessionData {
  cookies:       StoredCookie[];
  localStorage?: Record<string, string>;
  userAgent?:    string;
  savedAt:       string;
}

// ── Table setup ───────────────────────────────────────────────────────────────

export async function ensureAmbassadoriSessionTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ambassadori_session_store (
        id         SERIAL PRIMARY KEY,
        key        TEXT NOT NULL UNIQUE,
        data       JSONB NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("[AmbassadoriSession] Session table ready");
  } catch (err: any) {
    console.error("[AmbassadoriSession] Failed to ensure table:", err.message);
  } finally {
    client.release();
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getSessionData(): Promise<SessionData | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT data FROM ambassadori_session_store WHERE key = 'browser_session' LIMIT 1`
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].data as SessionData;
  } catch (err: any) {
    console.error("[AmbassadoriSession] Failed to get session:", err.message);
    return null;
  } finally {
    client.release();
  }
}

export async function saveSessionData(data: SessionData): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO ambassadori_session_store (key, data, created_at, updated_at)
      VALUES ('browser_session', $1, NOW(), NOW())
      ON CONFLICT (key) DO UPDATE SET data = $1, updated_at = NOW()
    `, [JSON.stringify(data)]);
    console.log(`[AmbassadoriSession] Session saved — ${data.cookies.length} cookie(s)`);
  } catch (err: any) {
    console.error("[AmbassadoriSession] Failed to save session:", err.message);
  } finally {
    client.release();
  }
}

export async function clearSessionData(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM ambassadori_session_store WHERE key = 'browser_session'`);
    console.log("[AmbassadoriSession] Session cleared");
  } catch (err: any) {
    console.error("[AmbassadoriSession] Failed to clear:", err.message);
  } finally {
    client.release();
  }
}

// ── Session health ────────────────────────────────────────────────────────────

export interface SessionStatus {
  hasSession:      boolean;
  savedAt?:        string;
  cookieCount?:    number;
  isLikelyExpired: boolean;
  ageHours?:       number;
  seedFromEnv?:    boolean;
}

export async function getSessionStatus(): Promise<SessionStatus> {
  const data = await getSessionData();
  if (!data) {
    const hasEnvToken = !!process.env.AMBASSADORI_SESSION_TOKEN?.trim();
    return { hasSession: false, isLikelyExpired: true, seedFromEnv: hasEnvToken };
  }
  const savedAt  = new Date(data.savedAt);
  const ageHours = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);
  return {
    hasSession:      true,
    savedAt:         data.savedAt,
    cookieCount:     data.cookies.length,
    isLikelyExpired: ageHours > 20,
    ageHours:        Math.round(ageHours * 10) / 10,
  };
}

// ── Build initial seed from env token ────────────────────────────────────────
// ITRIELT stores auth as localStorage key "token". If we have no stored session
// but have AMBASSADORI_SESSION_TOKEN, seed the session with it so the first
// browser attempt can try it directly.

export function buildEnvTokenSeed(): SessionData | null {
  const token = process.env.AMBASSADORI_SESSION_TOKEN?.trim();
  if (!token) return null;
  return {
    cookies:      [],
    localStorage: { token },
    savedAt:      new Date().toISOString(),
  };
}
