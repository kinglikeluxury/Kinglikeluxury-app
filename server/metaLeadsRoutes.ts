import crypto from "crypto";
import https from "https";
import type { Express } from "express";
import { db } from "./db";
import { leadImportQueue, leadImportAuditLog } from "@shared/schema";
import { eq, desc, asc, and, lte, count } from "drizzle-orm";
import { recordLeadReceived, getAlertStatus } from "./metaLeadsService";
import { storage } from "./storage";

const META_GRAPH_VERSION = "v19.0";
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

function graphGet(path: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    https.get(`${META_GRAPH_BASE}${path}`, (r) => {
      let raw = "";
      r.on("data", (c) => (raw += c));
      r.on("end", () => {
        try { resolve({ status: r.statusCode ?? 0, data: JSON.parse(raw) }); }
        catch { resolve({ status: r.statusCode ?? 0, data: { error: { message: raw.slice(0, 200) } } }); }
      });
    }).on("error", (e) => resolve({ status: 0, data: { error: { message: e.message } } }));
  });
}

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

        console.log(`[MetaLeads] ▶ Webhook received — entries: ${(payload.entry || []).length}`);

        for (const entry of payload.entry || []) {
          for (const change of entry.changes || []) {
            // Log every change field we see (safe — no secrets)
            console.log(`[MetaLeads] ▷ change.field="${change.field}" page_id="${entry.id || "?"}"`);

            if (change.field !== "leadgen") continue;

            const { leadgen_id, form_id, page_id, ad_id, adgroup_id, campaign_id } =
              change.value || {};

            // Safe diagnostic log — IDs only, no personal data
            console.log(
              `[MetaLeads] leadgen event — leadgen_id=${leadgen_id ?? "missing"} | form_id=${form_id ?? "—"} | page_id=${page_id ?? "—"} | ad_id=${ad_id ?? "—"} | META_ACCESS_TOKEN present: ${!!process.env.META_ACCESS_TOKEN}`
            );

            if (!leadgen_id) {
              console.warn("[MetaLeads] ✗ Skipping: leadgen_id is missing in payload");
              continue;
            }

            recordLeadReceived();

            // Duplicate check
            const existing = await db
              .select({ id: leadImportQueue.id })
              .from(leadImportQueue)
              .where(eq(leadImportQueue.metaLeadId, leadgen_id))
              .limit(1);

            if (existing.length > 0) {
              console.log(`[MetaLeads] ⚠ Duplicate — leadgen_id=${leadgen_id} already in queue (queueId=${existing[0].id}). Skipping.`);
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

  // ── Admin: token diagnostic — calls Meta Graph API, never exposes token value ──
  app.post("/api/admin/meta-leads/token-test", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      return res.json({
        tokenPresent: false,
        tokenValid: false,
        error: "META_ACCESS_TOKEN is not configured",
      });
    }

    const esc = encodeURIComponent(token);

    // Step 1 — basic token validity
    const meRes = await graphGet(`/me?access_token=${esc}&fields=id,name`);
    if (meRes.data?.error) {
      return res.json({
        tokenPresent: true,
        tokenValid: false,
        httpStatus: meRes.status,
        error: meRes.data.error.message,
        errorCode: meRes.data.error.code,
        errorType: meRes.data.error.type,
      });
    }

    // Step 2 — permissions granted to this token
    const permsRes = await graphGet(`/me/permissions?access_token=${esc}`);
    const permissions: string[] = (permsRes.data?.data || [])
      .filter((p: any) => p.status === "granted")
      .map((p: any) => p.permission as string);

    // Step 3 — pages accessible (name + id only, no tokens)
    const pagesRes = await graphGet(`/me/accounts?access_token=${esc}&fields=id,name,tasks`);
    const pages = (pagesRes.data?.data || []).slice(0, 10).map((p: any) => ({
      id: p.id,
      name: p.name,
      tasks: p.tasks || [],
    }));

    return res.json({
      tokenPresent: true,
      tokenValid: true,
      identity: {
        id:   meRes.data?.id   ?? "—",
        name: meRes.data?.name ?? "—",
      },
      permissions,
      hasLeadsRetrieval:       permissions.includes("leads_retrieval"),
      hasPagesReadEngagement:  permissions.includes("pages_read_engagement"),
      hasAdsManagement:        permissions.includes("ads_management"),
      pages,
    });
  });

  // ── Admin: credential config status (boolean only — no values) ──────────
  app.get("/api/admin/meta-leads/config-status", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;
    return res.json({
      hasAppSecret:   !!process.env.META_APP_SECRET,
      hasAccessToken: !!process.env.META_ACCESS_TOKEN,
      hasVerifyToken: !!process.env.META_VERIFY_TOKEN,
    });
  });

  // ── Admin: full diagnostic for one entry ─────────────────────────────────
  app.get("/api/admin/meta-leads/:id/diagnostic", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const [entry] = await db
      .select()
      .from(leadImportQueue)
      .where(eq(leadImportQueue.id, id))
      .limit(1);

    if (!entry) return res.status(404).json({ message: "Queue entry not found" });

    const auditLogs = await db
      .select()
      .from(leadImportAuditLog)
      .where(eq(leadImportAuditLog.queueEntryId, id))
      .orderBy(asc(leadImportAuditLog.createdAt));

    return res.json({ entry, auditLogs });
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
