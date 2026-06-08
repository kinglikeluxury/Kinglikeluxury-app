import { db } from "./db";
import { leadImportQueue, leadImportAuditLog, crmLeads } from "@shared/schema";
import { eq, and, lte } from "drizzle-orm";
import https from "https";

const META_GRAPH_VERSION = "v19.0";
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// ── Alert tracking (in-memory) ────────────────────────────────────────────────
let lastLeadReceivedAt: Date | null = null;
let queueProcessorRunning = false;

export function recordLeadReceived(): void {
  lastLeadReceivedAt = new Date();
}

export interface AlertStatus {
  alertActive: boolean;
  lastReceivedAt: Date | null;
  minutesSinceLast: number | null;
  isConfigured: boolean;
}

export function getAlertStatus(): AlertStatus {
  const isConfigured = !!(process.env.META_ACCESS_TOKEN && process.env.META_APP_SECRET);

  if (!lastLeadReceivedAt) {
    return { alertActive: isConfigured, lastReceivedAt: null, minutesSinceLast: null, isConfigured };
  }

  const minutesSinceLast = Math.round((Date.now() - lastLeadReceivedAt.getTime()) / 60_000);
  return {
    alertActive: isConfigured && minutesSinceLast > 30,
    lastReceivedAt,
    minutesSinceLast,
    isConfigured,
  };
}

// ── Graph API ─────────────────────────────────────────────────────────────────
async function fetchLeadFromGraph(leadgenId: string): Promise<any> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  console.log(`[MetaLeads] META_ACCESS_TOKEN present: ${!!accessToken} | token length: ${accessToken?.length ?? 0}`);
  if (!accessToken) throw new Error("META_ACCESS_TOKEN is not configured");

  const fields = [
    "id", "created_time", "field_data",
    "form_id", "ad_id", "adgroup_id",
    "campaign_id", "campaign_name", "adset_name", "ad_name",
  ].join(",");

  const url = `${META_GRAPH_BASE}/${leadgenId}?access_token=${encodeURIComponent(accessToken)}&fields=${fields}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            reject(new Error(`Meta Graph API: ${parsed.error.message} (code ${parsed.error.code})`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Graph API response parse error: ${raw.substring(0, 200)}`));
        }
      });
    }).on("error", reject);
  });
}

function extractFields(fieldData: Array<{ name: string; values: string[] }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const f of fieldData || []) {
    result[f.name] = (f.values || [])[0] || "";
  }
  return result;
}

// ── Audit logging ─────────────────────────────────────────────────────────────
async function logAudit(queueEntryId: number, metaLeadId: string, action: string, details: any): Promise<void> {
  try {
    await db.insert(leadImportAuditLog).values({ queueEntryId, metaLeadId, action, details });
  } catch (err) {
    console.error("[MetaLeads] Audit log write failed:", err);
  }
}

// ── Entry processor ───────────────────────────────────────────────────────────
async function processEntry(entry: typeof leadImportQueue.$inferSelect): Promise<void> {
  const now = new Date();

  await db.update(leadImportQueue)
    .set({ status: "processing", updatedAt: now })
    .where(eq(leadImportQueue.id, entry.id));

  await logAudit(entry.id, entry.metaLeadId, "processing", { attempt: entry.retryCount + 1 });

  try {
    const apiData = await fetchLeadFromGraph(entry.leadgenId);
    const fields = extractFields(apiData.field_data || []);

    const firstName = fields["first_name"] || null;
    const lastName = fields["last_name"] || null;
    const fullName =
      fields["full_name"] ||
      fields["name"] ||
      [firstName, lastName].filter(Boolean).join(" ") ||
      null;

    const [crmLead] = await db.insert(crmLeads).values({
      leadSource: "meta_ads",
      externalLeadId: entry.metaLeadId,
      firstName,
      lastName,
      fullName,
      phone: fields["phone_number"] || fields["phone"] || null,
      email: fields["email"] || null,
      country: fields["country"] || null,
      city: fields["city"] || null,
      campaignName: apiData.campaign_name || null,
      adsetName: apiData.adset_name || null,
      adName: apiData.ad_name || null,
      projectInterest:
        fields["project_interest"] ||
        fields["what_project_are_you_interested_in"] ||
        null,
      budget: fields["budget"] || null,
      status: "new",
      leadScore: "cold",
    }).returning();

    await db.update(leadImportQueue).set({
      status: "completed",
      leadData: apiData,
      crmLeadId: crmLead.id,
      processedAt: now,
      errorMessage: null,
      updatedAt: now,
    }).where(eq(leadImportQueue.id, entry.id));

    await logAudit(entry.id, entry.metaLeadId, "completed", {
      crmLeadId: crmLead.id,
      fieldsFound: Object.keys(fields),
    });

    console.log(`[MetaLeads] ✓ Processed: metaLeadId=${entry.metaLeadId} → crmLeadId=${crmLead.id}`);

  } catch (err: any) {
    const retryCount = entry.retryCount + 1;
    const retryDelaysMs = [60_000, 300_000, 1_800_000]; // 1 min, 5 min, 30 min

    if (retryCount >= entry.maxRetries) {
      await db.update(leadImportQueue).set({
        status: "needs_review",
        retryCount,
        errorMessage: err.message,
        updatedAt: now,
      }).where(eq(leadImportQueue.id, entry.id));

      await logAudit(entry.id, entry.metaLeadId, "needs_review", {
        error: err.message,
        totalAttempts: retryCount,
      });

      console.warn(`[MetaLeads] → needs_review after ${retryCount} attempts: metaLeadId=${entry.metaLeadId}`);
    } else {
      const delay = retryDelaysMs[retryCount - 1] ?? retryDelaysMs[retryDelaysMs.length - 1];
      const nextRetryAt = new Date(Date.now() + delay);

      await db.update(leadImportQueue).set({
        status: "retry",
        retryCount,
        errorMessage: err.message,
        nextRetryAt,
        updatedAt: now,
      }).where(eq(leadImportQueue.id, entry.id));

      await logAudit(entry.id, entry.metaLeadId, "retry_scheduled", {
        retryCount,
        nextRetryAt: nextRetryAt.toISOString(),
        error: err.message,
      });

      console.warn(`[MetaLeads] Retry ${retryCount}/${entry.maxRetries} at ${nextRetryAt.toISOString()}: metaLeadId=${entry.metaLeadId}`);
    }
  }
}

// ── Queue processor ───────────────────────────────────────────────────────────
async function processQueue(): Promise<void> {
  if (queueProcessorRunning) return;
  queueProcessorRunning = true;

  try {
    const now = new Date();

    const pending = await db
      .select()
      .from(leadImportQueue)
      .where(eq(leadImportQueue.status, "pending"))
      .limit(10);

    const readyRetries = await db
      .select()
      .from(leadImportQueue)
      .where(
        and(
          eq(leadImportQueue.status, "retry"),
          lte(leadImportQueue.nextRetryAt, now),
        ),
      )
      .limit(5);

    const toProcess = [...pending, ...readyRetries];

    for (const entry of toProcess) {
      await processEntry(entry);
    }
  } catch (err) {
    console.error("[MetaLeads] Queue processor error:", err);
  } finally {
    queueProcessorRunning = false;
  }
}

export function startMetaLeadsProcessor(): void {
  console.log("[MetaLeads] Queue processor started — polling every 30s");
  processQueue();
  setInterval(processQueue, 30_000);
}
