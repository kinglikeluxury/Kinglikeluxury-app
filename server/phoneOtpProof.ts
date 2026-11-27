export type PhoneOtpLoginChallenge = {
  phoneNumber: string;
  accountId: number | null;
  expiresAt: number;
};

export type PhoneRegistrationProof = PhoneOtpLoginChallenge;

export type PhoneOtpSessionState = {
  phoneOtpLoginChallenge?: PhoneOtpLoginChallenge;
  phoneRegistrationProof?: PhoneRegistrationProof;
};

declare module "express-session" {
  interface SessionData {
    phoneOtpLoginChallenge?: PhoneOtpLoginChallenge;
    phoneRegistrationProof?: PhoneRegistrationProof;
  }
}

export function bindPhoneOtpLoginChallenge(
  session: PhoneOtpSessionState,
  phoneNumber: string,
  accountId: number | null,
  expiresAt: number,
): void {
  session.phoneOtpLoginChallenge = { phoneNumber, accountId, expiresAt };
  delete session.phoneRegistrationProof;
}

export function getValidPhoneOtpLoginChallenge(
  session: PhoneOtpSessionState | null | undefined,
  phoneNumber: string,
  now = Date.now(),
): PhoneOtpLoginChallenge | null {
  const challenge = session?.phoneOtpLoginChallenge;
  if (
    !challenge ||
    challenge.phoneNumber !== phoneNumber ||
    !(
      challenge.accountId === null ||
      (Number.isSafeInteger(challenge.accountId) && challenge.accountId > 0)
    ) ||
    !Number.isFinite(challenge.expiresAt) ||
    now >= challenge.expiresAt
  ) {
    return null;
  }
  return challenge;
}

export function consumePhoneOtpLoginChallenge(
  session: PhoneOtpSessionState,
  phoneNumber: string,
  now = Date.now(),
): PhoneOtpLoginChallenge | null {
  const challenge = getValidPhoneOtpLoginChallenge(session, phoneNumber, now);
  if (!challenge) return null;
  delete session.phoneOtpLoginChallenge;
  return challenge;
}

export function setPhoneRegistrationProof(
  session: PhoneOtpSessionState,
  challenge: PhoneOtpLoginChallenge,
): void {
  session.phoneRegistrationProof = { ...challenge };
}

export function getValidPhoneRegistrationProof(
  session: PhoneOtpSessionState | null | undefined,
  phoneNumber: string,
  now = Date.now(),
): PhoneRegistrationProof | null {
  const proof = session?.phoneRegistrationProof;
  if (
    !proof ||
    proof.phoneNumber !== phoneNumber ||
    proof.accountId !== null ||
    !Number.isFinite(proof.expiresAt) ||
    now >= proof.expiresAt
  ) {
    return null;
  }
  return proof;
}

export function consumePhoneRegistrationProof(
  session: PhoneOtpSessionState,
  phoneNumber: string,
  now = Date.now(),
): PhoneRegistrationProof | null {
  const proof = getValidPhoneRegistrationProof(session, phoneNumber, now);
  if (!proof) return null;
  delete session.phoneRegistrationProof;
  return proof;
}

export function clearPhoneOtpSessionProofs(session: PhoneOtpSessionState): void {
  delete session.phoneOtpLoginChallenge;
  delete session.phoneRegistrationProof;
}

export type PhoneOtpAttemptLimiter = (
  phoneNumber: string,
  ipAddress: string,
) => boolean | Promise<boolean>;

export function createPhoneOtpAttemptLimiter(options?: {
  maxPerPhone?: number;
  maxPerIp?: number;
  windowMs?: number;
  now?: () => number;
}): PhoneOtpAttemptLimiter {
  const maxPerPhone = options?.maxPerPhone ?? 5;
  const maxPerIp = options?.maxPerIp ?? 20;
  const windowMs = options?.windowMs ?? 15 * 60 * 1000;
  const now = options?.now ?? Date.now;
  const phoneAttempts = new Map<string, number[]>();
  const ipAttempts = new Map<string, number[]>();

  const take = (attemptsByKey: Map<string, number[]>, key: string, max: number): boolean => {
    const currentTime = now();
    const recent = (attemptsByKey.get(key) ?? []).filter(
      (timestamp) => currentTime - timestamp < windowMs,
    );
    if (recent.length >= max) {
      attemptsByKey.set(key, recent);
      return false;
    }
    recent.push(currentTime);
    attemptsByKey.set(key, recent);
    return true;
  };

  return (phoneNumber, ipAddress) => {
    if (!phoneNumber || !ipAddress) return false;
    if (!take(phoneAttempts, phoneNumber, maxPerPhone)) return false;
    return take(ipAttempts, ipAddress, maxPerIp);
  };
}
