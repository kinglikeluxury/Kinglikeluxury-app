export type MetaOnboardingProof = {
  businessPortfolioId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  coexistence: "verified" | "not_verified";
  grantedPermissions: string[];
  ownershipVerified: boolean;
};

export type OnboardingFlow = {
  flowId: string;
  actorId: number;
  expectedOrigin: string;
  consumedAt: Date;
};

export interface OnboardingRepository {
  consumeFlow(input: {
    flowId: string; actorId: number; sessionHash: string; requestOrigin: string;
    state: string; csrfToken: string;
  }): Promise<OnboardingFlow | null>;
  saveVerifiedNumber(proof: MetaOnboardingProof, actorId: number): Promise<"saved" | "duplicate">;
  revokeNumber(phoneNumberId: string, actorId: number, reason: "owner_revoked" | "permission_lost"): Promise<boolean>;
}

/**
 * Adapter is the only future boundary allowed to exchange the one-time code and
 * query Graph. Implementations must keep tokens in memory only and return
 * verified facts, never credentials. Production adapter is intentionally absent.
 */
export interface MetaOnboardingVerifier {
  exchangeAndVerify(input: {
    code: string;
    businessPortfolioId: string;
    wabaId: string;
    phoneNumberId?: string;
    displayPhoneNumber: string;
  }): Promise<MetaOnboardingProof>;
}

const REQUIRED_PERMISSIONS = ["whatsapp_business_management", "whatsapp_business_messaging"];
const ID = /^\d{5,80}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export class MetaOnboardingRejected extends Error {
  constructor(readonly code: "DISABLED" | "INVALID_FINISH" | "FLOW_INVALID" | "META_PROOF_FAILED" | "DUPLICATE_OWNERSHIP") {
    super(code);
  }
}

/**
 * Disabled unless explicitly enabled by a caller in an isolated environment.
 * The FINISH callback is treated only as untrusted identifiers + one-time code.
 */
export async function acceptMetaOnboardingFinish(input: {
  enabled: boolean;
  finish: {
    flowId: string; state: string; code: string; businessPortfolioId: string; wabaId: string;
    phoneNumberId?: string; displayPhoneNumber: string;
  };
  actorId: number;
  sessionHash: string;
  requestOrigin: string;
  csrfToken: string;
  repository: OnboardingRepository;
  verifier: MetaOnboardingVerifier;
}): Promise<{ status: "verified_pending_activation"; phoneNumberId: string }> {
  if (!input.enabled) throw new MetaOnboardingRejected("DISABLED");
  const finish = input.finish;
  if (!finish || typeof finish.code !== "string" || finish.code.length < 8 || finish.code.length > 4096 ||
      typeof finish.flowId !== "string" || finish.flowId.length < 8 || finish.flowId.length > 200 ||
      typeof finish.state !== "string" || finish.state.length < 32 ||
      typeof input.csrfToken !== "string" || input.csrfToken.length < 32 ||
      typeof input.sessionHash !== "string" || !/^[a-f0-9]{64}$/.test(input.sessionHash) ||
      !ID.test(finish.businessPortfolioId) || !ID.test(finish.wabaId) ||
      (finish.phoneNumberId !== undefined && !ID.test(finish.phoneNumberId)) ||
      !E164.test(finish.displayPhoneNumber) || !Number.isSafeInteger(input.actorId) || input.actorId <= 0) {
    throw new MetaOnboardingRejected("INVALID_FINISH");
  }
  const requestOrigin = normalizedOrigin(input.requestOrigin);
  if (!requestOrigin) throw new MetaOnboardingRejected("FLOW_INVALID");
  const flow = await input.repository.consumeFlow({
    flowId: finish.flowId,
    actorId: input.actorId,
    sessionHash: input.sessionHash,
    requestOrigin,
    state: finish.state,
    csrfToken: input.csrfToken,
  });
  const expectedOrigin = flow ? normalizedOrigin(flow.expectedOrigin) : null;
  if (!flow || !expectedOrigin || !requestOrigin || expectedOrigin !== requestOrigin) {
    throw new MetaOnboardingRejected("FLOW_INVALID");
  }

  let proof: MetaOnboardingProof;
  try {
    proof = await input.verifier.exchangeAndVerify({
      code: finish.code,
      businessPortfolioId: finish.businessPortfolioId,
      wabaId: finish.wabaId,
      phoneNumberId: finish.phoneNumberId,
      displayPhoneNumber: finish.displayPhoneNumber,
    });
  } catch {
    throw new MetaOnboardingRejected("META_PROOF_FAILED");
  }
  const permissions = new Set(proof.grantedPermissions);
  if (!proof.ownershipVerified || proof.businessPortfolioId !== finish.businessPortfolioId ||
      proof.wabaId !== finish.wabaId || !ID.test(proof.phoneNumberId) ||
      (finish.phoneNumberId !== undefined && proof.phoneNumberId !== finish.phoneNumberId) ||
      proof.displayPhoneNumber !== finish.displayPhoneNumber || proof.coexistence !== "verified" ||
      REQUIRED_PERMISSIONS.some(permission => !permissions.has(permission))) {
    throw new MetaOnboardingRejected("META_PROOF_FAILED");
  }
  const saved = await input.repository.saveVerifiedNumber(proof, input.actorId);
  if (saved === "duplicate") throw new MetaOnboardingRejected("DUPLICATE_OWNERSHIP");
  return { status: "verified_pending_activation", phoneNumberId: proof.phoneNumberId };
}

export async function revokeMetaOnboardingNumber(
  repository: OnboardingRepository,
  phoneNumberId: string,
  actorId: number,
  reason: "owner_revoked" | "permission_lost",
): Promise<boolean> {
  if (!ID.test(phoneNumberId) || !Number.isSafeInteger(actorId) || actorId <= 0) return false;
  return repository.revokeNumber(phoneNumberId, actorId, reason);
}
