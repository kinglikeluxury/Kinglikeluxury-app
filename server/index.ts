import dotenv from "dotenv";
dotenv.config();
console.log("[Startup] RESEND_API_KEY:", process.env.RESEND_API_KEY ? `SET (len=${process.env.RESEND_API_KEY.length})` : "NOT SET");

// ── Neon WebSocket crash guard ────────────────────────────────────────────────
// @neondatabase/serverless has a known bug where it tries to set ErrorEvent.message
// (read-only getter in the ws library) when a WebSocket connection drops.
// This throws an uncaught TypeError that kills the Node process.
// We catch ONLY that specific error and log it — all other uncaught exceptions
// are re-thrown so genuine application bugs still surface and crash as expected.
process.on("uncaughtException", (err: Error) => {
  const isNeonWsReadOnlyError =
    err instanceof TypeError &&
    err.message.includes("Cannot set property message of") &&
    err.stack?.includes("@neondatabase/serverless");

  if (isNeonWsReadOnlyError) {
    console.warn("[NeonWS] Suppressed known Neon WebSocket ErrorEvent.message bug — server continues running.", err.message);
    return;
  }

  // Re-throw everything else so the process exits on real errors
  console.error("[Process] Uncaught exception:", err);
  process.exit(1);
});
// ─────────────────────────────────────────────────────────────────────────────
import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startScheduler } from "./schedulerService";
import { startDailyBackup } from "./dailyBackup";
import { startCrmTaskReminderScheduler } from "./crmTaskReminderService";
import { logDatabaseStatus, ensureCrmIndexes, ensureMetaLeadsTables, ensureWhatsappAiTables, ensureDeveloperRegistrationTables, ensureWhatsAppApiTables, ensureWaQualTables, ensureAiMarketingTables, ensureAiMarketingRevenueTables, ensureAiCampaignAttributionTables, ensureAiCreativeAttributionTable, ensureAiCreativeDraftsTable, ensureAiCampaignDraftTables, ensureProjectMarketingTables, ensureLearningEngineTables } from "./db";
import { ensureMetaIntelligenceTables } from "./metaIntelligenceSyncService";
import { startMetaLeadsProcessor, startPullSyncScheduler } from "./metaLeadsService";
import { ensureAssignmentCursor } from "./leadAssignmentService";
import { ensureCrmLeadEmailLogTable } from "./crmLeadEmailService";
import { registerWhatsappAiRoutes } from "./whatsappAiRoutes";
import { registerDeveloperRegistrationRoutes, ensureDeveloperRegistrationRouteTables } from "./developerRegistrationRoutes";
import { startDeveloperRegistrationScheduler } from "./developerRegistrationService";
import { registerEmailNurturingRoutes } from "./emailNurturingRoutes";
import { registerWhatsappApiHistoryRoutes } from "./whatsappApiHistoryRoutes";
import { registerWaQualRoutes } from "./waQualRoutes";
import { startWaQualScheduler } from "./waQualScheduler";
import { registerWebinarCampaignRoutes } from "./webinarCampaign";
import { registerBroadcastRoutes } from "./broadcastRoutes";
import { ensureBroadcastTables, resumePendingBroadcasts } from "./broadcastService";
import { ensureAiConciergeColumns } from "./waAiConcierge";
import { ensureEmailNurturingTables, startNurturingScheduler } from "./emailNurturingService";
import { generateSitemapXml } from "./sitemapGenerator";
import { storage } from "./storage";
import { translateText, detectLanguage } from "./translate";
import { validateMetaWhatsAppConfig } from "./services/metaWhatsAppService";

const app = express();

// ─────────────────────────────────────────────────────────────────────────────
// SITEMAP & ROBOTS — registered ABSOLUTELY FIRST, before CORS, before
// express.static, before Vite middleware, before everything.
// This guarantees no middleware or static-file handler can intercept these URLs
// and accidentally return index.html (which would make Google think it's HTML).
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight healthcheck — no DB, no file I/O, always 200
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, ts: Date.now() });
});

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
    "User-agent: *\nAllow: /\nDisallow: /invest-georgia-il\n\nSitemap: https://www.kinglikeluxury.app/sitemap.xml\n"
  );
});
// ─────────────────────────────────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://challenges.cloudflare.com",
          "https://www.googletagmanager.com",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
          "data:",
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://res.cloudinary.com",
          "https://lh3.googleusercontent.com",
          "https://graph.facebook.com",
          "https://*.tile.openstreetmap.org",
          "https://flagcdn.com",
          "https://images.unsplash.com",
          "https://cdnjs.cloudflare.com",
          "https://*.basemaps.cartocdn.com",
          "https://www.google-analytics.com",
          "https://www.googleadservices.com",
          "https://googleads.g.doubleclick.net",
          "https://www.google.com",
        ],
        mediaSrc: [
          "'self'",
          "blob:",
          "https://res.cloudinary.com",
        ],
        connectSrc: [
          "'self'",
          "https://api.cloudinary.com",
          "https://res.cloudinary.com",
          "https://challenges.cloudflare.com",
          "https://nominatim.openstreetmap.org",
          "https://api.ip-api.com",
          "http://ip-api.com",
          "https://www.google-analytics.com",
          "https://www.googleadservices.com",
          "https://googleads.g.doubleclick.net",
          "https://www.google.com",
          "wss:",
          "ws:",
        ],
        frameSrc: [
          "'self'",
          "https://challenges.cloudflare.com",
        ],
        frameAncestors: process.env.NODE_ENV === "production"
          ? ["'self'"]
          : [
              "'self'",
              "https://*.replit.dev",
              "https://*.picard.replit.dev",
              "https://replit.com",
            ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xFrameOptions: process.env.NODE_ENV === "production" ? { action: "sameorigin" } : false,
    strictTransportSecurity: process.env.NODE_ENV === "production"
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
  })
);

const PRODUCTION_ORIGINS = [
  "https://kinglikeluxury.app",
  "https://www.kinglikeluxury.app",
  "https://real-estate-hub-kinglikeluxury.replit.app",
];

const corsOriginFn: cors.CorsOptionsDelegate = (req, callback) => {
  const origin = (req as Request).headers.origin || "";
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    callback(null, { origin: PRODUCTION_ORIGINS.includes(origin), credentials: true });
  } else {
    // Development: allow production domains + any Replit dev/preview domain
    const allowed =
      PRODUCTION_ORIGINS.includes(origin) ||
      /^https?:\/\/(localhost|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin) ||
      origin.endsWith(".replit.dev") ||
      origin.endsWith(".picard.replit.dev") ||
      origin === "";
    callback(null, { origin: allowed, credentials: true });
  }
};

app.use(cors(corsOriginFn));

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
  registerWhatsappAiRoutes(app);
  registerDeveloperRegistrationRoutes(app);
  registerEmailNurturingRoutes(app);
  registerWhatsappApiHistoryRoutes(app);
  registerWaQualRoutes(app);
  registerWebinarCampaignRoutes(app);
  registerBroadcastRoutes(app);

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
    try {
      serveStatic(app);
    } catch (err: any) {
      console.error(
        "[Startup] serveStatic failed (dist/public missing?):",
        err.message
      );
      // Fallback: port still opens so /health passes; SPA routes return 503
      app.use("*", (_req: Request, res: Response) => {
        res.status(503).type("text/html").end(
          "<h1>Application starting</h1><p>Frontend assets are being built. Please wait and refresh.</p>"
        );
      });
    }
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

  const schedulersEnabled = process.env.ENABLE_BACKGROUND_SCHEDULERS === "true";
  const metaLeadsProcessorEnabled = process.env.ENABLE_META_LEADS_PROCESSOR === "true";
  if (schedulersEnabled) {
    startScheduler();
    startDailyBackup();
  } else {
    console.log("[Schedulers] Disabled by ENABLE_BACKGROUND_SCHEDULERS — set to 'true' to enable background processing");
  }
  // CRM task reminders are lightweight and user-facing — always run regardless of the heavy-scheduler gate
  startCrmTaskReminderScheduler();
  validateMetaWhatsAppConfig();

  // ─────────────────────────────────────────────────────────────────────────
  // SEQUENTIAL STARTUP BOOTSTRAP QUEUE
  //
  // Root cause note: the Neon serverless driver's websocket-based Pool has a
  // known race under concurrent connect()/release() traffic — when many
  // ensureXTables() calls each grab their own client from the pool at nearly
  // the same instant during boot, the driver can intermittently throw
  // "Release called on client which has already been released to the pool."
  // That error originates from the driver's internal event handling (not the
  // awaited call path), so it bypasses individual .catch() handlers and
  // trips the process-level uncaughtException handler, crashing the server.
  //
  // Fix: every table-bootstrap step below runs one at a time — fully awaited,
  // in a fixed order — instead of as independent floating promises. This
  // guarantees at most one pool.connect() from this boot sequence is ever in
  // flight at once, which removes the concurrency burst that triggers the
  // race. This does not change any application logic — each ensureXTables()
  // function body is untouched; only the call-site orchestration changed.
  // Non-fatal by design: a failure in one step is logged and the queue moves
  // on to the next step, matching the previous per-chain error handling.
  // ─────────────────────────────────────────────────────────────────────────
  const bootSteps: Array<{ name: string; run: () => Promise<void> }> = [
    { name: "logDatabaseStatus", run: () => logDatabaseStatus() },
    { name: "ensureCrmIndexes", run: () => ensureCrmIndexes() },
    { name: "ensureAssignmentCursor", run: () => ensureAssignmentCursor() },
    { name: "ensureCrmLeadEmailLogTable", run: () => ensureCrmLeadEmailLogTable() },
    {
      name: "ensureDeveloperRegistrationRouteTables",
      run: () => ensureDeveloperRegistrationRouteTables(),
    },
    {
      name: "ensureMetaLeadsTables",
      run: async () => {
        await ensureMetaLeadsTables();
        if (metaLeadsProcessorEnabled) {
          startMetaLeadsProcessor();
        } else {
          console.log("[MetaLeads] Queue processor disabled — set ENABLE_META_LEADS_PROCESSOR=true to enable");
        }
        if (schedulersEnabled) {
          if (process.env.META_LEAD_PULL_SYNC_ENABLED === "true") {
            startPullSyncScheduler();
          } else {
            console.log("[MetaLeads][PullSync] Scheduler disabled — set META_LEAD_PULL_SYNC_ENABLED=true to enable");
          }
        }
      },
    },
    { name: "ensureWhatsappAiTables", run: () => ensureWhatsappAiTables() },
    {
      name: "ensureDeveloperRegistrationTables",
      run: async () => {
        await ensureDeveloperRegistrationTables();
        startDeveloperRegistrationScheduler();
      },
    },
    {
      name: "ensureEmailNurturingTables",
      run: async () => {
        await ensureEmailNurturingTables();
        if (schedulersEnabled) startNurturingScheduler();
      },
    },
    {
      name: "ensureBroadcastTables",
      run: async () => {
        await ensureBroadcastTables();
        await resumePendingBroadcasts();
      },
    },
    { name: "ensureWhatsAppApiTables", run: () => ensureWhatsAppApiTables() },
    {
      name: "ensureAiMarketingTables",
      run: async () => {
        await ensureAiMarketingTables();
        await ensureAiMarketingRevenueTables();
        await ensureAiCampaignAttributionTables();
        await ensureAiCreativeAttributionTable();
        await ensureAiCreativeDraftsTable();
      },
    },
    // Phase 11 tables
    { name: "ensureAiCampaignDraftTables", run: () => ensureAiCampaignDraftTables() },
    // Phase 12 tables — project marketing knowledge base
    { name: "ensureProjectMarketingTables", run: () => ensureProjectMarketingTables() },
    // Phase 14 tables — performance learning engine
    { name: "ensureLearningEngineTables", run: () => ensureLearningEngineTables() },
    // Meta Intelligence tables — read-only snapshot store
    { name: "ensureMetaIntelligenceTables", run: () => ensureMetaIntelligenceTables() },
    // Phase 4 — AI Marketing Director tables (read-only analysis engine, additive only)
    {
      name: "ensureAiMarketingDirectorTables",
      run: async () => {
        const { ensureAiMarketingDirectorTables } = await import("./aiMarketingDirectorService");
        await ensureAiMarketingDirectorTables();
      },
    },
    // Phase 5 — Kinglike Quality Score (KQS) tables (read-only scoring engine,
    // additive only), then MVP Competitor Intelligence tables, then Phase 2 —
    // Market Intelligence Enhancement tables (additive only, new competitor_*
    // tables). All three already ran sequentially relative to each other;
    // they now also run sequentially relative to every other boot step.
    {
      name: "ensureKqsTables/ensureCompetitorIntelligenceTables/ensureAllPhase2Tables",
      run: async () => {
        const { ensureKqsTables } = await import("./kqsEngine");
        await ensureKqsTables();
        const { ensureCompetitorIntelligenceTables } = await import("./competitorIntelligenceService");
        await ensureCompetitorIntelligenceTables();
        const { ensureAllPhase2Tables } = await import("./competitorPhase2Orchestrator");
        await ensureAllPhase2Tables();
        // Phase 27 — Competitor Creative Gallery: new table only, additive.
        const { ensureCompetitorAdMediaTable } = await import("./competitorCreativeMediaService");
        await ensureCompetitorAdMediaTable();
        // Phase 28 — Creative DNA Foundation: new table only, additive.
        const { ensureCompetitorCreativeDnaTable } = await import("./competitorCreativeDnaService");
        await ensureCompetitorCreativeDnaTable();
      },
    },
    {
      name: "ensureWaQualTables",
      run: async () => {
        await ensureWaQualTables();
        await ensureAiConciergeColumns();
        if (schedulersEnabled) startWaQualScheduler();
        const { migrateLegacySessionsToAiConcierge } = await import("./waQualService");
        await migrateLegacySessionsToAiConcierge();
      },
    },
  ];

  for (const step of bootSteps) {
    try {
      await step.run();
    } catch (err) {
      console.error(`[DB] ${step.name} failed:`, err);
    }
  }

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
