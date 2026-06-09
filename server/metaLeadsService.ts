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
  const tokenLen    = accessToken?.length ?? 0;
  console.log(
    `[MetaLeads][Graph] fetchLeadFromGraph called — leadgen_id=${leadgenId} | ` +
    `token_present=${!!accessToken} | token_length=${tokenLen}`
  );
  if (!accessToken) throw new Error("META_ACCESS_TOKEN is not configured");

  const fields = [
    "id", "created_time", "field_data",
    "form_id", "ad_id", "adgroup_id",
    "campaign_id", "campaign_name", "adset_name", "ad_name",
  ].join(",");

  // Log sanitised URL (token replaced with length marker so we can verify construction)
  const sanitisedUrl =
    `${META_GRAPH_BASE}/${leadgenId}` +
    `?access_token=[len=${tokenLen}]` +
    `&fields=${fields}`;
  console.log(`[MetaLeads][Graph] GET ${sanitisedUrl}`);

  const url = `${META_GRAPH_BASE}/${leadgenId}?access_token=${encodeURIComponent(accessToken)}&fields=${fields}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const httpStatus = res.statusCode ?? 0;
      console.log(`[MetaLeads][Graph] HTTP ${httpStatus} for leadgen_id=${leadgenId}`);
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            console.warn(
              `[MetaLeads][Graph] ✗ Error response for leadgen_id=${leadgenId} — ` +
              `code=${parsed.error.code} | type=${parsed.error.type} | ` +
              `subcode=${parsed.error.error_subcode ?? "—"} | ` +
              `fbtrace_id=${parsed.error.fbtrace_id ?? "—"} | ` +
              `message="${parsed.error.message}"`
            );
            reject(new Error(`Meta Graph API: ${parsed.error.message} (code ${parsed.error.code})`));
          } else {
            const fieldKeys = (parsed.field_data || []).map((f: any) => f.name);
            console.log(
              `[MetaLeads][Graph] ✓ Success for leadgen_id=${leadgenId} — ` +
              `field_data_count=${fieldKeys.length} | field_names=[${fieldKeys.join(", ")}] | ` +
              `campaign_name=${parsed.campaign_name ?? "—"} | ad_name=${parsed.ad_name ?? "—"}`
            );
            resolve(parsed);
          }
        } catch {
          const parseErr = `Graph API response parse error — raw(200): ${raw.substring(0, 200)}`;
          console.error(`[MetaLeads][Graph] ${parseErr}`);
          reject(new Error(parseErr));
        }
      });
    }).on("error", (err) => {
      console.error(`[MetaLeads][Graph] Network error for leadgen_id=${leadgenId} — ${err.message}`);
      reject(err);
    });
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

  console.log(
    `[MetaLeads][Processor] ▶ processEntry — queueId=${entry.id} | ` +
    `metaLeadId=${entry.metaLeadId} | leadgenId=${entry.leadgenId} | ` +
    `status=${entry.status} | retryCount=${entry.retryCount}/${entry.maxRetries}`
  );

  await db.update(leadImportQueue)
    .set({ status: "processing", updatedAt: now })
    .where(eq(leadImportQueue.id, entry.id));

  await logAudit(entry.id, entry.metaLeadId, "processing", { attempt: entry.retryCount + 1 });

  try {
    // ── Step A: fetch lead details from Graph API ──────────────────────────
    console.log(
      `[MetaLeads][Processor] Step A — calling Graph API | ` +
      `queueId=${entry.id} | leadgenId=${entry.leadgenId}`
    );
    const apiData = await fetchLeadFromGraph(entry.leadgenId);

    // ── Step B: extract form fields ────────────────────────────────────────
    const fields = extractFields(apiData.field_data || []);
    const allFieldNames = Object.keys(fields);
    console.log(
      `[MetaLeads][Processor] Step B — fields extracted | ` +
      `queueId=${entry.id} | field_names=[${allFieldNames.join(", ")}] | ` +
      `has_phone=${!!(fields["phone_number"] || fields["phone"])} | ` +
      `has_email=${!!fields["email"]} | ` +
      `has_name=${!!(fields["full_name"] || fields["first_name"] || fields["name"])}`
    );

    const firstName = fields["first_name"] || null;
    const lastName  = fields["last_name"]  || null;
    const fullName  =
      fields["full_name"] ||
      fields["name"] ||
      [firstName, lastName].filter(Boolean).join(" ") ||
      null;

    // ── Step C: insert into CRM leads ──────────────────────────────────────
    const crmPayload = {
      leadSource:      "meta_ads" as const,
      externalLeadId:  entry.metaLeadId,
      firstName,
      lastName,
      fullName,
      phone:           fields["phone_number"] || fields["phone"] || null,
      email:           fields["email"] || null,
      country:         fields["country"] || null,
      city:            fields["city"] || null,
      campaignName:    apiData.campaign_name || null,
      adsetName:       apiData.adset_name    || null,
      adName:          apiData.ad_name       || null,
      projectInterest:
        fields["project_interest"] ||
        fields["what_project_are_you_interested_in"] ||
        null,
      budget:    fields["budget"] || null,
      status:    "new"  as const,
      leadScore: "cold" as const,
    };

    console.log(
      `[MetaLeads][Processor] Step C — inserting CRM lead | ` +
      `queueId=${entry.id} | externalLeadId=${entry.metaLeadId} | ` +
      `fullName=${fullName ?? "—"} | ` +
      `phone_present=${!!crmPayload.phone} | email_present=${!!crmPayload.email}`
    );

    const [crmLead] = await db.insert(crmLeads).values(crmPayload).returning();

    if (!crmLead) {
      throw new Error("CRM insert returned no row — possible DB constraint violation");
    }

    console.log(
      `[MetaLeads][Processor] Step C ✓ — CRM lead created | ` +
      `queueId=${entry.id} | crmLeadId=${crmLead.id}`
    );

    // ── Step D: mark queue entry completed ─────────────────────────────────
    await db.update(leadImportQueue).set({
      status:       "completed",
      leadData:     apiData,
      crmLeadId:    crmLead.id,
      processedAt:  now,
      errorMessage: null,
      updatedAt:    now,
    }).where(eq(leadImportQueue.id, entry.id));

    await logAudit(entry.id, entry.metaLeadId, "completed", {
      crmLeadId:   crmLead.id,
      fieldsFound: allFieldNames,
    });

    console.log(
      `[MetaLeads][Processor] ✓ Complete — metaLeadId=${entry.metaLeadId} → crmLeadId=${crmLead.id}`
    );

  } catch (err: any) {
    const retryCount    = entry.retryCount + 1;
    const retryDelaysMs = [60_000, 300_000, 1_800_000]; // 1 min, 5 min, 30 min

    console.error(
      `[MetaLeads][Processor] ✗ Error on attempt ${retryCount}/${entry.maxRetries} | ` +
      `queueId=${entry.id} | metaLeadId=${entry.metaLeadId} | ` +
      `error="${err.message}"`
    );

    if (retryCount >= entry.maxRetries) {
      await db.update(leadImportQueue).set({
        status:       "needs_review",
        retryCount,
        errorMessage: err.message,
        updatedAt:    now,
      }).where(eq(leadImportQueue.id, entry.id));

      await logAudit(entry.id, entry.metaLeadId, "needs_review", {
        error:         err.message,
        totalAttempts: retryCount,
      });

      console.warn(
        `[MetaLeads][Processor] → needs_review after ${retryCount} attempts | ` +
        `metaLeadId=${entry.metaLeadId}`
      );
    } else {
      const delay       = retryDelaysMs[retryCount - 1] ?? retryDelaysMs[retryDelaysMs.length - 1];
      const nextRetryAt = new Date(Date.now() + delay);

      await db.update(leadImportQueue).set({
        status:       "retry",
        retryCount,
        errorMessage: err.message,
        nextRetryAt,
        updatedAt:    now,
      }).where(eq(leadImportQueue.id, entry.id));

      await logAudit(entry.id, entry.metaLeadId, "retry_scheduled", {
        retryCount,
        nextRetryAt: nextRetryAt.toISOString(),
        error:       err.message,
      });

      console.warn(
        `[MetaLeads][Processor] Retry ${retryCount}/${entry.maxRetries} scheduled at ` +
        `${nextRetryAt.toISOString()} | metaLeadId=${entry.metaLeadId} | ` +
        `delay_ms=${delay}`
      );
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

    console.log(
      `[MetaLeads][Queue] tick — pending=${pending.length} | ready_retries=${readyRetries.length} | total_to_process=${toProcess.length}`
    );

    for (const entry of toProcess) {
      await processEntry(entry);
    }
  } catch (err) {
    console.error("[MetaLeads][Queue] processor error:", err);
  } finally {
    queueProcessorRunning = false;
  }
}

export function startMetaLeadsProcessor(): void {
  console.log("[MetaLeads] Queue processor started — polling every 30s");
  processQueue();
  setInterval(processQueue, 30_000);
}
