import type { Express, Request, RequestHandler } from "express";
import type { Pool } from "pg";
import {
  getAiBlogProviderReadiness,
  isAllowedAiBlogMarket,
  isPublishableAiDraft,
  normalizeAiDraftUpdate,
} from "./aiBlogDraftPolicy";

type UserLike = { id: number; isAdmin?: boolean } | undefined;

export interface AiBlogDraftRouteDependencies {
  pool: Pick<Pool, "query" | "connect">;
  isAuthenticated: RequestHandler;
  isAdmin: RequestHandler;
  getUser: (id: number) => Promise<UserLike>;
}

/**
 * Shared AI-draft HTTP routes. The isolated local integration harness injects
 * its own pool, auth middleware, and user lookup; it never imports app startup.
 */
export function registerAiBlogDraftRoutes(
  app: Express,
  { pool, isAuthenticated, isAdmin, getUser }: AiBlogDraftRouteDependencies,
) {
  app.get("/api/admin/ai-blog/status", isAuthenticated, isAdmin, async (_req, res) => {
    try {
      const [settings, drafts] = await Promise.all([
        pool.query("SELECT enabled, time_georgia, updated_at FROM ai_blog_schedule_settings WHERE id=1"),
        pool.query("SELECT id,business_date,country,status,title,content,keywords,seo_description,slug,cover_image,sources,review_note,safe_error_code,attempt_count,published_post_id,created_at,updated_at FROM ai_blog_drafts ORDER BY business_date DESC, country ASC LIMIT 100"),
      ]);
      res.json({
        configured: true,
        readiness: getAiBlogProviderReadiness(),
        schedule: settings.rows[0] ?? { enabled: false, time_georgia: "09:00", updated_at: null },
        drafts: drafts.rows,
      });
    } catch {
      res.status(503).json({
        configured: false,
        readiness: getAiBlogProviderReadiness(),
        message: "يلزم تطبيق ترحيل قاعدة البيانات الإضافي قبل استخدام لوحة المسودات.",
        schedule: { enabled: false, time_georgia: "09:00" },
        drafts: [],
      });
    }
  });

  app.put("/api/admin/ai-blog/schedule", isAuthenticated, isAdmin, async (req, res) => {
    const time = req.body?.timeGeorgia;
    if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return res.status(400).json({ message: "صيغة الوقت المطلوبة HH:MM بتوقيت جورجيا." });
    }
    const readiness = getAiBlogProviderReadiness();
    const enabled = req.body?.enabled === true && readiness.schedulerEnabled;
    try {
      const result = await pool.query(
        `INSERT INTO ai_blog_schedule_settings (id,enabled,time_georgia,updated_at)
         VALUES (1,$1,$2,NOW())
         ON CONFLICT (id) DO UPDATE SET enabled=EXCLUDED.enabled,time_georgia=EXCLUDED.time_georgia,updated_at=NOW()
         RETURNING enabled,time_georgia,updated_at`,
        [enabled, time],
      );
      res.json({ schedule: result.rows[0], readiness });
    } catch {
      res.status(503).json({ message: "ترحيل قاعدة البيانات غير مطبق؛ لم يتم حفظ الإعداد." });
    }
  });

  app.post("/api/admin/ai-blog/run-now", isAuthenticated, isAdmin, (_req, res) => {
    res.status(503).json({
      code: "AI_BLOG_GENERATION_DISABLED",
      message: "إنشاء المسودات متوقف حتى اعتماد التكلفة وإعداد مزودي البحث والنص والصور.",
    });
  });

  app.post("/api/admin/ai-blog/drafts/:id/retry", isAuthenticated, isAdmin, (_req, res) => {
    res.status(503).json({
      code: "AI_BLOG_GENERATION_DISABLED",
      message: "إعادة المحاولة متوقفة؛ لم يتم إنشاء طلب أو استدعاء أي مزود.",
    });
  });

  app.put("/api/admin/ai-blog/drafts/:id", isAuthenticated, isAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: "معرّف المسودة غير صالح." });
    const update = normalizeAiDraftUpdate(req.body ?? {});
    const entries = Object.entries(update).filter(([, value]) => value !== undefined);
    if (!entries.length) return res.status(400).json({ message: "لا توجد حقول صالحة للحفظ." });
    const setSql = entries.map(([key], index) => `"${key}"=$${index + 1}`).join(",");
    try {
      const result = await pool.query(
        `UPDATE ai_blog_drafts SET ${setSql},updated_at=NOW() WHERE id=$${entries.length + 1} AND status <> 'published' RETURNING *`,
        [...entries.map(([, value]) => value), id],
      );
      if (!result.rowCount) return res.status(404).json({ message: "المسودة غير موجودة أو منشورة." });
      res.json({ draft: result.rows[0] });
    } catch {
      res.status(503).json({ message: "تعذر حفظ المسودة؛ تحقق من تطبيق ترحيل قاعدة البيانات." });
    }
  });

  app.post("/api/admin/ai-blog/drafts/:id/publish", isAuthenticated, isAdmin, async (req: Request, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0 || !req.session?.userId) {
      return res.status(400).json({ message: "معرّف المسودة غير صالح." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM ai_blog_drafts WHERE id=$1 FOR UPDATE", [id]);
      const draft = rows[0];
      if (!draft || draft.status === "published") {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "المسودة غير موجودة أو سبق نشرها." });
      }
      if (!isAllowedAiBlogMarket(draft.country) || !isPublishableAiDraft(draft)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: "لا يمكن النشر قبل اكتمال المراجعة والعنوان والمحتوى والرابط والصورة." });
      }
      const author = await getUser(req.session.userId);
      if (!author?.isAdmin) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "صلاحية النشر غير متاحة." });
      }
      const excerpt = draft.seo_description || draft.content.slice(0, 200);
      const post = await client.query(
        `INSERT INTO blog_posts (title,slug,content,excerpt,cover_image,author_id,categories,country,translations,published,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,TRUE,NOW(),NOW()) RETURNING id,slug,published`,
        [draft.title,draft.slug,draft.content,excerpt,draft.cover_image,author.id,
          JSON.stringify(draft.keywords ?? []),draft.country,
          JSON.stringify({ ar: { title: draft.title, content: draft.content, excerpt, metaDescription: draft.seo_description, slug: draft.slug, keywords: draft.keywords ?? [] } })],
      );
      await client.query(
        "UPDATE ai_blog_drafts SET status='published',published_post_id=$1,updated_at=NOW() WHERE id=$2",
        [post.rows[0].id,id],
      );
      await client.query("COMMIT");
      return res.json({ post: post.rows[0] });
    } catch (error: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error?.code === "23505") return res.status(409).json({ message: "رابط المقال مستخدم بالفعل؛ عدّل الرابط قبل النشر." });
      return res.status(503).json({ message: "تعذر إتمام النشر. لم يتم كشف تفاصيل داخلية." });
    } finally {
      client.release();
    }
  });
}
