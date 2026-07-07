/**
 * CRM Task Reminder Service
 * Sends WhatsApp + Email notifications to assigned employees when a task's due time arrives.
 * Runs every 60 seconds. Protects against duplicates via reminder_sent_at column.
 * Read-only on leads — only updates crm_tasks.reminder_sent_at.
 */

import { pool } from "./db";
import { sendQualTextMessage } from "./interactiveMessageHelper";
import { Resend } from "resend";

// ── Employee contact maps (fallback when DB user.email / phone is unavailable) ─

const EMPLOYEE_PHONES: Record<string, string> = {
  samer: "+995511746491",
  fadi:  "+995591888863",
};

const EMPLOYEE_EMAILS: Record<string, string> = {
  samer: "kinglikeluxury.sales.ge@gmail.com",
  fadi:  "kinglikeluxury.fadi@gmail.com",
};

// ── Resend client (lazy singleton) ─────────────────────────────────────────────

let _resend: Resend | null = null;
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

// ── Additive DB migration ──────────────────────────────────────────────────────

export async function ensureCrmTaskReminderColumn(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE crm_tasks
      ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP
    `);
    console.log("[CrmReminder] reminder_sent_at column ensured ✓");
  } catch (e: any) {
    console.error("[CrmReminder] ensureCrmTaskReminderColumn error:", e.message);
  } finally {
    client.release();
  }
}

// ── Time parsing ───────────────────────────────────────────────────────────────

function parseDueAt(dueDate: string, dueTime: string): Date | null {
  if (!dueDate?.trim() || !dueTime?.trim()) return null;

  let hours = 0;
  let minutes = 0;

  // "HH:MM" — from <input type="time"> (24-hour)
  const h24 = dueTime.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    hours   = parseInt(h24[1], 10);
    minutes = parseInt(h24[2], 10);
  } else {
    // "H:MM AM/PM" or "HH:MM AM/PM"
    const h12 = dueTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (h12) {
      hours   = parseInt(h12[1], 10);
      minutes = parseInt(h12[2], 10);
      const isPM = h12[3].toUpperCase() === "PM";
      if (isPM && hours !== 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
    } else {
      return null;
    }
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  const d = new Date(`${dueDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
}

// ── Employee resolution ────────────────────────────────────────────────────────

function resolveEmployeePhone(assigneeName: string, dbPhone?: string | null): string | null {
  // Prefer the phone number stored in the users table (covers all employees)
  if (dbPhone?.trim()) return dbPhone.trim();
  // Fall back to hardcoded map for legacy entries
  const lower = assigneeName.toLowerCase();
  for (const [key, phone] of Object.entries(EMPLOYEE_PHONES)) {
    if (lower.includes(key)) return phone;
  }
  return null;
}

function resolveEmployeeEmailFallback(assigneeName: string): string | null {
  const lower = assigneeName.toLowerCase();
  for (const [key, email] of Object.entries(EMPLOYEE_EMAILS)) {
    if (lower.includes(key)) return email;
  }
  return null;
}

// ── Email reminder sender ──────────────────────────────────────────────────────

async function sendReminderEmail(opts: {
  to: string;
  taskId: number;
  leadId: number;
  leadName: string;
  leadPhone: string | null;
  taskTitle: string;
  taskDescription: string | null;
  dueLabel: string;
  assigneeName: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[CrmReminder] email skipped taskId=${opts.taskId} — RESEND_API_KEY not set`);
    return false;
  }

  const crmUrl = `https://kinglikeluxury.app/admin/crm/${opts.leadId}`;
  const descRow = opts.taskDescription?.trim()
    ? `<tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px;width:36%">Description</td><td style="padding:7px 0;color:#374151;font-size:14px">${opts.taskDescription.trim()}</td></tr>`
    : "";

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;background:#f0f9f9;padding:32px 16px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,84,118,0.10)">
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:28px 32px">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:800">🔔 Task Reminder</h1>
      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px">Kinglike Luxury CRM — Action Required</p>
    </div>
    <div style="padding:28px 32px">
      <p style="color:#374151;font-size:15px;margin:0 0 20px">Hi <strong>${opts.assigneeName}</strong>, a task assigned to you is now due:</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px;width:36%">Lead</td><td style="padding:7px 0;font-weight:700;color:#005476;font-size:15px">${opts.leadName}</td></tr>
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Phone</td><td style="padding:7px 0;color:#111827;font-size:14px">${opts.leadPhone ?? "—"}</td></tr>
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Task</td><td style="padding:7px 0;font-weight:700;color:#111827;font-size:14px">${opts.taskTitle}</td></tr>
        ${descRow}
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Due</td><td style="padding:7px 0;color:#dc2626;font-weight:700;font-size:14px">${opts.dueLabel}</td></tr>
      </table>
      <div style="text-align:center;margin-top:24px">
        <a href="${crmUrl}" style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">Open Lead in CRM →</a>
      </div>
    </div>
    <div style="background:#005476;padding:14px 32px;text-align:center">
      <p style="color:rgba(255,255,255,0.65);margin:0;font-size:12px">Kinglike Luxury CRM · info@kinglikeluxury.app</p>
    </div>
  </div>
</div>`;

  try {
    const result = await resend.emails.send({
      from:    "Kinglike Luxury CRM <info@kinglikeluxury.app>",
      to:      opts.to,
      subject: `🔔 Task Reminder — ${opts.leadName} | ${opts.taskTitle}`,
      html,
    });
    if (result.error) {
      console.error(`[CrmReminder] email ✗ taskId=${opts.taskId} to=${opts.to}:`, result.error.message);
      return false;
    }
    console.log(`[CrmReminder] email ✓ taskId=${opts.taskId} → ${opts.to} | id=${result.data?.id ?? "—"}`);
    return true;
  } catch (e: any) {
    console.error(`[CrmReminder] email ✗ taskId=${opts.taskId} exception:`, e.message);
    return false;
  }
}

// ── Core reminder runner ───────────────────────────────────────────────────────

async function runTaskReminders(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      id: number;
      lead_id: number;
      title: string;
      description: string | null;
      due_date: string;
      due_time: string;
      lead_name: string;
      lead_phone: string | null;
      lead_assignee_name: string | null;
      lead_assignee_email: string | null;
      lead_assignee_phone: string | null;
    }>(`
      SELECT
        ct.id,
        ct.lead_id,
        ct.title,
        ct.description,
        ct.due_date,
        ct.due_time,
        COALESCE(
          NULLIF(TRIM(cl.full_name), ''),
          NULLIF(TRIM(COALESCE(cl.first_name,'') || ' ' || COALESCE(cl.last_name,'')), ''),
          'عميل'
        ) AS lead_name,
        cl.phone                    AS lead_phone,
        lu.username                 AS lead_assignee_name,
        lu.email                    AS lead_assignee_email,
        lu.phone_number             AS lead_assignee_phone
      FROM crm_tasks ct
      LEFT JOIN crm_leads cl ON cl.id = ct.lead_id
      LEFT JOIN users      lu ON lu.id = cl.assigned_to
      WHERE ct.completed_at    IS NULL
        AND ct.reminder_sent_at IS NULL
        AND ct.due_date IS NOT NULL AND ct.due_date != ''
        AND ct.due_time IS NOT NULL AND ct.due_time != ''
    `);

    if (rows.length === 0) return;

    const now         = new Date();
    const windowStart = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    for (const row of rows) {
      const dueAt = parseDueAt(row.due_date, row.due_time);
      if (!dueAt) continue;
      if (dueAt > now) continue;
      if (dueAt < windowStart) continue;

      // ── Resolve employee ──────────────────────────────────────────────────────
      if (!row.lead_assignee_name) {
        console.warn(`[CrmReminder] taskId=${row.id} leadId=${row.lead_id} — no assignee on lead, skipping`);
        continue;
      }

      const employeePhone = resolveEmployeePhone(row.lead_assignee_name, row.lead_assignee_phone);
      if (!employeePhone) {
        console.warn(`[CrmReminder] taskId=${row.id} — no WA phone for "${row.lead_assignee_name}" (db or map), skipping`);
        continue;
      }

      // Prefer DB email; fall back to hardcoded map
      const employeeEmail: string | null =
        row.lead_assignee_email?.trim() ||
        resolveEmployeeEmailFallback(row.lead_assignee_name);

      // ── Build shared content ──────────────────────────────────────────────────
      const dueLabel  = `${row.due_date} — ${row.due_time}`;
      const descBlock = row.description?.trim()
        ? `\nالوصف:\n${row.description.trim()}\n`
        : "";

      const waMessage =
        `🔔 تذكير مهمة CRM\n\n` +
        `العميل: ${row.lead_name}\n` +
        `الهاتف: ${row.lead_phone ?? "—"}\n\n` +
        `المهمة:\n${row.title}\n` +
        descBlock +
        `\nوقت التواصل:\n${dueLabel}\n\n` +
        `رابط العميل:\nhttps://kinglikeluxury.app/admin/crm/${row.lead_id}\n\n` +
        `يرجى التواصل مع العميل الآن.`;

      // ── Send via both channels ─────────────────────────────────────────────────
      let waSent    = false;
      let emailSent = false;

      try {
        const waResult = await sendQualTextMessage(employeePhone, waMessage);
        waSent = waResult.success;
        if (!waSent) {
          console.error(`[CrmReminder] WA ✗ taskId=${row.id}: ${waResult.error}`);
        } else {
          console.log(`[CrmReminder] WA ✓ taskId=${row.id} → ${row.lead_assignee_name} (${employeePhone}) | wamid=${waResult.wamid ?? "—"}`);
        }
      } catch (e: any) {
        console.error(`[CrmReminder] WA ✗ taskId=${row.id} exception:`, e.message);
      }

      if (employeeEmail) {
        emailSent = await sendReminderEmail({
          to:              employeeEmail,
          taskId:          row.id,
          leadId:          row.lead_id,
          leadName:        row.lead_name,
          leadPhone:       row.lead_phone,
          taskTitle:       row.title,
          taskDescription: row.description,
          dueLabel,
          assigneeName:    row.lead_assignee_name,
        });
      } else {
        console.warn(`[CrmReminder] email skipped taskId=${row.id} — no email for "${row.lead_assignee_name}"`);
      }

      // ── Mark sent if at least one channel delivered ───────────────────────────
      if (waSent || emailSent) {
        await client.query(
          `UPDATE crm_tasks SET reminder_sent_at = NOW() WHERE id = $1`,
          [row.id]
        );
        console.log(
          `[CrmReminder] ✓ taskId=${row.id} marked sent | WA=${waSent} email=${emailSent}`
        );
      } else {
        console.error(
          `[CrmReminder] ✗ taskId=${row.id} — both channels failed, will retry next tick`
        );
      }
    }
  } catch (e: any) {
    console.error("[CrmReminder] runTaskReminders error:", e.message);
  } finally {
    client.release();
  }
}

// ── Public: start the scheduler ────────────────────────────────────────────────

let _running = false;

export function startCrmTaskReminderScheduler(): void {
  ensureCrmTaskReminderColumn()
    .then(() => runTaskReminders())
    .catch(() => {});

  setInterval(() => {
    if (_running) return;
    _running = true;
    runTaskReminders()
      .catch(e => console.error("[CrmReminder] Scheduler tick error:", e.message))
      .finally(() => { _running = false; });
  }, 60_000);

  console.log("[CrmReminder] Scheduler started — checks every 1 min");
}
