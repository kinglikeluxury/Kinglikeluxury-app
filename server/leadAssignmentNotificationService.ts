/**
 * Lead Assignment Notification Service
 *
 * Sends an email + in-app notification to an agent whenever a CRM lead
 * is assigned or reassigned to them. Zero dependencies on WhatsApp,
 * Meta, AI Qualification, or Email Marketing systems.
 *
 * Exported:
 *   notifyAgentOfLeadAssignment  — single lead (manual, auto, reassign)
 *   notifyAgentOfBulkAssignment  — multiple leads (bulk-update, import, backfill)
 */

import { pool } from "./db";
import { sendEmail } from "./notificationService";
import { storage } from "./storage";

const APP_URL = process.env.APP_URL || "https://www.kinglikeluxury.app";

const SOURCE_LABELS: Record<string, string> = {
  meta:         "Meta Ads",
  meta_ads:     "Meta Ads",
  website:      "Website",
  whatsapp:     "WhatsApp",
  excel:        "Excel Import",
  excel_import: "Excel Import",
  manual:       "Manual Entry",
};

function fmtSource(s: string | null | undefined): string {
  if (!s) return "—";
  return SOURCE_LABELS[s] || s;
}

function fmtDate(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: "Asia/Tbilisi",
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Email builders ─────────────────────────────────────────────────────────

function buildSingleAssignmentEmail(p: {
  agentName: string;
  leadId: number;
  leadName: string;
  leadPhone: string;
  leadEmail: string;
  leadSource: string;
  assignedAt: string;
  leadLink: string;
}): string {
  const emailRow = p.leadEmail
    ? `<tr style="border-bottom:1px solid #e8f4f8">
        <td style="padding:10px 0;color:#888;font-weight:600;width:45%">📧 البريد الإلكتروني</td>
        <td style="padding:10px 0;color:#005476">${p.leadEmail}</td>
       </tr>`
    : "";

  return `
<div style="background:#f0f9f9;padding:40px 20px;font-family:Arial,Helvetica,sans-serif;direction:rtl">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;
              box-shadow:0 4px 24px rgba(0,84,118,0.10)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);
                padding:48px 40px;text-align:center">
      <div style="font-size:40px;margin-bottom:10px">🔥</div>
      <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800;letter-spacing:-0.3px">
        Lead جديد بانتظار المتابعة
      </h1>
      <p style="color:rgba(255,255,255,0.80);margin:8px 0 0;font-size:14px">
        Kinglike Luxury — نظام إدارة العملاء
      </p>
    </div>

    <!-- Body -->
    <div style="padding:40px">
      <p style="color:#005476;font-size:16px;font-weight:600;margin-top:0">
        مرحباً ${p.agentName}،
      </p>
      <p style="color:#555;font-size:15px;line-height:1.8;margin-bottom:24px">
        تم تعيين عميل جديد لك على منصة Kinglike Luxury.
        يُرجى التواصل معه في أقرب وقت ممكن.
      </p>

      <!-- Lead Details Card -->
      <div style="background:#f8fbfd;border:1px solid #daeef5;border-radius:12px;
                  padding:24px;margin-bottom:28px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr style="border-bottom:1px solid #e8f4f8">
            <td style="padding:10px 0;color:#888;font-weight:600;width:45%">👤 اسم العميل</td>
            <td style="padding:10px 0;color:#005476;font-weight:700">${p.leadName}</td>
          </tr>
          <tr style="border-bottom:1px solid #e8f4f8">
            <td style="padding:10px 0;color:#888;font-weight:600">📞 رقم الهاتف</td>
            <td style="padding:10px 0;color:#005476;font-weight:700;
                       direction:ltr;text-align:right">${p.leadPhone}</td>
          </tr>
          ${emailRow}
          <tr style="border-bottom:1px solid #e8f4f8">
            <td style="padding:10px 0;color:#888;font-weight:600">📌 المصدر</td>
            <td style="padding:10px 0;color:#005476">${p.leadSource}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#888;font-weight:600">🕐 وقت التعيين</td>
            <td style="padding:10px 0;color:#005476">${p.assignedAt}</td>
          </tr>
        </table>
      </div>

      <!-- CTA Button -->
      <div style="text-align:center;margin:32px 0 8px">
        <a href="${p.leadLink}"
           style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);
                  color:#fff;padding:16px 52px;border-radius:10px;text-decoration:none;
                  font-weight:bold;font-size:16px;letter-spacing:0.3px">
          فتح ملف العميل ←
        </a>
      </div>

      <p style="color:#aaa;font-size:12px;text-align:center;margin-top:28px;margin-bottom:0">
        هذا إشعار تلقائي من نظام CRM — Kinglike Luxury
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f0f9f9;padding:20px;text-align:center;color:#bbb;font-size:12px">
      <p style="margin:0">© Kinglike Luxury Real Estate Platform</p>
    </div>
  </div>
</div>`;
}

function buildBulkAssignmentEmail(p: {
  agentName: string;
  leadCount: number;
  assignedAt: string;
  crmLink: string;
}): string {
  return `
<div style="background:#f0f9f9;padding:40px 20px;font-family:Arial,Helvetica,sans-serif;direction:rtl">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;
              box-shadow:0 4px 24px rgba(0,84,118,0.10)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);
                padding:48px 40px;text-align:center">
      <div style="font-size:40px;margin-bottom:10px">📋</div>
      <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800">
        تم تعيين عملاء جدد لك
      </h1>
      <p style="color:rgba(255,255,255,0.80);margin:8px 0 0;font-size:14px">
        Kinglike Luxury — نظام إدارة العملاء
      </p>
    </div>

    <!-- Body -->
    <div style="padding:40px">
      <p style="color:#005476;font-size:16px;font-weight:600;margin-top:0">
        مرحباً ${p.agentName}،
      </p>

      <!-- Count Card -->
      <div style="background:#f8fbfd;border:1px solid #daeef5;border-radius:12px;
                  padding:32px;text-align:center;margin:24px 0">
        <div style="font-size:56px;font-weight:800;color:#3bcac4;line-height:1">
          ${p.leadCount}
        </div>
        <div style="font-size:17px;color:#005476;font-weight:600;margin-top:8px">
          عميل جديد تم تعيينه لك
        </div>
        <div style="font-size:13px;color:#aaa;margin-top:6px">${p.assignedAt}</div>
      </div>

      <p style="color:#555;font-size:15px;line-height:1.8;text-align:center">
        يُرجى الاطلاع على قائمة العملاء والبدء في المتابعة.
      </p>

      <!-- CTA Button -->
      <div style="text-align:center;margin:32px 0 8px">
        <a href="${p.crmLink}"
           style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);
                  color:#fff;padding:16px 52px;border-radius:10px;text-decoration:none;
                  font-weight:bold;font-size:16px">
          فتح قائمة العملاء ←
        </a>
      </div>

      <p style="color:#aaa;font-size:12px;text-align:center;margin-top:28px;margin-bottom:0">
        هذا إشعار تلقائي من نظام CRM — Kinglike Luxury
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f0f9f9;padding:20px;text-align:center;color:#bbb;font-size:12px">
      <p style="margin:0">© Kinglike Luxury Real Estate Platform</p>
    </div>
  </div>
</div>`;
}

// ─── Public exports ──────────────────────────────────────────────────────────

/**
 * Notify agent of a SINGLE lead assignment.
 * Used for: manual create, PATCH reassign, reassign endpoint, Meta webhook.
 * Always fire-and-forget — never awaited in the caller.
 */
export async function notifyAgentOfLeadAssignment(params: {
  leadId: number;
  leadName: string | null | undefined;
  leadPhone: string | null | undefined;
  leadEmail: string | null | undefined;
  leadSource: string | null | undefined;
  assignedToUserId: number;
  context?: "new" | "reassigned" | "imported";
}): Promise<void> {
  const { leadId, leadName, leadPhone, leadEmail, leadSource, assignedToUserId } = params;
  try {
    const r = await pool.query<{ id: number; email: string | null; username: string }>(
      "SELECT id, email, username FROM users WHERE id=$1 LIMIT 1",
      [assignedToUserId]
    );
    const agent = r.rows[0];
    if (!agent) {
      console.warn(`[LeadAssignmentNotif] Agent userId=${assignedToUserId} not found`);
      return;
    }

    const leadLink   = `${APP_URL}/admin/crm/${leadId}`;
    const assignedAt = fmtDate(new Date());
    const name       = leadName  || "—";
    const phone      = leadPhone || "—";
    const emailVal   = leadEmail || "";
    const source     = fmtSource(leadSource);

    // ── Email ────────────────────────────────────────────────────────────────
    if (agent.email?.trim()) {
      const html = buildSingleAssignmentEmail({
        agentName: agent.username,
        leadId,
        leadName: name,
        leadPhone: phone,
        leadEmail: emailVal,
        leadSource: source,
        assignedAt,
        leadLink,
      });
      await sendEmail({
        to: agent.email,
        subject: "🔥 Lead جديد بانتظار المتابعة",
        html,
      });
    } else {
      console.warn(`[LeadAssignmentNotif] Agent ${agent.username} has no email — skipping email`);
    }

    // ── In-app notification ──────────────────────────────────────────────────
    await storage.createUserNotification({
      userId:  assignedToUserId,
      type:    "lead_assigned",
      title:   "🔥 Lead جديد بانتظار المتابعة",
      message: `تم تعيين العميل ${name} (${phone}) لك. المصدر: ${source}`,
      data:    { leadId, leadLink },
      isRead:  false,
    });

    console.log(`[LeadAssignmentNotif] Notified agent=${agent.username} for leadId=${leadId}`);
  } catch (err: any) {
    console.error(`[LeadAssignmentNotif] Failed for leadId=${leadId}: ${err.message}`);
  }
}

/**
 * Notify agent of a BULK lead assignment (import, backfill, bulk-update).
 * Sends one summary email + one in-app notification instead of N individual ones.
 * Always fire-and-forget — never awaited in the caller.
 */
export async function notifyAgentOfBulkAssignment(params: {
  assignedToUserId: number;
  leadCount: number;
  leadIds?: number[];
}): Promise<void> {
  const { assignedToUserId, leadCount, leadIds } = params;
  if (leadCount <= 0) return;
  try {
    const r = await pool.query<{ id: number; email: string | null; username: string }>(
      "SELECT id, email, username FROM users WHERE id=$1 LIMIT 1",
      [assignedToUserId]
    );
    const agent = r.rows[0];
    if (!agent) return;

    const crmLink    = `${APP_URL}/admin/crm`;
    const assignedAt = fmtDate(new Date());

    // ── Email ────────────────────────────────────────────────────────────────
    if (agent.email?.trim()) {
      const html = buildBulkAssignmentEmail({
        agentName: agent.username,
        leadCount,
        assignedAt,
        crmLink,
      });
      await sendEmail({
        to: agent.email,
        subject: `📋 تم تعيين ${leadCount} عميل جديد لك`,
        html,
      });
    }

    // ── In-app notification ──────────────────────────────────────────────────
    await storage.createUserNotification({
      userId:  assignedToUserId,
      type:    "leads_bulk_assigned",
      title:   `📋 تم تعيين ${leadCount} عميل جديد لك`,
      message: `تم تعيين ${leadCount} عميل جديد إليك في نظام CRM. يُرجى الاطلاع على القائمة.`,
      data:    { leadCount, leadIds: leadIds?.slice(0, 50), crmLink },
      isRead:  false,
    });

    console.log(`[LeadAssignmentNotif] Bulk-notified agent=${agent.username} for ${leadCount} leads`);
  } catch (err: any) {
    console.error(`[LeadAssignmentNotif] Bulk failed for userId=${assignedToUserId}: ${err.message}`);
  }
}
