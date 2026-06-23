/**
 * Webinar Campaign — "YouTube Webinar - Georgia 2026"
 *
 * Routes (admin-only):
 *   POST /api/admin/email-campaigns/webinar/setup-and-test
 *     Uploads webinar image to Cloudinary, creates sequence + template,
 *     sends a TEST email ONLY to kinglikeluxury@gmail.com.
 *     Safe to call multiple times — idempotent.
 *
 *   GET  /api/admin/email-campaigns/webinar/status
 *     Returns campaign record, template, and how many CRM leads have emails.
 *
 *   POST /api/admin/email-campaigns/webinar/send-approved
 *     REQUIRES MANUAL APPROVAL. Sends to all CRM leads with valid emails.
 *     Batches of 10 recipients, 10-minute delay between batches.
 *     Logs every batch (batch #, recipients, success, failure).
 *     One active run at a time — rejects concurrent calls.
 */

import type { Express } from "express";
import crypto from "crypto";
import { pool } from "./db";

// ── Constants ──────────────────────────────────────────────────────────────────

const CAMPAIGN_NAME  = "YouTube Webinar - Georgia 2026";
const SUBJECT        = "ندوة مجانية مباشرة: كيف تستثمر بذكاء في جورجيا 2026 🎥";
const TEST_EMAIL     = "kinglikeluxury@gmail.com";
const SORT_ORDER     = 100;      // high enough to never collide with sequences 1–7
const BATCH_SIZE     = 10;
const BATCH_DELAY_MS = 10 * 60 * 1000; // 10 minutes in ms
const FROM_NAME      = "Kinglike Luxury";
const FROM_EMAIL     = "info@kinglikeluxury.app";
const APP_URL        = "https://www.kinglikeluxury.app";
const UNSUB_SECRET   = process.env.EMAIL_NURTURING_UNSUBSCRIBE_SECRET || "kinglike-unsub-secret-2024";
const WHATSAPP_URL   = "https://wa.me/995591000058?text=Hello%20Kinglike%20Luxury";

const IMAGE_URL = "https://www.kinglikeluxury.app/webinar-georgia-2026.jpeg";

// ── Batch-run guard ────────────────────────────────────────────────────────────

let batchRunning = false;

// ── Helpers ────────────────────────────────────────────────────────────────────

function unsubUrl(leadId: number): string {
  const token = crypto.createHmac("sha256", UNSUB_SECRET).update(String(leadId)).digest("hex");
  return `${APP_URL}/api/email/unsubscribe?leadId=${leadId}&token=${token}`;
}

function buildHtml(imageUrl: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${CAMPAIGN_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#f0f9f9;font-family:Arial,Helvetica,sans-serif;direction:rtl">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f9f9;padding:40px 20px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0"
      style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,84,118,0.10)">

      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#005476 0%,#3bcac4 100%);padding:28px 40px;text-align:center">
          <h1 style="color:#fff;margin:0 0 4px;font-size:26px;font-weight:900;letter-spacing:-0.5px">Kinglike Luxury</h1>
          <p style="color:rgba(255,255,255,0.85);margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase">Invest with Vision</p>
        </td>
      </tr>

      <!-- Webinar Flyer Image -->
      <tr>
        <td style="padding:0;line-height:0">
          <img src="${imageUrl}"
               alt="ندوة مجانية: كيف تستثمر بذكاء في جورجيا 2026"
               width="600" border="0"
               style="display:block;width:100%;max-width:600px;height:auto;border:0" />
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:36px 40px 28px">
          <h2 style="color:#005476;margin:0 0 16px;font-size:22px;font-weight:800;line-height:1.3">
            ندوة مجانية مباشرة على يوتيوب 🎥
          </h2>
          <p style="color:#444;line-height:1.9;font-size:15px;margin:0 0 14px">
            يسعدنا دعوتكم للمشاركة في ندوتنا المباشرة المجانية على يوتيوب:
          </p>
          <p style="color:#005476;font-size:18px;font-weight:800;margin:0 0 8px;line-height:1.4">
            كيف تستثمر بذكاء في جورجيا 2026
          </p>
          <p style="color:#666;font-size:14px;margin:0 0 24px;line-height:1.7">
            دليلك الشامل لفرص استثمار آمنة ومربحة — مع المستشار العقاري طارق إمام
          </p>

          <!-- Details Card -->
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#f0f9f9;border-radius:12px;border-right:4px solid #3bcac4;margin-bottom:24px">
            <tr>
              <td style="padding:18px 20px">
                <p style="margin:0 0 8px;color:#005476;font-size:14px">
                  📅 <strong>التاريخ:</strong> الخميس 25.06.2026
                </p>
                <p style="margin:0 0 8px;color:#005476;font-size:14px">
                  🕙 <strong>الوقت:</strong> 10:00 PM بتوقيت إسرائيل
                </p>
                <p style="margin:0;color:#005476;font-size:14px">
                  📡 <strong>البث:</strong> مباشر عبر يوتيوب — مجاني بالكامل
                </p>
              </td>
            </tr>
          </table>

          <p style="color:#444;line-height:1.9;font-size:14px;margin:0 0 24px">
            ستتعلم في هذه الندوة:<br>
            ✅ لماذا أصبحت جورجيا وجهة المستثمرين العرب<br>
            ✅ أفضل المناطق والمشاريع للاستثمار<br>
            ✅ القوانين والإجراءات خطوة بخطوة<br>
            ✅ عوائد الإيجار والإرتفاع المتوقع للأسعار<br>
            ✅ جلسة أسئلة وأجوبة مباشرة
          </p>

          <!-- CTA Button -->
          <div style="text-align:center;margin:8px 0 24px">
            <a href="${WHATSAPP_URL}"
               style="display:inline-block;background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:700">
              سجّل الآن واحصل على رابط الدخول
            </a>
          </div>

          <p style="color:#888;font-size:13px;line-height:1.7;margin:0;text-align:center">
            للاستفسار تواصل معنا عبر
            <a href="${WHATSAPP_URL}" style="color:#3bcac4;text-decoration:none">واتساب</a>
            أو راسلنا على
            <a href="mailto:info@kinglikeluxury.app" style="color:#3bcac4;text-decoration:none">info@kinglikeluxury.app</a>
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:0 40px 28px;text-align:center;border-top:2px solid #e8f4f8">
          <p style="color:#005476;font-size:13px;font-weight:800;margin:20px 0 2px">Kinglike Luxury</p>
          <a href="https://www.kinglikeluxury.app" style="color:#3bcac4;font-size:11px;text-decoration:none;display:block;margin-bottom:10px">www.kinglikeluxury.app</a>
          <p style="color:#bbb;font-size:11px;margin:0">
            إذا كنت لا تريد تلقي هذه الرسائل،
            <a href="${unsubscribeUrl}" style="color:#3bcac4;text-decoration:underline">إلغاء الاشتراك</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Image URL — served from client/public/ via the production static handler ──
function getImageUrl(): string {
  return IMAGE_URL;
}

// ── Create sequence + template in DB (idempotent) ────────────────────────────

async function ensureCampaignInDb(imageUrl: string): Promise<{ seqId: number; tmplId: number }> {
  const client = await pool.connect();
  try {
    // Sequence
    let seqRow = (await client.query(
      `SELECT id FROM email_nurturing_sequences WHERE name = $1 LIMIT 1`,
      [CAMPAIGN_NAME]
    )).rows[0];

    if (!seqRow) {
      seqRow = (await client.query(
        `INSERT INTO email_nurturing_sequences(name, description, is_active)
         VALUES($1, $2, true) RETURNING id`,
        [CAMPAIGN_NAME, "Single-shot webinar invite campaign — batch send after approval"]
      )).rows[0];
      console.log(`[WebinarCampaign] Sequence created id=${seqRow.id}`);
    } else {
      console.log(`[WebinarCampaign] Sequence exists id=${seqRow.id}`);
    }

    const seqId = seqRow.id;

    // Template
    let tmplRow = (await client.query(
      `SELECT id FROM email_nurturing_templates WHERE sequence_id = $1 AND sort_order = $2 LIMIT 1`,
      [seqId, SORT_ORDER]
    )).rows[0];

    const html = buildHtml(imageUrl, "{{unsubscribeUrl}}");

    if (!tmplRow) {
      tmplRow = (await client.query(`
        INSERT INTO email_nurturing_templates
          (sequence_id, day_offset, sort_order, is_recurring, is_active, subject, body_html, body_text)
        VALUES($1, 0, $2, false, true, $3, $4, $5) RETURNING id
      `, [seqId, SORT_ORDER, SUBJECT, html,
          "ندوة مجانية مباشرة: كيف تستثمر بذكاء في جورجيا 2026 — سجل الآن عبر يوتيوب"]
      )).rows[0];
      console.log(`[WebinarCampaign] Template created id=${tmplRow.id}`);
    } else {
      // Refresh HTML in case image URL changed
      await client.query(
        `UPDATE email_nurturing_templates SET subject=$1, body_html=$2, updated_at=NOW() WHERE id=$3`,
        [SUBJECT, html, tmplRow.id]
      );
      console.log(`[WebinarCampaign] Template updated id=${tmplRow.id}`);
    }

    return { seqId, tmplId: tmplRow.id };
  } finally {
    client.release();
  }
}

// ── Send a single email via Resend ───────────────────────────────────────────

async function sendEmail(
  to: string,
  htmlBody: string,
  leadId: number | null = null,
): Promise<{ ok: boolean; resendId?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not configured" };

  const { Resend } = await import("resend");
  const resend   = new Resend(key);
  const unsub    = leadId ? unsubUrl(leadId) : `${APP_URL}/api/email/unsubscribe?leadId=0&token=test`;
  const finalHtml = htmlBody.replace(/\{\{unsubscribeUrl\}\}/g, unsub);

  const result = await resend.emails.send({
    from:      `${FROM_NAME} <${FROM_EMAIL}>`,
    to:        [to],
    subject:   SUBJECT,
    html:      finalHtml,
    replyTo:   FROM_EMAIL,
    headers:   { "List-Unsubscribe": `<${unsub}>` },
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, resendId: result.data?.id };
}

// ── Batch send to CRM leads ───────────────────────────────────────────────────

async function runBatchSend(templateHtml: string): Promise<void> {
  const client = await pool.connect();
  let leads: Array<{ id: number; email: string; first_name: string | null }> = [];
  try {
    const r = await client.query(`
      SELECT id, email, first_name
      FROM crm_leads
      WHERE email IS NOT NULL
        AND email != ''
        AND (opt_out_wa IS NULL OR opt_out_wa = FALSE)
      ORDER BY id ASC
    `);
    leads = r.rows;
  } finally {
    client.release();
  }

  const total   = leads.length;
  const batches = Math.ceil(total / BATCH_SIZE);
  console.log(`[WebinarCampaign][BATCH] Starting — total=${total} leads, batches=${batches}, batchSize=${BATCH_SIZE}`);

  for (let b = 0; b < batches; b++) {
    const batchNum  = b + 1;
    const chunk     = leads.slice(b * BATCH_SIZE, b * BATCH_SIZE + BATCH_SIZE);

    if (b > 0) {
      console.log(`[WebinarCampaign][BATCH] Waiting ${BATCH_DELAY_MS / 60000} min before batch ${batchNum}...`);
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }

    let success = 0;
    let failure = 0;

    for (const lead of chunk) {
      try {
        const res = await sendEmail(lead.email, templateHtml, lead.id);
        if (res.ok) {
          success++;
          console.log(`[WebinarCampaign][BATCH] ✓ Batch ${batchNum} leadId=${lead.id} email=${lead.email} resendId=${res.resendId}`);
        } else {
          failure++;
          console.warn(`[WebinarCampaign][BATCH] ✗ Batch ${batchNum} leadId=${lead.id} error=${res.error}`);
        }
      } catch (err: any) {
        failure++;
        console.error(`[WebinarCampaign][BATCH] ✗ Batch ${batchNum} leadId=${lead.id} exception=${err.message}`);
      }
    }

    console.log(
      `[WebinarCampaign][BATCH] Batch ${batchNum}/${batches} done — ` +
      `recipients=${chunk.length} success=${success} failure=${failure}`
    );
  }

  console.log(`[WebinarCampaign][BATCH] Campaign COMPLETED — total=${total} leads processed`);
  batchRunning = false;
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerWebinarCampaignRoutes(app: Express): void {

  function adminOnly(req: any, res: any): boolean {
    if (!req.session?.userId)  { res.status(401).json({ message: "Not authenticated" }); return false; }
    if (!req.session?.isAdmin) { res.status(403).json({ message: "Admin only" });         return false; }
    return true;
  }

  // ── GET status ──────────────────────────────────────────────────────────────
  app.get("/api/admin/email-campaigns/webinar/status", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    const client = await pool.connect();
    try {
      const seq  = (await client.query(`SELECT * FROM email_nurturing_sequences WHERE name=$1 LIMIT 1`, [CAMPAIGN_NAME])).rows[0] ?? null;
      const tmpl = seq ? (await client.query(`SELECT id, subject, sort_order, is_active, updated_at FROM email_nurturing_templates WHERE sequence_id=$1 AND sort_order=$2 LIMIT 1`, [seq.id, SORT_ORDER])).rows[0] ?? null : null;
      const cnt  = (await client.query(`SELECT COUNT(*) AS c FROM crm_leads WHERE email IS NOT NULL AND email != '' AND (opt_out_wa IS NULL OR opt_out_wa = FALSE)`)).rows[0].c;
      res.json({ campaign: seq, template: tmpl, eligibleLeads: parseInt(cnt), batchRunning, imageLocal: fs.existsSync(IMAGE_LOCAL) });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
    finally { client.release(); }
  });

  // ── POST setup-and-test ─────────────────────────────────────────────────────
  app.post("/api/admin/email-campaigns/webinar/setup-and-test", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      console.log("[WebinarCampaign] Starting setup-and-test...");

      // 1. Get image URL (served from client/public/webinar-georgia-2026.jpeg)
      const imageUrl = getImageUrl();

      // 2. Ensure DB records
      const { tmplId } = await ensureCampaignInDb(imageUrl);

      // 3. Build HTML using the stored image URL
      const html = buildHtml(imageUrl, "{{unsubscribeUrl}}");

      // 4. Send TEST email only to kinglikeluxury@gmail.com
      const result = await sendEmail(TEST_EMAIL, html, null);

      if (!result.ok) {
        console.error(`[WebinarCampaign] Test send FAILED: ${result.error}`);
        return res.status(500).json({ ok: false, error: result.error });
      }

      console.log(`[WebinarCampaign] TEST EMAIL sent → ${TEST_EMAIL} resendId=${result.resendId}`);
      res.json({
        ok: true,
        message: `Test email sent to ${TEST_EMAIL}`,
        resendId:  result.resendId,
        imageUrl,
        templateId: tmplId,
        note: "No CRM contacts were emailed. Await manual approval before calling /send-approved.",
      });
    } catch (err: any) {
      console.error("[WebinarCampaign] setup-and-test error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST send-approved (batch to all CRM leads) ──────────────────────────────
  app.post("/api/admin/email-campaigns/webinar/send-approved", async (req: any, res) => {
    if (!adminOnly(req, res)) return;

    if (batchRunning) {
      return res.status(409).json({ ok: false, message: "Batch send already in progress." });
    }

    const client = await pool.connect();
    let imageUrl = "";
    let html     = "";
    try {
      const tmpl = (await client.query(`
        SELECT t.body_html FROM email_nurturing_templates t
        JOIN email_nurturing_sequences s ON s.id = t.sequence_id
        WHERE s.name=$1 AND t.sort_order=$2 LIMIT 1
      `, [CAMPAIGN_NAME, SORT_ORDER])).rows[0];

      if (!tmpl) {
        return res.status(404).json({ ok: false, message: "Campaign template not found. Run /setup-and-test first." });
      }
      html = tmpl.body_html;
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    } finally {
      client.release();
    }

    batchRunning = true;
    console.log("[WebinarCampaign] BATCH SEND APPROVED — starting in background...");

    // Run batch asynchronously — response returns immediately
    runBatchSend(html).catch(err => {
      console.error("[WebinarCampaign][BATCH] Fatal error:", err.message);
      batchRunning = false;
    });

    res.json({
      ok: true,
      message: "Batch send started. Check server logs for progress. Batches of 10, every 10 minutes.",
      batchSize: BATCH_SIZE,
      delayMinutes: BATCH_DELAY_MS / 60000,
    });
  });
}
