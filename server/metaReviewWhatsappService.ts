import { createHmac, timingSafeEqual } from "node:crypto";

export const META_REVIEW_WHATSAPP_WEBHOOK_PATH =
  "/api/meta-review/whatsapp/webhook";

const META_GRAPH_API_VERSION = "v23.0";
const MAX_EVENTS = 100;
const MAX_MESSAGE_LENGTH = 1000;

export interface MetaReviewWhatsappEnvironment {
  META_REVIEW_WA_TEST_ENABLED?: string;
  META_REVIEW_WA_TEST_WABA_ID?: string;
  META_REVIEW_WA_TEST_PHONE_NUMBER_ID?: string;
  META_REVIEW_WA_TEST_RECIPIENT?: string;
  META_REVIEW_WA_TEST_ACCESS_TOKEN?: string;
  META_REVIEW_WA_TEST_VERIFY_TOKEN?: string;
  META_REVIEW_WA_TEST_APP_SECRET?: string;
}

export interface MetaReviewWhatsappEvent {
  id: string;
  timestamp: string;
  direction: "inbound" | "outbound";
  type: string;
  text?: string;
  status?: string;
}

interface StoredEvent extends MetaReviewWhatsappEvent {
  dedupeKey: string;
}

interface NormalizedConfig {
  enabled: boolean;
  wabaId: string;
  phoneNumberId: string;
  recipientDigits: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  webhookConfigured: boolean;
  sendConfigured: boolean;
}

export interface MetaReviewWhatsappStatus {
  enabled: boolean;
  webhookConfigured: boolean;
  sendConfigured: boolean;
  bufferedEventCount: number;
  storage: "in_memory";
}

export type WebhookProcessingResult =
  | { accepted: true; added: number }
  | {
      accepted: false;
      reason: "not_configured" | "invalid_signature" | "invalid_payload";
    };

export class MetaReviewWhatsappSendError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "MetaReviewWhatsappSendError";
  }
}

const eventBuffer: StoredEvent[] = [];
const seenDedupeKeys = new Set<string>();
let nextEventId = 1;

function normalizePhoneNumber(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw || !/^[+()\d.\-\s]+$/.test(raw)) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function readConfig(
  environment: MetaReviewWhatsappEnvironment = process.env,
): NormalizedConfig {
  const enabled =
    environment.META_REVIEW_WA_TEST_ENABLED?.trim().toLowerCase() === "true";
  const wabaId = environment.META_REVIEW_WA_TEST_WABA_ID?.trim() ?? "";
  const phoneNumberId =
    environment.META_REVIEW_WA_TEST_PHONE_NUMBER_ID?.trim() ?? "";
  const recipientDigits = normalizePhoneNumber(
    environment.META_REVIEW_WA_TEST_RECIPIENT,
  );
  const accessToken =
    environment.META_REVIEW_WA_TEST_ACCESS_TOKEN?.trim() ?? "";
  const verifyToken =
    environment.META_REVIEW_WA_TEST_VERIFY_TOKEN?.trim() ?? "";
  const appSecret = environment.META_REVIEW_WA_TEST_APP_SECRET?.trim() ?? "";
  const validIds = /^\d+$/.test(wabaId) && /^\d+$/.test(phoneNumberId);
  const webhookConfigured =
    enabled &&
    validIds &&
    recipientDigits.length > 0 &&
    verifyToken.length > 0 &&
    appSecret.length > 0;
  const sendConfigured =
    enabled &&
    /^\d+$/.test(phoneNumberId) &&
    recipientDigits.length > 0 &&
    accessToken.length > 0;

  return {
    enabled,
    wabaId,
    phoneNumberId,
    recipientDigits,
    accessToken,
    verifyToken,
    appSecret,
    webhookConfigured,
    sendConfigured,
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function validateMetaReviewWhatsappChallenge(
  mode: unknown,
  suppliedToken: unknown,
  challenge: unknown,
  environment: MetaReviewWhatsappEnvironment = process.env,
): string | null {
  const config = readConfig(environment);
  if (
    !config.enabled ||
    !config.verifyToken ||
    mode !== "subscribe" ||
    typeof suppliedToken !== "string" ||
    typeof challenge !== "string" ||
    challenge.length > 512 ||
    !safeEqual(suppliedToken, config.verifyToken)
  ) {
    return null;
  }
  return challenge;
}

export function verifyMetaReviewWhatsappSignature(
  rawBody: Buffer,
  signature: string,
  appSecret: string,
): boolean {
  const match = /^sha256=([a-f\d]{64})$/i.exec(signature.trim());
  if (!match || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const supplied = Buffer.from(match[1], "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function sanitizeMessageText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(
      /\b(access[_\s-]?token|refresh[_\s-]?token|token|secret|api[_\s-]?key|auth[_\s-]?code|authorization[_\s-]?code)\b\s*[:=]\s*["']?[^"'&\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[long value redacted]")
    .replace(/\b\d{12,}\b/g, "[number redacted]")
    .slice(0, MAX_MESSAGE_LENGTH);
}

function safeType(value: unknown): string {
  return typeof value === "string" && /^[a-z_]{1,32}$/i.test(value)
    ? value.toLowerCase()
    : "unknown";
}

function safeStatus(value: unknown): string {
  return typeof value === "string" &&
    ["sent", "delivered", "read", "failed", "deleted"].includes(value)
    ? value
    : "unknown";
}

function toIsoTimestamp(value: unknown): string {
  const seconds = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString();
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function pushEvent(
  dedupeKey: string,
  event: Omit<MetaReviewWhatsappEvent, "id">,
): boolean {
  if (seenDedupeKeys.has(dedupeKey)) return false;
  const stored: StoredEvent = {
    ...event,
    id: `meta-review-${nextEventId++}`,
    dedupeKey,
  };
  eventBuffer.unshift(stored);
  seenDedupeKeys.add(dedupeKey);
  while (eventBuffer.length > MAX_EVENTS) {
    const removed = eventBuffer.pop();
    if (removed) seenDedupeKeys.delete(removed.dedupeKey);
  }
  return true;
}

function ingestPayload(payload: unknown, config: NormalizedConfig): number {
  if (!payload || typeof payload !== "object") return 0;
  const root = payload as { object?: unknown; entry?: unknown };
  if (
    root.object !== "whatsapp_business_account" ||
    !Array.isArray(root.entry)
  ) {
    return 0;
  }

  let added = 0;
  for (const rawEntry of root.entry) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as { id?: unknown; changes?: unknown };
    if (entry.id !== config.wabaId || !Array.isArray(entry.changes)) continue;

    for (const rawChange of entry.changes) {
      if (!rawChange || typeof rawChange !== "object") continue;
      const change = rawChange as { field?: unknown; value?: unknown };
      if (change.field !== "messages" || !change.value || typeof change.value !== "object") continue;
      const value = change.value as {
        metadata?: { phone_number_id?: unknown };
        messages?: unknown;
        statuses?: unknown;
      };
      if (value.metadata?.phone_number_id !== config.phoneNumberId) continue;

      if (Array.isArray(value.messages)) {
        for (const rawMessage of value.messages) {
          if (!rawMessage || typeof rawMessage !== "object") continue;
          const message = rawMessage as {
            id?: unknown;
            from?: unknown;
            timestamp?: unknown;
            type?: unknown;
            text?: { body?: unknown };
          };
          if (
            typeof message.from !== "string" ||
            normalizePhoneNumber(message.from) !== config.recipientDigits
          ) {
            continue;
          }
          const type = safeType(message.type);
          const text = type === "text" ? sanitizeMessageText(message.text?.body) : undefined;
          const addedEvent = pushEvent(
            `inbound:${typeof message.id === "string" ? message.id : `${message.timestamp}:${type}:${text ?? ""}`}`,
            {
              timestamp: toIsoTimestamp(message.timestamp),
              direction: "inbound",
              type,
              ...(text ? { text } : {}),
            },
          );
          if (addedEvent) added += 1;
        }
      }

      if (Array.isArray(value.statuses)) {
        for (const rawStatus of value.statuses) {
          if (!rawStatus || typeof rawStatus !== "object") continue;
          const status = rawStatus as {
            id?: unknown;
            recipient_id?: unknown;
            timestamp?: unknown;
            status?: unknown;
          };
          if (
            typeof status.recipient_id !== "string" ||
            normalizePhoneNumber(status.recipient_id) !== config.recipientDigits
          ) {
            continue;
          }
          const safeDeliveryStatus = safeStatus(status.status);
          const addedEvent = pushEvent(
            `status:${typeof status.id === "string" ? status.id : "unknown"}:${safeDeliveryStatus}:${String(status.timestamp ?? "")}`,
            {
              timestamp: toIsoTimestamp(status.timestamp),
              direction: "outbound",
              type: "delivery_status",
              status: safeDeliveryStatus,
            },
          );
          if (addedEvent) added += 1;
        }
      }
    }
  }
  return added;
}

export function processMetaReviewWhatsappWebhook(
  rawBody: Buffer,
  signature: string,
  environment: MetaReviewWhatsappEnvironment = process.env,
): WebhookProcessingResult {
  const config = readConfig(environment);
  if (!config.webhookConfigured) {
    return { accepted: false, reason: "not_configured" };
  }
  if (!verifyMetaReviewWhatsappSignature(rawBody, signature, config.appSecret)) {
    return { accepted: false, reason: "invalid_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { accepted: false, reason: "invalid_payload" };
  }

  return { accepted: true, added: ingestPayload(payload, config) };
}

export function getMetaReviewWhatsappEvents(): MetaReviewWhatsappEvent[] {
  return eventBuffer.map(({ dedupeKey: _dedupeKey, ...event }) => ({ ...event }));
}

export function getMetaReviewWhatsappStatus(
  environment: MetaReviewWhatsappEnvironment = process.env,
): MetaReviewWhatsappStatus {
  const config = readConfig(environment);
  return {
    enabled: config.enabled,
    webhookConfigured: config.webhookConfigured,
    sendConfigured: config.sendConfigured,
    bufferedEventCount: eventBuffer.length,
    storage: "in_memory",
  };
}

export async function sendMetaReviewWhatsappTestTemplate(
  environment: MetaReviewWhatsappEnvironment = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const config = readConfig(environment);
  if (!config.sendConfigured) {
    throw new MetaReviewWhatsappSendError(
      "The isolated Meta test sender is not configured.",
      503,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(config.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: config.recipientDigits,
          type: "template",
          template: {
            name: "hello_world",
            language: { code: "en_US" },
          },
        }),
      },
    );
  } catch {
    throw new MetaReviewWhatsappSendError(
      "Meta Cloud API could not be reached.",
      502,
    );
  }

  if (!response.ok) {
    throw new MetaReviewWhatsappSendError(
      `Meta Cloud API rejected the test template (HTTP ${response.status}).`,
      502,
    );
  }

  pushEvent(`outbound:${Date.now()}:${nextEventId}`, {
    timestamp: new Date().toISOString(),
    direction: "outbound",
    type: "template",
    text: "hello_world test template submitted",
    status: "submitted",
  });
}

export function clearMetaReviewWhatsappEventsForTests(): void {
  eventBuffer.length = 0;
  seenDedupeKeys.clear();
  nextEventId = 1;
}
