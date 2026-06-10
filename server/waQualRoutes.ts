/**
 * WA Qualification Admin Routes
 *
 * GET  /api/admin/wa-qual/lead/:leadId          — session + answers for a lead
 * POST /api/admin/wa-qual/lead/:leadId/restart  — restart qualification flow
 * PATCH /api/admin/wa-qual/lead/:leadId/score   — manually override score
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
      await restartQualification(leadId);
      res.json({ ok: true });
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
}
