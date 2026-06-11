import { db } from "./db";
import { leadImportQueue, leadImportAuditLog, crmLeads } from "@shared/schema";
import { eq, and, lte } from "drizzle-orm";
import https from "https";
import { initConversationForLead } from "./whatsappAiService";
import { checkAndTrigger as waQualCheckAndTrigger } from "./waQualService";
import { initDeveloperRegistrationsForLead } from "./developerRegistrationService";
import { getEligibleSubAgents, pickNextSubAgentId, cycleAgentId } from "./leadAssignmentService";

export interface PullSyncResult {
  formsChecked: number;
  leadsFound: number;
  leadsInserted: number;
  duplicatesSkipped: number;
  errors: number;
}

const META_GRAPH_VERSION = "v19.0";
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const META_PAGE_ID = process.env.META_PAGE_ID || "127710467090772";

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
    lastReceivedAt: lastLeadReceivedAt,
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
    const webhookAssignedTo = await pickNextSubAgentId();

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
      assignedTo: webhookAssignedTo,
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
    if (crmLead.assignedTo) {
      console.log(`[LeadAssignment] Assigned leadId=${crmLead.id} to userId=${crmLead.assignedTo}`);
      import("./leadAssignmentNotificationService").then(({ notifyAgentOfLeadAssignment }) =>
        notifyAgentOfLeadAssignment({
          leadId: crmLead.id, leadName: crmLead.fullName, leadPhone: crmLead.phone,
          leadEmail: crmLead.email, leadSource: crmLead.leadSource,
          assignedToUserId: crmLead.assignedTo!, context: "new",
        })
      ).catch(() => {});
    }

    // ── WhatsApp AI: init draft conversation (Phase 1 — no message sent) ───
    initConversationForLead(crmLead.id, {
      fullName:        crmLead.fullName,
      firstName:       crmLead.firstName,
      phone:           crmLead.phone,
      country:         crmLead.country,
      city:            crmLead.city,
      budget:          crmLead.budget,
      projectInterest: crmLead.projectInterest,
      assignedTo:      crmLead.assignedTo,
    }).catch(err =>
      console.error(`[WhatsAppAI] Init failed crmLeadId=${crmLead.id}: ${err.message}`)
    );

    // ── WA Qualification: start interactive flow ──────────────────────────
    waQualCheckAndTrigger(crmLead.id, crmLead.phone, crmLead.firstName).catch(err =>
      console.error(`[WaQual] Trigger failed crmLeadId=${crmLead.id}: ${err.message}`)
    );

    // ── Developer Registration: prepare records for all active developers ───
    initDeveloperRegistrationsForLead(crmLead.id, {
      id:              crmLead.id,
      fullName:        crmLead.fullName,
      firstName:       crmLead.firstName,
      lastName:        crmLead.lastName,
      phone:           crmLead.phone,
      country:         crmLead.country,
      city:            crmLead.city,
      budget:          crmLead.budget,
      projectInterest: crmLead.projectInterest,
    }).catch(err =>
      console.error(`[DeveloperRegistration] Init failed crmLeadId=${crmLead.id}: ${err.message}`)
    );

    // ── Email Nurturing: start sequence for new Meta lead ─────────────────────
    import("./emailNurturingService").then(({ initNurturingForLead }) =>
      initNurturingForLead(crmLead.id, crmLead.email, { firstName: crmLead.firstName, fullName: crmLead.fullName })
    ).catch(err =>
      console.error(`[EmailNurturing] Init failed crmLeadId=${crmLead.id}: ${err.message}`)
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

// ── Pull Sync: fetch leads directly from Meta Graph API ───────────────────────
async function graphGetPull(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`JSON parse error: ${raw.slice(0, 200)}`)); }
      });
    }).on("error", reject);
  });
}

export async function pullSyncFromMeta(): Promise<PullSyncResult> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN is not configured");

  const tokenLen = token.length;
  const tokenType = "SYSTEM_USER";
  const pageId = META_PAGE_ID;
  const formsEndpoint = `/${pageId}/leadgen_forms`;
  const result: PullSyncResult = {
    formsChecked: 0, leadsFound: 0, leadsInserted: 0, duplicatesSkipped: 0, errors: 0,
  };

  console.log("[MetaLeads][PullSync] start");
  console.log(`[MetaLeads][PullSync] system token valid | token_len=${tokenLen} | token_type=${tokenType}`);

  // Step A: exchange SYSTEM_USER token for the Page Access Token via /me/accounts
  // /{page_id}/leadgen_forms requires a Page Access Token (Meta error #190 with system user token).
  // We use the system user token to fetch /me/accounts, extract the page token, and use it only
  // for the forms + leads calls. The system user token is never replaced or stored.
  const accountsUrl = `${META_GRAPH_BASE}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(token)}`;
  console.log(`[MetaLeads][PullSync] GET /me/accounts?fields=id,name,access_token (fetching page token for page_id=${pageId})`);

  let accountsData: any;
  try {
    accountsData = await graphGetPull(accountsUrl);
  } catch (err: any) {
    throw new Error(`Failed to fetch /me/accounts: ${err.message}`);
  }

  if (accountsData.error) {
    throw new Error(`Meta /me/accounts error: ${accountsData.error.message} (code ${accountsData.error.code})`);
  }

  const pages: any[] = accountsData.data || [];
  const pageEntry = pages.find((p: any) => p.id === pageId) || pages[0];
  if (!pageEntry) {
    throw new Error(`No pages found via /me/accounts. Confirm the System User has access to page ${pageId}.`);
  }
  const pageToken: string = pageEntry.access_token;
  const resolvedPageId: string = pageEntry.id;
  console.log(`[MetaLeads][PullSync] page token retrieved | page_id=${resolvedPageId} | page_name=${pageEntry.name}`);

  // Step B: fetch lead forms using the Page Access Token
  const formsUrl = `${META_GRAPH_BASE}/${resolvedPageId}/leadgen_forms?access_token=${encodeURIComponent(pageToken)}&fields=id,name,status&limit=100`;
  console.log(`[MetaLeads][PullSync] GET /${resolvedPageId}/leadgen_forms (using page token)`);

  let formsData: any;
  try {
    formsData = await graphGetPull(formsUrl);
  } catch (err: any) {
    throw new Error(`Failed to fetch forms: ${err.message}`);
  }

  if (formsData.error) {
    const errMsg: string = formsData.error.message || "";
    const errCode: number = formsData.error.code || 0;
    if (errCode === 200 || errMsg.toLowerCase().includes("pages_manage_ads")) {
      console.error(
        "[MetaLeads][PullSync] PERMISSION ERROR: Missing pages_manage_ads on page token. " +
        "Ensure the System User has pages_manage_ads in Business Manager and regenerate META_ACCESS_TOKEN."
      );
      throw new Error(
        `Meta permission error: Missing pages_manage_ads on page token. ` +
        `Ensure System User has pages_manage_ads in Business Manager and regenerate META_ACCESS_TOKEN. ` +
        `(original: ${errMsg})`
      );
    }
    throw new Error(`Meta error: ${errMsg} (code ${errCode})`);
  }

  const forms: any[] = formsData.data || [];
  result.formsChecked = forms.length;

  // Round-robin sub-agent assignment — fetch agents once before the batch loop
  const pullSyncAgents = await getEligibleSubAgents();
  let pullSyncOffset = 0;

  // Step 2: for each form, fetch and import leads
  for (const form of forms) {
    let inserted = 0, dups = 0, errs = 0, found = 0;

    try {
      const leadsUrl =
        `${META_GRAPH_BASE}/${form.id}/leads` +
        `?access_token=${encodeURIComponent(pageToken)}` +
        `&fields=id,created_time,field_data,ad_id,form_id,campaign_id&limit=25`;
      console.log(
        `[MetaLeads][PullSync] GET /${form.id}/leads?access_token=[page_token_len=${pageToken.length}]` +
        `&fields=id,created_time,field_data,ad_id,form_id,campaign_id&limit=25`
      );

      const leadsData = await graphGetPull(leadsUrl);

      if (leadsData.error) {
        console.warn(`[MetaLeads][PullSync] form_id=${form.id} error: ${leadsData.error.message}`);
        result.errors++;
        continue;
      }

      const leads: any[] = leadsData.data || [];
      found = leads.length;
      result.leadsFound += found;

      for (const lead of leads) {
        try {
          const leadId = String(lead.id);

          // Dedup check against queue (metaLeadId is unique)
          const existing = await db
            .select({ id: leadImportQueue.id })
            .from(leadImportQueue)
            .where(eq(leadImportQueue.metaLeadId, leadId))
            .limit(1);

          if (existing.length > 0) {
            dups++;
            result.duplicatesSkipped++;
            continue;
          }

          // Extract CRM fields from field_data
          const fields = extractFields(lead.field_data || []);
          const firstName = fields["first_name"] || null;
          const lastName  = fields["last_name"]  || null;
          const fullName  =
            fields["full_name"] || fields["name"] ||
            [firstName, lastName].filter(Boolean).join(" ") || null;

          // Insert CRM lead
          const pullSyncAssignedTo = cycleAgentId(pullSyncAgents, pullSyncOffset++);
          const [crmLead] = await db.insert(crmLeads).values({
            leadSource:      "meta_ads" as const,
            externalLeadId:  leadId,
            firstName,
            lastName,
            fullName,
            phone:           fields["phone_number"] || fields["phone"] || null,
            email:           fields["email"]        || null,
            country:         fields["country"]      || null,
            city:            fields["city"]         || null,
            projectInterest:
              fields["project_interest"] ||
              fields["what_project_are_you_interested_in"] || null,
            budget:    fields["budget"] || null,
            status:    "new"  as const,
            leadScore: "cold" as const,
            assignedTo: pullSyncAssignedTo,
          }).returning();

          if (!crmLead) throw new Error("CRM insert returned no row");
          if (crmLead.assignedTo) {
            console.log(`[LeadAssignment] Assigned leadId=${crmLead.id} to userId=${crmLead.assignedTo}`);
            import("./leadAssignmentNotificationService").then(({ notifyAgentOfLeadAssignment }) =>
              notifyAgentOfLeadAssignment({
                leadId: crmLead.id, leadName: crmLead.fullName, leadPhone: crmLead.phone,
                leadEmail: crmLead.email, leadSource: crmLead.leadSource,
                assignedToUserId: crmLead.assignedTo!, context: "new",
              })
            ).catch(() => {});
          }

          // ── WhatsApp AI: init draft conversation (Phase 1 — no message sent) ──
          initConversationForLead(crmLead.id, {
            fullName:        crmLead.fullName,
            firstName:       crmLead.firstName,
            phone:           crmLead.phone,
            country:         crmLead.country,
            city:            crmLead.city,
            budget:          crmLead.budget,
            projectInterest: crmLead.projectInterest,
            assignedTo:      crmLead.assignedTo,
          }).catch(err =>
            console.error(`[WhatsAppAI] Init failed crmLeadId=${crmLead.id}: ${err.message}`)
          );

          // ── WA Qualification: start interactive flow ────────────────────────
          waQualCheckAndTrigger(crmLead.id, crmLead.phone, crmLead.firstName).catch(err =>
            console.error(`[WaQual] Trigger failed crmLeadId=${crmLead.id}: ${err.message}`)
          );

          // ── Developer Registration: prepare records for all active developers ─
          initDeveloperRegistrationsForLead(crmLead.id, {
            id:              crmLead.id,
            fullName:        crmLead.fullName,
            firstName:       crmLead.firstName,
            lastName:        crmLead.lastName,
            phone:           crmLead.phone,
            country:         crmLead.country,
            city:            crmLead.city,
            budget:          crmLead.budget,
            projectInterest: crmLead.projectInterest,
          }).catch(err =>
            console.error(`[DeveloperRegistration] Init failed crmLeadId=${crmLead.id}: ${err.message}`)
          );

          // ── Email Nurturing: start sequence for new Meta pull-sync lead ───────
          import("./emailNurturingService").then(({ initNurturingForLead }) =>
            initNurturingForLead(crmLead.id, crmLead.email, { firstName: crmLead.firstName, fullName: crmLead.fullName })
          ).catch(err =>
            console.error(`[EmailNurturing] Init failed crmLeadId=${crmLead.id}: ${err.message}`)
          );

          // Parse created_time — Meta sends ISO string from /leads, integer from webhooks
          const now = new Date();
          const createdTime = lead.created_time
            ? typeof lead.created_time === "number"
              ? new Date(lead.created_time * 1000)
              : new Date(lead.created_time)
            : now;

          // Insert queue entry as completed (data already in hand)
          const [queueEntry] = await db.insert(leadImportQueue).values({
            metaLeadId:        leadId,
            leadgenId:         leadId,
            formId:            String(form.id),
            pageId:            null,
            adId:              lead.ad_id      ? String(lead.ad_id)      : null,
            campaignId:        lead.campaign_id ? String(lead.campaign_id) : null,
            status:            "completed",
            retryCount:        0,
            maxRetries:        3,
            rawWebhookPayload: lead,
            leadData:          lead,
            crmLeadId:         crmLead.id,
            processedAt:       now,
            receivedAt:        createdTime,
          }).returning();

          if (queueEntry) {
            await logAudit(queueEntry.id, leadId, "pull_sync_inserted", {
              formId:    form.id,
              formName:  form.name,
              crmLeadId: crmLead.id,
            });
          }

          inserted++;
          result.leadsInserted++;
        } catch (err: any) {
          console.error(`[MetaLeads][PullSync] lead=${lead.id} error: ${err.message}`);
          errs++;
          result.errors++;
        }
      }
    } catch (err: any) {
      console.error(`[MetaLeads][PullSync] form_id=${form.id} fetch error: ${err.message}`);
      result.errors++;
    }

    console.log(
      `[MetaLeads][PullSync] form_id=${form.id} leads_found=${found} ` +
      `inserted=${inserted} duplicates=${dups} errors=${errs}`
    );
  }

  console.log(
    `[MetaLeads][PullSync] complete — forms=${result.formsChecked} ` +
    `found=${result.leadsFound} inserted=${result.leadsInserted} ` +
    `dups=${result.duplicatesSkipped} errors=${result.errors}`
  );
  return result;
}

let pullSyncRunning = false;

async function runPullSync(): Promise<void> {
  if (pullSyncRunning) return;
  pullSyncRunning = true;
  try {
    await pullSyncFromMeta();
  } catch (err: any) {
    console.error("[MetaLeads][PullSync] Scheduler error:", err.message);
  } finally {
    pullSyncRunning = false;
  }
}

export function startPullSyncScheduler(): void {
  console.log("[MetaLeads][PullSync] Scheduler started — running every 5 minutes");
  runPullSync();
  setInterval(runPullSync, 5 * 60_000);
}
