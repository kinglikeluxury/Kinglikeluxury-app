/**
 * CRM Lead Email Notification Service
 *
 * Sends two emails when a new CRM lead is created:
 *   A) Admin notification  → kinglikeluxury@gmail.com
 *   C) Client welcome      → lead email (if present)
 *
 * Employee notification (B) is handled separately by leadAssignmentNotificationService
 * which also fires the in-app notification — we do not duplicate it here.
 *
 * Duplicate protection: each template sent at most once per lead,
 * tracked in crm_lead_email_log table.
 */

import { pool } from "./db";
import { Resend } from "resend";

const ADMIN_EMAIL = "kinglikeluxury@gmail.com";
const FROM        = "Kinglike Luxury <info@kinglikeluxury.app>";
const APP_URL     = process.env.APP_URL || "https://www.kinglikeluxury.app";

// ── Table setup ───────────────────────────────────────────────────────────────

export async function ensureCrmLeadEmailLogTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_lead_email_log (
        id                  SERIAL PRIMARY KEY,
        lead_id             INTEGER  NOT NULL,
        recipient_type      TEXT     NOT NULL,
        recipient_email     TEXT,
        template_name       TEXT     NOT NULL,
        status              TEXT     NOT NULL,
        provider_message_id TEXT,
        error_message       TEXT,
        sent_at             TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_lead_email_log_lead_id
        ON crm_lead_email_log(lead_id)
    `);
    console.log("[CrmLeadEmail] crm_lead_email_log table ensured ✓");
  } catch (e: any) {
    console.error("[CrmLeadEmail] ensureCrmLeadEmailLogTable error:", e.message);
  } finally {
    client.release();
  }
}

// ── Duplicate guard ───────────────────────────────────────────────────────────

async function alreadySent(leadId: number, templateName: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT id FROM crm_lead_email_log
       WHERE lead_id=$1 AND template_name=$2 AND status='sent'
       LIMIT 1`,
      [leadId, templateName]
    );
    return r.rows.length > 0;
  } finally {
    client.release();
  }
}

// ── Log helper ────────────────────────────────────────────────────────────────

async function logEntry(params: {
  leadId:            number;
  recipientType:     string;
  recipientEmail:    string | null;
  templateName:      string;
  status:            string;
  providerMessageId?: string | null;
  errorMessage?:     string | null;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO crm_lead_email_log
         (lead_id, recipient_type, recipient_email, template_name, status, provider_message_id, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        params.leadId, params.recipientType, params.recipientEmail,
        params.templateName, params.status,
        params.providerMessageId ?? null, params.errorMessage ?? null,
      ]
    );
  } catch (e: any) {
    console.error("[CrmLeadEmail] logEntry error:", e.message);
  } finally {
    client.release();
  }
}

// ── Resend helper ─────────────────────────────────────────────────────────────

async function sendViaResend(
  to: string, subject: string, html: string
): Promise<{ id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { error: "RESEND_API_KEY not configured" };
  if (!to?.trim()) return { error: "No recipient email" };
  try {
    const resend = new Resend(key);
    const result = await resend.emails.send({ from: FROM, to, subject, html });
    if (result.error) return { error: result.error.message };
    return { id: result.data?.id ?? undefined };
  } catch (e: any) {
    return { error: e.message };
  }
}

// ── Email builders ────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta Ads", meta_ads: "Meta Ads",
  website: "Website", whatsapp: "WhatsApp",
  excel: "Excel Import", excel_import: "Excel Import",
  manual: "Manual Entry",
};
function fmtSource(s: string | null | undefined): string {
  if (!s) return "—";
  return SOURCE_LABELS[s] || s;
}

function tableRow(label: string, val: string | null | undefined): string {
  if (!val) return "";
  return `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;width:38%">${label}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#005476;font-weight:600">${val}</td>
    </tr>`;
}

function buildAdminEmail(lead: {
  id: number;
  name: string;
  phone: string;
  email: string | null | undefined;
  source: string;
  assignedEmployee: string;
  originCountry: string | null | undefined;
  interestedCountry: string | null | undefined;
  projectInterest: string | null | undefined;
  budget: string | null | undefined;
}): string {
  const leadLink = `${APP_URL}/admin/crm/${lead.id}`;
  return `
<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f9f9;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f9;padding:32px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,84,118,.10)">

      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:28px 32px;text-align:center">
          <div style="font-size:36px;margin-bottom:8px">🎯</div>
          <h1 style="color:#fff;margin:0;font-size:20px;font-weight:800">New CRM Lead Registered</h1>
          <p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:13px">Kinglike Luxury — Admin Notification</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:28px 32px">
          <div style="background:#f9fafb;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
            <table style="width:100%;border-collapse:collapse">
              ${tableRow("👤 Lead Name",        lead.name)}
              ${tableRow("📞 Phone",            lead.phone)}
              ${tableRow("📧 Email",            lead.email || null)}
              ${tableRow("🌍 Source",           lead.source)}
              ${tableRow("👔 Assigned To",      lead.assignedEmployee)}
              ${tableRow("🏠 Origin Country",   lead.originCountry || null)}
              ${tableRow("📍 Interested In",    lead.interestedCountry || null)}
              ${tableRow("🏗️ Project Interest", lead.projectInterest || null)}
              ${tableRow("💰 Budget",           lead.budget || null)}
            </table>
          </div>

          <div style="text-align:center;margin-top:24px">
            <a href="${leadLink}"
               style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);
                      color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;
                      font-weight:bold;font-size:14px">
              View Lead in CRM →
            </a>
          </div>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f0f9f9;padding:16px;text-align:center;color:#bbb;font-size:11px">
          <p style="margin:0">© Kinglike Luxury Real Estate Platform</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

function buildClientWelcomeEmail(displayName: string): string {
  const name = displayName || "عزيزنا";
  return `
<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f9f9;font-family:Arial,Helvetica,sans-serif;direction:rtl">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f9;padding:32px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,84,118,.10)">

      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#005476 0%,#3bcac4 100%);padding:36px 32px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:28px;font-weight:900;letter-spacing:-0.5px">Kinglike Luxury</h1>
          <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:13px;letter-spacing:1px;text-transform:uppercase">Invest with Vision</p>
          <p style="color:rgba(255,255,255,.70);margin:8px 0 0;font-size:12px">Georgia &bull; Batumi &bull; Tbilisi</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:36px 32px">
          <h2 style="color:#005476;margin-top:0;font-size:20px">أهلاً ${name} 👋</h2>
          <p style="color:#444;font-size:15px;line-height:1.9">
            شكراً لتواصلك مع <strong>Kinglike Luxury</strong>.
          </p>
          <p style="color:#444;font-size:15px;line-height:1.9">
            تم استلام طلبك بنجاح، وسيقوم أحد مستشارينا العقاريين بالتواصل معك لمساعدتك
            في اختيار الفرصة العقارية الأنسب لك.
          </p>
          <p style="color:#444;font-size:15px;line-height:1.9">
            نحن نساعد عملاءنا في التملك والاستثمار العقاري في جورجيا، تركيا،
            قبرص الشمالية، والإمارات.
          </p>
          <div style="background:#f0f9f9;border-right:4px solid #3bcac4;padding:16px 20px;
                      margin:24px 0;border-radius:0 8px 8px 0">
            <p style="color:#005476;font-weight:700;margin:0 0 4px;font-size:14px">
              Kinglike Luxury — استثمر بثقة
            </p>
            <p style="color:#555;font-size:13px;margin:0">فريقنا جاهز للمساعدة في أي وقت.</p>
          </div>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#005476;padding:18px;text-align:center">
          <p style="color:rgba(255,255,255,.7);margin:0;font-size:11px">
            Kinglike Luxury &middot;
            <a href="mailto:info@kinglikeluxury.app" style="color:#3bcac4;text-decoration:none">
              info@kinglikeluxury.app
            </a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface NewLeadEmailPayload {
  id:                 number;
  fullName?:          string | null;
  firstName?:         string | null;
  lastName?:          string | null;
  phone?:             string | null;
  email?:             string | null;
  leadSource?:        string | null;
  country?:           string | null;
  interestedCountry?: string | null;
  projectInterest?:   string | null;
  budget?:            string | null;
  assignedTo?:        number | null;
}

/**
 * sendNewLeadNotifications
 *
 * Fires admin + client emails for a freshly created CRM lead.
 * Idempotent — each template is sent at most once per lead.
 * Always fire-and-forget (.catch(() => {})) from callers.
 */
export async function sendNewLeadNotifications(lead: NewLeadEmailPayload): Promise<void> {
  const leadId   = lead.id;
  const leadName = (
    lead.fullName?.trim() ||
    [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
    "—"
  );
  const leadPhone = lead.phone || "—";
  const source    = fmtSource(lead.leadSource);

  // Resolve assigned employee name
  let agentName = "Unassigned";
  if (lead.assignedTo) {
    const c = await pool.connect();
    try {
      const r = await c.query(
        "SELECT username FROM users WHERE id=$1 LIMIT 1",
        [lead.assignedTo]
      );
      if (r.rows.length) agentName = r.rows[0].username;
    } finally {
      c.release();
    }
  }

  // ── A. Admin email ─────────────────────────────────────────────────────────
  const adminDupe = await alreadySent(leadId, "admin_new_lead");
  if (adminDupe) {
    console.log(`[Email] Admin notification already sent leadId=${leadId} — skip duplicate`);
  } else {
    const html = buildAdminEmail({
      id:              leadId,
      name:            leadName,
      phone:           leadPhone,
      email:           lead.email,
      source,
      assignedEmployee: agentName,
      originCountry:   lead.country,
      interestedCountry: lead.interestedCountry,
      projectInterest: lead.projectInterest,
      budget:          lead.budget,
    });
    console.log(`[Email] Sending admin new-lead notification leadId=${leadId} → ${ADMIN_EMAIL}`);
    const r = await sendViaResend(
      ADMIN_EMAIL,
      "New CRM Lead Registered — Kinglike Luxury",
      html
    );
    if (r.error) {
      console.error(`[Email] Admin notification FAILED leadId=${leadId}: ${r.error}`);
      await logEntry({ leadId, recipientType: "admin", recipientEmail: ADMIN_EMAIL, templateName: "admin_new_lead", status: "failed", errorMessage: r.error });
    } else {
      console.log(`[Email] Admin notification SENT leadId=${leadId} msgId=${r.id}`);
      await logEntry({ leadId, recipientType: "admin", recipientEmail: ADMIN_EMAIL, templateName: "admin_new_lead", status: "sent", providerMessageId: r.id });
    }
  }

  // ── C. Client welcome email ────────────────────────────────────────────────
  const clientEmail = lead.email?.trim();
  const clientDupe  = await alreadySent(leadId, "client_welcome");
  if (clientDupe) {
    console.log(`[Email] Client welcome already sent leadId=${leadId} — skip duplicate`);
  } else if (!clientEmail) {
    console.log(`[Email] Client has no email leadId=${leadId} — skip client welcome`);
    await logEntry({ leadId, recipientType: "client", recipientEmail: null, templateName: "client_welcome", status: "skipped_no_email" });
  } else {
    const displayName = lead.firstName?.trim() || lead.fullName?.trim() || "";
    const html = buildClientWelcomeEmail(displayName);
    console.log(`[Email] Sending client welcome leadId=${leadId} → ${clientEmail}`);
    const r = await sendViaResend(
      clientEmail,
      "أهلاً بك في Kinglike Luxury 🏡",
      html
    );
    if (r.error) {
      console.error(`[Email] Client welcome FAILED leadId=${leadId}: ${r.error}`);
      await logEntry({ leadId, recipientType: "client", recipientEmail: clientEmail, templateName: "client_welcome", status: "failed", errorMessage: r.error });
    } else {
      console.log(`[Email] Client welcome SENT leadId=${leadId} to=${clientEmail} msgId=${r.id}`);
      await logEntry({ leadId, recipientType: "client", recipientEmail: clientEmail, templateName: "client_welcome", status: "sent", providerMessageId: r.id });
    }
  }
}

/**
 * getCrmLeadEmailLog
 * Returns all email log entries for a given lead (admin panel use).
 */
export async function getCrmLeadEmailLog(leadId: number): Promise<any[]> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT * FROM crm_lead_email_log WHERE lead_id=$1 ORDER BY sent_at DESC`,
      [leadId]
    );
    return r.rows;
  } finally {
    client.release();
  }
}
