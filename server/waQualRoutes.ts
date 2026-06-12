/**
 * WA Qualification Admin Routes
 *
 * GET  /api/admin/wa-qual/lead/:leadId          — session + answers for a lead
 * POST /api/admin/wa-qual/lead/:leadId/restart  — restart qualification flow
 * PATCH /api/admin/wa-qual/lead/:leadId/score   — manually override score
 * POST /api/admin/whatsapp-test-send            — AUDIT: raw template send, full Meta response
 * GET  /api/admin/whatsapp-audit/webhook-log    — AUDIT: recent wa_webhook_audit_log rows
 * GET  /api/admin/whatsapp-audit/config         — AUDIT: WABA/phone config + webhook subscriptions
 */

import { Express } from "express";
import { pool } from "./db";
import { getQualSessionForLead, restartQualification } from "./waQualService";

async function requireAdmin(req: any, res: any): Promise<boolean> {
  if (!req.session?.userId) { res.status(401).json({ message: "Unauthorised" }); return false; }
  const c = await pool.connect();
  try {
    const r = await c.query(`SELECT is_admin FROM users WHERE id = $1`, [req.session.userId]);
    if (!r.rows[0]?.is_admin) { res.status(403).json({ message: "Forbidden" }); return false; }
    return true;
  } finally { c.release(); }
}

async function requireCrm(req: any, res: any): Promise<boolean> {
  if (!req.session?.userId) { res.status(401).json({ message: "Unauthorised" }); return false; }
  const c = await pool.connect();
  try {
    const r = await c.query(
      `SELECT is_admin, role FROM users WHERE id = $1`,
      [req.session.userId]
    );
    const u = r.rows[0];
    if (!u) { res.status(401).json({ message: "Unauthorised" }); return false; }
    if (!u.is_admin && u.role !== "sub_agent") {
      res.status(403).json({ message: "Forbidden" });
      return false;
    }
    return true;
  } finally { c.release(); }
}

export function registerWaQualRoutes(app: Express): void {
  // ── GET session for a lead ─────────────────────────────────────────────────
  app.get("/api/admin/wa-qual/lead/:leadId", async (req: any, res: any) => {
    if (!(await requireCrm(req, res))) return;

    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ message: "Invalid leadId" });

    try {
      const data = await getQualSessionForLead(leadId);
      if (!data) {
        return res.json({ session: null, answers: [], summary: null });
      }
      // Reshape answers from Record<string,string> → {question_key, answer_label}[]
      const answersArr = Object.entries(data.answers ?? {}).map(([question_key, answer_label]) => ({
        question_key,
        answer_label,
      }));
      const sessionRow = data.session ?? null;
      return res.json({
        session: sessionRow ? {
          id: sessionRow.id,
          state: sessionRow.status,
          score: sessionRow.score_points ?? null,
          qualified_score: (sessionRow.qual_score ?? sessionRow.qualified_score)?.toLowerCase() ?? null,
          qualified_at: sessionRow.completed_at ?? null,
          opt_out: sessionRow.status === "opt_out",
        } : null,
        answers: answersArr,
        summary: sessionRow?.summary_text ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST restart qualification ─────────────────────────────────────────────
  app.post("/api/admin/wa-qual/lead/:leadId/restart", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ message: "Invalid leadId" });

    try {
      const result = await restartQualification(leadId);

      // Active session blocking restart
      if (result.alreadyActive) {
        return res.status(409).json({ message: result.error });
      }

      // Template send failed (Meta API error)
      if (!result.success) {
        return res.status(422).json({
          message: result.error ?? "Failed to send WhatsApp template",
          sessionId: result.sessionId,
        });
      }

      // Success — return wamid so UI can display it
      return res.json({
        ok:        true,
        wamid:     result.wamid,
        sessionId: result.sessionId,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PATCH manual score override ────────────────────────────────────────────
  app.patch("/api/admin/wa-qual/lead/:leadId/score", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const leadId = parseInt(req.params.leadId);
    if (isNaN(leadId)) return res.status(400).json({ message: "Invalid leadId" });

    const rawScore = req.body.score;
    const scoreUpper = String(rawScore ?? "").toUpperCase();
    const VALID = ["VIP", "HOT", "WARM", "COLD"];
    if (!VALID.includes(scoreUpper)) {
      return res.status(400).json({ message: `score must be one of: ${VALID.join(", ")}` });
    }
    const score = scoreUpper;

    const client = await pool.connect();
    try {
      const mappedLeadScore =
        score === "VIP" || score === "HOT" ? "hot"
        : score === "WARM" ? "warm"
        : "cold";

      await client.query(`
        UPDATE crm_leads
        SET qualification_score = $1, lead_score = $2
        WHERE id = $3
      `, [score.toLowerCase(), mappedLeadScore, leadId]);

      await client.query(`
        UPDATE wa_qual_summaries sm
        SET qual_score = $1
        FROM wa_qual_sessions s
        WHERE sm.session_id = s.id AND s.lead_id = $2
      `, [score, leadId]);

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  // ── GET aggregate stats (admin dashboard) ─────────────────────────────────
  app.get("/api/admin/wa-qual/stats", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const client = await pool.connect();
    try {
      const r = await client.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'completed')          AS completed,
          COUNT(*) FILTER (WHERE status = 'in_progress'
            OR status NOT IN ('completed','timed_out','failed','opt_out','already_qualified','idle')) AS in_progress,
          COUNT(*) FILTER (WHERE status = 'timed_out')          AS timed_out,
          COUNT(*) FILTER (WHERE status = 'opt_out')            AS opt_out,
          COUNT(*) FILTER (WHERE status = 'already_qualified')  AS already_qualified,
          COUNT(*) AS total
        FROM wa_qual_sessions
      `);

      const scoreR = await client.query(`
        SELECT qual_score, COUNT(*) AS cnt
        FROM wa_qual_summaries
        GROUP BY qual_score
      `);

      const byScore: Record<string, number> = {};
      for (const row of scoreR.rows) byScore[row.qual_score] = Number(row.cnt);

      res.json({ ...r.rows[0], byScore });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  // ── POST /api/admin/whatsapp-test-send ────────────────────────────────────
  // AUDIT endpoint — sends the template directly and returns the full Meta
  // API response including WAMID, WABA ID, Phone Number ID.
  // Does NOT create a wa_qual_session or modify any CRM data.
  app.post("/api/admin/whatsapp-test-send", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const phone        = String(req.body?.phone ?? "").replace(/[^0-9]/g, "");
    const templateName = String(req.body?.template ?? "kinglike_qual_opener");
    const language     = String(req.body?.language ?? "ar");

    if (!phone) return res.status(400).json({ message: "phone is required (any format)" });

    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "1110445448828325";
    const WABA_ID         = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "2006683553274156";
    const token           = process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.META_ACCESS_TOKEN ?? null;

    if (!token) return res.status(500).json({ message: "No WhatsApp access token configured" });

    const apiUrl  = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      recipient_type:    "individual",
      to:                phone,
      type:              "template",
      template: {
        name:     templateName,
        language: { code: language },
        components: [
          { type: "button", sub_type: "quick_reply", index: "0",
            parameters: [{ type: "payload", payload: "QUAL_YES" }] },
          { type: "button", sub_type: "quick_reply", index: "1",
            parameters: [{ type: "payload", payload: "QUAL_LATER" }] },
        ],
      },
    };

    console.log(
      `[WA-TestSend] POST ${apiUrl} → to=${phone} template=${templateName} lang=${language}`
    );

    try {
      const metaRes  = await fetch(apiUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(15_000),
      });
      const metaBody: any = await metaRes.json().catch(() => ({}));

      const wamid   = metaBody?.messages?.[0]?.id ?? null;
      const success = metaRes.ok && !!wamid;

      console.log(
        `[WA-TestSend] status=${metaRes.status} success=${success} wamid=${wamid ?? "—"}`
      );

      // Log this test send to the audit table as well
      try {
        await pool.query(`
          INSERT INTO wa_webhook_audit_log
            (received_at, source_ip, hub_verify, object_field, raw_payload, note)
          VALUES (NOW(), NULL, FALSE, 'test_send', $1::jsonb, $2)
        `, [
          JSON.stringify({ request: payload, response: metaBody, http_status: metaRes.status }),
          `TEST SEND to=${phone} template=${templateName}`,
        ]);
      } catch { /* non-critical */ }

      return res.json({
        success,
        wamid,
        http_status:     metaRes.status,
        meta_response:   metaBody,
        phone_sent_to:   phone,
        phone_number_id: PHONE_NUMBER_ID,
        waba_id:         WABA_ID,
        template:        templateName,
        language,
        api_url:         apiUrl,
        sent_at:         new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[WA-TestSend] fetch error:", err.message);
      return res.status(500).json({ message: err.message });
    }
  });

  // ── GET /api/admin/whatsapp-audit/webhook-log ─────────────────────────────
  // Returns the most recent rows in wa_webhook_audit_log.
  app.get("/api/admin/whatsapp-audit/webhook-log", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const limit  = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
    const client = await pool.connect();
    try {
      const r = await client.query(`
        SELECT id, received_at, source_ip, hub_verify, object_field,
               raw_payload, note
        FROM wa_webhook_audit_log
        ORDER BY received_at DESC
        LIMIT $1
      `, [limit]);
      res.json({ count: r.rows.length, rows: r.rows });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  });

  // ── GET /api/admin/whatsapp-audit/config ─────────────────────────────────
  // Returns current server-side WABA + phone config and live Meta Graph API
  // responses for phone number details, WABA details, and app subscriptions.
  app.get("/api/admin/whatsapp-audit/config", async (req: any, res: any) => {
    if (!(await requireAdmin(req, res))) return;

    const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "1110445448828325";
    const WABA_ID         = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? "2006683553274156";
    const APP_ID          = "1514951776833947";
    const token           = process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.META_ACCESS_TOKEN ?? null;
    const appSecret       = process.env.META_APP_SECRET ?? null;

    const serverConfig = {
      phone_number_id:              PHONE_NUMBER_ID,
      waba_id:                      WABA_ID,
      app_id:                       APP_ID,
      whatsapp_phone_number_id_env: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
      whatsapp_access_token_env:    !!process.env.WHATSAPP_ACCESS_TOKEN,
      meta_access_token_env:        !!process.env.META_ACCESS_TOKEN,
      meta_app_secret_env:          !!process.env.META_APP_SECRET,
      token_in_use:                 process.env.WHATSAPP_ACCESS_TOKEN ? "WHATSAPP_ACCESS_TOKEN" : "META_ACCESS_TOKEN",
      token_length:                 token?.length ?? 0,
      api_url:                      `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`,
    };

    // Fetch live Meta data in parallel (fail gracefully on each)
    const fetchMeta = async (url: string): Promise<any> => {
      if (!token) return { error: "No token" };
      try {
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal:  AbortSignal.timeout(10_000),
        });
        return r.json();
      } catch (e: any) {
        return { error: e.message };
      }
    };

    const fetchMetaAppToken = async (url: string): Promise<any> => {
      if (!appSecret) return { error: "META_APP_SECRET not set" };
      try {
        const r = await fetch(`${url}?access_token=${APP_ID}|${appSecret}`, {
          signal: AbortSignal.timeout(10_000),
        });
        return r.json();
      } catch (e: any) {
        return { error: e.message };
      }
    };

    const [phoneDetails, wabaDetails, wabaPhones, appSubscriptions, wabaSubscribedApps] =
      await Promise.all([
        fetchMeta(
          `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}` +
          `?fields=display_phone_number,verified_name,quality_rating,` +
          `messaging_limit_tier,status,code_verification_status,name_status`
        ),
        fetchMeta(
          `https://graph.facebook.com/v23.0/${WABA_ID}` +
          `?fields=name,currency,timezone_id,account_review_status,business_verification_status,ownership_type`
        ),
        fetchMeta(
          `https://graph.facebook.com/v23.0/${WABA_ID}/phone_numbers` +
          `?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,status,code_verification_status`
        ),
        fetchMetaAppToken(
          `https://graph.facebook.com/v23.0/${APP_ID}/subscriptions`
        ),
        fetchMeta(`https://graph.facebook.com/v23.0/${WABA_ID}/subscribed_apps`),
      ]);

    // Summarise subscribed webhook fields
    const subscribedFields: string[] =
      (appSubscriptions?.data ?? []).flatMap((s: any) =>
        (s.fields ?? []).map((f: any) => f.name as string)
      );

    const hasMessages                   = subscribedFields.includes("messages");
    const hasMessageTemplateStatusUpdate = subscribedFields.includes("message_template_status_update");

    res.json({
      server_config:      serverConfig,
      phone_details:      phoneDetails,
      waba_details:       wabaDetails,
      waba_phone_numbers: wabaPhones,
      app_subscriptions:  appSubscriptions,
      waba_subscribed_apps: wabaSubscribedApps,
      webhook_analysis: {
        subscribed_fields:                  subscribedFields,
        has_messages_field:                 hasMessages,
        has_message_template_status_update: hasMessageTemplateStatusUpdate,
        missing_fields:                     [
          ...(!hasMessages                    ? ["messages"]                         : []),
          ...(!hasMessageTemplateStatusUpdate ? ["message_template_status_update"]   : []),
        ],
        verdict: hasMessages
          ? "✅ messages field subscribed — delivery status callbacks will arrive"
          : "❌ messages field NOT subscribed — no delivery status callbacks will arrive",
      },
    });
  });
}
