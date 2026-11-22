import type { IncomingMessage, ServerResponse } from "node:http";
import { getStagingArchiveReadiness } from "../stagingArchive/isolation";
import { getEmployeeArchiveRuntimeDecision } from "../whatsappEmployeeArchiveSafety";

export type StagingArchiveActor = { id: number };
export type StagingArchiveMessage = {
  id: number;
  direction: "inbound" | "outbound";
  messageType: string;
  status: string;
  occurredAt: string;
  tombstonedAt: string | null;
  payload: Record<string, unknown> | null;
  mediaId?: number | null;
  mediaType?: string | null;
};

type FixtureConversation = {
  id: number;
  employeeId: number;
  phoneNumberId: string;
  contactWaId: string;
  lastMessageAt: string;
  messages: StagingArchiveMessage[];
};

export type StagingArchiveFixture = ReturnType<typeof createStagingArchiveFixture>;
export type StagingArchiveRequestStore = {
  listEmployees(): Promise<Array<Record<string, unknown>>>;
  listConversations(filters: { employeeId: number; search: string; from?: string; to?: string }): Promise<Array<Record<string, unknown>>>;
  getConversation(id: number): Promise<{ id: number; employeeId: number } | null>;
  listMessages(id: number): Promise<StagingArchiveMessage[]>;
  getPrivateMedia(id: number): Promise<{ employeeId: number; conversationId: number; mimeType: string; data: Buffer } | null>;
  recordAudit(event: { actorUserId: number; action: string; conversationId?: number }): Promise<void>;
};

const SYNTHETIC_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6v8AAAAASUVORK5CYII=",
  "base64",
);

export function createStagingArchiveFixture() {
  const employees = [{
    id: 910001,
    username: "staging_employee_synthetic_01",
    role: "advisor",
  }];
  const conversations: FixtureConversation[] = [
    {
      id: 920001,
      employeeId: 910001,
      phoneNumberId: "synthetic-phone-number-alpha",
      contactWaId: "synthetic-contact-alpha",
      lastMessageAt: "2026-11-16T10:02:00.000Z",
      messages: [
        {
          id: 930001,
          direction: "inbound",
          messageType: "text",
          status: "received",
          occurredAt: "2026-11-16T10:00:00.000Z",
          tombstonedAt: null,
          payload: { text: { body: "رسالة اختبار من أرشيف staging — لا تحتوي بيانات حقيقية." } },
        },
        {
          id: 930002,
          direction: "inbound",
          messageType: "image",
          status: "received",
          occurredAt: "2026-11-16T10:01:00.000Z",
          tombstonedAt: null,
          payload: { image: { caption: "مرفق صورة اصطناعي للاختبار." } },
          mediaId: 940001,
          mediaType: "image/png",
        },
        {
          id: 930003,
          direction: "outbound",
          messageType: "text",
          status: "deleted",
          occurredAt: "2026-11-16T10:02:00.000Z",
          tombstonedAt: "2026-11-16T10:03:00.000Z",
          payload: null,
        },
      ],
    },
    {
      id: 920002,
      employeeId: 910001,
      phoneNumberId: "synthetic-phone-number-beta",
      contactWaId: "synthetic-contact-beta",
      lastMessageAt: "2026-11-16T11:00:00.000Z",
      messages: [
        {
          id: 930004,
          direction: "outbound",
          messageType: "text",
          status: "read",
          occurredAt: "2026-11-16T11:00:00.000Z",
          tombstonedAt: null,
          payload: { text: { body: "محادثة اختبار ثانية؛ لا تمثل سجلاً حقيقياً." } },
        },
      ],
    },
  ];
  const seenEventIds = new Set(["fixture-seed-message-930001", "fixture-seed-message-930002", "fixture-seed-message-930003", "fixture-seed-message-930004"]);
  const auditEvents: Array<{ actorUserId: number; action: string; conversationId?: number }> = [];

  return {
    listEmployees: async () => employees.map((employee) => ({ ...employee })),
    listConversations: async (filters: { employeeId: number; search: string; from?: string; to?: string }) =>
      conversations
        .filter((conversation) => conversation.employeeId === filters.employeeId)
        .filter((conversation) => !filters.search || conversation.contactWaId.includes(filters.search))
        .filter((conversation) => !filters.from || conversation.lastMessageAt >= filters.from)
        .filter((conversation) => !filters.to || conversation.lastMessageAt < `${filters.to.slice(0, 10)}T23:59:59.999Z`)
        .map(({ messages, ...conversation }) => ({
          ...conversation,
          messageCount: messages.length,
          deletedCount: messages.filter((message) => message.tombstonedAt).length,
          mediaCount: messages.filter((message) => message.mediaId).length,
        })),
    getConversation: async (id: number) => {
      const conversation = conversations.find((item) => item.id === id);
      return conversation ? { id: conversation.id, employeeId: conversation.employeeId } : null;
    },
    listMessages: async (conversationId: number) =>
      (conversations.find((item) => item.id === conversationId)?.messages ?? [])
        .map((message) => ({ ...message, payload: message.payload ? { ...message.payload } : null })),
    getPrivateMedia: async (id: number) => id === 940001
      ? {
          employeeId: 910001,
          conversationId: 920001,
          mimeType: "image/png",
          data: Buffer.from(SYNTHETIC_PNG),
        }
      : null,
    recordAudit: async (event: { actorUserId: number; action: string; conversationId?: number }) => {
      auditEvents.push({ ...event });
    },
    ingestEvent: (event: {
      providerEventId: string;
      conversationId: number;
      message: StagingArchiveMessage;
    }): boolean => {
      if (seenEventIds.has(event.providerEventId)) return false;
      const conversation = conversations.find((item) => item.id === event.conversationId);
      if (!conversation) return false;
      seenEventIds.add(event.providerEventId);
      conversation.messages.push({ ...event.message });
      conversation.lastMessageAt = event.message.occurredAt;
      return true;
    },
    tombstoneMessage: (messageId: number, deletedAt: string): boolean => {
      const message = conversations.flatMap((item) => item.messages).find((item) => item.id === messageId);
      if (!message || message.tombstonedAt) return false;
      message.tombstonedAt = deletedAt;
      message.payload = null;
      return true;
    },
    auditEvents,
  };
}

type StagingArchiveAuthorization =
  | { actor: StagingArchiveActor }
  | { status: 401 | 403 };

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(JSON.stringify(body));
}

export function createStagingArchiveRequestHandler(
  authorize: (req: IncomingMessage) => Promise<StagingArchiveAuthorization>,
  store: StagingArchiveRequestStore,
  source: "staging-fixture" | "staging-archive-database" = "staging-fixture",
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const prefix = "/api/admin/whatsapp-employee-archive";
    if (!url.pathname.startsWith(`${prefix}/`)) return false;
    if (req.method !== "GET") {
      req.resume();
      json(res, 405, { message: "Staging archive is read-only." });
      return true;
    }

    const authorization = await authorize(req);
    if ("status" in authorization) {
      json(res, authorization.status, {
        message: authorization.status === 401 ? "Not authenticated." : "Owner access required.",
      });
      return true;
    }
    res.setHeader("X-WhatsApp-Archive-Source", "archive-api");
    res.setHeader("X-WhatsApp-Archive-Environment", source);
    if (source === "staging-fixture") res.setHeader("X-Staging-Archive-Fixture", "synthetic-only");
    res.setHeader("Vary", "Cookie");

    if (url.pathname === `${prefix}/readiness`) {
      json(res, 200, {
        readiness: getStagingArchiveReadiness({
          ...process.env,
          WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE:
            source === "staging-fixture" ? "fixture" : "postgres",
        }),
      });
      return true;
    }
    if (
      source === "staging-archive-database" &&
      !getEmployeeArchiveRuntimeDecision(process.env).enabled
    ) {
      json(res, 503, { message: "Archive storage is not approved and ready." });
      return true;
    }

    if (url.pathname === `${prefix}/employees`) {
      const employees = await store.listEmployees();
      await store.recordAudit({ actorUserId: authorization.actor.id, action: "list_employees" });
      json(res, 200, { employees });
      return true;
    }
    if (url.pathname === `${prefix}/conversations`) {
      const employeeId = Number(url.searchParams.get("employeeId"));
      if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
        json(res, 400, { message: "Valid employeeId is required." });
        return true;
      }
      const conversations = await store.listConversations({
        employeeId,
        search: (url.searchParams.get("search") || "").slice(0, 120),
        from: url.searchParams.get("from") || undefined,
        to: url.searchParams.get("to") || undefined,
      });
      await store.recordAudit({ actorUserId: authorization.actor.id, action: "list_conversations" });
      json(res, 200, { conversations });
      return true;
    }

    const messagesMatch = url.pathname.match(
      /^\/api\/admin\/whatsapp-employee-archive\/conversations\/(\d+)\/messages$/,
    );
    if (messagesMatch) {
      const conversationId = Number(messagesMatch[1]);
      const conversation = await store.getConversation(conversationId);
      if (!conversation) {
        json(res, 404, { message: "Conversation not found." });
        return true;
      }
      const messages = await store.listMessages(conversationId);
      await store.recordAudit({
        actorUserId: authorization.actor.id,
        action: "read_messages",
        conversationId,
      });
      json(res, 200, {
        conversation,
        messages: messages.map(({ payload, ...message }) => ({
          ...message,
          payload: message.tombstonedAt ? null : payload,
        })),
      });
      return true;
    }

    const mediaMatch = url.pathname.match(
      /^\/api\/admin\/whatsapp-employee-archive\/media\/(\d+)$/,
    );
    if (mediaMatch) {
      const media = await store.getPrivateMedia(Number(mediaMatch[1]));
      if (!media) {
        json(res, 404, { message: "Synthetic attachment not found." });
        return true;
      }
      await store.recordAudit({
        actorUserId: authorization.actor.id,
        action: "read_media",
        conversationId: media.conversationId,
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", media.mimeType);
      res.setHeader("Content-Length", media.data.length);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.end(media.data);
      return true;
    }
    json(res, 404, { message: "Not found." });
    return true;
  };
}
