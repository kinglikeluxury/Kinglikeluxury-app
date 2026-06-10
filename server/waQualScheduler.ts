/**
 * WA Qualification Scheduler
 * Runs every 30 minutes and times-out sessions that have had no activity
 * for more than 24 hours.  Also nudges sessions that are stuck waiting for
 * a reply for more than 1 hour (up to 2 nudges per session).
 */

import { pool } from "./db";

const TIMEOUT_MS  = 24 * 60 * 60 * 1000; // 24 h
const NUDGE_MS    =      60 * 60 * 1000; // 1 h
const MAX_NUDGES  = 2;
const POLL_MS     = 30 * 60 * 1000;      // 30 min

let _started = false;

export function startWaQualScheduler(): void {
  if (_started) return;
  _started = true;
  console.log("[WaQualScheduler] Started — polling every 30 min");
  setTimeout(runOnce, 60_000); // first run 1 min after boot
  setInterval(runOnce, POLL_MS);
}

async function runOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    // ── Timeout stale sessions ────────────────────────────────────────────
    const timeoutResult = await client.query(`
      UPDATE wa_qual_sessions
      SET status = 'timed_out', completed_at = NOW()
      WHERE status NOT IN ('completed','timed_out','failed','opt_out','already_qualified')
        AND last_message_at < NOW() - INTERVAL '24 hours'
      RETURNING id, lead_id
    `);
    if (timeoutResult.rowCount && timeoutResult.rowCount > 0) {
      console.log(`[WaQualScheduler] Timed out ${timeoutResult.rowCount} session(s)`);
      // Update crm_leads qualification_status
      for (const row of timeoutResult.rows) {
        await client.query(`
          UPDATE crm_leads
          SET qualification_status = 'timed_out'
          WHERE id = $1
        `, [row.lead_id]);
      }
    }

    // ── Nudge sessions waiting for reply > 1 h ───────────────────────────
    const { handleNudge } = await import("./waQualService");
    const nudgeResult = await client.query(`
      SELECT id, lead_id, phone, retry_count
      FROM wa_qual_sessions
      WHERE status NOT IN ('completed','timed_out','failed','opt_out','already_qualified','idle')
        AND last_message_at < NOW() - INTERVAL '1 hour'
        AND retry_count < $1
    `, [MAX_NUDGES]);

    for (const row of nudgeResult.rows) {
      await handleNudge(row.id, row.phone, row.retry_count).catch(err =>
        console.error(`[WaQualScheduler] Nudge failed sessionId=${row.id}:`, err.message)
      );
    }
  } catch (err: any) {
    console.error("[WaQualScheduler] runOnce error:", err.message);
  } finally {
    client.release();
  }
}
