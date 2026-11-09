/**
 * Coexistence history preflight + METADATA-ONLY webhook summary.
 * This is not a live webhook handler or a message-import implementation.
 *
 * The live handler must validate the raw Meta HMAC and registered WABA/number,
 * enqueue raw payload bytes into strictly private storage, and process in an
 * isolated worker AFTER consent, audit and DB permissions are verified.
 * A history webhook can carry thousands of messages: do not process it
 * synchronously during the HTTP response.
 */
import { createHash } from "node:crypto";

export type HistorySyncGate = Readonly<{
  verifiedCoexistence: boolean;
  employeeConsented: boolean;
  customerNoticeApproved: boolean;
  companyNumberAuthorized: boolean;
  subscribedToHistoryWebhook: boolean;
  archiveAndAuditReady: boolean;
  hasAlreadyRequestedHistory: boolean;
  onboardedAtMs: number;
  nowMs: number;
}>;

export type HistorySyncPreflight = Readonly<{
  mayRequest: boolean;
  reason: "ready" | "not_verified" | "notice_or_consent_missing" | "webhook_not_subscribed" |
    "archive_not_ready" | "already_requested" | "outside_24h_window";
}>;

export function assessOneTimeHistorySync(gate: HistorySyncGate): HistorySyncPreflight {
  if (!gate.verifiedCoexistence || !gate.companyNumberAuthorized) return { mayRequest: false, reason: "not_verified" };
  if (!gate.employeeConsented || !gate.customerNoticeApproved) return { mayRequest: false, reason: "notice_or_consent_missing" };
  if (!gate.subscribedToHistoryWebhook) return { mayRequest: false, reason: "webhook_not_subscribed" };
  if (!gate.archiveAndAuditReady) return { mayRequest: false, reason: "archive_not_ready" };
  if (gate.hasAlreadyRequestedHistory) return { mayRequest: false, reason: "already_requested" };
  if (!Number.isSafeInteger(gate.onboardedAtMs) || !Number.isSafeInteger(gate.nowMs) ||
      gate.onboardedAtMs <= 0 || gate.nowMs < gate.onboardedAtMs ||
      gate.nowMs - gate.onboardedAtMs >= 24 * 60 * 60 * 1000) {
    return { mayRequest: false, reason: "outside_24h_window" };
  }
  return { mayRequest: true, reason: "ready" };
}

export type ExpectedHistoryBusiness = Readonly<{
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
}>;

export type HistoryBatchSummary = Readonly<{
  kind: "chunk" | "declined";
  // No message bodies, contact numbers, media links or provider IDs returned.
  phase: 0 | 1 | 2 | null;
  chunkOrder: number | null;
  progress: number | null;
  threadCount: number;
  messageCount: number;
  // Stable key is scoped by WABA/number/phase/order. Duplicates must compare
  // the private content hash; conflicting duplicates must be quarantined.
  chunkKey: string;
  contentDigest: string;
  reportedComplete: boolean;
}>;

export class InvalidHistoryPayload extends Error {
  constructor() { super("Untrusted or invalid WhatsApp history metadata"); this.name = "InvalidHistoryPayload"; }
}

function obj(v: unknown): Record<string, any> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : null;
}

function digits(v: unknown): string {
  return typeof v === "string" ? v.replace(/\D/g, "") : "";
}

function integerIn(v: unknown, min: number, max: number): number | null {
  const n = (typeof v === "number" || (typeof v === "string" && /^\d{1,8}$/.test(v)))
    ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

function digest(v: unknown): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

export function summarizeVerifiedHistoryWebhook(
  payload: unknown,
  expected: ExpectedHistoryBusiness,
): HistoryBatchSummary[] {
  const root = obj(payload);
  if (root?.object !== "whatsapp_business_account" || !Array.isArray(root.entry) ||
      root.entry.length > 20 || !/^\d{4,24}$/.test(expected.wabaId) ||
      !/^\d{4,24}$/.test(expected.phoneNumberId) ||
      digits(expected.displayPhoneNumber).length < 8) throw new InvalidHistoryPayload();

  const results: HistoryBatchSummary[] = [];
  const seen = new Map<string, string>();
  let totalMessages = 0;
  for (const entry of root.entry) {
    const e = obj(entry);
    if (!e || typeof e.id !== "string") throw new InvalidHistoryPayload();
    if (!Array.isArray(e.changes) || e.changes.length > 40) throw new InvalidHistoryPayload();
    for (const change of e.changes) {
      const c = obj(change);
      if (!c || c.field !== "history") continue;
      if (e.id !== expected.wabaId) throw new InvalidHistoryPayload();
      const value = obj(c.value);
      if (!value || value.messaging_product !== "whatsapp" ||
          value.metadata?.phone_number_id !== expected.phoneNumberId ||
          digits(value.metadata?.display_phone_number) !== digits(expected.displayPhoneNumber) ||
          !Array.isArray(value.history) || value.history.length > 50) throw new InvalidHistoryPayload();

      for (const item of value.history) {
        const h = obj(item);
        if (!h) throw new InvalidHistoryPayload();
        const errors = h.errors;
        if (Array.isArray(errors) && errors.some((error) => obj(error)?.code === 2593109)) {
          if (value.history.length !== 1 || errors.length !== 1 || h.threads) throw new InvalidHistoryPayload();
          const chunkKey = digest([expected.wabaId, expected.phoneNumberId, "declined"]);
          const contentDigest = digest(h);
          if (seen.has(chunkKey) && seen.get(chunkKey) !== contentDigest) throw new InvalidHistoryPayload();
          if (!seen.has(chunkKey)) {
            results.push({ kind: "declined", phase: null, chunkOrder: null, progress: null,
              threadCount: 0, messageCount: 0, chunkKey, contentDigest, reportedComplete: false });
            seen.set(chunkKey, contentDigest);
          }
          continue;
        }
        const meta = obj(h.metadata);
        const phase = integerIn(meta?.phase, 0, 2);
        const chunkOrder = integerIn(meta?.chunk_order, 1, 1000000);
        const progress = integerIn(meta?.progress, 0, 100);
        if (phase === null || chunkOrder === null || progress === null ||
            !Array.isArray(h.threads) || h.threads.length > 5000) throw new InvalidHistoryPayload();

        let messageCount = 0;
        for (const thread of h.threads) {
          const t = obj(thread);
          if (!t || !Array.isArray(t.messages) || t.messages.length > 50000) throw new InvalidHistoryPayload();
          messageCount += t.messages.length;
          totalMessages += t.messages.length;
          if (totalMessages > 50000) throw new InvalidHistoryPayload();
        }
        const chunkKey = digest([expected.wabaId, expected.phoneNumberId, phase, chunkOrder]);
        const contentDigest = digest(h);
        if (seen.has(chunkKey)) {
          // A retransmission may be idempotent, but conflicting content is not.
          if (seen.get(chunkKey) !== contentDigest) throw new InvalidHistoryPayload();
          continue;
        }
        seen.set(chunkKey, contentDigest);
        results.push({
          kind: "chunk", phase: phase as 0 | 1 | 2, chunkOrder, progress,
          threadCount: h.threads.length, messageCount, chunkKey, contentDigest,
          // Meta's 'progress=100' is a signal, NOT proof all earlier chunks
          // were durably imported. Completion must be reconciled in the DB.
          reportedComplete: progress === 100,
        });
      }
    }
  }
  return results;
}
