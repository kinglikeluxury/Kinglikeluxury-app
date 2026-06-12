/**
 * Email Nurturing Routes — admin-only API endpoints.
 * Sub-agents are blocked server-side (403 for non-admin).
 */

import type { Express } from "express";
import {
  getNurturingOverview, getEmailHistoryPage, getLeadNurturingStatus, getLeadEmailEvents,
  getSequences, getSequenceTemplates, getNurturingSettings, updateNurturingSettings,
  pauseNurturingForLead, resumeNurturingForLead, stopNurturingForLead, initNurturingForLead,
  handleUnsubscribe, sendTestNurturingEmail,
} from "./emailNurturingService";
import { pool } from "./db";

function adminOnly(req: any, res: any): boolean {
  if (!req.session?.userId)  { res.status(401).json({ message: "Not authenticated" }); return false; }
  if (!req.session?.isAdmin) { res.status(403).json({ message: "Admin only" });         return false; }
  return true;
}

export function registerEmailNurturingRoutes(app: Express): void {

  // ── Public unsubscribe ──────────────────────────────────────────────────────
  app.get("/api/email/unsubscribe", async (req, res) => {
    const leadId = parseInt(String(req.query.leadId));
    const token  = String(req.query.token || "");
    if (!leadId || !token) return res.status(400).send("Invalid unsubscribe link.");
    const ok = await handleUnsubscribe(leadId, token);
    if (!ok) return res.status(400).send("Invalid or already processed unsubscribe link.");
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Unsubscribed</title></head>
<body style="font-family:Arial,sans-serif;text-align:center;padding:60px 20px;background:#f0f9f9;direction:rtl">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 20px rgba(0,84,118,.1)">
    <h2 style="color:#005476;margin-top:0">تم إلغاء الاشتراك</h2>
    <p style="color:#555;line-height:1.8">تم إلغاء اشتراكك من قائمة البريد الإلكتروني بنجاح.<br>لن نرسل لك رسائل إضافية.</p>
    <a href="https://www.kinglikeluxury.app" style="color:#3bcac4;text-decoration:none">العودة إلى الموقع</a>
  </div>
</body></html>`);
  });

  // ── Resend webhook (email events: opened, clicked, bounced, etc.) ──────────
  app.post("/api/webhooks/email-nurturing", async (req, res) => {
    try {
      const { handleNurturingWebhookEvent } = await import("./emailNurturingService");
      const { type, data } = req.body;
      if (type) await handleNurturingWebhookEvent(type, data);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Overview / analytics ───────────────────────────────────────────────────
  app.get("/api/admin/email-nurturing/overview", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try { res.json(await getNurturingOverview()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Settings ───────────────────────────────────────────────────────────────
  app.get("/api/admin/email-nurturing/settings", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try { res.json(await getNurturingSettings()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/admin/email-nurturing/settings", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      await updateNurturingSettings(req.body);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Sequences ──────────────────────────────────────────────────────────────
  app.get("/api/admin/email-nurturing/sequences", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try { res.json(await getSequences()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/admin/email-nurturing/sequences", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ message: "name is required" });
    const client = await pool.connect();
    try {
      const r = await client.query(
        `INSERT INTO email_nurturing_sequences(name,description,is_active) VALUES($1,$2,true) RETURNING *`,
        [name, description || null]
      );
      res.status(201).json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
    finally { client.release(); }
  });

  app.put("/api/admin/email-nurturing/sequences/:id", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    const id = parseInt(req.params.id);
    const { name, description, is_active } = req.body;
    const client = await pool.connect();
    try {
      const r = await client.query(
        `UPDATE email_nurturing_sequences SET name=COALESCE($2,name), description=COALESCE($3,description), is_active=COALESCE($4,is_active) WHERE id=$1 RETURNING *`,
        [id, name, description, is_active]
      );
      if (!r.rows.length) return res.status(404).json({ message: "Not found" });
      res.json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
    finally { client.release(); }
  });

  // ── Templates ──────────────────────────────────────────────────────────────
  app.get("/api/admin/email-nurturing/sequences/:id/templates", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try { res.json(await getSequenceTemplates(parseInt(req.params.id))); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/admin/email-nurturing/sequences/:id/templates", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    const seqId = parseInt(req.params.id);
    const { day_offset, sort_order, subject, body_html, body_text, is_recurring } = req.body;
    if (!subject || !body_html) return res.status(400).json({ message: "subject and body_html required" });
    const client = await pool.connect();
    try {
      const r = await client.query(`
        INSERT INTO email_nurturing_templates(sequence_id,day_offset,sort_order,is_recurring,is_active,subject,body_html,body_text)
        VALUES($1,$2,$3,$4,true,$5,$6,$7) RETURNING *
      `, [seqId, day_offset ?? 0, sort_order ?? 99, is_recurring ?? false, subject, body_html, body_text || null]);
      res.status(201).json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
    finally { client.release(); }
  });

  app.put("/api/admin/email-nurturing/templates/:id", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    const id = parseInt(req.params.id);
    const { day_offset, sort_order, subject, body_html, body_text, is_active, is_recurring } = req.body;
    const client = await pool.connect();
    try {
      const r = await client.query(`
        UPDATE email_nurturing_templates SET
          day_offset=COALESCE($2,day_offset), sort_order=COALESCE($3,sort_order),
          subject=COALESCE($4,subject), body_html=COALESCE($5,body_html),
          body_text=COALESCE($6,body_text), is_active=COALESCE($7,is_active),
          is_recurring=COALESCE($8,is_recurring), updated_at=NOW()
        WHERE id=$1 RETURNING *
      `, [id, day_offset, sort_order, subject, body_html, body_text, is_active, is_recurring]);
      if (!r.rows.length) return res.status(404).json({ message: "Not found" });
      res.json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
    finally { client.release(); }
  });

  app.delete("/api/admin/email-nurturing/templates/:id", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    const id = parseInt(req.params.id);
    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM email_nurturing_templates WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
    finally { client.release(); }
  });

  // ── Email history ──────────────────────────────────────────────────────────
  app.get("/api/admin/email-nurturing/history", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const result = await getEmailHistoryPage({
        page:     parseInt(String(req.query.page   || "1")),
        limit:    parseInt(String(req.query.limit  || "50")),
        search:   String(req.query.search  || ""),
        status:   String(req.query.status  || ""),
        dateFrom: String(req.query.dateFrom || ""),
        dateTo:   String(req.query.dateTo   || ""),
      });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // View exact email content for a specific event
  app.get("/api/admin/email-nurturing/events/:id/content", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    const client = await pool.connect();
    try {
      const r = await client.query(`SELECT * FROM lead_email_events WHERE id=$1`, [parseInt(req.params.id)]);
      if (!r.rows.length) return res.status(404).json({ message: "Not found" });
      res.json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
    finally { client.release(); }
  });

  // ── Per-lead nurturing control ─────────────────────────────────────────────
  app.get("/api/admin/email-nurturing/lead/:leadId", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const status = await getLeadNurturingStatus(parseInt(req.params.leadId));
      const events = await getLeadEmailEvents(parseInt(req.params.leadId));
      res.json({ status, events });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/admin/email-nurturing/lead/:leadId/pause", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      await pauseNurturingForLead(parseInt(req.params.leadId), req.body.reason);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/admin/email-nurturing/lead/:leadId/resume", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      await resumeNurturingForLead(parseInt(req.params.leadId));
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/admin/email-nurturing/lead/:leadId/stop", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      await stopNurturingForLead(parseInt(req.params.leadId), req.body.reason || "manual_admin_stop");
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Test send (sends real email, does NOT touch queue or lead records) ────────
  app.post("/api/admin/email-nurturing/send-test", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    const { to, sort_order, first_name } = req.body;
    if (!to || !to.includes("@")) return res.status(400).json({ message: "Valid 'to' email required" });
    try {
      const result = await sendTestNurturingEmail(to, sort_order ?? 1, first_name || "عزيزنا");
      if (!result.ok) return res.status(500).json({ message: result.error });
      res.json(result);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/admin/email-nurturing/lead/:leadId/start", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    const leadId = parseInt(req.params.leadId);
    const client = await pool.connect();
    try {
      const lead = await client.query(`SELECT * FROM crm_leads WHERE id=$1`, [leadId]);
      if (!lead.rows.length) return res.status(404).json({ message: "Lead not found" });
      const l = lead.rows[0];
      await initNurturingForLead(leadId, l.email, { firstName: l.first_name, fullName: l.full_name });
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
    finally { client.release(); }
  });
}
