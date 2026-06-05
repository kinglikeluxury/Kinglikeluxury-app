import dotenv from "dotenv";
dotenv.config();
console.log("[Startup] RESEND_API_KEY:", process.env.RESEND_API_KEY ? `SET (len=${process.env.RESEND_API_KEY.length})` : "NOT SET");
import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startScheduler } from "./schedulerService";
import { startDailyBackup } from "./dailyBackup";
import { logDatabaseStatus, ensureCrmIndexes, ensureMetaLeadsTables } from "./db";
import { startMetaLeadsProcessor } from "./metaLeadsService";
import { generateSitemapXml } from "./sitemapGenerator";
import { storage } from "./storage";
import { translateText, detectLanguage } from "./translate";

const app = express();

// ─────────────────────────────────────────────────────────────────────────────
// SITEMAP & ROBOTS — registered ABSOLUTELY FIRST, before CORS, before
// express.static, before Vite middleware, before everything.
// This guarantees no middleware or static-file handler can intercept these URLs
// and accidentally return index.html (which would make Google think it's HTML).
// ─────────────────────────────────────────────────────────────────────────────
app.get("/sitemap.xml", async (_req, res) => {
  try {
    const xml = await generateSitemapXml();
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.removeHeader("X-Powered-By");
    res.end(xml);
  } catch (err) {
    console.error("[Sitemap] Error:", err);
    res.status(500).type("text/plain").end("Error generating sitemap");
  }
});

app.get("/robots.txt", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.end(
    "User-agent: *\nAllow: /\n\nSitemap: https://www.kinglikeluxury.app/sitemap.xml\n"
  );
});
// ─────────────────────────────────────────────────────────────────────────────

app.use(
  cors({
    origin: [
      "https://kinglikeluxury.app",
      "https://www.kinglikeluxury.app",
      "https://real-estate-hub-kinglikeluxury.replit.app",
    ],
    credentials: true,
  })
);

app.use(express.json({
  limit: "50mb",
  verify: (req: any, _res, buf) => {
    if (req.path === "/api/webhooks/meta-leads") {
      req.rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));

app.set("trust proxy", 1);

// Prevent CDN/proxy caching of all API responses
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  app.use("/locales", express.static(path.join(process.cwd(), "public/locales")));

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error(
      `[Express:Error] ${status} ${message}`,
      err.stack?.split("\n").slice(0, 3).join(" | ") ?? ""
    );
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });

  // Guard: any /api/* path that didn't match a registered route must return
  // JSON — never fall through to the SPA index.html catch-all.
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ message: "API endpoint not found" });
  });

  // Use Vite dev middleware only when explicitly in development AND
  // the built dist/public directory does NOT exist yet.
  // This prevents accidentally running Vite in production when NODE_ENV
  // is not set (Express defaults app.get("env") to "development").
  const distPublic = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "public"
  );
  const isDevMode =
    process.env.NODE_ENV !== "production" && !fs.existsSync(distPublic);

  if (isDevMode) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    }
  );

  server.timeout = 600000;
  server.keepAliveTimeout = 620000;
  server.headersTimeout = 630000;

  startScheduler();
  startDailyBackup();

  // Log active database status after server is up
  logDatabaseStatus().catch(err =>
    console.error("[DB] Failed to log database status:", err)
  );

  // Ensure CRM performance indexes exist (idempotent — IF NOT EXISTS)
  ensureCrmIndexes().catch(err =>
    console.error("[DB] ensureCrmIndexes failed:", err)
  );

  ensureMetaLeadsTables()
    .then(() => startMetaLeadsProcessor())
    .catch(err => console.error("[DB] ensureMetaLeadsTables failed:", err));

  // ─── Auto-retranslate blog posts for newly added languages ───────────────
  const NEW_LANGS = ["fa", "nl", "de", "sv", "fr", "it"];
  (async () => {
    try {
      const posts = await storage.getBlogPosts();
      let updated = 0;
      for (const post of posts) {
        const existing: any = (post as any).translations ?? {};
        const missing = NEW_LANGS.filter(l => !existing[l]);
        if (missing.length === 0) continue;

        const detectedLang = await detectLanguage(post.title + " " + post.content.substring(0, 200));
        const sourceTitle   = existing[detectedLang]?.title   ?? existing["en"]?.title   ?? post.title;
        const sourceContent = existing[detectedLang]?.content ?? existing["en"]?.content ?? post.content;
        const sourceExcerpt = existing[detectedLang]?.excerpt ?? existing["en"]?.excerpt ?? (post as any).excerpt ?? "";

        const newTranslations: any = { ...existing };
        for (const lang of missing) {
          try {
            const [tTitle, tContent, tExcerpt] = await Promise.all([
              translateText(sourceTitle, lang, detectedLang),
              translateText(sourceContent, lang, detectedLang),
              translateText(sourceExcerpt, lang, detectedLang),
            ]);
            newTranslations[lang] = { title: tTitle, content: tContent, excerpt: tExcerpt };
          } catch (e) {
            console.error(`[AutoTranslate] lang=${lang} post=${post.id}:`, e);
          }
        }
        await storage.updateBlogPost(post.id, { translations: newTranslations } as any);
        updated++;
        console.log(`[AutoTranslate] Post ${post.id} — added: ${missing.join(", ")}`);
      }
      if (updated > 0) console.log(`[AutoTranslate] Done — ${updated}/${posts.length} posts updated`);
    } catch (err) {
      console.error("[AutoTranslate] Startup retranslation failed:", err);
    }
  })();
})();
