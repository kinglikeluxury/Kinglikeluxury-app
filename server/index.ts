import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startScheduler } from "./schedulerService";
import { generateSitemapXml } from "./sitemapGenerator";

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

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));

app.set("trust proxy", 1);

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

    res.status(status).json({ message });
    throw err;
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = 5000;
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
})();
