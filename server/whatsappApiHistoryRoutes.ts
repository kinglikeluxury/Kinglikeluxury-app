/**
 * WhatsApp API Chat History — Admin-Only Routes
 *
 * All endpoints require req.session.isAdmin === true.
 * Server-side check — frontend hiding alone is not sufficient.
 */

import { type Express, type Request, type Response } from "express";
import { pool } from "./db";

function adminOnly(req: Request, res: Response): boolean {
  if (!req.session?.userId || !req.session?.isAdmin) {
    res.status(403).json({ message: "Admin access required" });
    return false;
  }
  return true;
}

export function registerWhatsappApiHistoryRoutes(app: Express): void {

  // ── GET /api/admin/whatsapp-api/conversations ───────────────────────────────
  // List all conversations with optional filters.
  // Query params: search, source, agentId, dateFrom, dateTo, page, limit
  app.get("/api/admin/whatsapp-api/conversations", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;

    const {
      search   = "",
      source   = "",
      agentId  = "",
      dateFrom = "",
      dateTo   = "",
      page     = "1",
      limit    = "50",
    } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page,  10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset   = (pageNum - 1) * limitNum;

    const conditions: string[] = [];
    const params: any[]        = [];
    let   p                    = 1;

    if (search) {
      conditions.push(`(c.phone_number ILIKE $${p} OR c.contact_name ILIKE $${p} OR cl.full_name ILIKE $${p})`);
      params.push(`%${search}%`);
      p++;
    }
    if (source) {
      conditions.push(`c.source = $${p}`);
      params.push(source);
      p++;
    }
    if (agentId) {
      conditions.push(`c.assigned_agent_id = $${p}`);
      params.push(parseInt(agentId, 10));
      p++;
    }
    if (dateFrom) {
      conditions.push(`c.last_message_at >= $${p}`);
      params.push(dateFrom);
      p++;
    }
    if (dateTo) {
      conditions.push(`c.last_message_at <= $${p}::date + interval '1 day'`);
      params.push(dateTo);
      p++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const client = await pool.connect();
    try {
      const countResult = await client.query(`
        SELECT COUNT(*) FROM whatsapp_api_conversations c
        LEFT JOIN crm_leads cl ON cl.id = c.lead_id
        ${where}
      `, params);
      const total = parseInt(countResult.rows[0].count, 10);

      const rows = await client.query(`
        SELECT
          c.id,
          c.phone_number,
          c.contact_name,
          c.lead_id,
          c.last_message_at,
          c.last_message_preview,
          c.unread_count,
          c.source,
          c.assigned_agent_id,
          c.created_at,
          COALESCE(cl.full_name, c.contact_name) AS crm_name,
          u.username                              AS assigned_agent_name,
          (SELECT COUNT(*) FROM whatsapp_api_messages m WHERE m.conversation_id = c.id) AS message_count
        FROM whatsapp_api_conversations c
        LEFT JOIN crm_leads cl ON cl.id = c.lead_id
        LEFT JOIN users     u  ON u.id  = c.assigned_agent_id
        ${where}
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT $${p} OFFSET $${p + 1}
      `, [...params, limitNum, offset]);

      res.json({ rows: rows.rows, total, page: pageNum, limit: limitNum });
    } finally {
      client.release();
    }
  });

  // ── GET /api/admin/whatsapp-api/conversations/:id/messages ─────────────────
  // Full message thread for one conversation.
  app.get("/api/admin/whatsapp-api/conversations/:id/messages", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;

    const convId = parseInt(req.params.id, 10);
    if (!convId) return void res.status(400).json({ message: "Invalid conversation ID" });

    const client = await pool.connect();
    try {
      const convResult = await client.query(`
        SELECT
          c.*,
          COALESCE(cl.full_name, c.contact_name) AS crm_name,
          cl.phone                                AS crm_phone,
          u.username                              AS assigned_agent_name
        FROM whatsapp_api_conversations c
        LEFT JOIN crm_leads cl ON cl.id = c.lead_id
        LEFT JOIN users     u  ON u.id  = c.assigned_agent_id
        WHERE c.id = $1
      `, [convId]);

      if (!convResult.rows.length) {
        return void res.status(404).json({ message: "Conversation not found" });
      }

      const messages = await client.query(`
        SELECT
          id, direction, message_text, message_type,
          wamid, status, context_label, error_message, created_at, updated_at
        FROM whatsapp_api_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC
      `, [convId]);

      res.json({
        conversation: convResult.rows[0],
        messages:     messages.rows,
      });
    } finally {
      client.release();
    }
  });

  // ── GET /api/admin/whatsapp-api/stats ──────────────────────────────────────
  // Summary stats for the header banner.
  app.get("/api/admin/whatsapp-api/stats", async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;

    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT
          (SELECT COUNT(*) FROM whatsapp_api_conversations)                                          AS total_conversations,
          (SELECT COUNT(*) FROM whatsapp_api_messages WHERE direction = 'outbound')                  AS total_outbound,
          (SELECT COUNT(*) FROM whatsapp_api_messages WHERE direction = 'inbound')                   AS total_inbound,
          (SELECT COUNT(*) FROM whatsapp_api_messages WHERE status = 'failed')                       AS total_failed,
          (SELECT COUNT(*) FROM whatsapp_api_messages WHERE status IN ('delivered','read'))          AS total_delivered,
          (SELECT COUNT(*) FROM whatsapp_api_messages WHERE created_at > NOW() - interval '24 hours') AS last_24h
      `);
      res.json(result.rows[0]);
    } finally {
      client.release();
    }
  });
}
