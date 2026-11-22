import crypto from "node:crypto";
import {
  encryptArchiveValue,
  getEmployeeArchiveRuntimeDecision,
  type EncryptedArchiveValue,
} from "./whatsappEmployeeArchiveSafety";
import type { ArchiveMessageType } from "./whatsappEmployeeArchiveIngest";
import type { CloudWebhookPayload } from "./whatsappArchiveWebhookRoutes";
import {
  fingerprintCustomerNoticeRecipient,
  parseCustomerNoticeRecipientHmacKey,
} from "./stagingArchive/customerNoticeRecipientFingerprint";

export type VerifiedArchiveBinding = Readonly<{
  wabaId: string;
  phoneNumberId: string;
  employeeId: number;
  verifiedAt: string;
  active: true;
  revokedAt: null;
  immutableAssignment: true;
  companyWorkNumberOnly: boolean;
  employeeNoticeCurrent: boolean;
  policyApproved: true;
  retentionDays: number;
}>;

export type PreparedArchiveEvent =
  | Readonly<{
      kind: "message";
      wamid: string;
      contactWaId: string;
      occurredAt: Date;
      messageType: "text" | "image" | "video" | "audio" | "document" | "interactive" | "unknown";
      direction: "inbound" | "outbound";
      status: "received" | "sent";
      encryptedPayload: EncryptedArchiveValue;
      mediaId?: string;
      mediaMimeType?: string;
    }>
  | Readonly<{
      kind: "edit";
      eventId: string;
      originalWamid: string;
      contactWaId: string;
      occurredAt: Date;
      encryptedPayload: EncryptedArchiveValue;
    }>
  | Readonly<{
      kind: "status";
      eventId: string;
      wamid: string;
      status: "sent" | "delivered" | "read" | "failed";
      occurredAt: Date;
      recipientWaId?: string;
    }>
  | Readonly<{
      kind: "tombstone";
      eventId: string;
      wamid: string;
      deletedAt: Date;
    }>;

export interface WhatsAppArchiveWebhookStore {
  resolveVerifiedImmutableBinding(
    wabaId: string,
    phoneNumberId: string,
  ): Promise<VerifiedArchiveBinding | null>;
  /**
   * Must use one DB transaction, unique event/message IDs, retention checks,
   * audit writes, and tombstones. The staging route is wired to the PostgreSQL
   * implementation; it still fails closed until a verified company-work number,
   * reviewed policy and recorded employee notice exist in the archive database.
   */
  commitBatchOnce(input: {
    eventKey: string;
    binding: VerifiedArchiveBinding;
    events: PreparedArchiveEvent[];
  }): Promise<"processed" | "duplicate">;
}

function safeId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value)
    ? value
    : null;
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const numeric = typeof value === "number" || /^\d{1,12}$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value);
  const date = new Date(numeric);
  return Number.isFinite(date.getTime()) ? date : null;
}

function messageType(value: unknown): ArchiveMessageType {
  return (["text", "image", "video", "audio", "document", "interactive"].includes(String(value))
    ? value
    : "unknown") as ArchiveMessageType;
}

function eventId(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex");
}

function prepareEvents(
  value: Record<string, any>,
  key: Buffer,
  retentionDays: number,
  now: Date,
  field: "messages" | "smb_message_echoes",
): PreparedArchiveEvent[] {
  const retentionStart = now.getTime() - retentionDays * 86_400_000;
  const events: PreparedArchiveEvent[] = [];
  if (field === "messages") {
    for (const message of Array.isArray(value.messages) ? value.messages : []) {
      const wamid = safeId(message?.id);
      const contactWaId = safeId(message?.from_user_id) ?? safeId(message?.from);
      const occurredAt = timestamp(message?.timestamp);
      if (!wamid || !contactWaId || !occurredAt || occurredAt.getTime() < retentionStart || occurredAt > now) {
        throw new Error("Webhook message is invalid or outside retention.");
      }
      const type = messageType(message?.type);
      if (type !== "text" && type !== "interactive") {
        throw new Error("Media, voice, and unclassified content are outside the approved archive scope.");
      }
      events.push({
        kind: "message",
        wamid,
        contactWaId,
        occurredAt,
        messageType: type,
        direction: "inbound",
        status: "received",
        encryptedPayload: encryptArchiveValue(JSON.stringify(message), key),
      });
    }
  } else {
    for (const echo of Array.isArray(value.message_echoes) ? value.message_echoes : []) {
      const occurredAt = timestamp(echo?.timestamp);
      if (!occurredAt || occurredAt.getTime() < retentionStart || occurredAt > now) {
        throw new Error("Webhook echo is invalid or outside retention.");
      }
      if (echo?.type === "revoke") {
        const wamid = safeId(echo?.revoke?.original_message_id) ?? safeId(echo?.original_message_id);
        const providerEventId = safeId(echo?.id);
        if (!wamid || !providerEventId) throw new Error("Webhook revoke event is invalid.");
        events.push({ kind: "tombstone", eventId: providerEventId, wamid, deletedAt: occurredAt });
        continue;
      }
      if (echo?.type === "edit") {
        const originalWamid = safeId(echo?.edit?.original_message_id) ?? safeId(echo?.original_message_id);
        const editMessage = echo?.edit?.message ?? echo?.message;
        const contactWaId = safeId(echo?.to_user_id) ?? safeId(echo?.to);
        const providerEventId = safeId(echo?.id);
        if (!originalWamid || !contactWaId || !providerEventId ||
            messageType(editMessage?.type) !== "text") {
          throw new Error("Webhook text edit is invalid or outside the approved archive scope.");
        }
        events.push({
          kind: "edit",
          eventId: eventId([providerEventId, originalWamid, occurredAt.toISOString()]),
          originalWamid,
          contactWaId,
          occurredAt,
          encryptedPayload: encryptArchiveValue(JSON.stringify(editMessage), key),
        });
        continue;
      }
      const wamid = safeId(echo?.id);
      const contactWaId = safeId(echo?.to_user_id) ?? safeId(echo?.to);
      const type = messageType(echo?.type);
      if (!wamid || !contactWaId || (type !== "text" && type !== "interactive")) {
        throw new Error("Webhook echo is invalid or outside the approved archive scope.");
      }
      events.push({
        kind: "message",
        wamid,
        contactWaId,
        occurredAt,
        messageType: type,
        direction: "outbound",
        status: "sent",
        encryptedPayload: encryptArchiveValue(JSON.stringify(echo), key),
      });
    }
  }
  for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
    const wamid = safeId(status?.id);
    const occurredAt = timestamp(status?.timestamp);
    if (!wamid || !occurredAt || occurredAt.getTime() < retentionStart || occurredAt > now) {
      throw new Error("Webhook status is invalid or outside retention.");
    }
    if (!["sent", "delivered", "read", "failed"].includes(status?.status)) {
      throw new Error("Webhook status is unsupported.");
    }
    events.push({
      kind: "status",
      eventId: eventId([wamid, String(status.status), occurredAt.toISOString()]),
      wamid,
      status: status.status,
      occurredAt,
      ...(safeId(status?.recipient_id) ? { recipientWaId: safeId(status.recipient_id)! } : {}),
    });
  }
  // This is an internal/test deletion event shape, not a claim that Cloud API
  // sends message_deletions callbacks. A future verified deletion source must
  // map to this shape only after its signature and authority are established.
  for (const deletion of Array.isArray(value.message_deletions) ? value.message_deletions : []) {
    const wamid = safeId(deletion?.id);
    const providerDeletionId = safeId(deletion?.deletion_event_id);
    const deletedAt = timestamp(deletion?.timestamp) ?? now;
    if (!wamid || !providerDeletionId || deletedAt > now) {
      throw new Error("Webhook deletion event is invalid.");
    }
    events.push({
      kind: "tombstone",
      eventId: providerDeletionId,
      wamid,
      deletedAt,
    });
  }
  return events;
}

export function createWhatsappArchiveWebhookProcessor(dependencies: {
  env: NodeJS.ProcessEnv;
  store: WhatsAppArchiveWebhookStore;
  requireCustomerNoticeProof?: boolean;
  customerNoticeGate?: (input: {
    wabaId: string;
    phoneNumberId: string;
    recipientFingerprint: Buffer;
  }) => Promise<boolean>;
  now?: () => Date;
}) {
  return async (
    eventKey: string,
    payload: CloudWebhookPayload,
  ): Promise<"processed" | "duplicate" | "discarded_unnotified"> => {
    const decision = getEmployeeArchiveRuntimeDecision(dependencies.env);
    if (!decision.enabled) throw new Error("Archive policy is not approved.");
    const now = dependencies.now?.() ?? new Date();
    const groups: Array<{
      wabaId: string;
      phoneNumberId: string;
      value: Record<string, any>;
      field: "messages" | "smb_message_echoes";
    }> = [];
    for (const entry of payload.entry) {
      const wabaId = safeId(entry.id);
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      if (!wabaId || changes.length === 0) {
        throw new Error("Webhook WABA or change identity is invalid.");
      }
      for (const change of changes) {
        if (
          (change?.field !== "messages" && change?.field !== "smb_message_echoes") ||
          !change.value || typeof change.value !== "object"
        ) {
          throw new Error("Webhook contains an unsupported WhatsApp change.");
        }
        const phoneNumberId = safeId(change.value.metadata?.phone_number_id);
        if (!phoneNumberId) throw new Error("Webhook WABA or phone identity is invalid.");
        groups.push({ wabaId, phoneNumberId, value: change.value, field: change.field });
      }
    }
    if (groups.length === 0) throw new Error("Webhook contains no supported WhatsApp events.");

    const prepared = [];
    for (const group of groups) {
      const binding = await dependencies.store.resolveVerifiedImmutableBinding(group.wabaId, group.phoneNumberId);
      if (
        !binding ||
        binding.wabaId !== group.wabaId ||
        binding.phoneNumberId !== group.phoneNumberId ||
        !Number.isSafeInteger(binding.employeeId) ||
        binding.employeeId <= 0 ||
        binding.active !== true ||
        binding.revokedAt !== null ||
        binding.immutableAssignment !== true ||
        binding.companyWorkNumberOnly !== true ||
        binding.policyApproved !== true ||
        !Number.isFinite(Date.parse(binding.verifiedAt)) ||
        binding.retentionDays !== decision.retentionDays
      ) {
        throw new Error("Verified company-work number binding is unavailable.");
      }
      let events = prepareEvents(group.value, decision.encryptionKey, decision.retentionDays, now, group.field);
      if (!events.length) throw new Error("Webhook change contains no supported events.");
      if (events.some((event) => event.kind === "message" || event.kind === "edit") &&
          !binding.employeeNoticeCurrent) {
        throw new Error("Current company policy and employee notice receipt are required before archive writes.");
      }
      if (dependencies.requireCustomerNoticeProof === true) {
        if (!dependencies.customerNoticeGate) return "discarded_unnotified";
        const recipientKey = parseCustomerNoticeRecipientHmacKey(
          dependencies.env.WHATSAPP_ARCHIVE_STAGING_NOTICE_RECIPIENT_HMAC_KEY,
        );
        if (!recipientKey) return "discarded_unnotified";
        const eligibleEvents: PreparedArchiveEvent[] = [];
        for (const event of events) {
          const recipient = event.kind === "message" || event.kind === "edit"
            ? event.contactWaId
            : event.kind === "status"
              ? event.recipientWaId
              : undefined;
          if (!recipient) continue;
          const recipientFingerprint = fingerprintCustomerNoticeRecipient(recipient, recipientKey);
          if (!recipientFingerprint) continue;
          const hasProof = await dependencies.customerNoticeGate({
            wabaId: group.wabaId,
            phoneNumberId: group.phoneNumberId,
            recipientFingerprint,
          });
          if (hasProof) eligibleEvents.push(event);
        }
        events = eligibleEvents;
        if (!events.length) return "discarded_unnotified";
      }
      prepared.push({ binding, events });
    }

    // Multi-WABA payloads are deliberately refused until the store supports a
    // single atomic transaction spanning every binding in the signed payload.
    if (prepared.length !== 1) throw new Error("Multi-binding webhook batches are not enabled.");
    return dependencies.store.commitBatchOnce({
      eventKey,
      binding: prepared[0].binding,
      events: prepared[0].events,
    });
  };
}
