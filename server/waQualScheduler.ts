/**
 * WA Qualification Scheduler
 *
 * Runs every 30 minutes:
 *
 * TIMEOUTS:
 *   • Legacy Q-flow sessions (q1_sent … q7_sent etc.)  → 24 h
 *   • AI concierge sessions (ai_concierge_active)       → 72 h
 *     Before timing out an AI session, sends a personalised AI-generated
 *     follow-up from the stored conversation history.
 *
 * NUDGES:
 *   • Nudge 1 (retry_count = 0, silence > 2 h)
 *       "هل ما زلت مهتماً بالحصول على خيارات مناسبة لاحتياجاتك؟ 🌟"
 *   • Nudge 2 (retry_count = 1, silence > 24 h)
 *       "وجدنا بعض الفرص الجديدة التي قد تناسب ما تحدثنا عنه سابقاً."
 */

import { pool } from "./db";

const POLL_MS = 30 * 60 * 1000; // 30 min

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

    // ── 1. Timeout legacy Q-flow sessions after 24 h ─────────────────────────
    const LEGACY_STATES = [
      "'greeting_sent'","'q1_sent'","'q2_sent'","'q3_sent'",
      "'q4_sent'","'q4b_sent'","'q5_sent'","'q6_sent'","'q7_sent'",
    ].join(",");

    const legacyTimeout = await client.query(`
      UPDATE wa_qual_sessions
      SET status = 'timed_out', completed_at = NOW()
      WHERE status IN (${LEGACY_STATES})
        AND last_message_at < NOW() - INTERVAL '24 hours'
      RETURNING id, lead_id
    `);
    if (legacyTimeout.rowCount && legacyTimeout.rowCount > 0) {
      console.log(`[WaQualScheduler] Timed out ${legacyTimeout.rowCount} legacy session(s)`);
      for (const row of legacyTimeout.rows) {
        await client.query(
          `UPDATE crm_leads SET qualification_status = 'timed_out' WHERE id = $1`,
          [row.lead_id]
        );
      }
    }

    // ── 2. Timeout AI concierge sessions after 72 h (with personalised send) ─
    const aiTimeoutRows = await client.query(`
      SELECT id, lead_id, phone,
             COALESCE(conversation_history, '[]'::jsonb) AS conversation_history
      FROM wa_qual_sessions
      WHERE status = 'ai_concierge_active'
        AND last_message_at < NOW() - INTERVAL '72 hours'
    `);

    if (aiTimeoutRows.rowCount && aiTimeoutRows.rowCount > 0) {
      console.log(`[WaQualScheduler] AI timeout: ${aiTimeoutRows.rowCount} session(s)`);
      const { generateTimeoutFollowUp } = await import("./waAiConcierge");
      for (const row of aiTimeoutRows.rows) {
        try {
          await generateTimeoutFollowUp(row.phone, row.conversation_history ?? []);
        } catch (e: any) {
          console.warn(`[WaQualScheduler] Follow-up send failed sessionId=${row.id}:`, e.message);
        }
        await client.query(
          `UPDATE wa_qual_sessions SET status = 'timed_out', completed_at = NOW() WHERE id = $1`,
          [row.id]
        );
        await client.query(
          `UPDATE crm_leads SET qualification_status = 'timed_out' WHERE id = $1`,
          [row.lead_id]
        );
      }
    }

    // ── 3. Nudge 1 — silence > 2 h, retry_count = 0 ──────────────────────────
    const { handleNudge } = await import("./waQualService");

    const nudge1Rows = await client.query(`
      SELECT id, lead_id, phone, status, retry_count
      FROM wa_qual_sessions
      WHERE status NOT IN ('completed','timed_out','failed','opt_out','already_qualified','idle','template_sent','postponed')
        AND last_message_at < NOW() - INTERVAL '2 hours'
        AND retry_count = 0
    `);
    for (const row of nudge1Rows.rows) {
      await handleNudge(row.id, row.phone, 0, row.status).catch(err =>
        console.error(`[WaQualScheduler] Nudge1 failed sessionId=${row.id}:`, err.message)
      );
    }

    // ── 4. Nudge 2 — silence > 24 h, retry_count = 1 ─────────────────────────
    const nudge2Rows = await client.query(`
      SELECT id, lead_id, phone, status, retry_count
      FROM wa_qual_sessions
      WHERE status NOT IN ('completed','timed_out','failed','opt_out','already_qualified','idle','template_sent','postponed')
        AND last_message_at < NOW() - INTERVAL '24 hours'
        AND retry_count = 1
    `);
    for (const row of nudge2Rows.rows) {
      await handleNudge(row.id, row.phone, 1, row.status).catch(err =>
        console.error(`[WaQualScheduler] Nudge2 failed sessionId=${row.id}:`, err.message)
      );
    }

  } catch (err: any) {
    console.error("[WaQualScheduler] runOnce error:", err.message);
  } finally {
    client.release();
  }
}
