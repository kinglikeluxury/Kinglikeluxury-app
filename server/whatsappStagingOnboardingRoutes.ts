import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import type { Pool } from "pg";
import { acceptMetaOnboardingFinish, MetaOnboardingRejected, type MetaOnboardingVerifier, type OnboardingRepository } from "./whatsappMetaOnboardingProof";
import { stagingDatabaseIsIsolated } from "./stagingExternalGuard";

/**
 * A Staging-only, manually gated real-backend boundary for future Embedded Signup.
 * It does not call Meta without an explicitly supplied verifier and does not
 * enable the client-side Connect button. No message/webhook ingestion or sends.
 * A separate migration review is required before the opt-in flag can be set.
 */
export type StagingOnboardingDependencies = {
  db: Pick<Pool, "query">;
  authorizeAdmin: (req: Request) => Promise<number | null>;
  verifier?: MetaOnboardingVerifier;
  env?: NodeJS.ProcessEnv;
};

const ID = /^\d{5,80}$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const TTL_MS = 300_000;

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export function stagingSignupPolicy(env: NodeJS.ProcessEnv = process.env) {
  const approvedPortfolio = env.WHATSAPP_STAGING_APPROVED_BUSINESS_PORTFOLIO_ID;
  const approvedPhone = env.WHATSAPP_STAGING_APPROVED_EMPLOYEE_PHONE;
  if (env.APP_DEPLOYMENT_MODE !== "staging" ||
      env.WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED !== "true" ||
      !stagingDatabaseIsIsolated(env) ||
      !ID.test(approvedPortfolio ?? "") ||
      !E164.test(approvedPhone ?? "") ||
      env.WHATSAPP_STAGING_EMPLOYEE_NOTICE_REVIEWED !== "true" ||
      env.WHATSAPP_STAGING_PROOF_SCHEMA_REVIEWED !== "true") return null;
  return { approvedPortfolio: approvedPortfolio!, approvedPhone: approvedPhone! };
}

function noStore(res: any): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function exactOrigin(req: Request): string | null {
  const origin = req.get("origin");
  const host = req.get("host");
  if (!origin || !host) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.host !== host ||
        parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch { return null; }
}

function sessionId(req: Request): string | null {
  const value = (req as any).sessionID;
  return typeof value === "string" && value.length >= 16 ? value : null;
}

function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" ||
      a.length < 32 || a.length > 256 || b.length < 32 || b.length > 256) return false;
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

function finishBodyValid(value: unknown, policy: NonNullable<ReturnType<typeof stagingSignupPolicy>>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const x = value as Record<string, unknown>;
  return x.businessPortfolioId === policy.approvedPortfolio &&
    x.displayPhoneNumber === policy.approvedPhone &&
    ID.test(String(x.wabaId ?? "")) &&
    (x.phoneNumberId === undefined || (typeof x.phoneNumberId === "string" && ID.test(x.phoneNumberId)));
}

/** SQL stays manual; no migration or table creation is performed here. */
export function stagingProofRepository(db: Pick<Pool, "query">):
  OnboardingRepository & {
    createFlow(input: { flowId: string; actorId: number; sessionHash: string; origin: string;
      state: string; csrfToken: string; expiresAt: Date }): Promise<void>;
  } {
  return {
    async createFlow(input) {
      await db.query(
        `INSERT INTO kinglike_whatsapp.whatsapp_onboarding_flows
          (flow_id, actor_id, session_hash, origin, state_hash, csrf_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.flowId, input.actorId, input.sessionHash, input.origin,
          digest(input.state), digest(input.csrfToken), input.expiresAt],
      );
    },
    async consumeFlow(input) {
      const result = await db.query(
        `UPDATE kinglike_whatsapp.whatsapp_onboarding_flows SET consumed_at=NOW()
          WHERE flow_id=$1 AND actor_id=$2 AND session_hash=$3 AND origin=$4
            AND state_hash=$5 AND csrf_hash=$6 AND expires_at>NOW() AND consumed_at IS NULL
          RETURNING flow_id, actor_id, origin, consumed_at`,
        [input.flowId, input.actorId, input.sessionHash, input.requestOrigin,
          digest(input.state), digest(input.csrfToken)],
      );
      const row = result.rows?.[0];
      return row ? { flowId: String(row.flow_id), actorId: Number(row.actor_id),
        expectedOrigin: String(row.origin), consumedAt: new Date(row.consumed_at) } : null;
    },
    async saveVerifiedNumber(proof, actorId) {
      try {
        await db.query(
          `INSERT INTO kinglike_whatsapp.whatsapp_onboarding_proofs
            (business_portfolio_id, waba_id, phone_number_id, display_phone_number,
             ownership_verified, coexistence_verified, permissions, verified_by)
            VALUES ($1,$2,$3,$4,true,true,$5,$6)`,
          [proof.businessPortfolioId, proof.wabaId, proof.phoneNumberId,
            proof.displayPhoneNumber, proof.grantedPermissions, actorId],
        );
        return "saved";
      } catch (error: any) {
        if (error?.code === "23505") return "duplicate";
        throw error;
      }
    },
    async revokeNumber(phoneNumberId, actorId, reason) {
      const result = await db.query(
        `UPDATE kinglike_whatsapp.whatsapp_onboarding_proofs
          SET revoked_at=NOW(), revoked_by=$2, revocation_reason=$3
          WHERE phone_number_id=$1 AND revoked_at IS NULL`,
        [phoneNumberId, actorId, reason],
      );
      return result.rowCount === 1;
    },
  };
}

export function registerStagingWhatsappOnboardingRoutes(app: Express, deps: StagingOnboardingDependencies): void {
  const env = deps.env ?? process.env;
  const ready = () => stagingSignupPolicy(env) && deps.verifier;
  const repository = stagingProofRepository(deps.db);
  const prefix = "/api/admin/staging/whatsapp-verified-signup";
  // Always return 404 outside explicitly approved isolated staging.
  const prepare = async (req: Request, res: any): Promise<{ actorId: number; origin: string; sessionHash: string } | null> => {
    noStore(res);
    if (!ready()) { res.sendStatus(404); return null; }
    const origin = exactOrigin(req);
    const id = sessionId(req);
    if (!origin || !id) { res.sendStatus(403); return null; }
    try {
      const actorId = await deps.authorizeAdmin(req);
      if (!Number.isSafeInteger(actorId) || !actorId || actorId <= 0) {
        res.sendStatus(403); return null;
      }
      return { actorId, origin, sessionHash: digest(id) };
    } catch {
      res.sendStatus(503);
      return null;
    }
  };
  app.get(`${prefix}/csrf`, async (req, res) => {
    const actor = await prepare(req, res);
    if (!actor) return;
    const token = randomBytes(32).toString("hex");
    (req.session as any).stagingVerifiedSignupStartCsrf = token;
    req.session.save(error => {
      if (error) return res.sendStatus(503);
      return res.status(200).json({ csrfToken: token });
    });
  });
  app.post(`${prefix}/start`, async (req, res) => {
    const actor = await prepare(req, res);
    if (!actor) return;
    if (!safeEqual(req.get("x-csrf-token"), (req.session as any).stagingVerifiedSignupStartCsrf)) {
      return res.sendStatus(403);
    }
    const state = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(32).toString("hex");
    const flowId = randomUUID();
    try {
      await repository.createFlow({ flowId, actorId: actor.actorId,
        sessionHash: actor.sessionHash, origin: actor.origin, state, csrfToken,
        expiresAt: new Date(Date.now() + TTL_MS) });
      (req.session as any).stagingVerifiedSignupStartCsrf = null;
      req.session.save(error => {
        if (error) return res.sendStatus(503);
        return res.status(201).json({ flowId, state, csrfToken });
      });
    } catch { return res.sendStatus(503); }
  });
  app.post(`${prefix}/finish`, async (req, res) => {
    const actor = await prepare(req, res);
    if (!actor) return;
    const policy = stagingSignupPolicy(env);
    if (!policy || !finishBodyValid(req.body, policy)) return res.sendStatus(400);
    try {
      const outcome = await acceptMetaOnboardingFinish({
        enabled: true, finish: req.body, actorId: actor.actorId,
        sessionHash: actor.sessionHash, requestOrigin: actor.origin,
        csrfToken: req.get("x-csrf-token") ?? "",
        repository, verifier: deps.verifier!,
      });
      return res.status(201).json({ status: outcome.status }); // never return IDs/tokens
    } catch (err) {
      return res.status(err instanceof MetaOnboardingRejected ? 400 : 503)
        .json({ message: "Onboarding verification was not completed" });
    }
  });
}
