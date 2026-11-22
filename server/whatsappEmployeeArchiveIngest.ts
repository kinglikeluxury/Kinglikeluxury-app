import {
  encryptArchiveValue,
  getEmployeeArchiveRuntimeDecision,
  type EncryptedArchiveValue,
} from "./whatsappEmployeeArchiveSafety";

export type ArchiveMessageType = "text" | "image" | "video" | "audio" | "document" | "interactive" | "unknown";
export type ArchiveDirection = "inbound" | "outbound";
export type ArchiveStatus = "received" | "sent" | "delivered" | "read" | "failed";

export interface NormalizedArchiveEvent {
  phoneNumberId: string;
  contactWaId: string;
  wamid: string;
  direction: ArchiveDirection;
  messageType: ArchiveMessageType;
  occurredAt: Date;
  status: ArchiveStatus;
  payload: Record<string, unknown>;
  mediaId?: string;
  mediaMimeType?: string;
}

export interface ArchiveIngestStore {
  findVerifiedBinding(phoneNumberId: string): Promise<{ employeeId: number; active: boolean } | null>;
  hasCurrentEmployeeAcknowledgement(employeeId: number): Promise<boolean>;
  saveMessage(input: {
    employeeId: number;
    phoneNumberId: string;
    contactWaId: string;
    wamid: string;
    direction: ArchiveDirection;
    messageType: ArchiveMessageType;
    status: ArchiveStatus;
    occurredAt: Date;
    encryptedPayload: EncryptedArchiveValue;
    mediaId?: string;
    mediaMimeType?: string;
  }): Promise<"inserted" | "duplicate">;
}

const ALLOWED_TYPES = new Set<ArchiveMessageType>([
  "text", "image", "video", "audio", "document", "interactive", "unknown",
]);
const ALLOWED_STATUSES = new Set<ArchiveStatus>(["received", "sent", "delivered", "read", "failed"]);

export async function archiveSyntheticMessage(
  event: NormalizedArchiveEvent,
  deps: { env: NodeJS.ProcessEnv; store: ArchiveIngestStore },
): Promise<"stored" | "duplicate"> {
  const decision = getEmployeeArchiveRuntimeDecision(deps.env);
  if (!decision.enabled) throw new Error("WhatsApp archive is disabled");
  if (!event.phoneNumberId || !event.contactWaId || !event.wamid) {
    throw new Error("WhatsApp event is incomplete");
  }
  if (!ALLOWED_TYPES.has(event.messageType) || !ALLOWED_STATUSES.has(event.status)) {
    throw new Error("WhatsApp event type or status is unsupported");
  }
  if (!(event.occurredAt instanceof Date) || !Number.isFinite(event.occurredAt.getTime())) {
    throw new Error("WhatsApp event timestamp is invalid");
  }

  const binding = await deps.store.findVerifiedBinding(event.phoneNumberId);
  if (!binding?.active || !(await deps.store.hasCurrentEmployeeAcknowledgement(binding.employeeId))) {
    throw new Error("WhatsApp archive prerequisites are not met");
  }

  const encryptedPayload = encryptArchiveValue(JSON.stringify(event.payload), decision.encryptionKey);
  const result = await deps.store.saveMessage({
    employeeId: binding.employeeId,
    phoneNumberId: event.phoneNumberId,
    contactWaId: event.contactWaId,
    wamid: event.wamid,
    direction: event.direction,
    messageType: event.messageType,
    status: event.status,
    occurredAt: event.occurredAt,
    encryptedPayload,
    mediaId: event.mediaId,
    mediaMimeType: event.mediaMimeType,
  });
  return result === "duplicate" ? "duplicate" : "stored";
}
