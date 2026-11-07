import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import pg from "pg";
import {
  acceptMetaOnboardingFinish,
  MetaOnboardingRejected,
  type MetaOnboardingProof,
  type MetaOnboardingVerifier,
  type OnboardingRepository,
} from "./whatsappMetaOnboardingProof";

const FLOW_TTL_SECONDS = 300;
let pool: pg.Pool | undefined;

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function enabled(verifier?: MetaOnboardingVerifier): boolean {
  // No production route may use the fixture verifier or the test repository.
  return process.env.NODE_ENV === "test" &&
    process.env.WHATSAPP_META_ONBOARDING_ENABLED === "true" &&
    verifier !== undefined;
}

function getTestPool(): pg.Pool {
  if (process.env.NODE_ENV !== "test") throw new Error("Test-only onboarding repository");
  const connectionString = process.env.WHATSAPP_META_ONBOARDING_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Onboarding test database is not configured");
  const parsed = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) ||
      !/(^|[_-])(test|testing)([_-]|$)/.test(parsed.pathname.replace(/^\//, "").toLowerCase())) {
    throw new Error("Onboarding requires an isolated loopback test database");
  }
  return pool ??= new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 1200 });
}

export async function closeWhatsappMetaOnboardingTestPool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

function repository(db: pg.Pool): OnboardingRepository & {
  createFlow(input: { flowId: string; actorId: number; sessionHash: string; origin: string;
    state: string; csrfToken: string; expiresAt: Date }): Promise<void>;
} {
  return {
    async createFlow(input) {
      await db.query(
        `INSERT INTO whatsapp_onboarding_flows
          (flow_id,actor_id,session_hash,origin,state_hash,csrf_hash,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.flowId,input.actorId,input.sessionHash,input.origin,digest(input.state),digest(input.csrfToken),input.expiresAt],
      );
    },
    async consumeFlow(input) {
      // One conditional UPDATE is the single-use claim. Only the winner receives
      // a row; origin, actor, session, state, CSRF and expiry are checked atomically.
      const result = await db.query(
        `UPDATE whatsapp_onboarding_flows
            SET consumed_at=NOW()
          WHERE flow_id=$1 AND actor_id=$2 AND session_hash=$3 AND origin=$4
            AND state_hash=$5 AND csrf_hash=$6 AND expires_at>NOW() AND consumed_at IS NULL
          RETURNING flow_id,actor_id,origin,consumed_at`,
        [input.flowId,input.actorId,input.sessionHash,input.requestOrigin,digest(input.state),digest(input.csrfToken)],
      );
      const row = result.rows[0];
      return row ? {
        flowId: String(row.flow_id), actorId: Number(row.actor_id),
        expectedOrigin: String(row.origin), consumedAt: new Date(row.consumed_at as string),
      } : null;
    },
    async saveVerifiedNumber(proof, actorId) {
      try {
        await db.query(
          `INSERT INTO whatsapp_onboarding_proofs
            (business_portfolio_id,waba_id,phone_number_id,display_phone_number,
             ownership_verified,coexistence_verified,permissions,verified_by)
           VALUES ($1,$2,$3,$4,true,true,$5,$6)`,
          [proof.businessPortfolioId,proof.wabaId,proof.phoneNumberId,proof.displayPhoneNumber,
            proof.grantedPermissions,actorId],
        );
        return "saved";
      } catch (error: any) {
        if (error?.code === "23505") return "duplicate";
        throw error;
      }
    },
    async revokeNumber(phoneNumberId, actorId, reason) {
      const result = await db.query(
        `UPDATE whatsapp_onboarding_proofs SET revoked_at=NOW(),revoked_by=$2,revocation_reason=$3
          WHERE phone_number_id=$1 AND revoked_at IS NULL`,
        [phoneNumberId,actorId,reason],
      );
      return result.rowCount === 1;
    },
  };
}

function sameRequestOrigin(req: any): string | null {
  const origin = req.get("origin");
  const host = req.get("host");
  if (typeof origin !== "string" || typeof host !== "string") return null;
  try {
    const parsed = new URL(origin);
    const local = parsed.protocol === "http:" &&
      ["localhost","127.0.0.1","[::1]"].includes(parsed.hostname);
    if ((parsed.protocol !== "https:" && !local) || parsed.origin !== origin ||
        parsed.host !== host || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch { return null; }
}

async function adminActor(req: any, db: pg.Pool): Promise<number | null> {
  const actorId = Number(req.session?.userId);
  const sessionId = req.sessionID;
  if (!Number.isSafeInteger(actorId) || actorId <= 0 || typeof sessionId !== "string" || sessionId.length < 16) return null;
  const result = await db.query(
    "SELECT id FROM users WHERE id=$1 AND is_admin=true AND is_active=true LIMIT 1",
    [actorId],
  );
  return result.rowCount === 1 ? actorId : null;
}

function saveSession(req: any): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof req.session?.save !== "function") return reject(new Error("Server session store unavailable"));
    req.session.save((error: unknown) => error ? reject(error) : resolve());
  });
}

function noStore(res: any): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

/**
 * A route contract for isolated tests only. Production is hard-disabled until
 * a separately reviewed, real Meta verifier and non-test repository exist.
 */
export function registerWhatsappMetaOnboardingRoutes(
  app: Express,
  verifier?: MetaOnboardingVerifier,
): void {
  app.get("/api/admin/whatsapp-meta/onboarding/csrf", async (req: any, res: any) => {
    noStore(res);
    if (!enabled(verifier)) return res.sendStatus(404);
    const origin = sameRequestOrigin(req);
    if (!origin) return res.sendStatus(403);
    try {
      const db = getTestPool();
      if (!(await adminActor(req, db))) return res.sendStatus(req.session?.userId ? 403 : 401);
      const csrfToken = randomBytes(32).toString("hex");
      req.session.whatsappMetaStartCsrf = csrfToken;
      await saveSession(req);
      return res.json({ csrfToken });
    } catch { return res.sendStatus(503); }
  });

  app.post("/api/admin/whatsapp-meta/onboarding/start", async (req: any, res: any) => {
    noStore(res);
    if (!enabled(verifier)) return res.sendStatus(404);
    const origin = sameRequestOrigin(req);
    if (!origin) return res.sendStatus(403);
    try {
      const db = getTestPool();
      const actorId = await adminActor(req, db);
      if (!actorId) return res.sendStatus(req.session?.userId ? 403 : 401);
      const suppliedCsrf = req.get("x-csrf-token");
      const sessionCsrf = req.session?.whatsappMetaStartCsrf;
      if (typeof suppliedCsrf !== "string" || typeof sessionCsrf !== "string") return res.sendStatus(403);
      const suppliedBytes = Buffer.from(suppliedCsrf);
      const sessionBytes = Buffer.from(sessionCsrf);
      if (suppliedBytes.length !== sessionBytes.length || !timingSafeEqual(suppliedBytes, sessionBytes)) {
        return res.sendStatus(403);
      }
      const flowId = randomUUID();
      const state = randomBytes(32).toString("hex");
      const csrfToken = randomBytes(32).toString("hex");
      const sessionHash = digest(req.sessionID);
      const expiresAt = new Date(Date.now() + FLOW_TTL_SECONDS * 1000);
      await repository(db).createFlow({ flowId,actorId,sessionHash,origin,state,csrfToken,expiresAt });
      req.session.whatsappMetaStartCsrf = null;
      await saveSession(req);
      return res.status(201).json({ flowId,state,csrfToken,expiresAt: expiresAt.toISOString() });
    } catch { return res.sendStatus(503); }
  });

  app.post("/api/admin/whatsapp-meta/onboarding/finish", async (req: any, res: any) => {
    noStore(res);
    if (!enabled(verifier)) return res.sendStatus(404);
    const origin = sameRequestOrigin(req);
    if (!origin) return res.sendStatus(403);
    try {
      const db = getTestPool();
      const actorId = await adminActor(req, db);
      if (!actorId) return res.sendStatus(req.session?.userId ? 403 : 401);
      const sessionHash = digest(req.sessionID);
      const outcome = await acceptMetaOnboardingFinish({
        enabled: true,
        finish: req.body,
        actorId,
        sessionHash,
        requestOrigin: origin,
        csrfToken: req.get("x-csrf-token") ?? "",
        repository: repository(db),
        verifier: verifier!,
      });
      return res.status(201).json({ status: outcome.status });
    } catch (error) {
      // No provider error, code, token, callback body, or identifier is logged or echoed.
      const status = error instanceof MetaOnboardingRejected ? 400 : 503;
      return res.status(status).json({ message: "Onboarding could not be verified" });
    }
  });
}
