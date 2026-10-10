import type { Request } from "express";
import { recordWhatsappAudit, type WhatsappAuditAction } from "./whatsappInternalAudit";
import type { WhatsappActor } from "./whatsappInternalAuth";
import {
  whatsappInternalRepository,
  type WhatsappEmployeeMonitoringRepository,
  type WhatsappInternalNote,
  type WhatsappListQuery,
  type WhatsappPage,
  type WhatsappEmployee,
  type WhatsappConversation,
  type WhatsappMessage,
} from "./whatsappInternalRepository";

export class WhatsappInternalServiceError extends Error {
  constructor(public readonly statusCode: 400 | 403 | 404, message: string) {
    super(message);
  }
}

function audit(
  req: Request,
  actor: WhatsappActor,
  action: WhatsappAuditAction,
  resourceType: "employee" | "conversation" | "messages" | "internal_note",
  resourceId: string,
  allowed = true,
): void {
  recordWhatsappAudit(req, actor, { action, resourceType, resourceId, allowed });
}

function repositoryError(error: unknown): WhatsappInternalServiceError {
  const message = error instanceof Error ? error.message : "Unable to access WhatsApp mock data";
  if (message === "Not authorized") return new WhatsappInternalServiceError(403, message);
  if (message === "Conversation not found") return new WhatsappInternalServiceError(404, message);
  return new WhatsappInternalServiceError(400, message);
}

export class WhatsappInternalService {
  constructor(private readonly repository: WhatsappEmployeeMonitoringRepository = whatsappInternalRepository) {}

  async listEmployees(req: Request, actor: WhatsappActor, query: WhatsappListQuery): Promise<WhatsappPage<WhatsappEmployee>> {
    try {
      const result = await this.repository.listEmployees(actor, query);
      audit(req, actor, "list_employees", "employee", "collection");
      return result;
    } catch (error) {
      audit(req, actor, "list_employees", "employee", "collection", false);
      throw repositoryError(error);
    }
  }

  async listConversations(req: Request, actor: WhatsappActor, query: WhatsappListQuery): Promise<WhatsappPage<WhatsappConversation>> {
    try {
      const result = await this.repository.listConversations(actor, query);
      audit(req, actor, "list_conversations", "conversation", "collection");
      return result;
    } catch (error) {
      audit(req, actor, "list_conversations", "conversation", "collection", false);
      throw repositoryError(error);
    }
  }

  async getConversationMessages(req: Request, actor: WhatsappActor, conversationId: string): Promise<{ conversation: WhatsappConversation; messages: WhatsappMessage[] }> {
    try {
      const result = await this.repository.getConversationMessages(actor, conversationId);
      audit(req, actor, "read_messages", "messages", conversationId);
      return result;
    } catch (error) {
      audit(req, actor, "read_messages", "messages", conversationId, false);
      throw repositoryError(error);
    }
  }

  async addInternalNote(req: Request, actor: WhatsappActor, conversationId: string, text: string): Promise<WhatsappInternalNote> {
    try {
      const result = await this.repository.addInternalNote(actor, conversationId, text);
      audit(req, actor, "add_internal_note", "internal_note", conversationId);
      return result;
    } catch (error) {
      audit(req, actor, "add_internal_note", "internal_note", conversationId, false);
      throw repositoryError(error);
    }
  }
}

export const whatsappInternalService = new WhatsappInternalService();