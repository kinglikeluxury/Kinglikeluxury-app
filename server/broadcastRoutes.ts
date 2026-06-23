/**
 * Broadcast Routes — admin-only API for bulk email campaigns.
 */

import type { Express } from "express";
import { pool } from "./db";
import {
  countBroadcastRecipients,
  buildBroadcastRecipients,
  sendBroadcastTestEmail,
  startBroadcastRunner,
  pauseBroadcastRunner,
  resumeBroadcastRunner,
  stopBroadcastRunner,
  type BroadcastFilterConfig,
} from "./broadcastService";

function adminOnly(req: any, res: any): boolean {
  if (!req.session?.userId)  { res.status(401).json({ message: "Not authenticated" }); return false; }
  if (!req.session?.isAdmin) { res.status(403).json({ message: "Admin only" });         return false; }
  return true;
}

async function getBroadcastWithStats(id: number) {
  const result = await pool.query(
    `SELECT b.*,
       COUNT(r.id)                                          AS total_recipients,
       COUNT(r.id) FILTER (WHERE r.status = 'sent')        AS sent_count,
       COUNT(r.id) FILTER (WHERE r.status = 'failed')      AS failed_count,
       COUNT(r.id) FILTER (WHERE r.status = 'pending')     AS pending_count
     FROM email_broadcasts b
     LEFT JOIN email_broadcast_recipients r ON r.broadcast_id = b.id
     WHERE b.id = $1
     GROUP BY b.id`,
    [id],
  );
  return result.rows[0] ?? null;
}

export function registerBroadcastRoutes(app: Express): void {

  // ── List all broadcasts ──────────────────────────────────────────────────
  app.get("/api/admin/broadcast", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const result = await pool.query(
        `SELECT b.*,
           COUNT(r.id)                                          AS total_recipients,
           COUNT(r.id) FILTER (WHERE r.status = 'sent')        AS sent_count,
           COUNT(r.id) FILTER (WHERE r.status = 'failed')      AS failed_count,
           COUNT(r.id) FILTER (WHERE r.status = 'pending')     AS pending_count
         FROM email_broadcasts b
         LEFT JOIN email_broadcast_recipients r ON r.broadcast_id = b.id
         GROUP BY b.id
         ORDER BY b.created_at DESC`,
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Get single broadcast ─────────────────────────────────────────────────
  app.get("/api/admin/broadcast/:id", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const bc = await getBroadcastWithStats(parseInt(req.params.id, 10));
      if (!bc) return res.status(404).json({ message: "Broadcast not found" });
      res.json(bc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Create broadcast (draft) ─────────────────────────────────────────────
  app.post("/api/admin/broadcast", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const { name, subject, body_html, image_url, filter_config, batch_size, batch_delay_ms } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "name is required" });

      const result = await pool.query(
        `INSERT INTO email_broadcasts (name, subject, body_html, image_url, filter_config, batch_size, batch_delay_ms, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          name.trim(),
          (subject ?? "").trim(),
          body_html ?? "",
          image_url ?? null,
          JSON.stringify(filter_config ?? {}),
          batch_size ?? 10,
          batch_delay_ms ?? 600000,
          req.session.userId,
        ],
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Update broadcast (draft only) ────────────────────────────────────────
  app.put("/api/admin/broadcast/:id", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await pool.query("SELECT * FROM email_broadcasts WHERE id=$1", [id]);
      const bc = existing.rows[0];
      if (!bc) return res.status(404).json({ message: "Broadcast not found" });
      if (!["draft", "test_sent"].includes(bc.status)) {
        return res.status(409).json({ message: `Cannot edit a broadcast with status '${bc.status}'` });
      }

      const { name, subject, body_html, image_url, filter_config, batch_size, batch_delay_ms } = req.body;
      const result = await pool.query(
        `UPDATE email_broadcasts SET
           name          = COALESCE($1, name),
           subject       = COALESCE($2, subject),
           body_html     = COALESCE($3, body_html),
           image_url     = $4,
           filter_config = COALESCE($5, filter_config),
           batch_size    = COALESCE($6, batch_size),
           batch_delay_ms= COALESCE($7, batch_delay_ms),
           updated_at    = NOW()
         WHERE id = $8
         RETURNING *`,
        [
          name ?? null,
          subject ?? null,
          body_html ?? null,
          image_url !== undefined ? (image_url ?? null) : bc.image_url,
          filter_config ? JSON.stringify(filter_config) : null,
          batch_size ?? null,
          batch_delay_ms ?? null,
          id,
        ],
      );
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Delete broadcast (draft / cancelled only) ────────────────────────────
  app.delete("/api/admin/broadcast/:id", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = parseInt(req.params.id, 10);
      const existing = await pool.query("SELECT status FROM email_broadcasts WHERE id=$1", [id]);
      const bc = existing.rows[0];
      if (!bc) return res.status(404).json({ message: "Broadcast not found" });
      if (!["draft", "test_sent", "cancelled", "completed"].includes(bc.status)) {
        return res.status(409).json({ message: "Stop the broadcast before deleting" });
      }
      await pool.query("DELETE FROM email_broadcasts WHERE id=$1", [id]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Preview recipient count ──────────────────────────────────────────────
  app.post("/api/admin/broadcast/preview-count", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const filters: BroadcastFilterConfig = req.body.filters ?? {};
      const count = await countBroadcastRecipients(filters);
      res.json({ count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Send test email ──────────────────────────────────────────────────────
  app.post("/api/admin/broadcast/:id/send-test", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = parseInt(req.params.id, 10);
      const { to_email, first_name } = req.body;
      if (!to_email) return res.status(400).json({ message: "to_email required" });

      const result = await sendBroadcastTestEmail(id, to_email, first_name);
      if (!result.ok) return res.status(502).json({ message: result.error });

      // Mark as test_sent so approve gate opens
      await pool.query(
        `UPDATE email_broadcasts SET status='test_sent', test_sent_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND status='draft'`,
        [id],
      );

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Approve & start sending ──────────────────────────────────────────────
  app.post("/api/admin/broadcast/:id/approve", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = parseInt(req.params.id, 10);
      const bcResult = await pool.query("SELECT * FROM email_broadcasts WHERE id=$1", [id]);
      const bc = bcResult.rows[0];
      if (!bc) return res.status(404).json({ message: "Broadcast not found" });
      if (bc.status === "draft") {
        return res.status(409).json({ message: "Send a test email first before bulk sending" });
      }
      if (!["test_sent"].includes(bc.status)) {
        return res.status(409).json({ message: `Broadcast is already '${bc.status}'` });
      }

      const filters: BroadcastFilterConfig = bc.filter_config ?? {};
      const count = await buildBroadcastRecipients(id, filters);
      if (count === 0) {
        return res.status(400).json({ message: "No recipients found with the selected filters" });
      }

      await pool.query(
        `UPDATE email_broadcasts SET status='approved', approved_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [id],
      );

      // Start runner async (non-blocking)
      await startBroadcastRunner(id);

      res.json({ ok: true, recipients: count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Pause ────────────────────────────────────────────────────────────────
  app.post("/api/admin/broadcast/:id/pause", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = parseInt(req.params.id, 10);
      pauseBroadcastRunner(id);
      await pool.query(
        `UPDATE email_broadcasts SET status='paused', updated_at=NOW() WHERE id=$1 AND status='running'`,
        [id],
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Resume ───────────────────────────────────────────────────────────────
  app.post("/api/admin/broadcast/:id/resume", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = parseInt(req.params.id, 10);
      const bcResult = await pool.query("SELECT status FROM email_broadcasts WHERE id=$1", [id]);
      const bc = bcResult.rows[0];
      if (!bc) return res.status(404).json({ message: "Not found" });

      if (bc.status === "paused") {
        const inMemory = resumeBroadcastRunner(id);
        if (!inMemory) {
          // Runner was lost on restart — restart it
          await startBroadcastRunner(id);
        } else {
          await pool.query(
            `UPDATE email_broadcasts SET status='running', updated_at=NOW() WHERE id=$1`,
            [id],
          );
        }
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Stop / Cancel ────────────────────────────────────────────────────────
  app.post("/api/admin/broadcast/:id/stop", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = parseInt(req.params.id, 10);
      stopBroadcastRunner(id);
      await pool.query(
        `UPDATE email_broadcasts SET status='cancelled', updated_at=NOW() WHERE id=$1`,
        [id],
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Recipients list (paginated) ──────────────────────────────────────────
  app.get("/api/admin/broadcast/:id/recipients", async (req: any, res) => {
    if (!adminOnly(req, res)) return;
    try {
      const id = parseInt(req.params.id, 10);
      const page  = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10) || 1);
      const limit = Math.min(100, parseInt(String(req.query.limit ?? "50"), 10) || 50);
      const offset = (page - 1) * limit;
      const statusFilter = req.query.status ? String(req.query.status) : null;

      const whereExtra = statusFilter ? " AND status = $3" : "";
      const params: any[] = [id, limit];
      if (statusFilter) params.push(statusFilter);

      const [rowsResult, countResult] = await Promise.all([
        pool.query(
          `SELECT * FROM email_broadcast_recipients WHERE broadcast_id=$1 ${whereExtra} ORDER BY id DESC LIMIT $2 OFFSET ${offset}`,
          params,
        ),
        pool.query(
          `SELECT COUNT(*) FROM email_broadcast_recipients WHERE broadcast_id=$1 ${whereExtra}`,
          statusFilter ? [id, statusFilter] : [id],
        ),
      ]);

      res.json({
        recipients: rowsResult.rows,
        total: parseInt(countResult.rows[0]?.count ?? "0", 10),
        page,
        limit,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
