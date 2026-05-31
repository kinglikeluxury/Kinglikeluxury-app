import { Express } from "express";
import { pool } from "./db";

const PAGE_SIZE = 50;

function adminOnly(req: any, res: any, next: any) {
  if (!req.session?.isAdmin) return res.status(403).json({ message: "Forbidden" });
  next();
}

export function registerAiIntelligenceRoutes(app: Express) {

  // ── Conversations: paginated list with filters ──────────────────────────
  app.get("/api/admin/ai-conversations", adminOnly, async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const offset = (page - 1) * PAGE_SIZE;
      const { search, leadScore, language, dateFrom, dateTo } = req.query as Record<string, string>;
      const conds: string[] = ["1=1"];
      const vals: any[] = [];
      let i = 1;
      if (dateFrom) { conds.push(`c.created_at >= $${i++}`); vals.push(new Date(dateFrom)); }
      if (dateTo) { const t = new Date(dateTo); t.setHours(23,59,59,999); conds.push(`c.created_at <= $${i++}`); vals.push(t); }
      if (language) { conds.push(`c.language = $${i++}`); vals.push(language); }
      if (leadScore && leadScore !== "all") { conds.push(`ip.lead_score = $${i++}`); vals.push(leadScore); }
      if (search) { conds.push(`(u.username ILIKE $${i} OR u.email ILIKE $${i} OR u.phone_number ILIKE $${i})`); vals.push(`%${search}%`); i++; }
      const where = conds.join(" AND ");
      const [countRes, rows] = await Promise.all([
        pool.query(
          `SELECT count(DISTINCT c.id)::int as total
           FROM ai_conversations c
           LEFT JOIN users u ON u.id = c.user_id
           LEFT JOIN investor_profiles ip ON ip.conversation_id = c.id
           WHERE ${where}`, vals),
        pool.query(
          `SELECT c.id, c.user_id, c.language, c.status, c.message_count,
                  c.country, c.city, c.device_type, c.source_page,
                  c.created_at, c.updated_at,
                  u.username, u.email, u.phone_number as phone,
                  ip.lead_score, ip.budget, ip.goal, ip.interested_project
           FROM ai_conversations c
           LEFT JOIN users u ON u.id = c.user_id
           LEFT JOIN investor_profiles ip ON ip.conversation_id = c.id
           WHERE ${where}
           ORDER BY c.created_at DESC
           LIMIT ${PAGE_SIZE} OFFSET ${offset}`, vals),
      ]);
      const total = countRes.rows[0]?.total || 0;
      res.json({ conversations: rows.rows, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) });
    } catch (e: any) {
      console.error("[AI-Intel] conversations:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Single conversation transcript ──────────────────────────────────────
  app.get("/api/admin/ai-conversations/:id/messages", adminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [msgs, profile, conv] = await Promise.all([
        pool.query("SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC", [id]),
        pool.query(
          `SELECT ip.*, u.username, u.email, u.phone_number,
                  a.username as assigned_agent_name
           FROM investor_profiles ip
           LEFT JOIN users u ON u.id = ip.user_id
           LEFT JOIN users a ON a.id = ip.assigned_agent_id
           WHERE ip.conversation_id = $1 LIMIT 1`, [id]),
        pool.query(
          "SELECT c.*, u.username, u.email, u.phone_number FROM ai_conversations c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = $1", [id]),
      ]);
      res.json({ conversation: conv.rows[0] || null, messages: msgs.rows, profile: profile.rows[0] || null });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Leads: paginated list with filters ──────────────────────────────────
  app.get("/api/admin/ai-leads-paged", adminOnly, async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const offset = (page - 1) * PAGE_SIZE;
      const { leadScore, search, dateFrom, dateTo, leadStatus } = req.query as Record<string, string>;
      const conds: string[] = ["1=1"];
      const vals: any[] = [];
      let i = 1;
      if (leadScore && leadScore !== "all") { conds.push(`ip.lead_score = $${i++}`); vals.push(leadScore); }
      if (leadStatus && leadStatus !== "all") { conds.push(`ip.lead_status = $${i++}`); vals.push(leadStatus); }
      if (dateFrom) { conds.push(`ip.created_at >= $${i++}`); vals.push(new Date(dateFrom)); }
      if (dateTo) { const t = new Date(dateTo); t.setHours(23,59,59,999); conds.push(`ip.created_at <= $${i++}`); vals.push(t); }
      if (search) {
        conds.push(`(u.username ILIKE $${i} OR u.email ILIKE $${i} OR ip.whatsapp_contact_number ILIKE $${i} OR ip.country ILIKE $${i} OR ip.interested_project ILIKE $${i})`);
        vals.push(`%${search}%`); i++;
      }
      const where = conds.join(" AND ");
      const [countRes, rows] = await Promise.all([
        pool.query(`SELECT count(*)::int as total FROM investor_profiles ip LEFT JOIN users u ON u.id = ip.user_id WHERE ${where}`, vals),
        pool.query(
          `SELECT ip.*, u.username, u.email,
                  a.username as assigned_agent_name
           FROM investor_profiles ip
           LEFT JOIN users u ON u.id = ip.user_id
           LEFT JOIN users a ON a.id = ip.assigned_agent_id
           WHERE ${where}
           ORDER BY ip.updated_at DESC
           LIMIT ${PAGE_SIZE} OFFSET ${offset}`, vals),
      ]);
      const total = countRes.rows[0]?.total || 0;
      res.json({ leads: rows.rows, total, page, pageSize: PAGE_SIZE, totalPages: Math.ceil(total / PAGE_SIZE) });
    } catch (e: any) {
      console.error("[AI-Intel] leads:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Assign lead to agent ────────────────────────────────────────────────
  app.patch("/api/admin/ai-leads/:id/assign", adminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { assignedAgentId, leadStatus, assignmentNote } = req.body;
      const sets: string[] = ["updated_at = now()"];
      const vals: any[] = [];
      let i = 1;
      if (assignedAgentId !== undefined) { sets.push(`assigned_agent_id = $${i++}`); vals.push(assignedAgentId || null); }
      if (leadStatus !== undefined) { sets.push(`lead_status = $${i++}`); vals.push(leadStatus); }
      if (assignmentNote !== undefined) { sets.push(`assignment_note = $${i++}`); vals.push(assignmentNote); }
      vals.push(id);
      await pool.query(`UPDATE investor_profiles SET ${sets.join(", ")} WHERE id = $${i}`, vals);
      const { rows } = await pool.query(
        `SELECT ip.*, u.username, u.email, a.username as assigned_agent_name
         FROM investor_profiles ip
         LEFT JOIN users u ON u.id = ip.user_id
         LEFT JOIN users a ON a.id = ip.assigned_agent_id
         WHERE ip.id = $1`, [id]);
      res.json(rows[0] || { success: true });
    } catch (e: any) {
      console.error("[AI-Intel] assign:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  // ── Users list for agent picker ─────────────────────────────────────────
  app.get("/api/admin/ai-users", adminOnly, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT id, username, email FROM users ORDER BY username");
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Analytics ───────────────────────────────────────────────────────────
  app.get("/api/admin/ai-analytics", adminOnly, async (req, res) => {
    try {
      const [
        totalConvs, todayConvs, weekConvs, monthConvs,
        totalLeads, hotLeads, warmLeads, coldLeads,
        convsByDay, topCountries, mostRequestedProjects, topLanguages,
        topGoals, topBudgets, topTimelines,
      ] = await Promise.all([
        pool.query("SELECT count(*)::int as c FROM ai_conversations"),
        pool.query("SELECT count(*)::int as c FROM ai_conversations WHERE created_at >= date_trunc('day', now())"),
        pool.query("SELECT count(*)::int as c FROM ai_conversations WHERE created_at >= now() - interval '7 days'"),
        pool.query("SELECT count(*)::int as c FROM ai_conversations WHERE created_at >= date_trunc('month', now())"),
        pool.query("SELECT count(*)::int as c FROM investor_profiles"),
        pool.query("SELECT count(*)::int as c FROM investor_profiles WHERE lead_score = 'hot'"),
        pool.query("SELECT count(*)::int as c FROM investor_profiles WHERE lead_score = 'warm'"),
        pool.query("SELECT count(*)::int as c FROM investor_profiles WHERE lead_score = 'cold'"),
        pool.query("SELECT date_trunc('day', created_at)::date as day, count(*)::int as count FROM ai_conversations WHERE created_at >= now() - interval '14 days' GROUP BY day ORDER BY day ASC"),
        pool.query("SELECT country, count(*)::int as count FROM investor_profiles WHERE country IS NOT NULL AND country != '' GROUP BY country ORDER BY count DESC LIMIT 10"),
        pool.query(`
          SELECT
            ip.interested_project as project,
            count(*)::int as mention_count,
            count(DISTINCT ip.conversation_id)::int as conversation_count,
            count(DISTINCT ip.id)::int as lead_count
          FROM investor_profiles ip
          WHERE ip.interested_project IS NOT NULL AND ip.interested_project != ''
          GROUP BY ip.interested_project
          ORDER BY lead_count DESC, conversation_count DESC
          LIMIT 10`),
        pool.query("SELECT language, count(*)::int as count FROM ai_conversations WHERE language IS NOT NULL GROUP BY language ORDER BY count DESC LIMIT 10"),
        pool.query("SELECT goal, count(*)::int as count FROM investor_profiles WHERE goal IS NOT NULL AND goal != '' GROUP BY goal ORDER BY count DESC LIMIT 8"),
        pool.query("SELECT budget, count(*)::int as count FROM investor_profiles WHERE budget IS NOT NULL AND budget != '' GROUP BY budget ORDER BY count DESC LIMIT 8"),
        pool.query("SELECT timeline, count(*)::int as count FROM investor_profiles WHERE timeline IS NOT NULL AND timeline != '' GROUP BY timeline ORDER BY count DESC LIMIT 8"),
      ]);
      const hot = hotLeads.rows[0]?.c || 0;
      const warm = warmLeads.rows[0]?.c || 0;
      const cold = coldLeads.rows[0]?.c || 0;
      const total = totalLeads.rows[0]?.c || 0;
      res.json({
        stats: {
          totalConversations: totalConvs.rows[0]?.c || 0,
          todayConversations: todayConvs.rows[0]?.c || 0,
          weekConversations: weekConvs.rows[0]?.c || 0,
          monthConversations: monthConvs.rows[0]?.c || 0,
          totalLeads: total, hotLeads: hot, warmLeads: warm, coldLeads: cold,
          averageLeadScore: total > 0 ? Math.round((hot * 90 + warm * 65 + cold * 25) / total) : 0,
        },
        convsByDay: convsByDay.rows,
        topCountries: topCountries.rows,
        mostRequestedProjects: mostRequestedProjects.rows,
        topLanguages: topLanguages.rows,
        topGoals: topGoals.rows,
        topBudgets: topBudgets.rows,
        topTimelines: topTimelines.rows,
      });
    } catch (e: any) {
      console.error("[AI-Intel] analytics:", e.message);
      res.status(500).json({ message: e.message });
    }
  });
}
