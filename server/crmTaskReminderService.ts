/**
 * CRM Task Reminder Service
 * Sends WhatsApp notifications to assigned employees when a task's due time arrives.
 * Runs every 60 seconds. Protects against duplicates via reminder_sent_at column.
 * Read-only on leads — only updates crm_tasks.reminder_sent_at.
 */

import { pool } from "./db";
import { sendQualTextMessage } from "./interactiveMessageHelper";

// ── Employee WhatsApp phone map ────────────────────────────────────────────────

const EMPLOYEE_PHONES: Record<string, string> = {
  samer: "+995511746491",
  fadi:  "+995591888863",
};

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

/**
 * Combine a YYYY-MM-DD date string with an HH:MM (24h) or H:MM AM/PM time string
 * into a UTC Date. Returns null if either field is missing or unparseable.
 */
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
      // Natural-language AI time (e.g. "at noon", "evening") — skip
      return null;
    }
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  // Parse date as UTC midnight then set the stored hours/minutes as UTC
  const d = new Date(`${dueDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
}

// ── Employee resolution ────────────────────────────────────────────────────────

function resolveEmployeePhone(assigneeName: string): string | null {
  const lower = assigneeName.toLowerCase();
  for (const [key, phone] of Object.entries(EMPLOYEE_PHONES)) {
    if (lower.includes(key)) return phone;
  }
  return null;
}

// ── Core reminder runner ───────────────────────────────────────────────────────

async function runTaskReminders(): Promise<void> {
  const client = await pool.connect();
  try {
    // Fetch all pending, un-reminded tasks that have a due date/time.
    // Join lead + assigned user for name, phone, and assignee resolution.
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
        lu.username                 AS lead_assignee_name
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
    // Catch-up window: fire for tasks that became due within the last 12 hours
    // (covers server restarts / brief outages)
    const windowStart = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    for (const row of rows) {
      const dueAt = parseDueAt(row.due_date, row.due_time);
      if (!dueAt) {
        // Unparseable time (AI natural language) — skip silently
        continue;
      }
      if (dueAt > now) continue;         // Not yet due
      if (dueAt < windowStart) continue; // Too old — skip to avoid flooding on first boot

      // ── Resolve employee ────────────────────────────────────────────────────
      if (!row.lead_assignee_name) {
        console.warn(
          `[CrmReminder] taskId=${row.id} leadId=${row.lead_id} — no assignee on lead, skipping`
        );
        continue;
      }
      const employeePhone = resolveEmployeePhone(row.lead_assignee_name);
      if (!employeePhone) {
        console.warn(
          `[CrmReminder] taskId=${row.id} — no WA phone mapped for "${row.lead_assignee_name}", skipping`
        );
        continue;
      }

      // ── Build message ───────────────────────────────────────────────────────
      const dueLabel  = `${row.due_date} — ${row.due_time}`;
      const descBlock = row.description?.trim()
        ? `\nالوصف:\n${row.description.trim()}\n`
        : "";

      const message =
        `🔔 تذكير مهمة CRM\n\n` +
        `العميل: ${row.lead_name}\n` +
        `الهاتف: ${row.lead_phone ?? "—"}\n\n` +
        `المهمة:\n${row.title}\n` +
        descBlock +
        `\nوقت التواصل:\n${dueLabel}\n\n` +
        `يرجى التواصل مع العميل الآن.`;

      // ── Send & mark ─────────────────────────────────────────────────────────
      try {
        const result = await sendQualTextMessage(employeePhone, message);
        if (result.success) {
          await client.query(
            `UPDATE crm_tasks SET reminder_sent_at = NOW() WHERE id = $1`,
            [row.id]
          );
          console.log(
            `[CrmReminder] ✓ taskId=${row.id} → ${row.lead_assignee_name}` +
            ` (${employeePhone}) | wamid=${result.wamid ?? "—"}`
          );
        } else {
          console.error(
            `[CrmReminder] ✗ taskId=${row.id} send failed: ${result.error}`
          );
          // Do NOT set reminder_sent_at — will retry next minute
        }
      } catch (e: any) {
        console.error(`[CrmReminder] ✗ taskId=${row.id} exception:`, e.message);
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
  // Run once immediately after ensuring column
  ensureCrmTaskReminderColumn()
    .then(() => runTaskReminders())
    .catch(() => {});

  // Then every 60 seconds
  setInterval(() => {
    if (_running) return; // Skip if previous tick is still in progress
    _running = true;
    runTaskReminders()
      .catch(e => console.error("[CrmReminder] Scheduler tick error:", e.message))
      .finally(() => { _running = false; });
  }, 60_000);

  console.log("[CrmReminder] Scheduler started — checks every 1 min");
}
