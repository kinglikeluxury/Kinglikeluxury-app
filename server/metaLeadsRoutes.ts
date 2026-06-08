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

function httpsGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    https.get(url, (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => resolve({ status: r.statusCode ?? 0, body }));
    }).on("error", (e) => resolve({ status: 0, body: String(e.message) }));
  });
}

// ── In-memory webhook receipt log (last 20, never contains secrets or lead values) ──
interface WebhookReceipt {
  ts: string;
  hasSignature: boolean;
  outcome: "verified" | "rejected_signature" | "missing_signature" | "missing_rawbody" | "processing_error";
  bodyType?: string;
  entryCount?: number;
  changes?: Array<{ field: string; leadgenId?: string; formId?: string; pageId?: string }>;
  error?: string;
}
const webhookReceipts: WebhookReceipt[] = [];
function pushReceipt(r: WebhookReceipt): WebhookReceipt {
  webhookReceipts.unshift(r);
  if (webhookReceipts.length > 20) webhookReceipts.pop();
  return r;
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

    // ── Record every POST attempt in the in-memory receipt log ──────────────
    const receipt = pushReceipt({
      ts:           new Date().toISOString(),
      hasSignature: !!signature,
      outcome:      "processing_error", // updated below at each exit
    });

    console.log(
      `[MetaLeads][POST] Webhook hit — x-hub-signature-256 present: ${!!signature} | rawBody present: ${!!rawBody} | content-type: ${req.headers["content-type"] ?? "none"}`
    );

    if (!rawBody) {
      receipt.outcome = "missing_rawbody";
      console.error("[MetaLeads][POST] ✗ rawBody missing — check express.json verify()");
      return res.status(400).json({ message: "No raw body" });
    }
    if (!signature) {
      receipt.outcome = "missing_signature";
      console.warn("[MetaLeads][POST] ✗ X-Hub-Signature-256 header absent — request likely not from Meta");
      return res.status(400).json({ message: "Missing signature" });
    }
    if (!verifyMetaSignature(rawBody, signature)) {
      receipt.outcome = "rejected_signature";
      console.warn("[MetaLeads][POST] ✗ Signature verification failed — META_APP_SECRET mismatch or payload tampered");
      return res.status(401).json({ message: "Invalid signature" });
    }

    receipt.outcome = "verified";

    // Always respond 200 immediately so Meta doesn't retry
    res.status(200).json({ status: "ok" });

    // Process asynchronously — never block the webhook response
    (async () => {
      try {
        const payload = JSON.parse(rawBody.toString("utf8"));

        receipt.bodyType    = typeof payload;
        receipt.entryCount  = (payload.entry || []).length;
        receipt.changes     = [];

        console.log(`[MetaLeads][POST] ▶ Verified — entries: ${receipt.entryCount} | bodyType: ${receipt.bodyType}`);

        for (const entry of payload.entry || []) {
          for (const change of entry.changes || []) {
            const cv = change.value || {};
            const changeRecord = {
              field:     String(change.field ?? ""),
              leadgenId: cv.leadgen_id ?? undefined,
              formId:    cv.form_id    ?? undefined,
              pageId:    cv.page_id    ?? undefined,
            };
            receipt.changes.push(changeRecord);

            console.log(
              `[MetaLeads][POST] ▷ field="${change.field}" | leadgen_id=${cv.leadgen_id ?? "—"} | form_id=${cv.form_id ?? "—"} | page_id=${cv.page_id ?? "—"}`
            );

            if (change.field !== "leadgen") continue;

            const { leadgen_id, form_id, page_id, ad_id, adgroup_id, campaign_id } = cv;

            console.log(
              `[MetaLeads][POST] leadgen event — leadgen_id=${leadgen_id ?? "missing"} | form_id=${form_id ?? "—"} | page_id=${page_id ?? "—"} | ad_id=${ad_id ?? "—"} | token_present=${!!process.env.META_ACCESS_TOKEN}`
            );

            if (!leadgen_id) {
              console.warn("[MetaLeads][POST] ✗ Skipping: leadgen_id is missing in payload");
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
              console.log(`[MetaLeads][POST] ⚠ Duplicate — leadgen_id=${leadgen_id} already queued (queueId=${existing[0].id})`);
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

            console.log(`[MetaLeads][POST] ✓ Queued — metaLeadId=${leadgen_id} queueId=${queued.id}`);
          }
        }
      } catch (err) {
        receipt.outcome = "processing_error";
        receipt.error   = String(err).slice(0, 300);
        console.error("[MetaLeads][POST] Payload processing error:", err);
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

  // ── Admin: webhook receipt log (in-memory, last 20) ───────────────────────
  app.get("/api/admin/meta-leads/webhook-receipts", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;
    return res.json({ receipts: webhookReceipts });
  });

  // ── Admin: test webhook GET endpoint (challenge verification) ─────────────
  // Calls the PRODUCTION callback URL so we know if Meta can actually reach it.
  app.post("/api/admin/meta-leads/webhook-verify-test", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const verifyToken = process.env.META_VERIFY_TOKEN;
    const callbackUrl = "https://www.kinglikeluxury.app/api/webhooks/meta-leads";
    const challenge   = "KINGLIKE_TEST_OK";

    if (!verifyToken) {
      return res.json({
        verifyTokenPresent: false,
        reachable:          false,
        challengeMatch:     false,
        error:              "META_VERIFY_TOKEN is not configured",
        callbackUrl,
      });
    }

    const testUrl =
      `${callbackUrl}?hub.mode=subscribe` +
      `&hub.verify_token=${encodeURIComponent(verifyToken)}` +
      `&hub.challenge=${encodeURIComponent(challenge)}`;

    const result = await httpsGet(testUrl);
    const responseBody = result.body.trim();
    const challengeMatch = responseBody === challenge;

    return res.json({
      verifyTokenPresent: true,
      reachable:          result.status !== 0,
      httpStatus:         result.status,
      challengeMatch,
      responseBody:       responseBody.slice(0, 100), // safe — just the challenge text
      callbackUrl,
      note: challengeMatch
        ? "✓ Endpoint reachable — challenge verification works correctly"
        : result.status === 0
          ? `✗ Network error — could not reach ${callbackUrl}`
          : `✗ Expected "${challenge}", got HTTP ${result.status}: "${responseBody.slice(0, 60)}"`,
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
