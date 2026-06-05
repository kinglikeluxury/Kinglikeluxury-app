import crypto from "crypto";
import type { Express } from "express";
import { db } from "./db";
import { leadImportQueue, leadImportAuditLog } from "@shared/schema";
import { eq, desc, and, lte, count } from "drizzle-orm";
import { recordLeadReceived, getAlertStatus } from "./metaLeadsService";
import { storage } from "./storage";

// ── Signature verification ────────────────────────────────────────────────────
function verifyMetaSignature(rawBody: Buffer, signature: string): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.warn("[MetaLeads] META_APP_SECRET not set — rejecting webhook");
    return false;
  }
  const expected = "sha256=" + crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Auth helper ───────────────────────────────────────────────────────────────
async function requireAdmin(req: any, res: any): Promise<boolean> {
  if (!req.session?.userId) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }
  const user = await storage.getUser(req.session.userId);
  if (!user?.isAdmin) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}

// ── Route registration ────────────────────────────────────────────────────────
export function registerMetaLeadsRoutes(app: Express): void {

  // ── Webhook: GET (Meta hub verification) ─────────────────────────────────
  app.get("/api/webhooks/meta-leads", (req: any, res: any) => {
    const mode      = req.query["hub.mode"];
    const token     = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
      console.log("[MetaLeads] Webhook verified by Meta");
      return res.status(200).send(challenge);
    }
    console.warn("[MetaLeads] Webhook verification failed — token mismatch");
    return res.status(403).json({ message: "Verification failed" });
  });

  // ── Webhook: POST (receive lead events) ──────────────────────────────────
  app.post("/api/webhooks/meta-leads", async (req: any, res: any) => {
    const signature: string = req.headers["x-hub-signature-256"] as string || "";
    const rawBody: Buffer | undefined = req.rawBody;

    if (!rawBody) {
      console.error("[MetaLeads] rawBody missing");
      return res.status(400).json({ message: "No raw body" });
    }
    if (!signature) {
      console.warn("[MetaLeads] Missing X-Hub-Signature-256");
      return res.status(400).json({ message: "Missing signature" });
    }
    if (!verifyMetaSignature(rawBody, signature)) {
      console.warn("[MetaLeads] Invalid webhook signature — request rejected");
      return res.status(401).json({ message: "Invalid signature" });
    }

    // Always respond 200 immediately so Meta doesn't retry
    res.status(200).json({ status: "ok" });

    // Process asynchronously — never block the webhook response
    (async () => {
      try {
        const payload = JSON.parse(rawBody.toString("utf8"));

        for (const entry of payload.entry || []) {
          for (const change of entry.changes || []) {
            if (change.field !== "leadgen") continue;

            const { leadgen_id, form_id, page_id, ad_id, adgroup_id, campaign_id } =
              change.value || {};

            if (!leadgen_id) continue;

            recordLeadReceived();

            // Duplicate check
            const existing = await db
              .select({ id: leadImportQueue.id })
              .from(leadImportQueue)
              .where(eq(leadImportQueue.metaLeadId, leadgen_id))
              .limit(1);

            if (existing.length > 0) {
              console.log(`[MetaLeads] Duplicate lead ignored: ${leadgen_id}`);
              await db.insert(leadImportAuditLog).values({
                queueEntryId: existing[0].id,
                metaLeadId: leadgen_id,
                action: "duplicate_detected",
                details: { rawValue: change.value },
              });
              continue;
            }

            const [queued] = await db.insert(leadImportQueue).values({
              metaLeadId: leadgen_id,
              leadgenId: leadgen_id,
              formId: form_id || null,
              pageId: page_id || null,
              adId: ad_id || null,
              adgroupId: adgroup_id || null,
              campaignId: campaign_id || null,
              rawWebhookPayload: change.value,
              status: "pending",
            }).returning();

            await db.insert(leadImportAuditLog).values({
              queueEntryId: queued.id,
              metaLeadId: leadgen_id,
              action: "received",
              details: { pageId: page_id, formId: form_id, adId: ad_id },
            });

            console.log(`[MetaLeads] Queued: metaLeadId=${leadgen_id} queueId=${queued.id}`);
          }
        }
      } catch (err) {
        console.error("[MetaLeads] Webhook payload processing error:", err);
      }
    })();
  });

  // ── Admin: dashboard data ─────────────────────────────────────────────────
  app.get("/api/admin/meta-leads/dashboard", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const tab    = (req.query.tab as string) || "all";
    const page   = Math.max(1, parseInt((req.query.page as string) || "1"));
    const limit  = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "25")));
    const offset = (page - 1) * limit;

    const STATUS_MAP: Record<string, string> = {
      failed: "failed",
      retry: "retry",
      needs_review: "needs_review",
      completed: "completed",
      pending: "pending",
      processing: "processing",
    };

    const rows = tab !== "all" && STATUS_MAP[tab]
      ? await db.select().from(leadImportQueue)
          .where(eq(leadImportQueue.status, STATUS_MAP[tab]))
          .orderBy(desc(leadImportQueue.receivedAt))
          .limit(limit).offset(offset)
      : await db.select().from(leadImportQueue)
          .orderBy(desc(leadImportQueue.receivedAt))
          .limit(limit).offset(offset);

    const statRows = await db
      .select({ status: leadImportQueue.status, cnt: count() })
      .from(leadImportQueue)
      .groupBy(leadImportQueue.status);

    const stats: Record<string, number> = {};
    for (const r of statRows) stats[r.status] = Number(r.cnt);

    const [dupRow] = await db
      .select({ cnt: count() })
      .from(leadImportAuditLog)
      .where(eq(leadImportAuditLog.action, "duplicate_detected"));

    return res.json({
      rows,
      stats,
      duplicateCount: Number(dupRow?.cnt || 0),
      page,
      limit,
    });
  });

  // ── Admin: duplicates log ─────────────────────────────────────────────────
  app.get("/api/admin/meta-leads/duplicates", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const page   = Math.max(1, parseInt((req.query.page as string) || "1"));
    const limit  = Math.min(100, 25);
    const offset = (page - 1) * limit;

    const duplicates = await db
      .select()
      .from(leadImportAuditLog)
      .where(eq(leadImportAuditLog.action, "duplicate_detected"))
      .orderBy(desc(leadImportAuditLog.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json({ duplicates, page, limit });
  });

  // ── Admin: audit log for one entry ───────────────────────────────────────
  app.get("/api/admin/meta-leads/:id/audit", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const logs = await db
      .select()
      .from(leadImportAuditLog)
      .where(eq(leadImportAuditLog.queueEntryId, id))
      .orderBy(desc(leadImportAuditLog.createdAt));

    return res.json({ logs });
  });

  // ── Admin: manual retry ───────────────────────────────────────────────────
  app.post("/api/admin/meta-leads/:id/retry", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const [entry] = await db
      .select()
      .from(leadImportQueue)
      .where(eq(leadImportQueue.id, id))
      .limit(1);

    if (!entry) return res.status(404).json({ message: "Queue entry not found" });

    const retryableStatuses = ["failed", "needs_review", "retry"];
    if (!retryableStatuses.includes(entry.status)) {
      return res.status(400).json({ message: `Cannot retry entry with status: ${entry.status}` });
    }

    await db.update(leadImportQueue).set({
      status: "pending",
      retryCount: 0,
      errorMessage: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    }).where(eq(leadImportQueue.id, id));

    await db.insert(leadImportAuditLog).values({
      queueEntryId: id,
      metaLeadId: entry.metaLeadId,
      action: "manual_retry",
      details: { triggeredByUserId: req.session.userId },
    });

    return res.json({ success: true });
  });

  // ── Admin: alert status ───────────────────────────────────────────────────
  app.get("/api/admin/meta-leads/alerts", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;
    return res.json(getAlertStatus());
  });
}
