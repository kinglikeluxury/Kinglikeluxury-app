import type { MetaWhatsappSignupSessionEvent } from "./metaWhatsappMonitorSignup";

/**
 * Transient client-side coordination of two independent Meta SDK callbacks.
 *
 * Embedded Signup provides the one-time authorization code through FB.login,
 * and the WABA / phone identifiers through WA_EMBEDDED_SIGNUP postMessage.
 * Their order is not guaranteed. The bridge NEVER stores data outside memory,
 * and it does not itself contact Graph, authorize staff, or persist credentials.
 *
 * Only submit a completed payload to a separately approved, authenticated,
 * CSRF-checked server onboarding route. Such a live route is NOT enabled.
 */
export type PendingMetaSignupFinish = {
  code: string;
  businessPortfolioId: string;
  wabaId: string;
  /** Optional in Coexistence FINISH; server must discover exact approved phone. */
  phoneNumberId?: string;
};

const ID = /^\d{5,80}$/;
const CODE = /^[\x21-\x7E]{8,4096}$/;
const DEFAULT_TTL_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read only the documented FB.login authResponse.code; never log response. */
export function readMetaSignupAuthorizationCode(response: unknown): string | null {
  if (!isRecord(response) || !isRecord(response.authResponse)) return null;
  const code = response.authResponse.code;
  return typeof code === "string" && CODE.test(code) ? code : null;
}

type MetaSignupIds = Omit<PendingMetaSignupFinish, "code">;

function validIds(event: MetaWhatsappSignupSessionEvent): MetaSignupIds | null {
  if (event.kind !== "completed" ||
      !ID.test(event.businessPortfolioId ?? "") ||
      !ID.test(event.wabaId ?? "") ||
      (event.phoneNumberId != null && !ID.test(event.phoneNumberId))) return null;
  return {
    businessPortfolioId: event.businessPortfolioId!,
    wabaId: event.wabaId!,
    ...(event.phoneNumberId ? { phoneNumberId: event.phoneNumberId } : {}),
  };
}

export class MetaSignupCompletionBridge {
  private startedAt: number | null = null;
  private code: string | null = null;
  private ids: MetaSignupIds | null = null;
  private consumed = false;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  begin(): void {
    this.clear();
    this.startedAt = this.now();
  }

  /** Cancellation, error, or unmount must immediately discard pending code. */
  clear(): void {
    this.code = null;
    this.ids = null;
    this.startedAt = null;
    this.consumed = false;
  }

  private validAttempt(): boolean {
    if (this.startedAt === null || this.consumed) return false;
    const elapsed = this.now() - this.startedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > this.ttlMs) {
      this.clear();
      return false;
    }
    return true;
  }

  /** SDK authorization can arrive before or after WA_EMBEDDED_SIGNUP FINISH. */
  acceptLoginResponse(response: unknown): boolean {
    if (!this.validAttempt()) return false;
    const code = readMetaSignupAuthorizationCode(response);
    if (!code) return false;
    if (this.code !== null && this.code !== code) {
      this.clear(); // Conflicting callbacks never cross-contaminate a flow.
      return false;
    }
    this.code = code;
    return true;
  }

  acceptSessionEvent(event: MetaWhatsappSignupSessionEvent): boolean {
    if (!this.validAttempt()) return false;
    if (event.kind === "cancelled" || event.kind === "error") {
      this.clear();
      return false;
    }
    const ids = validIds(event);
    if (!ids) return false;
    if (this.ids &&
        (this.ids.businessPortfolioId !== ids.businessPortfolioId ||
         this.ids.wabaId !== ids.wabaId ||
         this.ids.phoneNumberId !== ids.phoneNumberId)) {
      this.clear();
      return false;
    }
    this.ids = ids;
    return true;
  }

  /**
   * One-time consume, never serializes a code to browser storage.
   * Caller must only use this in an approved authenticated server handshake.
   */
  takeReady(): PendingMetaSignupFinish | null {
    if (!this.validAttempt() || !this.code || !this.ids) return null;
    const ready = { code: this.code, ...this.ids };
    this.clear();
    this.consumed = true;
    return ready;
  }
}
