import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { WhatsappActor } from "./whatsappInternalAuth";

export type WhatsappAuditAction =
  | "list_employees"
  | "list_conversations"
  | "read_messages"
  | "add_internal_note";

export interface WhatsappAuditEntry {
  actorId: number;
  actorRole: string;
  action: WhatsappAuditAction;
  resourceType: "employee" | "conversation" | "messages" | "internal_note";
  resourceId: string;
  allowed: boolean;
  timestamp: string;
  requestCorrelationId: string;
}

const entries: WhatsappAuditEntry[] = [];

function safeCorrelationId(req: Request): string {
  const supplied = req.header("x-request-id");
  if (supplied && /^[a-zA-Z0-9._:-]{1,100}$/.test(supplied)) return supplied;
  return randomUUID();
}

export function recordWhatsappAudit(
  req: Request,
  actor: WhatsappActor,
  details: Omit<WhatsappAuditEntry, "actorId" | "actorRole" | "timestamp" | "requestCorrelationId">,
): void {
  entries.push({
    actorId: actor.userId,
    actorRole: actor.role,
    timestamp: new Date().toISOString(),
    requestCorrelationId: safeCorrelationId(req),
    ...details,
  });
  if (entries.length > 500) entries.splice(0, entries.length - 500);
}

/** Test-only inspection of the in-memory audit buffer. It contains metadata only. */
export function getWhatsappAuditEntries(): readonly WhatsappAuditEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export function clearWhatsappAuditEntries(): void {
  entries.length = 0;
}