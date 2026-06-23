/**
 * Broadcast Service
 * Manages bulk email broadcasts to CRM leads with batch sending,
 * pause/resume/stop controls, and full send history tracking.
 */

import { pool } from "./db";
import { Resend } from "resend";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BroadcastFilterConfig {
  search?: string;
  status?: string[];
  source?: string[];
  assignedTo?: string[];
  expectedMonth?: string[];
  contactDate?: string;
  qualScore?: string[];
  aiScore?: string[];
  projectInterest?: string[];
  interestedCountry?: string[];
  city?: string[];
  waStage?: string[];
  leadScore?: string[];
}

export interface Broadcast {
  id: number;
  name: string;
  subject: string;
  body_html: string;
  image_url: string | null;
  filter_config: BroadcastFilterConfig;
  status: "draft" | "test_sent" | "approved" | "running" | "paused" | "completed" | "cancelled";
  batch_size: number;
  batch_delay_ms: number;
  created_by: number | null;
  test_sent_at: string | null;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  total_recipients?: number;
  sent_count?: number;
  failed_count?: number;
  pending_count?: number;
}

// ── DB table creation ──────────────────────────────────────────────────────────

export async function ensureBroadcastTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_broadcasts (
      id             SERIAL PRIMARY KEY,
      name           TEXT    NOT NULL,
      subject        TEXT    NOT NULL DEFAULT '',
      body_html      TEXT    NOT NULL DEFAULT '',
      image_url      TEXT,
      filter_config  JSONB   NOT NULL DEFAULT '{}',
      status         TEXT    NOT NULL DEFAULT 'draft',
      batch_size     INT     NOT NULL DEFAULT 10,
      batch_delay_ms INT     NOT NULL DEFAULT 600000,
      created_by     INT,
      test_sent_at   TIMESTAMPTZ,
      approved_at    TIMESTAMPTZ,
      started_at     TIMESTAMPTZ,
      completed_at   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_broadcast_recipients (
      id           SERIAL PRIMARY KEY,
      broadcast_id INT  NOT NULL REFERENCES email_broadcasts(id) ON DELETE CASCADE,
      lead_id      INT,
      email        TEXT NOT NULL,
      first_name   TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      sent_at      TIMESTAMPTZ,
      error        TEXT,
      resend_id    TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ebr_broadcast_status
    ON email_broadcast_recipients(broadcast_id, status)
  `);
  console.log("[Broadcast] Tables ensured.");
}

// ── Recipient counting (no DB write) ─────────────────────────────────────────

export async function countBroadcastRecipients(filters: BroadcastFilterConfig): Promise<number> {
  const { sql, params } = buildLeadQuery(filters, true);
  const result = await pool.query(sql, params);
  return parseInt(result.rows[0]?.count ?? "0", 10);
}

// ── Build & persist recipients ────────────────────────────────────────────────

export async function buildBroadcastRecipients(
  broadcastId: number,
  filters: BroadcastFilterConfig,
): Promise<number> {
  const { sql, params } = buildLeadQuery(filters, false);
  const leadsResult = await pool.query(sql, params);
  const leads = leadsResult.rows;

  if (leads.length === 0) return 0;

  // Delete any previous recipient rows (idempotent rebuild)
  await pool.query(
    "DELETE FROM email_broadcast_recipients WHERE broadcast_id = $1",
    [broadcastId],
  );

  // Batch-insert
  const values: any[] = [];
  const placeholders: string[] = [];
  leads.forEach((lead: any, i: number) => {
    const base = i * 4;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    values.push(broadcastId, lead.id, lead.email, lead.first_name ?? lead.full_name ?? null);
  });

  await pool.query(
    `INSERT INTO email_broadcast_recipients (broadcast_id, lead_id, email, first_name)
     VALUES ${placeholders.join(",")}`,
    values,
  );

  return leads.length;
}

// ── Email HTML builder ────────────────────────────────────────────────────────

function buildEmailHtml(opts: {
  subject: string;
  bodyHtml: string;
  imageUrl?: string | null;
  firstName?: string | null;
}): string {
  const { subject, bodyHtml, imageUrl, firstName } = opts;
  const hasArabic = /[\u0600-\u06FF]/.test(subject + bodyHtml);
  const dir = hasArabic ? "rtl" : "ltr";
  const align = hasArabic ? "right" : "left";

  const greeting = firstName
    ? `<p style="color:#005476;font-size:16px;font-weight:bold;margin:0 0 16px">${hasArabic ? `مرحباً ${firstName}،` : `Hello ${firstName},`}</p>`
    : "";

  const imageBlock = imageUrl
    ? `<div style="padding:0 0 24px">
         <img src="${imageUrl}" alt="campaign" style="width:100%;max-height:360px;object-fit:cover;border-radius:12px" />
       </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="${hasArabic ? "ar" : "en"}" dir="${dir}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f0f9f9;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:640px;margin:32px auto;padding:0 16px">
  <div style="background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 4px 32px rgba(0,84,118,.10)">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:40px 32px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800;letter-spacing:-0.5px">Kinglike Luxury</h1>
      <p style="color:rgba(255,255,255,.82);margin:6px 0 0;font-size:13px">منصة العقارات الفاخرة</p>
    </div>
    <!-- Body -->
    <div style="padding:32px 32px 8px;direction:${dir};text-align:${align}">
      ${greeting}
      <h2 style="color:#005476;margin:0 0 20px;font-size:20px;line-height:1.4">${subject}</h2>
      ${imageBlock}
      <div style="color:#333;font-size:15px;line-height:1.85">${bodyHtml}</div>
    </div>
    <!-- CTA -->
    <div style="padding:24px 32px 32px;text-align:center">
      <a href="https://www.kinglikeluxury.app"
         style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);color:#fff;padding:14px 42px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">
        ${hasArabic ? "استكشف العقارات →" : "Explore Properties →"}
      </a>
    </div>
    <!-- Footer -->
    <div style="background:#f0f9f9;padding:24px 20px;text-align:center;border-top:1px solid #e5f5f5">
      <div style="color:#aaa;font-size:12px">© Kinglike Luxury Real Estate Platform</div>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ── In-process runner registry ────────────────────────────────────────────────

interface RunnerHandle {
  paused: boolean;
  stopped: boolean;
}
const activeRunners = new Map<number, RunnerHandle>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getResendKey(): Promise<string | null> {
  const envKey = process.env.RESEND_API_KEY;
  if (envKey) return envKey;
  try {
    const r = await pool.query(
      "SELECT value FROM app_settings WHERE key='RESEND_API_KEY' LIMIT 1",
    );
    return r.rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

// ── Batch runner ──────────────────────────────────────────────────────────────

export async function startBroadcastRunner(broadcastId: number): Promise<void> {
  if (activeRunners.has(broadcastId)) {
    const handle = activeRunners.get(broadcastId)!;
    handle.paused = false;
    handle.stopped = false;
    return;
  }

  const handle: RunnerHandle = { paused: false, stopped: false };
  activeRunners.set(broadcastId, handle);

  // Mark as running
  await pool.query(
    `UPDATE email_broadcasts SET status='running', started_at=COALESCE(started_at,NOW()), updated_at=NOW() WHERE id=$1`,
    [broadcastId],
  );

  // Run async in background — not awaited
  (async () => {
    try {
      const resendKey = await getResendKey();
      if (!resendKey) {
        console.error(`[Broadcast #${broadcastId}] RESEND_API_KEY not found. Aborting.`);
        await pool.query(
          `UPDATE email_broadcasts SET status='paused', updated_at=NOW() WHERE id=$1`,
          [broadcastId],
        );
        activeRunners.delete(broadcastId);
        return;
      }
      const resend = new Resend(resendKey);

      while (true) {
        if (handle.stopped) break;

        // Wait while paused
        while (handle.paused && !handle.stopped) {
          await sleep(5000);
        }
        if (handle.stopped) break;

        // Get broadcast config
        const bcResult = await pool.query(
          "SELECT * FROM email_broadcasts WHERE id=$1",
          [broadcastId],
        );
        const bc = bcResult.rows[0];
        if (!bc) break;

        // Pull next batch of pending recipients
        const batchResult = await pool.query(
          `SELECT * FROM email_broadcast_recipients
           WHERE broadcast_id=$1 AND status='pending'
           ORDER BY id ASC LIMIT $2`,
          [broadcastId, bc.batch_size],
        );
        const batch = batchResult.rows;

        if (batch.length === 0) {
          // All done
          await pool.query(
            `UPDATE email_broadcasts SET status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=$1`,
            [broadcastId],
          );
          console.log(`[Broadcast #${broadcastId}] Completed.`);
          break;
        }

        console.log(`[Broadcast #${broadcastId}] Sending batch of ${batch.length}...`);

        // Send each email in this batch
        for (const recipient of batch) {
          if (handle.stopped || handle.paused) break;

          const html = buildEmailHtml({
            subject: bc.subject,
            bodyHtml: bc.body_html,
            imageUrl: bc.image_url,
            firstName: recipient.first_name,
          });

          try {
            const result = await resend.emails.send({
              from: "Kinglike Luxury <info@kinglikeluxury.app>",
              to: recipient.email,
              subject: bc.subject,
              html,
            });
            if (result.error) {
              await pool.query(
                `UPDATE email_broadcast_recipients SET status='failed', sent_at=NOW(), error=$1 WHERE id=$2`,
                [result.error.message, recipient.id],
              );
            } else {
              await pool.query(
                `UPDATE email_broadcast_recipients SET status='sent', sent_at=NOW(), resend_id=$1 WHERE id=$2`,
                [result.data?.id ?? null, recipient.id],
              );
            }
          } catch (err: any) {
            await pool.query(
              `UPDATE email_broadcast_recipients SET status='failed', sent_at=NOW(), error=$1 WHERE id=$2`,
              [err.message ?? "Unknown error", recipient.id],
            );
          }

          // Small delay between individual emails within the batch
          await sleep(200);
        }

        // If paused mid-batch, wait
        if (handle.paused) {
          await pool.query(
            `UPDATE email_broadcasts SET status='paused', updated_at=NOW() WHERE id=$1`,
            [broadcastId],
          );
          while (handle.paused && !handle.stopped) {
            await sleep(5000);
          }
          if (!handle.stopped) {
            await pool.query(
              `UPDATE email_broadcasts SET status='running', updated_at=NOW() WHERE id=$1`,
              [broadcastId],
            );
          }
        }

        if (handle.stopped) break;

        // Check if more pending remain before sleeping
        const remaining = await pool.query(
          "SELECT COUNT(*) FROM email_broadcast_recipients WHERE broadcast_id=$1 AND status='pending'",
          [broadcastId],
        );
        const pendingCount = parseInt(remaining.rows[0]?.count ?? "0", 10);
        if (pendingCount === 0) {
          await pool.query(
            `UPDATE email_broadcasts SET status='completed', completed_at=NOW(), updated_at=NOW() WHERE id=$1`,
            [broadcastId],
          );
          console.log(`[Broadcast #${broadcastId}] Completed.`);
          break;
        }

        console.log(`[Broadcast #${broadcastId}] Batch done. Waiting ${bc.batch_delay_ms}ms. Remaining: ${pendingCount}`);
        await sleep(bc.batch_delay_ms);
      }
    } catch (err: any) {
      console.error(`[Broadcast #${broadcastId}] Runner error:`, err.message);
      try {
        await pool.query(
          `UPDATE email_broadcasts SET status='paused', updated_at=NOW() WHERE id=$1`,
          [broadcastId],
        );
      } catch {}
    } finally {
      activeRunners.delete(broadcastId);
      if (activeRunners.get(broadcastId)?.stopped) {
        await pool.query(
          `UPDATE email_broadcasts SET status='cancelled', updated_at=NOW() WHERE id=$1`,
          [broadcastId],
        ).catch(() => {});
      }
    }
  })();
}

export function pauseBroadcastRunner(broadcastId: number): boolean {
  const h = activeRunners.get(broadcastId);
  if (!h) return false;
  h.paused = true;
  return true;
}

export function resumeBroadcastRunner(broadcastId: number): boolean {
  const h = activeRunners.get(broadcastId);
  if (!h) return false;
  h.paused = false;
  return true;
}

export function stopBroadcastRunner(broadcastId: number): boolean {
  const h = activeRunners.get(broadcastId);
  if (!h) return false;
  h.stopped = true;
  h.paused = false;
  return true;
}

// ── Resume any running broadcasts on server startup ──────────────────────────

export async function resumePendingBroadcasts(): Promise<void> {
  try {
    const result = await pool.query(
      "SELECT id FROM email_broadcasts WHERE status IN ('running','approved') ORDER BY id ASC",
    );
    for (const row of result.rows) {
      console.log(`[Broadcast] Resuming broadcast #${row.id} after restart.`);
      await startBroadcastRunner(row.id);
    }
  } catch (err: any) {
    console.error("[Broadcast] resumePendingBroadcasts error:", err.message);
  }
}

// ── Test email ────────────────────────────────────────────────────────────────

export async function sendBroadcastTestEmail(
  broadcastId: number,
  toEmail: string,
  firstName?: string,
): Promise<{ ok: boolean; error?: string }> {
  const resendKey = await getResendKey();
  if (!resendKey) return { ok: false, error: "RESEND_API_KEY not configured" };

  const result = await pool.query("SELECT * FROM email_broadcasts WHERE id=$1", [broadcastId]);
  const bc = result.rows[0];
  if (!bc) return { ok: false, error: "Broadcast not found" };

  const html = buildEmailHtml({
    subject: `[TEST] ${bc.subject}`,
    bodyHtml: bc.body_html,
    imageUrl: bc.image_url,
    firstName: firstName ?? "Admin",
  });

  const resend = new Resend(resendKey);
  const r = await resend.emails.send({
    from: "Kinglike Luxury <info@kinglikeluxury.app>",
    to: toEmail,
    subject: `[TEST] ${bc.subject}`,
    html,
  });

  if (r.error) return { ok: false, error: r.error.message };
  return { ok: true };
}

// ── CRM lead query builder ────────────────────────────────────────────────────

function buildLeadQuery(
  filters: BroadcastFilterConfig,
  countOnly: boolean,
): { sql: string; params: any[] } {
  const conditions: string[] = [
    "email IS NOT NULL",
    "email != ''",
    "email ILIKE '%@%'",
  ];
  const params: any[] = [];
  let pIdx = 1;

  const addParam = (v: any): string => {
    params.push(v);
    return `$${pIdx++}`;
  };

  if (filters.search) {
    const p = addParam(`%${filters.search}%`);
    conditions.push(`(full_name ILIKE ${p} OR first_name ILIKE ${p} OR last_name ILIKE ${p} OR phone ILIKE ${p} OR email ILIKE ${p})`);
  }

  if (filters.status?.length) {
    const ps = filters.status.map(v => addParam(v));
    conditions.push(`status IN (${ps.join(",")})`);
  }

  if (filters.source?.length) {
    const ps = filters.source.map(v => addParam(v));
    conditions.push(`lead_source IN (${ps.join(",")})`);
  }

  if (filters.assignedTo?.length) {
    const withNull = filters.assignedTo.includes("unassigned");
    const ids = filters.assignedTo.filter(v => v !== "unassigned").map(v => parseInt(v, 10)).filter(n => !isNaN(n));
    if (withNull && ids.length > 0) {
      const ps = ids.map(v => addParam(v));
      conditions.push(`(assigned_to IS NULL OR assigned_to IN (${ps.join(",")}))`);
    } else if (withNull) {
      conditions.push("assigned_to IS NULL");
    } else if (ids.length > 0) {
      const ps = ids.map(v => addParam(v));
      conditions.push(`assigned_to IN (${ps.join(",")})`);
    }
  }

  if (filters.expectedMonth?.length) {
    const parts = filters.expectedMonth.map(v => {
      if (v === "not_specified") return `(expected_purchase_month IS NULL OR expected_purchase_month = '')`;
      return `expected_purchase_month = ${addParam(v)}`;
    });
    conditions.push(`(${parts.join(" OR ")})`);
  }

  if (filters.contactDate && filters.contactDate !== "all") {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let start: Date | null = null;
    let end: Date | null = null;
    switch (filters.contactDate) {
      case "today":     start = todayStart; end = todayEnd; break;
      case "yesterday": start = new Date(+todayStart - 86400000); end = new Date(+todayEnd - 86400000); break;
      case "last7":     start = new Date(+todayStart - 6 * 86400000); end = todayEnd; break;
      case "last30":    start = new Date(+todayStart - 29 * 86400000); end = todayEnd; break;
      case "thisMonth": start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999); break;
      case "prevMonth": start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999); break;
    }
    if (start && end) {
      const ps = addParam(start); const pe = addParam(end);
      conditions.push(`COALESCE(last_contact_at, created_at) >= ${ps} AND COALESCE(last_contact_at, created_at) <= ${pe}`);
    }
  }

  if (filters.qualScore?.length) {
    const parts = filters.qualScore.map(v => {
      if (v === "in_progress") return `qualification_status = 'in_progress'`;
      if (v === "none")        return `(qualification_status IS NULL OR qualification_status = 'none')`;
      return `qualification_score = ${addParam(v)}`;
    });
    conditions.push(`(${parts.join(" OR ")})`);
  }

  if (filters.aiScore?.length) {
    const parts = filters.aiScore.map(v =>
      v === "none" ? `ai_score_category IS NULL` : `ai_score_category = ${addParam(v)}`,
    );
    conditions.push(`(${parts.join(" OR ")})`);
  }

  if (filters.projectInterest?.length) {
    const parts = filters.projectInterest.map(v => `project_interest ILIKE ${addParam(`%${v}%`)}`);
    conditions.push(`(${parts.join(" OR ")})`);
  }

  if (filters.interestedCountry?.length) {
    const ps = filters.interestedCountry.map(v => addParam(v));
    conditions.push(`interested_country IN (${ps.join(",")})`);
  }

  if (filters.city?.length) {
    const ps = filters.city.map(v => addParam(v));
    conditions.push(`city IN (${ps.join(",")})`);
  }

  if (filters.waStage?.length) {
    const ps = filters.waStage.map(v => addParam(v));
    conditions.push(`wa_stage IN (${ps.join(",")})`);
  }

  if (filters.leadScore?.length) {
    const ps = filters.leadScore.map(v => addParam(v));
    conditions.push(`lead_score IN (${ps.join(",")})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  if (countOnly) {
    return { sql: `SELECT COUNT(*) as count FROM crm_leads ${whereClause}`, params };
  }
  return {
    sql: `SELECT id, email, first_name, full_name FROM crm_leads ${whereClause} ORDER BY id ASC`,
    params,
  };
}
