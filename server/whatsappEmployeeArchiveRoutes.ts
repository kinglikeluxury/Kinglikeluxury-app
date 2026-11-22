import type { Express, Request, Response } from "express";
import {
  decryptArchiveValue,
  getEmployeeArchiveRuntimeDecision,
  type EncryptedArchiveValue,
} from "./whatsappEmployeeArchiveSafety";
import { getStagingArchiveReadiness } from "./stagingArchive/isolation";

export type ArchiveActor = { id: number; isAdmin: boolean };
export type ArchiveReadStore = {
  listEmployees(): Promise<Array<{ id: number; username: string; role: string }>>;
  listConversations(filters: {
    employeeId: number;
    search: string;
    from?: string;
    to?: string;
  }): Promise<Array<Record<string, unknown>>>;
  getConversation(id: number): Promise<{ id: number; employeeId: number } | null>;
  listMessages(conversationId: number): Promise<Array<{
    id: number;
    direction: string;
    messageType: string;
    status: string;
    occurredAt: string;
    tombstonedAt: string | null;
    mediaId?: number | null;
    mediaType?: string | null;
    encryptedPayload: EncryptedArchiveValue | null;
  }>>;
  getPrivateMedia(id: number): Promise<{
    employeeId: number;
    conversationId: number;
    mimeType: string;
    data: Buffer;
  } | null>;
  recordAudit(event: {
    actorUserId: number;
    action: string;
    employeeId?: number;
    conversationId?: number;
  }): Promise<void>;
};

function adminActor(req: Request): ArchiveActor | null {
  const session = req.session as typeof req.session & { userId?: number; isAdmin?: boolean };
  if (!Number.isSafeInteger(session?.userId) || !session?.isAdmin) return null;
  return { id: Number(session.userId), isAdmin: true };
}

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function registerWhatsappEmployeeArchiveRoutes(
  app: Express,
  deps: { store: ArchiveReadStore; env?: NodeJS.ProcessEnv },
): void {
  const env = deps.env ?? process.env;
  const gated = (_req: Request, res: Response): boolean => {
    const decision = getEmployeeArchiveRuntimeDecision(env);
    if (decision.enabled) return true;
    res.status(404).json({ message: "Employee archive is unavailable" });
    return false;
  };
  const authorized = (req: Request, res: Response): ArchiveActor | null => {
    const actor = adminActor(req);
    if (!actor) res.status(403).json({ message: "Admin access required" });
    return actor;
  };
  const markArchiveSource = (res: Response) => {
    res.setHeader("X-WhatsApp-Archive-Source", "archive-api");
    res.setHeader("Vary", "Cookie");
  };

  app.get("/api/admin/whatsapp-employee-archive/readiness", (req, res) => {
    if (!authorized(req, res)) return;
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ readiness: getStagingArchiveReadiness(env) });
  });

  app.get("/api/admin/whatsapp-employee-archive/employees", async (req, res) => {
    if (!gated(req, res) || !authorized(req, res)) return;
    markArchiveSource(res);
    try {
      const employees = await deps.store.listEmployees();
      const actor = adminActor(req);
      if (actor) await deps.store.recordAudit({ actorUserId: actor.id, action: "list_employees" });
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ employees });
    } catch {
      res.status(503).json({ message: "Archive is temporarily unavailable" });
    }
  });

  app.get("/api/admin/whatsapp-employee-archive/conversations", async (req, res) => {
    if (!gated(req, res)) return;
    const actor = authorized(req, res);
    if (!actor) return;
    markArchiveSource(res);
    const employeeId = positiveId(req.query.employeeId);
    if (!employeeId) return void res.status(400).json({ message: "Valid employeeId is required" });
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if ([from, to].some((date) => date && !Number.isFinite(Date.parse(date)))) {
      return void res.status(400).json({ message: "Invalid date filter" });
    }
    try {
      const conversations = await deps.store.listConversations({
        employeeId,
        search: typeof req.query.search === "string" ? req.query.search.slice(0, 120) : "",
        from,
        to,
      });
      await deps.store.recordAudit({ actorUserId: actor.id, action: "list_conversations", employeeId });
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ conversations });
    } catch {
      res.status(503).json({ message: "Archive is temporarily unavailable" });
    }
  });

  app.get("/api/admin/whatsapp-employee-archive/conversations/:id/messages", async (req, res) => {
    if (!gated(req, res)) return;
    const actor = authorized(req, res);
    if (!actor) return;
    markArchiveSource(res);
    const id = positiveId(req.params.id);
    if (!id) return void res.status(400).json({ message: "Invalid conversation ID" });
    try {
      const conversation = await deps.store.getConversation(id);
      if (!conversation) return void res.status(404).json({ message: "Conversation not found" });
      const rows = await deps.store.listMessages(id);
      const decision = getEmployeeArchiveRuntimeDecision(env);
      if (!decision.enabled) return void res.status(404).json({ message: "Employee archive is unavailable" });
      const messages = rows.map(({ encryptedPayload, ...row }) => {
        if (row.tombstonedAt) return { ...row, payload: null };
        if (!encryptedPayload) throw new Error("Archive payload is missing.");
        return {
          ...row,
          payload: JSON.parse(decryptArchiveValue(encryptedPayload, decision.encryptionKey)),
        };
      });
      await deps.store.recordAudit({
        actorUserId: actor.id,
        action: "read_messages",
        employeeId: conversation.employeeId,
        conversationId: id,
      });
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ conversation: { id: conversation.id, employeeId: conversation.employeeId }, messages });
    } catch {
      res.status(503).json({ message: "Archive is temporarily unavailable" });
    }
  });

  app.get("/api/admin/whatsapp-employee-archive/media/:id", async (req, res) => {
    if (!gated(req, res) || !authorized(req, res)) return;
    markArchiveSource(res);
    const id = positiveId(req.params.id);
    if (!id) return void res.status(400).json({ message: "Invalid media ID" });
    try {
      const media = await deps.store.getPrivateMedia(id);
      if (!media) return void res.status(404).json({ message: "Media not found" });
      const actor = adminActor(req);
      if (actor) {
        await deps.store.recordAudit({
          actorUserId: actor.id,
          action: "read_media",
          employeeId: media.employeeId,
          conversationId: media.conversationId,
        });
      }
      if (media.data.length > 15 * 1024 * 1024) {
        return void res.status(413).json({ message: "Media exceeds the allowed size" });
      }
      const allowed = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "audio/ogg", "audio/mpeg", "application/pdf"]);
      if (!allowed.has(media.mimeType)) return void res.status(415).json({ message: "Unsupported media type" });
      res.setHeader("Content-Type", media.mimeType);
      res.setHeader("Content-Length", media.data.length);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.end(media.data);
    } catch {
      res.status(503).json({ message: "Archive is temporarily unavailable" });
    }
  });
}
