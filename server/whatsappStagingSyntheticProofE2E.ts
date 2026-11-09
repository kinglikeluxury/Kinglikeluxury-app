import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  acceptMetaOnboardingFinish,
  MetaOnboardingRejected,
  type MetaOnboardingVerifier,
} from "./whatsappMetaOnboardingProof";
import { stagingProofRepository } from "./whatsappStagingOnboardingRoutes";
import { resolveWhatsappProofDbConfig } from "./whatsappStagingProofDb";

/**
 * Run one synthetic onboarding transaction against the already-verified,
 * dedicated WhatsApp Staging proof pool. Never reaches Meta, never activates
 * a real number, and NEVER commits test records.
 *
 * This is an app-to-PostgreSQL integration probe, not a real onboarding demo.
 */
export const SYNTHETIC_PROOF_WABA = "8888811122";
export const SYNTHETIC_PROOF_PHONE_ID = "8888833344";
export const SYNTHETIC_PROOF_E164 = "+995555000001";
const SYNTHETIC_PORTFOLIO = "8888855566";
const SYNTHETIC_ACTOR = 900001;
const SYNTHETIC_ORIGIN = "https://synthetic.invalid";

type QueryResult = { rows: Array<Record<string, unknown>> };
export type SyntheticProofClient = {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};
export type SyntheticProofPool = {
  connect(): Promise<SyntheticProofClient>;
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
};

function countsAreZero(rows: Array<Record<string, unknown>>): boolean {
  return rows.length === 1 &&
    Number(rows[0].flows) === 0 &&
    Number(rows[0].proofs) === 0;
}

const countSql = `
  SELECT
    (SELECT COUNT(*) FROM kinglike_whatsapp.whatsapp_onboarding_flows) AS flows,
    (SELECT COUNT(*) FROM kinglike_whatsapp.whatsapp_onboarding_proofs) AS proofs
`;

export function syntheticProofProbeApproved(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_DEPLOYMENT_MODE === "staging" &&
    env.WHATSAPP_STAGING_SYNTHETIC_PROOF_PROBE_ENABLED === "true" &&
    env.WHATSAPP_STAGING_PROOF_PREFLIGHT_ENABLED === "true" &&
    env.WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED !== "true" &&
    env.WHATSAPP_STAGING_META_GRAPH_VERIFIER_ENABLED !== "true" &&
    env.WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED !== "true" &&
    env.WHATSAPP_EMPLOYEE_MONITORING_ENABLED !== "true" &&
    resolveWhatsappProofDbConfig(env) !== null;
}

export async function runSyntheticWhatsappProofE2E(
  pool: SyntheticProofPool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  status: "synthetic_verified_rolled_back";
  realNumbersConnected: false;
  recordsPersisted: 0;
  metaRequests: 0;
}> {
  if (!syntheticProofProbeApproved(env)) throw new Error("Synthetic proof probe not approved");
  if (!countsAreZero((await pool.query(countSql)).rows)) {
    throw new Error("Synthetic proof database contains records; refusing probe");
  }

  const client = await pool.connect();
  let inTransaction = false;
  let readyToReturn = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;

    // The shared proof logic and SQL repository are the same implementation
    // that would be used by a *separately enabled* real Meta callback route.
    const repository = stagingProofRepository(client as unknown as Pick<Pool, "query">);
    const flowId = randomUUID();
    const state = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(32).toString("hex");
    const sessionHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    const oneTimeCode = "SYNTHETIC_CODE_NO_META_CALL_" + randomBytes(16).toString("hex");
    await repository.createFlow({
      flowId,
      actorId: SYNTHETIC_ACTOR,
      sessionHash,
      origin: SYNTHETIC_ORIGIN,
      state,
      csrfToken,
      expiresAt: new Date(Date.now() + 300_000),
    });

    let metaCalls = 0;
    const syntheticVerifier: MetaOnboardingVerifier = {
      async exchangeAndVerify(input) {
        metaCalls++;
        if (input.code !== oneTimeCode ||
            input.businessPortfolioId !== SYNTHETIC_PORTFOLIO ||
            input.wabaId !== SYNTHETIC_PROOF_WABA ||
            input.phoneNumberId !== SYNTHETIC_PROOF_PHONE_ID ||
            input.displayPhoneNumber !== SYNTHETIC_PROOF_E164) {
          throw new Error("Unexpected synthetic proof input");
        }
        return {
          businessPortfolioId: SYNTHETIC_PORTFOLIO,
          wabaId: SYNTHETIC_PROOF_WABA,
          phoneNumberId: SYNTHETIC_PROOF_PHONE_ID,
          displayPhoneNumber: SYNTHETIC_PROOF_E164,
          grantedPermissions: ["whatsapp_business_management", "whatsapp_business_messaging"],
          ownershipVerified: true,
          coexistence: "verified",
        };
      },
    };
    const finish = {
      flowId,
      state,
      code: oneTimeCode,
      businessPortfolioId: SYNTHETIC_PORTFOLIO,
      wabaId: SYNTHETIC_PROOF_WABA,
      phoneNumberId: SYNTHETIC_PROOF_PHONE_ID,
      displayPhoneNumber: SYNTHETIC_PROOF_E164,
    };

    const result = await acceptMetaOnboardingFinish({
      enabled: true,
      finish,
      actorId: SYNTHETIC_ACTOR,
      sessionHash,
      requestOrigin: SYNTHETIC_ORIGIN,
      csrfToken,
      repository,
      verifier: syntheticVerifier,
    });
    if (result.status !== "verified_pending_activation" ||
        result.phoneNumberId !== SYNTHETIC_PROOF_PHONE_ID || metaCalls !== 1) {
      throw new Error("Synthetic proof validation was not accepted exactly once");
    }

    try {
      await acceptMetaOnboardingFinish({
        enabled: true,
        finish,
        actorId: SYNTHETIC_ACTOR,
        sessionHash,
        requestOrigin: SYNTHETIC_ORIGIN,
        csrfToken,
        repository,
        verifier: syntheticVerifier,
      });
      throw new Error("Synthetic replay unexpectedly succeeded");
    } catch (error) {
      if (!(error instanceof MetaOnboardingRejected) || error.code !== "FLOW_INVALID") throw error;
    }
    if (metaCalls !== 1) throw new Error("Verifier was called during a replay");

    const inside = (await client.query(countSql)).rows;
    if (inside.length !== 1 || Number(inside[0].flows) !== 1 ||
        Number(inside[0].proofs) !== 1) {
      throw new Error("Synthetic proof transaction did not write one record each");
    }
    readyToReturn = true;
  } finally {
    try {
      if (inTransaction) await client.query("ROLLBACK"); // unconditional, never COMMIT
    } finally {
      client.release();
    }
  }

  if (!readyToReturn || !countsAreZero((await pool.query(countSql)).rows)) {
    throw new Error("Synthetic proof test did not fully roll back");
  }
  return {
    status: "synthetic_verified_rolled_back",
    realNumbersConnected: false,
    recordsPersisted: 0,
    metaRequests: 0,
  };
}
