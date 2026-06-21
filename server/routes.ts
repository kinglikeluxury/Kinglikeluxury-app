import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { registerAiIntelligenceRoutes } from "./ai-intelligence-routes";
import { registerMetaLeadsRoutes } from "./metaLeadsRoutes";
import bcrypt from "bcrypt";
import { Resend } from "resend";
import { sendEmail, buildConsultationConfirmEmail, buildConsultationBookedEmail, sendPushNotification } from "./notificationService";
import pg from "pg";
const { Pool } = pg;
import { storage } from "./storage";
import { 
  insertUserSchema, 
  insertPropertySchema, 
  insertProjectSchema,
  insertBlogPostSchema,
  PROPERTY_TYPES,
  PROPERTY_STATUS,
  crmLeads,
} from "@shared/schema";
import { validatePhone as vPhone, validateEmail as vEmail } from "@shared/crmValidation";
import session from "express-session";
import { z } from "zod";
import { processImages } from "./utils/imageProcessing";
import { sendNewPropertyNotification, sendLeadChangeNotification, sendLeadTaskChangeNotification } from "./emailService";
import { translateBlogPost, translateText, detectLanguage, enrichTranslationsWithSeo, PRIMARY_SEO_LANGS } from "./translate";
import { generateEnglishSlug, hasNonAscii, timestampSlug, toEnglishSlug, slugToUrlPath } from "./slugUtils";
import { createBOGOrder, getBOGOrderStatus, refundBOGOrder } from "./bogPayment";
// TODO: Fix Google Cloud Storage TypeScript compatibility issues
// import {
//   ObjectStorageService,
//   ObjectNotFoundError,
// } from "./objectStorage";
import multer from "multer";
import { ObjectStorageService } from "./objectStorage";

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Twilio from "twilio";
import { sendWelcomeEmail, sendBulkEmail, isEmailConfigured, getOrCreateTemplate, sendEmailOtp } from "./emailService";
import { sendWelcomeWhatsApp, sendBulkWhatsApp, isWhatsAppConfigured } from "./whatsappNotificationService";
import { db, getActiveDbHost, getActiveDbName, pool } from "./db";

import { notificationTemplates, notificationLogs } from "@shared/schema";
import { eq, and, desc, inArray, count as sqlCount, sql as drizzleSql } from "drizzle-orm";

// Configure multer for file uploads - memory storage for Cloudinary
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 500 * 1024 * 1024, // 500MB max per file
    fieldSize: 10 * 1024 * 1024, // 10MB field size
    files: 20 // Max 20 files per request
  }
});

// Session type definition
declare module "express-session" {
  interface SessionData {
    userId: number;
    isAdmin: boolean;
    role: string;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // ─── Database Status Debug Endpoint ────────────────────────────────────────
  app.get("/api/debug/database-status", async (_req, res) => {
    try {
      const client = await pool.connect();
      try {
        const countRow = async (tbl: string): Promise<number> => {
          const r = await client.query(`SELECT COUNT(*) FROM "${tbl}"`);
          return parseInt(r.rows[0].count, 10);
        };

        const [properties, projects, blogPosts, users] = await Promise.all([
          countRow("properties"),
          countRow("projects"),
          countRow("blog_posts"),
          countRow("users"),
        ]);

        res.json({
          activeDatabase: "production",
          databaseHost: getActiveDbHost(),
          databaseName: getActiveDbName(),
          properties,
          projects,
          blogPosts,
          users,
          timestamp: new Date().toISOString(),
        });
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(500).json({
        activeDatabase: "production",
        databaseHost: getActiveDbHost(),
        databaseName: getActiveDbName(),
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ─── Health Check Endpoint ─────────────────────────────────────────────────
  app.get("/api/health-db", async (_req, res) => {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
        res.json({
          ok: true,
          activeDatabase: "production",
          databaseHost: getActiveDbHost(),
        });
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        activeDatabase: "production",
        databaseHost: getActiveDbHost(),
        error: err.message,
      });
    }
  });

  // ─── SEO: Sitemap & Robots (MUST be first — before any catch-all) ─────────
  const SEO_LANGS = ["en", "ar", "fa", "tr", "ru", "ka", "az", "he", "zh", "pl", "it", "nl", "de", "sv", "fr"];
  const SEO_BASE  = "https://www.kinglikeluxury.app";

  // Detects preferred language from Accept-Language header; falls back to "en".
  function detectPreferredLang(acceptLanguage: string): string {
    const candidates = acceptLanguage
      .split(",")
      .map(l => l.split(";")[0].trim().toLowerCase().substring(0, 2));
    return candidates.find(l => SEO_LANGS.includes(l)) || "en";
  }

  // ─── 301 redirect: /blog/:slug → /{lang}/blog/:slug ──────────────────────
  // MUST be registered BEFORE /:lang/blog/:slug so Express matches it first.
  app.get("/blog/:slug", (req, res) => {
    const { slug } = req.params;
    const lang = detectPreferredLang(req.headers["accept-language"] || "");
    return res.redirect(301, `/${lang}/blog/${slug}`);
  });


  // ─── SEO: Canonical + hreflang injection for all visitors ────────────────
  const __routesDirname = path.dirname(fileURLToPath(import.meta.url));

  app.get("/:lang/blog/:slug", async (req, res, next) => {
    const { lang } = req.params;
    // Express auto-decodes path params — no need for manual decodeURIComponent
    const slug = req.params.slug;
    if (!SEO_LANGS.includes(lang)) return next();

    const ua = req.headers["user-agent"] || "";
    const isBot = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|twitterbot|facebookexternalhit|linkedinbot|whatsapp|slackbot|telegrambot|applebot|semrushbot|ahrefsbot/i.test(ua);

    /** Returns the per-language slug for a post, falling back to the English base slug. */
    const getPostLangSlug = (p: any, l: string): string =>
      p.translations?.[l]?.slug || p.slug;

    try {
      let post: any = null;

      // ── 1. Try localized slug lookup first (e.g. Arabic هل-أسعار-... or Russian prodolzhat-...) ──
      post = await storage.getBlogPostByLocalizedSlug(lang, slug);

      // ── 2. Fall back to English base slug lookup ──────────────────────────
      if (!post) {
        post = await storage.getBlogPostBySlug(slug);
        if (post) {
          // If this language has its own localized slug that differs from what was requested,
          // 301 redirect to the canonical localized URL for this language.
          const localizedSlug = getPostLangSlug(post, lang);
          if (localizedSlug && localizedSlug !== slug) {
            return res.redirect(301, `/${lang}/blog/${slugToUrlPath(localizedSlug)}`);
          }
        }
      }

      // ── 3. Check legacy old slugs → 301 to localized URL ─────────────────
      if (!post) {
        const redirectPost = await storage.getBlogPostByOldSlug(slug);
        if (redirectPost) {
          const localizedSlug = getPostLangSlug(redirectPost, lang);
          return res.redirect(301, `/${lang}/blog/${slugToUrlPath(localizedSlug)}`);
        }
        if (isBot) return res.status(404).send("Not found");
        return next();
      }

      const safe = (s: string) =>
        s.replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" }[c] ?? c));

      // ── Resolve per-language SEO fields (fall back gracefully for legacy rows) ──
      const tr: any         = post.translations?.[lang] ?? {};
      const fallbackTitle   = post.translations?.en?.title || post.title || "Kinglike Luxury Blog";
      const fallbackExcerpt = post.translations?.en?.excerpt || post.excerpt || "";

      const rawTitle   = tr.title   || fallbackTitle;
      const rawExcerpt = tr.excerpt || fallbackExcerpt;

      const title        = safe(rawTitle);
      const description  = safe(tr.metaDescription || rawExcerpt || rawTitle);
      const ogTitle      = safe(tr.ogTitle        || rawTitle);
      const ogDescription = safe(tr.ogDescription || tr.metaDescription || rawExcerpt || rawTitle);
      const twitterTitle = safe(tr.twitterTitle   || rawTitle);
      const twitterDesc  = safe(tr.twitterDescription || tr.metaDescription || rawExcerpt || rawTitle);
      const keywords     = tr.keywords ? safe(tr.keywords) : "";
      const content      = tr.content || post.content || "";
      const image        = post.coverImage || `${SEO_BASE}/icons/icon-512.png`;

      // ── Per-language canonical URL uses the language-specific slug ────────
      const thisLangSlug = getPostLangSlug(post, lang);
      const canonical    = `${SEO_BASE}/${lang}/blog/${slugToUrlPath(thisLangSlug)}`;

      const datePublished = post.createdAt ? new Date(post.createdAt).toISOString() : "";
      const dateModified  = post.updatedAt ? new Date(post.updatedAt).toISOString() : datePublished;

      // ── hreflang: each language uses its own translated slug ──────────────
      const hreflangs = SEO_LANGS.map(l => {
        const lSlug = getPostLangSlug(post, l);
        return `  <link rel="alternate" hreflang="${l}" href="${SEO_BASE}/${l}/blog/${slugToUrlPath(lSlug)}" />`;
      }).join("\n");
      const enSlug    = getPostLangSlug(post, "en");
      const xDefault  = `  <link rel="alternate" hreflang="x-default" href="${SEO_BASE}/en/blog/${slugToUrlPath(enSlug)}" />`;

      // Article Schema JSON-LD — language-specific with inLanguage + translated slug URL
      const jsonLd = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: ogTitle,
        description: ogDescription,
        image: image,
        url: canonical,
        inLanguage: lang,
        datePublished: datePublished,
        dateModified: dateModified,
        ...(keywords ? { keywords } : {}),
        author: { "@type": "Organization", name: "Kinglike Luxury", url: SEO_BASE },
        publisher: {
          "@type": "Organization",
          name: "Kinglike Luxury",
          logo: { "@type": "ImageObject", url: `${SEO_BASE}/icons/icon-512.png` },
        },
        mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
      });

      // ── Bots: return a minimal server-rendered page for maximum crawlability ──
      if (isBot) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.send(`<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} | Kinglike Luxury</title>
  <meta name="description" content="${description}">
${keywords ? `  <meta name="keywords" content="${keywords}">` : ""}
  <link rel="canonical" href="${canonical}">
${hreflangs}
  ${xDefault}
  <meta property="og:type" content="article">
  <meta property="og:title" content="${ogTitle} | Kinglike Luxury">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:image" content="${image}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="Kinglike Luxury">
  <meta property="og:locale" content="${lang}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${twitterTitle} | Kinglike Luxury">
  <meta name="twitter:description" content="${twitterDesc}">
  <meta name="twitter:image" content="${image}">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body><article><h1>${title}</h1><p>${description}</p>${content}</article></body>
</html>`);
      }

      // ── Regular browsers: inject SEO tags into the SPA shell ──────────────
      const isProd = process.env.NODE_ENV === "production";
      const indexPath = isProd
        ? path.resolve(__routesDirname, "public", "index.html")
        : path.resolve(__routesDirname, "..", "client", "index.html");

      if (!fs.existsSync(indexPath)) return next();

      const seoHead = [
        `  <title>${title} | Kinglike Luxury</title>`,
        `  <meta name="description" content="${description}" />`,
        ...(keywords ? [`  <meta name="keywords" content="${keywords}" />`] : []),
        `  <link rel="canonical" href="${canonical}" />`,
        hreflangs,
        `  ${xDefault}`,
        `  <meta property="og:type" content="article" />`,
        `  <meta property="og:title" content="${ogTitle} | Kinglike Luxury" />`,
        `  <meta property="og:description" content="${ogDescription}" />`,
        `  <meta property="og:image" content="${image}" />`,
        `  <meta property="og:url" content="${canonical}" />`,
        `  <meta property="og:site_name" content="Kinglike Luxury" />`,
        `  <meta property="og:locale" content="${lang}" />`,
        `  <meta name="twitter:card" content="summary_large_image" />`,
        `  <meta name="twitter:title" content="${twitterTitle} | Kinglike Luxury" />`,
        `  <meta name="twitter:description" content="${twitterDesc}" />`,
        `  <meta name="twitter:image" content="${image}" />`,
        `  <script type="application/ld+json">${jsonLd}</script>`,
      ].join("\n");

      let html = fs.readFileSync(indexPath, "utf-8");
      html = html
        .replace(/<title>[^<]*<\/title>/, "")
        .replace(/<meta\s+name="description"[^>]*>/i, "")
        .replace("</head>", `${seoHead}\n</head>`);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.send(html);
    } catch (err) {
      console.error("[BlogMeta] Error:", err);
      return next();
    }
  });

  // ─── SEO / OG: Property page meta-tag injection ────────────────────────────
  // When WhatsApp / any crawler fetches /property/:id, the server responds with
  // the real OG tags (title, description, og:image = first property photo) so
  // that the link preview is shown correctly.
  // Inline slug utility (server-side)
  const serverSlugify = (str: string) =>
    str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ").trim().replace(/\s+/g, "-").replace(/-+/g, "-");

  const buildPropertySlug = (title: string, location: string, id: number) => {
    const [city = "", country = ""] = location.split(",").map(s => s.trim());
    return [serverSlugify(title), serverSlugify(city), serverSlugify(country), String(id)].filter(Boolean).join("-");
  };

  app.get("/property/:id", async (req, res, next) => {
    // Support both numeric IDs and SEO slugs like "title-city-country-52"
    const rawParam = req.params.id;
    const id = parseInt(rawParam.split("-").pop() || rawParam, 10);
    if (isNaN(id)) return next();

    const ua = req.headers["user-agent"] || "";
    const isBot = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|twitterbot|facebookexternalhit|linkedinbot|whatsapp|slackbot|telegrambot|applebot|semrushbot|ahrefsbot/i.test(ua);

    // For regular browsers that are NOT bots, let Vite / the SPA serve the page
    if (!isBot) return next();

    try {
      const property = await storage.getProperty(id);
      if (!property) return res.status(404).send("Property not found");

      const safe = (s: string) =>
        String(s).replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" }[c] ?? c));

      const title       = safe((property as any).title || "Kinglike Luxury Property");
      const description = safe(
        ((property as any).description || "").replace(/\n/g, " ").substring(0, 200) ||
        `${(property as any).propertyType || "Property"} in ${(property as any).location || ""} — Kinglike Luxury`
      );
      const images      = (property as any).images as string[];
      const rawImage    = (Array.isArray(images) && images.length > 0)
        ? images[0]
        : `${SEO_BASE}/icons/icon-512.png`;
      // Optimise Cloudinary image for WhatsApp preview: resize to 1200×630,
      // convert to JPEG and reduce quality so it loads fast (< 1 MB).
      const image = rawImage.includes("res.cloudinary.com")
        ? rawImage.replace(/\/upload\//, "/upload/w_1200,h_630,c_fill,f_jpg,q_80/")
        : rawImage;
      const slug = buildPropertySlug((property as any).title || "", (property as any).location || "", id);
      const canonical   = `${SEO_BASE}/property/${slug}`;

      const metaTags = `
  <title>${title} | Kinglike Luxury</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title} | Kinglike Luxury">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${image}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="Kinglike Luxury">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title} | Kinglike Luxury">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${image}">`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.send(`<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
${metaTags}
</head>
<body>
  <h1>${title}</h1>
  <p>${description}</p>
  <img src="${image}" alt="${title}" />
</body>
</html>`);
    } catch (err) {
      console.error("[PropertyMeta] Error:", err);
      return next();
    }
  });

  // Configure sessions with PostgreSQL store
  const isProduction = process.env.NODE_ENV === "production";

  app.use(
    session({
      cookie: {
        maxAge: 86400000, // 24 hours
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "none" : "lax",
      },
      store: storage.sessionStore,
      resave: false,
      saveUninitialized: false,
      secret: (() => {
        const secret = process.env.SESSION_SECRET;
        if (!secret) {
          if (process.env.NODE_ENV === "production") {
            console.error(
              "[SECURITY] SESSION_SECRET environment variable is NOT set. " +
              "This is required in production to prevent session forgery. " +
              "Set SESSION_SECRET in Replit Secrets immediately."
            );
          } else {
            console.warn(
              "[SECURITY] SESSION_SECRET not set — using insecure dev fallback. " +
              "Set SESSION_SECRET before deploying to production."
            );
          }
        }
        return secret || (process.env.NODE_ENV === "production"
          ? (() => { throw new Error("SESSION_SECRET must be set in production"); })()
          : "dev-only-insecure-fallback-do-not-use-in-production");
      })(),
    })
  );

  // Middleware to check if user is authenticated
  const isAuthenticated = (req: Request, res: Response, next: Function) => {
    if (req.session.userId) {
      return next();
    }
    res.status(401).json({ message: "Not authenticated" });
  };

  // Middleware to check if user is admin
  const isAdmin = (req: Request, res: Response, next: Function) => {
    if (req.session.userId && req.session.isAdmin) {
      return next();
    }
    res.status(403).json({ message: "Not authorized" });
  };

  // Digital Asset Links for TWA (Trusted Web Activity) - Required for Google Play
  app.get("/.well-known/assetlinks.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.json([{
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": {
        "namespace": "android_app",
        "package_name": "com.kinglikeluxury",
        "sha256_cert_fingerprints": [
          "A7:9B:9A:D6:7E:A3:E8:32:83:12:60:B6:F8:27:36:E8:3F:00:3D:89:6A:82:E4:6E:8B:20:73:F5:FB:84:AF:2F"
        ]
      }
    }]);
  });

  // IP-based country detection
  app.get("/api/geo/detect", async (req, res) => {
    try {
      const forwarded = req.headers['x-forwarded-for'];
      const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || '';
      const response = await fetch(`http://ip-api.com/json/${ip}?fields=countryCode`);
      const data = await response.json() as any;
      res.json({ countryCode: data.countryCode || 'US' });
    } catch {
      res.json({ countryCode: 'US' });
    }
  });

  // Twilio configuration check — admin only, no credential values returned
  app.get("/api/admin/twilio-status", isAuthenticated, isAdmin, async (_req, res) => {
    res.json({
      ok: true,
      twilioConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
    });
  });

  // Twilio client
  const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

  // ── Email OTP store (server-side only, never exposed to client) ────────────
  const emailOtpStore = new Map<string, { code: string; expiresAt: Date; verified: boolean }>();

  // ── OTP Security Layer ────────────────────────────────────────────────────

  /**
   * Resolve real client IP — safe against header spoofing.
   *
   * Priority:
   *  1. CF-Connecting-IP — set exclusively by Cloudflare infrastructure;
   *     Cloudflare strips any client-supplied copy before adding its own,
   *     so end-users cannot forge this header.
   *  2. req.ip — Express's resolved address, which already honours
   *     `app.set("trust proxy", 1)` configured in server/index.ts.
   *     Never parse x-forwarded-for directly — it can be client-controlled.
   */
  /**
   * Resolve the real client IP.
   * `cf-connecting-ip` is only trusted when the app is deployed behind Cloudflare
   * (indicated by CLOUDFLARE_TURNSTILE_SECRET_KEY being configured). Trusting it
   * unconditionally would let any client spoof it to bypass IP rate-limits.
   */
  const behindCloudflare = !!process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  function getClientIp(req: any): string {
    if (behindCloudflare) {
      const cfIp = req.headers['cf-connecting-ip'];
      if (typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim();
    }
    return req.ip || 'unknown';
  }

  /** Partially mask a phone number or email for logs (never log full PII). */
  function maskIdentifier(id: string): string {
    if (!id) return '?';
    if (id.includes('@')) {
      const [local, domain] = id.split('@');
      return `${local.slice(0, 2)}***@${domain}`;
    }
    return `${id.slice(0, 4)}****${id.slice(-3)}`;
  }

  // Per-identifier (phone / email) rate limit: max 3 per 15 min
  const smsOtpRateLimit   = new Map<string, number[]>();
  const emailOtpRateLimit = new Map<string, number[]>();
  const passwordResetRateLimit = new Map<string, number[]>();

  function checkOtpRateLimit(
    map: Map<string, number[]>,
    key: string,
    maxAttempts = 3,
    windowMs = 15 * 60 * 1000,
  ): boolean {
    const now = Date.now();
    const attempts = (map.get(key) || []).filter((t: number) => now - t < windowMs);
    if (attempts.length >= maxAttempts) return false;
    attempts.push(now);
    map.set(key, attempts);
    return true;
  }

  // Per-IP rate limit: max 5 per 10 min; auto-block after 10 per hour
  const ipOtpAttempts = new Map<string, number[]>();
  const blockedIPs    = new Set<string>();
  const IP_RATE_MAX    = 5;
  const IP_RATE_WIN_MS = 10 * 60 * 1000;  // 10 min
  const IP_BLOCK_THR   = 10;
  const IP_BLOCK_WIN_MS = 60 * 60 * 1000; // 1 hour

  function checkIpOtpLimit(ip: string): 'ok' | 'rate_limited' | 'blocked' {
    if (blockedIPs.has(ip)) return 'blocked';
    const now  = Date.now();
    const all  = (ipOtpAttempts.get(ip) || []).filter((t: number) => now - t < IP_BLOCK_WIN_MS);
    const recent = all.filter((t: number) => now - t < IP_RATE_WIN_MS);
    if (recent.length >= IP_RATE_MAX) return 'rate_limited';
    all.push(now);
    ipOtpAttempts.set(ip, all);
    if (all.length >= IP_BLOCK_THR) {
      blockedIPs.add(ip);
      console.warn(`[OTP Security] Auto-blocked suspicious IP: ${ip} (${all.length} req/hr)`);
      return 'blocked';
    }
    return 'ok';
  }

  // In-memory OTP request log — circular buffer, newest last (max 500 entries)
  interface OtpLogEntry {
    id: number;
    timestamp: string;
    type: 'sms' | 'email' | 'reset';
    identifier: string;
    ip: string;
    result: 'sent' | 'phone_rate_limited' | 'ip_rate_limited' | 'ip_blocked' | 'captcha_failed' | 'error';
    method?: 'whatsapp' | 'sms';
    userAgent: string;
  }
  const otpLogs: OtpLogEntry[] = [];
  let otpLogSeq = 0;

  function addOtpLog(entry: Omit<OtpLogEntry, 'id' | 'timestamp'>): void {
    if (otpLogs.length >= 500) otpLogs.shift();
    otpLogs.push({ id: ++otpLogSeq, timestamp: new Date().toISOString(), ...entry });
  }

  /**
   * Verify Cloudflare Turnstile token.
   *
   * Security rules:
   * - In production (CLOUDFLARE_TURNSTILE_SECRET_KEY is set): always verify; fail closed
   *   on network error or missing token so a broken CAPTCHA never silently degrades.
   * - In development (no secret configured): skip verification and log a warning so
   *   developers can work locally without a Cloudflare account. This branch must never
   *   execute in production because the secret will always be present there.
   * - The Cloudflare "always-pass" test secret (1x0000…) is intentionally NOT used as a
   *   fallback — it would let any request bypass CAPTCHA if the secret is misconfigured.
   */
  async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
    const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
    if (!secret) {
      // Development-only bypass: no secret means no Cloudflare account is configured.
      if (process.env.NODE_ENV === 'production') {
        console.error('[Turnstile] CLOUDFLARE_TURNSTILE_SECRET_KEY is missing in production — blocking request.');
        return false;
      }
      console.warn('[Turnstile] No secret configured — skipping CAPTCHA check (dev mode only).');
      return true;
    }
    if (!token) return false;
    try {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, response: token, remoteip: ip }),
      });
      const data = await r.json() as { success: boolean };
      return data.success === true;
    } catch (err) {
      // Fail-closed: if Cloudflare is unreachable in production, block the request.
      // This prevents an outage from silently disabling bot protection.
      console.error('[Turnstile] Verification request failed — blocking request:', err);
      return false;
    }
  }

  // ── Password-reset OTP store (server-side only, expires 10 min) ───────────
  const passwordResetStore = new Map<string, { code: string; expiresAt: Date }>();

  // Send verification code — WhatsApp first, SMS fallback via Messaging Service
  app.post("/api/auth/send-verification", async (req, res) => {
    const ip = getClientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    try {
      const { phoneNumber, turnstileToken } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }

      // 1. IP-level check (blocked / rate-limited)
      const ipStatus = checkIpOtpLimit(ip);
      if (ipStatus === 'blocked') {
        addOtpLog({ type: 'sms', identifier: maskIdentifier(phoneNumber), ip, result: 'ip_blocked', userAgent: ua });
        return res.status(429).json({ message: "Too many requests from your network. Please try again later." });
      }
      if (ipStatus === 'rate_limited') {
        addOtpLog({ type: 'sms', identifier: maskIdentifier(phoneNumber), ip, result: 'ip_rate_limited', userAgent: ua });
        return res.status(429).json({ message: "Too many OTP requests from your network. Please wait 10 minutes." });
      }

      // 2. Per-phone rate limit (max 3 per 15 min)
      if (!checkOtpRateLimit(smsOtpRateLimit, phoneNumber)) {
        addOtpLog({ type: 'sms', identifier: maskIdentifier(phoneNumber), ip, result: 'phone_rate_limited', userAgent: ua });
        return res.status(429).json({ message: "Too many OTP requests for this number. Please wait 15 minutes." });
      }

      // 3. Turnstile CAPTCHA verification
      const captchaOk = await verifyTurnstile(turnstileToken, ip);
      if (!captchaOk) {
        addOtpLog({ type: 'sms', identifier: maskIdentifier(phoneNumber), ip, result: 'captcha_failed', userAgent: ua });
        return res.status(403).json({ message: "Security verification failed. Please refresh the page and try again." });
      }

      if (!twilioClient) {
        return res.status(500).json({ message: "Messaging service not configured" });
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await storage.createVerificationCode(phoneNumber, code, expiresAt);

      const msgSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;
      const msgBody = `🔐 Kinglike Luxury\nرمز التحقق: *${code}*\nصالح 10 دقائق.`;

      // Send OTP via SMS only (Twilio) — WhatsApp OTP removed, Twilio WhatsApp is not configured
      const method = "sms";
      const smsBody = `Kinglike Luxury - رمز التحقق: ${code} (صالح 10 دقائق)`;
      try {
        if (msgSid) {
          await twilioClient.messages.create({ body: smsBody, to: phoneNumber, messagingServiceSid: msgSid });
        } else {
          throw new Error("No messaging service SID");
        }
      } catch {
        await twilioClient.messages.create({ body: smsBody, to: phoneNumber, from: fromNumber });
      }
      console.log(`✅ SMS OTP sent to ${phoneNumber}`);

      addOtpLog({ type: 'sms', identifier: maskIdentifier(phoneNumber), ip, result: 'sent', method: method as 'whatsapp' | 'sms', userAgent: ua });
      res.json({ success: true, method, message: method === "whatsapp" ? "Verification code sent via WhatsApp" : "Verification code sent via SMS" });
    } catch (error: any) {
      addOtpLog({ type: 'sms', identifier: maskIdentifier(req.body?.phoneNumber || '?'), ip, result: 'error', userAgent: ua });
      console.error("OTP send error:", error);
      res.status(500).json({ message: error.message || "Failed to send verification code" });
    }
  });

  // Verify SMS code
  app.post("/api/auth/verify-code", async (req, res) => {
    try {
      const { phoneNumber, code } = req.body;
      if (!phoneNumber || !code) {
        return res.status(400).json({ message: "Phone number and code are required" });
      }

      // Verify against local DB (codes are generated and stored by send-verification)
      const isValid = await storage.verifyCode(phoneNumber, code);
      if (!isValid) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }

      res.json({ success: true, verified: true });
    } catch (error: any) {
      console.error("Verify code error:", error);
      res.status(500).json({ message: error.message || "Verification failed" });
    }
  });

  // Send Email OTP — fallback verification (server-side only, credentials never exposed)
  app.post("/api/auth/send-email-otp", async (req, res) => {
    const ip = getClientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }

      // IP-level check
      const ipStatus = checkIpOtpLimit(ip);
      if (ipStatus === 'blocked') {
        addOtpLog({ type: 'email', identifier: maskIdentifier(email), ip, result: 'ip_blocked', userAgent: ua });
        return res.status(429).json({ message: "Too many requests from your network. Please try again later." });
      }
      if (ipStatus === 'rate_limited') {
        addOtpLog({ type: 'email', identifier: maskIdentifier(email), ip, result: 'ip_rate_limited', userAgent: ua });
        return res.status(429).json({ message: "Too many OTP requests from your network. Please wait 10 minutes." });
      }

      // Per-email rate limit
      if (!checkOtpRateLimit(emailOtpRateLimit, email.toLowerCase())) {
        addOtpLog({ type: 'email', identifier: maskIdentifier(email), ip, result: 'phone_rate_limited', userAgent: ua });
        return res.status(429).json({ message: "Too many email OTP attempts. Please wait 15 minutes." });
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      emailOtpStore.set(email.toLowerCase(), { code, expiresAt, verified: false });
      await sendEmailOtp(email, code);
      addOtpLog({ type: 'email', identifier: maskIdentifier(email), ip, result: 'sent', userAgent: ua });
      res.json({ success: true });
    } catch (err: any) {
      addOtpLog({ type: 'email', identifier: maskIdentifier(req.body?.email || '?'), ip, result: 'error', userAgent: ua });
      console.error("Email OTP send error:", err);
      res.status(500).json({ message: err.message || "Failed to send email verification code" });
    }
  });

  // Verify Email OTP
  app.post("/api/auth/verify-email-code", async (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email || !code) {
        return res.status(400).json({ message: "Email and code are required" });
      }
      const key = email.toLowerCase();
      const record = emailOtpStore.get(key);
      if (!record || new Date() > record.expiresAt) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }
      if (record.code !== code) {
        return res.status(400).json({ message: "Invalid verification code" });
      }
      emailOtpStore.set(key, { ...record, verified: true });
      res.json({ success: true, verified: true });
    } catch (err: any) {
      console.error("Email verify error:", err);
      res.status(500).json({ message: err.message || "Verification failed" });
    }
  });

  // Send password-reset OTP — supports phone (WhatsApp/SMS + email fallback) and email
  app.post("/api/auth/send-reset-otp", async (req, res) => {
    const ip = getClientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const GENERIC_OK = { message: "If an account exists, a verification code will be sent." };
    try {
      const { method, phoneNumber, email, turnstileToken } = req.body;

      // 1. IP-level check for all reset attempts
      const ipStatus = checkIpOtpLimit(ip);
      if (ipStatus === 'blocked') {
        addOtpLog({ type: 'reset', identifier: maskIdentifier(phoneNumber || email || '?'), ip, result: 'ip_blocked', userAgent: ua });
        return res.status(429).json({ message: "Too many requests from your network. Please try again later." });
      }
      if (ipStatus === 'rate_limited') {
        addOtpLog({ type: 'reset', identifier: maskIdentifier(phoneNumber || email || '?'), ip, result: 'ip_rate_limited', userAgent: ua });
        return res.status(429).json({ message: "Too many requests from your network. Please wait 10 minutes." });
      }

      // 2. Turnstile CAPTCHA verification (blocks bots before any Twilio call)
      const captchaOk = await verifyTurnstile(turnstileToken, ip);
      if (!captchaOk) {
        addOtpLog({ type: 'reset', identifier: maskIdentifier(phoneNumber || email || '?'), ip, result: 'captcha_failed', userAgent: ua });
        return res.status(403).json({ message: "Security verification failed. Please refresh the page and try again." });
      }

      if (method === 'phone') {
        if (!phoneNumber || typeof phoneNumber !== 'string') {
          return res.status(400).json({ message: "Phone number required" });
        }
        if (!checkOtpRateLimit(passwordResetRateLimit, phoneNumber)) {
          addOtpLog({ type: 'reset', identifier: maskIdentifier(phoneNumber), ip, result: 'phone_rate_limited', userAgent: ua });
          return res.status(429).json({ message: "Too many reset attempts. Please wait 15 minutes." });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        const msgBody = `🔐 Kinglike Luxury\nPassword reset code: ${code}\nValid for 10 minutes.`;
        let codeSent = false;

        if (twilioClient) {
          // Use SMS only — Twilio WhatsApp is not configured
          const msgSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
          const fromNumber = process.env.TWILIO_PHONE_NUMBER;
          try {
            if (msgSid) {
              await twilioClient.messages.create({ body: msgBody, to: phoneNumber, messagingServiceSid: msgSid });
            } else {
              await twilioClient.messages.create({ body: msgBody, to: phoneNumber, from: fromNumber });
            }
            codeSent = true;
          } catch (smsErr: any) {
            console.warn('[Reset OTP] SMS failed:', smsErr.message);
          }
        }

        if (!codeSent) {
          // SMS/WhatsApp unavailable — email fallback using account email
          try {
            const user = await storage.getUserByPhone(phoneNumber);
            if (user?.email) {
              await sendEmailOtp(user.email, code);
              codeSent = true;
            }
          } catch (emailErr: any) {
            console.warn('[Reset OTP] Email fallback failed:', emailErr.message);
          }
        }

        if (codeSent) {
          passwordResetStore.set(`phone:${phoneNumber}`, { code, expiresAt });
        }
        return res.json(GENERIC_OK);
      }

      if (method === 'email') {
        if (!email || typeof email !== 'string') {
          return res.status(400).json({ message: "Email required" });
        }
        const emailKey = email.toLowerCase().trim();
        if (!checkOtpRateLimit(passwordResetRateLimit, emailKey)) {
          return res.status(429).json({ message: "Too many reset attempts. Please wait 10 minutes." });
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        try {
          const user = await storage.getUserByEmail(emailKey);
          if (user) {
            await sendEmailOtp(emailKey, code);
            passwordResetStore.set(`email:${emailKey}`, { code, expiresAt });
          }
        } catch (err: any) {
          console.warn('[Reset OTP] Email send failed:', err.message);
        }
        return res.json(GENERIC_OK);
      }

      return res.status(400).json({ message: "Method must be 'phone' or 'email'" });
    } catch (err: any) {
      console.error("Send reset OTP error:", err);
      res.status(500).json({ message: "Failed to send verification code" });
    }
  });

  // Verify password-reset OTP (non-destructive — code remains valid for the reset step)
  app.post("/api/auth/verify-reset-otp", async (req, res) => {
    try {
      const { method, phoneNumber, email, code } = req.body;
      if (!code) return res.status(400).json({ message: "Code required" });

      let record: { code: string; expiresAt: Date } | undefined;
      if (method === 'phone' && phoneNumber) {
        record = passwordResetStore.get(`phone:${phoneNumber}`);
      } else if (method === 'email' && email) {
        record = passwordResetStore.get(`email:${(email as string).toLowerCase().trim()}`);
      }

      if (!record || new Date() > record.expiresAt || record.code !== code) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("Verify reset OTP error:", err);
      res.status(500).json({ message: "Verification failed" });
    }
  });

  // Reset password using OTP from passwordResetStore (phone or email method)
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { method, phoneNumber, email, code, newPassword } = req.body;

      if (!code || !newPassword) {
        return res.status(400).json({ message: "Code and new password are required" });
      }
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const INVALID = { message: "Invalid or expired verification code" };
      let user: any = null;

      if (method === 'phone' && phoneNumber) {
        const record = passwordResetStore.get(`phone:${phoneNumber}`);
        if (!record || new Date() > record.expiresAt || record.code !== code) {
          return res.status(400).json(INVALID);
        }
        user = await storage.getUserByPhone(phoneNumber);
        passwordResetStore.delete(`phone:${phoneNumber}`);
      } else if (method === 'email' && email) {
        const emailKey = (email as string).toLowerCase().trim();
        const record = passwordResetStore.get(`email:${emailKey}`);
        if (!record || new Date() > record.expiresAt || record.code !== code) {
          return res.status(400).json(INVALID);
        }
        user = await storage.getUserByEmail(emailKey);
        passwordResetStore.delete(`email:${emailKey}`);
      } else {
        return res.status(400).json({ message: "Phone number or email required" });
      }

      if (!user) {
        return res.status(404).json({ message: "Account not found" });
      }

      await storage.updateUserPassword(user.id, newPassword);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Auth routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { username, password, email, phoneNumber, authMethod } = req.body;

      if (!username || typeof username !== 'string' || username.length < 3) {
        return res.status(400).json({ message: "Username must be at least 3 characters" });
      }
      if (!password || typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      // Check username uniqueness
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Enforce phone verification — allow email OTP as fallback
      if (phoneNumber) {
        const isPhoneVerified = await storage.isPhoneVerified(phoneNumber);
        const emailRecord = email ? emailOtpStore.get(email.toLowerCase()) : null;
        const isEmailVerified = emailRecord?.verified === true;

        if (!isPhoneVerified && !isEmailVerified) {
          return res.status(400).json({ message: "Phone number must be verified before registration" });
        }
        const existingPhone = await storage.getUserByPhone(phoneNumber);
        if (existingPhone) {
          return res.status(400).json({ message: "Phone number already registered" });
        }
      } else if (authMethod === 'phone') {
        return res.status(400).json({ message: "Phone number is required" });
      }

      const user = await storage.createUser({
        username,
        password,
        email: email || null,
        phoneNumber: phoneNumber || null,
        whatsappNumber: null,
        facebookId: null,
        authMethod: authMethod || 'phone',
        isAdmin: false,
        isVerified: true,
      });

      req.session.userId = user.id;
      req.session.isAdmin = user.isAdmin;
      req.session.role = user.role ?? "user";

      // Fire-and-forget welcome notifications
      sendWelcomeEmail(user).catch(() => {});
      sendWelcomeWhatsApp(user).catch(() => {});

      const userResponse: any = {
        id: user.id,
        username: user.username,
        authMethod: user.authMethod,
        isAdmin: user.isAdmin,
      };
      if (user.email) userResponse.email = user.email;
      if (user.phoneNumber) userResponse.phoneNumber = user.phoneNumber;

      res.status(201).json(userResponse);
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ message: (error as any)?.message || "Server error" });
    }
  });

  app.post("/api/auth/change-password", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Both passwords are required" });
      }
      const user = await storage.getUser(userId);
      if (!user || user.password !== currentPassword) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }
      await storage.updateUserPassword(userId, newPassword);
      res.json({ success: true });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password, phoneNumber, whatsappNumber, facebookId, authMethod } = req.body;
      
      // Get user based on auth method
      let user;
      
      // Validate required fields based on auth method
      if (authMethod === 'email') {
        if (!username || !password) {
          return res.status(400).json({ message: "Username and password are required for email login" });
        }
        
        user = await storage.getUserByUsername(username);
        
        const _emailPassOk = user.password?.startsWith("$2b$") || user.password?.startsWith("$2a$")
          ? await bcrypt.compare(password, user.password)
          : user.password === password;
        if (!user || !_emailPassOk) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
      } 
      else if (authMethod === 'phone') {
        if (!phoneNumber) {
          return res.status(400).json({ message: "Phone number is required for SMS login" });
        }
        
        // Here we would normally validate a verification code
        // For demo, we'll just check if a user with this phone number exists
        user = await storage.getUserByField('phoneNumber', phoneNumber);
        
        // In production, verify OTP code here
      }
      else if (authMethod === 'whatsapp') {
        if (!whatsappNumber) {
          return res.status(400).json({ message: "WhatsApp number is required for WhatsApp login" });
        }
        
        // Here we would normally validate a verification code
        // For demo, we'll just check if a user with this WhatsApp number exists
        user = await storage.getUserByField('whatsappNumber', whatsappNumber);
        
        // In production, verify WhatsApp code here
      }
      else if (authMethod === 'facebook') {
        if (!facebookId) {
          return res.status(400).json({ message: "Facebook ID is required for Facebook login" });
        }
        
        // For demo, we'll just check if a user with this Facebook ID exists
        user = await storage.getUserByField('facebookId', facebookId);
        
        // In production, Facebook OAuth would handle this
      }
      else {
        // Default login — identifier can be username, email, or phone number
        if (!username || !password) {
          return res.status(401).json({ message: "Invalid login credentials." });
        }
        const identifier = (username as string).trim();

        // Detect identifier type: email → email lookup, phone-like → phone lookup, else → username
        const isEmail = identifier.includes('@');
        const cleanedPhone = identifier.replace(/[\s\-().]/g, '');
        const isPhone = !isEmail && /^[+\d]/.test(cleanedPhone) && /\d{6,}/.test(cleanedPhone);

        if (isEmail) {
          user = await storage.getUserByEmail(identifier.toLowerCase());
        } else if (isPhone) {
          user = await storage.getUserByPhone(cleanedPhone);
          // Also try the original string in case it was stored without normalization
          if (!user) user = await storage.getUserByPhone(identifier);
        } else {
          user = await storage.getUserByUsername(identifier);
        }

        // Generic error — never reveal whether username/email/phone exists or which field failed
        const _passOk = user.password?.startsWith("$2b$") || user.password?.startsWith("$2a$")
          ? await bcrypt.compare(password, user.password!)
          : user.password === password;
        if (!user || !_passOk) {
          return res.status(401).json({ message: "Invalid login credentials." });
        }
      }
      
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Set session
      req.session.userId = user.id;
      req.session.isAdmin = user.isAdmin;
      req.session.role = user.role ?? "user";
      
      // Return appropriate user data
      const userResponse: any = {
        id: user.id, 
        username: user.username,
        authMethod: user.authMethod,
        isAdmin: user.isAdmin,
        role: user.role ?? "user",
      };
      
      // Add method-specific fields to response
      if (user.email) userResponse.email = user.email;
      if (user.phoneNumber) userResponse.phoneNumber = user.phoneNumber;
      if (user.whatsappNumber) userResponse.whatsappNumber = user.whatsappNumber;
      if (user.facebookId) userResponse.facebookId = user.facebookId;
      
      res.json(userResponse);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // ─── Admin Leads ───────────────────────────────────────────────────────────
  app.get("/api/admin/leads", isAuthenticated, async (req, res) => {
    try {
      if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
      const allUsers = await storage.getAllUsers();
      const allProperties = await storage.getProperties({});
      const leads = allUsers.map((u) => {
        const propCount = allProperties.filter((p) => p.ownerId === u.id).length;
        const type = propCount > 0 ? "seller" : "browser";
        return {
          id: u.id,
          username: u.username,
          phoneNumber: u.phoneNumber || "",
          email: u.email || "",
          whatsappNumber: u.whatsappNumber || "",
          authMethod: u.authMethod,
          isAdmin: u.isAdmin,
          isVerified: u.isVerified,
          propertiesCount: propCount,
          leadType: type,
          registeredAt: u.createdAt,
        };
      });
      res.json(leads);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Export leads as real Excel .xlsx file
  app.get("/api/admin/leads/export", isAuthenticated, async (req, res) => {
    try {
      if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });

      const XLSX = await import("xlsx");
      const allUsers = await storage.getAllUsers();
      const allProperties = await storage.getProperties({});

      const rows = allUsers.map((u) => {
        const propCount = allProperties.filter((p) => p.ownerId === u.id).length;
        return {
          "الرقم": u.id,
          "اسم المستخدم": u.username,
          "رقم الهاتف": u.phoneNumber || "",
          "البريد الإلكتروني": u.email || "",
          "واتساب": u.whatsappNumber || "",
          "طريقة التسجيل": u.authMethod,
          "نوع العميل": propCount > 0 ? "بائع / رافع عقار" : "متصفح",
          "عدد العقارات": propCount,
          "موثّق": u.isVerified ? "نعم" : "لا",
          "الدور": u.isAdmin ? "أدمن" : "مستخدم",
          "تاريخ التسجيل": u.createdAt ? new Date(u.createdAt).toLocaleDateString("ar-EG") : "",
          "وقت التسجيل": u.createdAt ? new Date(u.createdAt).toLocaleTimeString("ar-EG") : "",
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);

      // Column widths
      worksheet["!cols"] = [
        { wch: 6 }, { wch: 20 }, { wch: 18 }, { wch: 28 },
        { wch: 18 }, { wch: 14 }, { wch: 20 }, { wch: 12 },
        { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 14 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "العملاء - Leads");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      const filename = `kinglike-leads-${new Date().toISOString().slice(0, 10)}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (err) {
      console.error("Excel export error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });
  
  // Admin: get all contact logs
  app.get("/api/admin/contact-logs", isAuthenticated, async (req, res) => {
    try {
      if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
      const logs = await storage.getContactLogs();
      res.json(logs);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Payment routes
  app.post("/api/payments", isAuthenticated, async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const paymentData = req.body;
      if (!paymentData.propertyId || !paymentData.amount || !paymentData.paymentMethod) {
        return res.status(400).json({ message: "Missing required payment fields" });
      }
      const payment = {
        id: Math.floor(Math.random() * 1000000),
        ...paymentData,
        userId: req.session.userId,
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      console.log('💳 Payment processed:', payment);
      res.status(201).json(payment);
    } catch (error) {
      console.error('Payment error:', error);
      res.status(500).json({ message: "Payment processing failed" });
    }
  });

  // BOG (Bank of Georgia) payment — create order and redirect
  app.post("/api/bog/create-order", isAuthenticated, async (req, res) => {
    try {
      const { amount, currency = "USD", propertyId, days } = req.body;
      if (!amount || !propertyId) {
        return res.status(400).json({ message: "amount and propertyId are required" });
      }
      const shopOrderId = `prop-${propertyId}-${Date.now()}`;
      const baseUrl = process.env.BOG_BASE_URL ||
        `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
      const { orderId, redirectUrl } = await createBOGOrder(
        parseFloat(amount),
        currency,
        shopOrderId,
        baseUrl
      );
      // Store pending payment with bog order id
      await storage.createPendingBOGPayment({
        bogOrderId: orderId,
        shopOrderId,
        propertyId: parseInt(propertyId),
        userId: req.session.userId!,
        amount: parseFloat(amount),
        currency,
        days: parseInt(days) || 30,
        status: "pending",
      });
      res.json({ orderId, redirectUrl });
    } catch (error: any) {
      console.error("BOG create order error:", error);
      res.status(500).json({ message: error.message || "Failed to create BOG payment order" });
    }
  });

  // BOG callback — called by BOG after payment
  app.post("/api/bog/callback", async (req, res) => {
    try {
      const { order_id } = req.body;
      if (!order_id) {
        return res.status(400).json({ message: "order_id missing" });
      }
      const status = await getBOGOrderStatus(order_id);
      const completed = status === "completed" || status === "captured";
      if (completed) {
        await storage.completeBOGPayment(order_id);
      }
      console.log(`BOG callback: order ${order_id} status=${status}`);
      res.json({ received: true, status });
    } catch (error: any) {
      console.error("BOG callback error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // BOG order status check
  app.get("/api/bog/order-status/:orderId", isAuthenticated, async (req, res) => {
    try {
      const status = await getBOGOrderStatus(req.params.orderId);
      res.json({ status });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // BOG refund — called by admin when rejecting a paid property
  app.post("/api/bog/refund/:propertyId", isAdmin, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const payment = await storage.getBOGPaymentByPropertyId(propertyId);
      if (!payment) {
        return res.status(404).json({ message: "No confirmed BOG payment found for this property" });
      }
      await refundBOGOrder(payment.bogOrderId);
      console.log(`BOG refund issued for property ${propertyId}, order ${payment.bogOrderId}`);
      res.json({ success: true, refundedAmount: payment.amount });
    } catch (error: any) {
      console.error("BOG refund error:", error);
      res.status(500).json({ message: error.message || "Refund failed" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    const user = await storage.getUser(req.session.userId);
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    res.json({ 
      id: user.id, 
      username: user.username,
      email: user.email,
      phoneNumber: user.phoneNumber,
      authMethod: user.authMethod,
      isAdmin: user.isAdmin,
      role: user.role ?? "user",
    });
  });

  // Property routes
  app.get("/api/properties", async (req, res) => {
    try {
      const { 
        type, 
        status = PROPERTY_STATUS.APPROVED, // Default to showing only approved properties
        location,
        minPrice,
        maxPrice,
        includeAll
      } = req.query;
      let filters: any = { status };

      // includeAll=true bypasses project exclusion (used by map view)
      if (includeAll === 'true') {
        filters.includeAllTypes = true;
      }
      
      // Handle apartment subtypes (studio, one-bedroom, etc.) by converting to proper filters
      if (type) {
        switch (type) {
          case 'studio':
            filters.type = 'apartment';
            filters.bedrooms = 0; // Studio = 0 bedrooms
            break;
          case 'one-bedroom':
            filters.type = 'apartment';
            filters.bedrooms = 1;
            break;
          case 'two-bedrooms':
            filters.type = 'apartment';
            filters.bedrooms = 2;
            break;
          case 'three-bedrooms':
            filters.type = 'apartment';
            filters.bedrooms = 3;
            break;
          case 'doublex':
            filters.type = 'apartment';
            // Doublex can have various bedroom counts, so no bedroom filter
            break;
          default:
            // Handle regular property types (apartment, villa, land, project)
            filters.type = type as string;
            break;
        }
      }
      
      if (location && location !== 'any') filters.location = location as string;
      if (minPrice) filters.minPrice = parseInt(minPrice as string);
      if (maxPrice) filters.maxPrice = parseInt(maxPrice as string);
      
      // Support country+city filtering for main feed (Hero search)
      if (req.query.city && req.query.city !== 'any') {
        const locationFilter = getLocationFilter(req.query.city as string);
        if (locationFilter) {
          filters.locationContains = locationFilter;
        }
      }
      
      // If admin is requesting, allow getting all statuses
      if (req.session.isAdmin && req.query.status) {
        // If admin requests status=all, don't filter by status at all
        if (req.query.status === 'all') {
          delete filters.status;
        } else {
          filters.status = req.query.status as string;
        }
      }
      
      // If regular user is requesting their own properties, include their pending ones
      if (req.session.userId && !req.session.isAdmin && req.query.myProperties) {
        filters = {
          ownerId: req.session.userId
        };
      }
      
      const properties = await storage.getProperties(filters);
      
      // Sort properties to prioritize featured listings (VIP and Super VIP)
      const sortedProperties = properties.sort((a, b) => {
        // First, check if listings are still active (not expired)
        const now = new Date();
        const aIsActive = !a.listingExpiresAt || new Date(a.listingExpiresAt) > now;
        const bIsActive = !b.listingExpiresAt || new Date(b.listingExpiresAt) > now;
        
        // If listing is expired, treat it as regular
        const aListingType = aIsActive ? a.listingType : 'regular';
        const bListingType = bIsActive ? b.listingType : 'regular';
        
        // Prioritization order: super_vip > vip > regular
        const priorities = { 'super_vip': 3, 'vip': 2, 'regular': 1 };
        const aPriority = priorities[aListingType as keyof typeof priorities] || 1;
        const bPriority = priorities[bListingType as keyof typeof priorities] || 1;
        
        if (aPriority !== bPriority) {
          return bPriority - aPriority; // Higher priority first
        }
        
        // If same priority, sort by creation date (newest first)
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      
      res.json(sortedProperties);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/properties/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getPropertyWithAgent(id);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      // If property is not approved, only show to owner or admin
      if (
        property.status !== PROPERTY_STATUS.APPROVED && 
        (!req.session.userId || 
          (property.ownerId !== req.session.userId && !req.session.isAdmin))
      ) {
        return res.status(403).json({ message: "Not authorized to view this property" });
      }
      
      res.json(property);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Contact property owner — notify admin via SMS
  app.post("/api/properties/:id/contact", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getPropertyWithAgent(id);
      if (!property) return res.status(404).json({ message: "Property not found" });

      // Who is contacting? (logged-in user or guest)
      const contactorId = req.session?.userId;
      let contactorPhone: string | null = null;
      let contactorName: string = "زائر / Guest";
      if (contactorId) {
        const contactor = await storage.getUser(contactorId);
        if (contactor) {
          contactorPhone = contactor.whatsappNumber || contactor.phoneNumber || null;
          contactorName = contactor.username;
        }
      }
      // Also accept phone from body (guest flow)
      if (!contactorPhone && req.body?.phone) contactorPhone = req.body.phone;

      // Save contact event to database (no SMS — admin reviews leads manually)
      await storage.createContactLog({
        propertyId: id,
        contactorId: contactorId ?? undefined,
        contactorName,
        contactorPhone: contactorPhone ?? undefined,
        ownerName: property.agent?.username ?? undefined,
        ownerPhone: property.agent?.whatsappNumber || property.agent?.phoneNumber || undefined,
        propertyTitle: property.title,
      });

      res.json({
        success: true,
        ownerPhone: property.agent?.phoneNumber || null,
        ownerWhatsapp: property.agent?.whatsappNumber || null,
      });
    } catch (error: any) {
      console.error("Contact notify error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  const recentSubmissions = new Map<string, number>();
  
  app.post("/api/properties", isAuthenticated, async (req, res) => {
    try {
      const propertyData = insertPropertySchema.parse(req.body);
      
      const dedupeKey = `${req.session.userId}-${propertyData.title}-${propertyData.propertyType}`;
      const lastSubmission = recentSubmissions.get(dedupeKey);
      const now = Date.now();
      if (lastSubmission && now - lastSubmission < 3000) {
        return res.status(429).json({ message: "Duplicate submission detected. Please wait a few seconds." });
      }
      recentSubmissions.set(dedupeKey, now);
      setTimeout(() => recentSubmissions.delete(dedupeKey), 5000);
      
      // Add watermark to all property images
      try {
        const watermarkedImages = await processImages(propertyData.images);
        propertyData.images = watermarkedImages;
      } catch (err) {
        console.error('Error adding watermarks to images:', err);
      }
      
      const isAdminUser = req.session.isAdmin === true;
      
      const property = await storage.createProperty({
        ...propertyData,
        ownerId: req.session.userId!,
      });
      
      if (isAdminUser) {
        await storage.updatePropertyStatus(property.id, PROPERTY_STATUS.APPROVED);
        property.status = PROPERTY_STATUS.APPROVED;
      } else {
        // Notify admin about new property needing approval (fire-and-forget with full logging)
        (async () => {
          try {
            console.log(`[Email] 🔔 New property #${property.id} submitted by user ${req.session.userId} — sending admin notification...`);
            const owner = await storage.getUser(req.session.userId!);
            await sendNewPropertyNotification({
              id: property.id,
              title: property.title,
              propertyType: property.propertyType,
              price: property.price,
              location: property.location,
              ownerName: owner?.username,
              ownerEmail: owner?.email,
              ownerPhone: owner?.phoneNumber,
            });
            console.log(`[Email] ✅ Admin notification complete for property #${property.id}`);
          } catch (err: any) {
            console.error(`[Email] ❌ Notification failed for property #${property.id}:`, err.message);
          }
        })();
      }
      
      if (
        propertyData.propertyType === PROPERTY_TYPES.PROJECT && 
        req.body.projectDetails
      ) {
        const projectData = insertProjectSchema.parse({
          ...req.body.projectDetails,
          propertyId: property.id
        });
        
        await storage.createProject(projectData);
      }
      
      res.status(201).json({
        ...property,
        pendingReview: !isAdminUser
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error('❌ Property creation ZodError:', JSON.stringify(error.errors, null, 2));
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error('❌ Property creation error:', error);
      res.status(500).json({ message: (error as Error).message || "Server error" });
    }
  });

  // Update property (PATCH)
  app.patch("/api/properties/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const propertyData = insertPropertySchema.parse(req.body);
      
      // Get existing property to check ownership
      const existingProperty = await storage.getPropertyById(id);
      if (!existingProperty) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      // Check ownership - only allow property owner or admin to edit
      const isOwner = existingProperty.ownerId === req.session.userId;
      const isAdmin = req.session.isAdmin;
      
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ message: "You can only edit your own properties" });
      }
      
      // Add watermark to all property images if they've changed
      try {
        const watermarkedImages = await processImages(propertyData.images);
        propertyData.images = watermarkedImages;
      } catch (err) {
        console.error('Error adding watermarks to images:', err);
        // Continue with original images if watermarking fails
      }
      
      // Update property (preserve original owner)
      const property = await storage.updateProperty(id, {
        ...propertyData,
        ownerId: existingProperty.ownerId // Keep original owner
      });
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }

      // If project type and title changed, sync projects.developer when it matched the old title
      if (
        propertyData.propertyType === PROPERTY_TYPES.PROJECT &&
        existingProperty.title !== propertyData.title
      ) {
        if (req.body.projectDetails?.developer) {
          // Explicit developer provided — update with that value
          await storage.updateProjectByPropertyId(id, {
            developer: req.body.projectDetails.developer,
          });
        } else {
          // No explicit developer — sync developer to new title only if it previously matched the old title
          const existingProjects = await storage.getProjects();
          const linked = existingProjects.find(p => p.propertyId === id);
          if (linked && linked.developer === existingProperty.title) {
            await storage.updateProjectByPropertyId(id, {
              developer: propertyData.title,
            });
          }
        }
      } else if (
        propertyData.propertyType === PROPERTY_TYPES.PROJECT &&
        req.body.projectDetails
      ) {
        // Title unchanged but projectDetails explicitly sent — update them
        await storage.updateProjectByPropertyId(id, {
          developer: req.body.projectDetails.developer,
          completionDate: req.body.projectDetails.completionDate,
          projectStatus: req.body.projectDetails.projectStatus,
        });
      }

      res.json(property);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error('Error updating property:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Mark property as sold / unmark
  // Toggle topRated — admin only
  app.patch("/api/properties/:id/top-rated", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getProperty(id);
      if (!property) return res.status(404).json({ message: "Property not found" });
      const topRated = req.body.topRated === true;
      const updated = await storage.updateProperty(id, { topRated } as any);
      res.json(updated);
    } catch (error) {
      console.error("Error updating topRated:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Toggle bestPrice — admin only
  app.patch("/api/properties/:id/best-price", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getProperty(id);
      if (!property) return res.status(404).json({ message: "Property not found" });
      const bestPrice = req.body.bestPrice === true;
      const updated = await storage.updateProperty(id, { bestPrice } as any);
      res.json(updated);
    } catch (error) {
      console.error("Error updating bestPrice:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Toggle acceptablePrice — admin only
  app.patch("/api/properties/:id/acceptable-price", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getProperty(id);
      if (!property) return res.status(404).json({ message: "Property not found" });
      const acceptablePrice = req.body.acceptablePrice === true;
      const updated = await storage.updateProperty(id, { acceptablePrice } as any);
      res.json(updated);
    } catch (error) {
      console.error("Error updating acceptablePrice:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Toggle highPrice — admin only
  app.patch("/api/properties/:id/high-price", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getProperty(id);
      if (!property) return res.status(404).json({ message: "Property not found" });
      const highPrice = req.body.highPrice === true;
      const updated = await storage.updateProperty(id, { highPrice } as any);
      res.json(updated);
    } catch (error) {
      console.error("Error updating highPrice:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.patch("/api/properties/:id/sold", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getProperty(id);
      if (!property) return res.status(404).json({ message: "Property not found" });
      if (property.ownerId !== req.session.userId && !req.session.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { isSold } = req.body;
      const updated = await storage.updateProperty(id, { isSold: !!isSold } as any);
      res.json(updated);
    } catch (error) {
      console.error("Error marking sold:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.delete("/api/properties/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const property = await storage.getProperty(id);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      if (property.ownerId !== req.session.userId && !req.session.isAdmin) {
        return res.status(403).json({ message: "Not authorized to delete this property" });
      }
      
      const deleted = await storage.deleteProperty(id);
      if (deleted) {
        res.json({ message: "Property deleted successfully" });
      } else {
        res.status(500).json({ message: "Failed to delete property" });
      }
    } catch (error) {
      console.error('Error deleting property:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Admin routes for property approval
  app.patch("/api/properties/:id/status", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      
      if (!status || !Object.values(PROPERTY_STATUS).includes(status as any)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      
      const property = await storage.updatePropertyStatus(id, status);
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      res.json(property);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Project routes
  app.get("/api/projects", async (req, res) => {
    try {
      // Get both dedicated projects and project-type properties
      const [dedicatedProjects, projectProperties] = await Promise.all([
        storage.getProjects(),
        storage.getPropertiesByType(PROPERTY_TYPES.PROJECT)
      ]);
      
      // Get property IDs that already have dedicated project records to avoid duplicates
      const dedicatedPropertyIds = new Set(dedicatedProjects.map(project => project.propertyId));
      
      // Filter out properties that already have dedicated project records
      const standaloneProjectProperties = projectProperties.filter(
        property => !dedicatedPropertyIds.has(property.id)
      );
      
      // Transform standalone project-type properties to project format for display
      const propertyProjects = standaloneProjectProperties.map(property => ({
        id: `property-${property.id}`, // Unique ID to avoid conflicts with dedicated projects
        propertyId: property.id,
        developer: property.title, // Use title as developer
        completionDate: 'Q4 2024', // Default completion
        projectStatus: 'Now Selling', // Default status
        createdAt: property.createdAt,
        property: property,
        // Include property fields for backward compatibility
        title: property.title,
        description: property.description,
        price: property.price,
        location: property.location,
        area: property.area,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        features: property.features || [],
        amenities: property.amenities || [],
        images: property.images || [],
        videos: property.videos || [],
        status: property.status,
        ownerId: property.ownerId
      }));
      
      // Combine and return all projects (dedicated projects + standalone project properties)
      const allProjects = [...dedicatedProjects, ...propertyProjects];
      res.json(allProjects);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const project = await storage.getProject(id);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      
      res.json(project);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/projects", isAdmin, async (req, res) => {
    try {
      const propertyData = insertPropertySchema.parse({
        ...req.body.property,
        propertyType: PROPERTY_TYPES.PROJECT,
        ownerId: req.session.userId!
      });
      
      const dedupeKey = `project-${req.session.userId}-${propertyData.title}`;
      const lastSubmission = recentSubmissions.get(dedupeKey);
      const now = Date.now();
      if (lastSubmission && now - lastSubmission < 3000) {
        return res.status(429).json({ message: "Duplicate submission detected. Please wait a few seconds." });
      }
      recentSubmissions.set(dedupeKey, now);
      setTimeout(() => recentSubmissions.delete(dedupeKey), 5000);
      
      try {
        const watermarkedImages = await processImages(propertyData.images);
        propertyData.images = watermarkedImages;
      } catch (err) {
        console.error('Error adding watermarks to project images:', err);
      }
      
      const property = await storage.createProperty(propertyData);
      
      // Then create the project with the property ID
      const projectData = insertProjectSchema.parse({
        ...req.body.projectDetails,
        propertyId: property.id
      });
      
      const project = await storage.createProject(projectData);
      
      res.status(201).json({ property, project });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      res.status(500).json({ message: "Server error" });
    }
  });

  // Cloudinary diagnostics (admin only)
  app.get("/api/cloudinary/test", isAuthenticated, async (req, res) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    res.json({
      configured: !!(cloudName && apiKey && apiSecret),
      cloudName: cloudName ? cloudName.substring(0, 4) + "***" : "MISSING",
      apiKey: apiKey ? apiKey.substring(0, 6) + "***" : "MISSING",
      apiSecretSet: !!apiSecret,
    });
  });

  // Photo upload — handled client-side via unsigned Cloudinary preset (kinglike_unsigned)
  // This stub is kept for backward compatibility only
  app.post("/api/photos/upload", isAuthenticated, (req, res) => {
    res.status(410).json({ error: "Server-side upload removed. Use direct unsigned Cloudinary upload from the client." });
  });

  app.post("/api/photos/process", isAuthenticated, async (req, res) => {
    const { photoURL } = req.body;
    res.status(200).json({ objectPath: photoURL || "" });
  });

  // Route to serve uploaded files (legacy object storage - with Range request support for video)
  app.get(/^\/objects\/(.*)/, async (req, res) => {
    try {
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);

      const [metadata] = await objectFile.getMetadata();
      const contentType = metadata.contentType || "application/octet-stream";
      const fileSize = Number(metadata.size);
      const isVideo = contentType.startsWith("video/");

      const rangeHeader = req.headers.range;

      if (isVideo && rangeHeader) {
        // Parse Range header e.g. "bytes=0-1023"
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=3600",
        });

        const stream = objectFile.createReadStream({ start, end });
        stream.on("error", (err) => {
          console.error("Stream error:", err);
          if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
      } else {
        // No range request - serve full file
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": fileSize,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
        });
        const stream = objectFile.createReadStream();
        stream.on("error", (err) => {
          console.error("Stream error:", err);
          if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
      }
    } catch (error: any) {
      if (error.name === "ObjectNotFoundError") {
        if (req.path.startsWith("/objects/.private/uploads/")) {
          return res.status(404).json({ error: "File not found" });
        }
        return res.redirect("https://via.placeholder.com/800x600?text=Image+Not+Found");
      }
      return res.status(404).json({ error: "Object not found" });
    }
  });

  // Video upload — handled client-side via unsigned Cloudinary preset (kinglike_unsigned)
  app.post("/api/videos/upload", isAuthenticated, (req, res) => {
    res.status(410).json({ error: "Server-side upload removed. Use direct unsigned Cloudinary upload from the client." });
  });

  app.post("/api/videos/process", isAuthenticated, async (req, res) => {
    const { videoURL } = req.body;
    res.status(200).json({ objectPath: videoURL || "" });
  });

  // Audio upload — handled client-side via unsigned Cloudinary preset (kinglike_unsigned)
  app.post("/api/audios/upload", isAuthenticated, (req, res) => {
    res.status(410).json({ error: "Server-side upload removed. Use direct unsigned Cloudinary upload from the client." });
  });

  app.post("/api/audios/process", isAuthenticated, async (req, res) => {
    const { audioURL } = req.body;
    res.status(200).json({ objectPath: audioURL || "" });
  });

  // Serve uploaded files
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  // Blog routes
  app.get("/api/blog", async (req, res) => {
    try {
      const { published, authorId, category, lang, country: countryFilter } = req.query;
      
      const filters: any = {};
      const isAdmin = req.session?.userId ? (await storage.getUser(req.session.userId))?.isAdmin : false;
      if (published === 'all' && isAdmin) {
        // Admin can see all posts - don't filter by published
      } else {
        filters.published = true;
      }
      if (authorId) filters.authorId = parseInt(authorId as string);
      if (category) filters.category = category as string;
      
      let blogPosts = await storage.getBlogPosts(filters);
      
      if (countryFilter && countryFilter !== 'all') {
        blogPosts = blogPosts.filter((p: any) => p.country === countryFilter);
      }

      if (lang) {
        blogPosts = blogPosts.map((post: any) => {
          const t = post.translations?.[lang as string];
          if (t) {
            return { ...post, title: t.title, content: t.content, excerpt: t.excerpt };
          }
          return post;
        });
      }
      
      res.json(blogPosts);
    } catch (error) {
      console.error('Error fetching blog posts:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.get("/api/blog/slug/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const { lang } = req.query;
      const langStr = typeof lang === "string" && SEO_LANGS.includes(lang) ? lang : null;

      let blogPost: any = null;

      // 1. Try localized slug lookup if a lang was provided
      if (langStr) {
        blogPost = await storage.getBlogPostByLocalizedSlug(langStr, slug);
      }

      // 2. Fall back to English base slug
      if (!blogPost) {
        blogPost = await storage.getBlogPostBySlug(slug);
      }

      if (!blogPost) {
        // Check legacy old slugs
        const redirectPost = await storage.getBlogPostByOldSlug(slug);
        if (redirectPost) {
          const localizedSlug = langStr
            ? ((redirectPost as any).translations?.[langStr]?.slug || redirectPost.slug)
            : redirectPost.slug;
          return res.status(301).json({ redirect: localizedSlug });
        }
        return res.status(404).json({ message: "Blog post not found" });
      }

      if (langStr) {
        const t = blogPost.translations?.[langStr];
        if (t) {
          return res.json({ ...blogPost, title: t.title, content: t.content, excerpt: t.excerpt });
        }
      }

      res.json(blogPost);
    } catch (error) {
      console.error('Error fetching blog post by slug:', error);
      res.status(500).json({ message: "Failed to fetch blog post" });
    }
  });

  app.get("/api/blog/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { lang } = req.query;
      const blogPost = await storage.getBlogPostById(id);
      
      if (!blogPost) {
        return res.status(404).json({ message: "Blog post not found" });
      }
      
      if (lang) {
        const t = (blogPost as any).translations?.[lang as string];
        if (t) {
          return res.json({ ...blogPost, title: t.title, content: t.content, excerpt: t.excerpt });
        }
      }

      res.json(blogPost);
    } catch (error) {
      console.error('Error fetching blog post:', error);
      res.status(500).json({ message: "Server error" });
    }
  });





  // Blog image upload route
  // Blog image/video upload — handled client-side via unsigned Cloudinary preset (kinglike_unsigned)
  app.post("/api/blog/upload-image", (req, res) => {
    res.status(410).json({ message: "Server-side upload removed. Use direct unsigned Cloudinary upload from the client." });
  });

  app.post("/api/blog/upload-video", (req, res) => {
    res.status(410).json({ message: "Server-side upload removed. Use direct unsigned Cloudinary upload from the client." });
  });

  // Blog CRUD routes (admin only)
  app.post("/api/blog", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { title, content, excerpt, coverImage, coverVideo, categories, published, country, slug: rawManualSlug } = req.body;
      
      if (!title || !content) {
        return res.status(400).json({ message: "Title and content are required" });
      }

      // ── Slug resolution ───────────────────────────────────────────────────
      let slug: string;
      let isManualSlug = false;
      if (rawManualSlug && typeof rawManualSlug === "string") {
        const cleanSlug = rawManualSlug.toLowerCase().trim()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
        if (cleanSlug) {
          const taken = await storage.getBlogPostBySlug(cleanSlug);
          if (taken) {
            return res.status(409).json({ message: `Slug "${cleanSlug}" is already used by another post` });
          }
          slug = cleanSlug;
          isManualSlug = true;
        } else {
          slug = generateEnglishSlug(title) || timestampSlug();
        }
      } else {
        // Auto-generate English-only slug (non-ASCII titles get a timestamp until translation completes)
        slug = generateEnglishSlug(title) || timestampSlug();
      }
      const finalExcerpt = excerpt || content.substring(0, 200);

      const postData = {
        title,
        slug,
        content,
        excerpt: finalExcerpt,
        coverImage: coverImage || '',
        coverVideo: coverVideo || null,
        authorId: user.id,
        categories: categories || [],
        country: country || 'georgia',
        published: published !== false,
      };

      const validated = insertBlogPostSchema.safeParse(postData);
      if (!validated.success) {
        return res.status(400).json({ message: "Invalid blog post data", errors: validated.error.errors });
      }

      const blogPost = await storage.createBlogPost(validated.data);
      const originalSlug = blogPost.slug;

      res.status(201).json(blogPost);

      translateBlogPost(title, content, finalExcerpt).then(async (translations) => {
        try {
          const updatePayload: any = { translations };
          // Only upgrade the slug if it's a timestamp fallback AND was not manually set by the admin.
          // Manual slugs must never be silently overwritten by the translation process.
          const isTimestampSlug = /^post-\d+$/.test(originalSlug);
          const enTitle = (translations as any)?.en?.title;
          if (!isManualSlug && isTimestampSlug && enTitle) {
            const enSlug = toEnglishSlug(enTitle);
            if (enSlug && enSlug !== originalSlug) {
              // Try to use the English slug; if duplicate, keep original
              try {
                const existing = await storage.getBlogPostBySlug(enSlug);
                if (!existing) {
                  updatePayload.slug = enSlug;
                  const currentPost = await storage.getBlogPostBySlug(originalSlug);
                  const prevOld: string[] = (currentPost as any)?.oldSlugs ?? [];
                  if (!prevOld.includes(originalSlug)) {
                    updatePayload.oldSlugs = [...prevOld, originalSlug];
                  }
                }
              } catch (_) { /* slug conflict — keep original */ }
            }
          }
          await storage.updateBlogPost(blogPost.id, updatePayload);
          console.log(`Translations saved for blog post ${blogPost.id}`);
        } catch (err) {
          console.error(`Failed to save translations for blog post ${blogPost.id}:`, err);
        }
      }).catch(err => console.error('Translation failed:', err));
    } catch (error) {
      console.error('Error creating blog post:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.put("/api/blog/:id", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const { title, content, excerpt, coverImage, coverVideo, categories, published, country, slug: manualSlug } = req.body;
      
      const updates: any = {};
      const currentPost = await storage.getBlogPostById(id);

      // ── Manual slug override (admin panel) ────────────────────────────────
      // If the admin explicitly sends a `slug` field, honour it and
      // automatically create a 301 redirect from the old slug.
      if (manualSlug !== undefined && typeof manualSlug === "string") {
        const cleanSlug = manualSlug.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
        if (cleanSlug && currentPost && cleanSlug !== currentPost.slug) {
          // Confirm no other post owns this slug
          const taken = await storage.getBlogPostBySlug(cleanSlug);
          if (taken && taken.id !== id) {
            return res.status(409).json({ message: `Slug "${cleanSlug}" is already used by another post (ID ${taken.id})` });
          }
          const prevOld: string[] = (currentPost as any)?.oldSlugs ?? [];
          if (!prevOld.includes(currentPost.slug)) {
            updates.oldSlugs = [...prevOld, currentPost.slug];
          }
          updates.slug = cleanSlug;
        }
      } else if (title !== undefined) {
        // ── Auto-slug from title (existing behaviour) ──────────────────────
        updates.title = title;
        // If title is ASCII-safe, generate a new English slug.
        // If non-ASCII (e.g. Arabic), keep the EXISTING slug so we don't
        // overwrite a good English slug with a new timestamp slug.
        const asciiSlug = generateEnglishSlug(title);
        if (asciiSlug) {
          // Title changed to an ASCII-able value — update slug with 301 redirect
          if (currentPost && currentPost.slug !== asciiSlug) {
            const prevOld: string[] = (currentPost as any)?.oldSlugs ?? [];
            if (!prevOld.includes(currentPost.slug)) {
              updates.oldSlugs = [...prevOld, currentPost.slug];
            }
          }
          updates.slug = asciiSlug;
        }
        // else: non-ASCII title → keep existing slug; translation callback will upgrade it
      }

      if (title !== undefined && manualSlug === undefined) updates.title = title;
      else if (title !== undefined) updates.title = title;
      if (content !== undefined) updates.content = content;
      if (excerpt !== undefined) updates.excerpt = excerpt;
      if (coverImage !== undefined) updates.coverImage = coverImage;
      if (coverVideo !== undefined) updates.coverVideo = coverVideo;
      if (categories !== undefined) updates.categories = categories;
      if (published !== undefined) updates.published = published;
      if (country !== undefined) updates.country = country;

      const blogPost = await storage.updateBlogPost(id, updates);
      if (!blogPost) {
        return res.status(404).json({ message: "Blog post not found" });
      }

      res.json(blogPost);

      if (title !== undefined || content !== undefined || excerpt !== undefined) {
        const finalTitle = title || blogPost.title;
        const finalContent = content || blogPost.content;
        const finalExcerpt = excerpt || blogPost.excerpt;
        const slugBeforeTranslation = blogPost.slug;
        translateBlogPost(finalTitle, finalContent, finalExcerpt).then(async (translations) => {
          try {
            const translationUpdate: any = { translations };
            // After translation, upgrade slug if it's still a timestamp fallback
            const enTitle = (translations as any)?.en?.title;
            // Only upgrade the slug when it is a timestamp fallback (post-<timestamp>).
            // Never overwrite a manually-set or auto-generated real slug via the translation callback.
            const isTimestamp = /^post-\d+$/.test(slugBeforeTranslation);
            if (enTitle && isTimestamp) {
              const enSlug = toEnglishSlug(enTitle);
              if (enSlug && enSlug !== slugBeforeTranslation) {
                const conflict = await storage.getBlogPostBySlug(enSlug);
                if (!conflict || conflict.id === id) {
                  const prevOld: string[] = (currentPost as any)?.oldSlugs ?? [];
                  if (!prevOld.includes(slugBeforeTranslation)) {
                    translationUpdate.oldSlugs = [...prevOld, slugBeforeTranslation];
                  }
                  translationUpdate.slug = enSlug;
                }
              }
            }
            await storage.updateBlogPost(id, translationUpdate);
            console.log(`Translations updated for blog post ${id}`);
          } catch (err) {
            console.error(`Failed to update translations for blog post ${id}:`, err);
          }
        }).catch(err => console.error('Translation update failed:', err));
      }
    } catch (error) {
      console.error('Error updating blog post:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // ─── Admin: Migrate all blog slugs to English-only ──────────────────────
  app.post("/api/admin/migrate-blog-slugs", isAuthenticated, isAdmin, async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) return res.status(403).json({ message: "Admin access required" });

      const posts = await storage.getBlogPosts();
      const results: { id: number; old: string; new: string; skipped?: boolean }[] = [];

      for (const post of posts) {
        const enTitle = (post as any).translations?.en?.title;
        const newSlug = enTitle ? toEnglishSlug(enTitle) : generateEnglishSlug(post.title);
        if (!newSlug || newSlug === post.slug) continue;

        // Check for collision
        const conflict = await storage.getBlogPostBySlug(newSlug);
        if (conflict && conflict.id !== post.id) {
          results.push({ id: post.id, old: post.slug, new: newSlug, skipped: true });
          continue;
        }

        const prevOld: string[] = (post as any).oldSlugs ?? [];
        const oldSlugsUpdated = prevOld.includes(post.slug) ? prevOld : [...prevOld, post.slug];
        await storage.updateBlogPost(post.id, { slug: newSlug, oldSlugs: oldSlugsUpdated } as any);
        results.push({ id: post.id, old: post.slug, new: newSlug });
      }

      console.log(`[MigrateSlugs] Migrated ${results.filter(r => !r.skipped).length} posts`);
      res.json({ migrated: results.filter(r => !r.skipped).length, skipped: results.filter(r => r.skipped).length, details: results });
    } catch (error) {
      console.error("Error migrating slugs:", error);
      res.status(500).json({ message: "Migration failed" });
    }
  });

  // ─── Admin: Re-translate all blog posts for missing languages ────────────
  app.post("/api/admin/retranslate-blogs", isAuthenticated, isAdmin, async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) return res.status(403).json({ message: "Admin access required" });

      const NEW_LANGS = ["fa", "nl", "de", "sv", "fr", "it"];
      const posts = await storage.getBlogPosts();
      res.json({ message: "Re-translation started in background", total: posts.length });

      // Run in background after response
      (async () => {
        let updated = 0;
        for (const post of posts) {
          const existingTranslations: any = (post as any).translations ?? {};
          const missingLangs = NEW_LANGS.filter(l => !existingTranslations[l]);
          if (missingLangs.length === 0) continue;

          try {
            const detectedLang = await detectLanguage(post.title + " " + post.content.substring(0, 200));
            const sourceLang = detectedLang;
            const sourceTitle   = existingTranslations[sourceLang]?.title   ?? existingTranslations["en"]?.title   ?? post.title;
            const sourceContent = existingTranslations[sourceLang]?.content ?? existingTranslations["en"]?.content ?? post.content;
            const sourceExcerpt = existingTranslations[sourceLang]?.excerpt ?? existingTranslations["en"]?.excerpt ?? post.excerpt ?? "";

            const newTranslations: any = { ...existingTranslations };
            for (const lang of missingLangs) {
              const [tTitle, tContent, tExcerpt] = await Promise.all([
                translateText(sourceTitle, lang, sourceLang),
                translateText(sourceContent, lang, sourceLang),
                translateText(sourceExcerpt, lang, sourceLang),
              ]);
              newTranslations[lang] = { title: tTitle, content: tContent, excerpt: tExcerpt };
            }
            await storage.updateBlogPost(post.id, { translations: newTranslations } as any);
            updated++;
            console.log(`[Retranslate] Post ${post.id} updated with langs: ${missingLangs.join(", ")}`);
          } catch (err) {
            console.error(`[Retranslate] Failed for post ${post.id}:`, err);
          }
        }
        console.log(`[Retranslate] Done — updated ${updated}/${posts.length} posts`);
      })();
    } catch (error) {
      console.error("Error starting retranslation:", error);
      res.status(500).json({ message: "Failed to start retranslation" });
    }
  });

  // ─── Admin: Backfill SEO metadata for existing posts ────────────────────
  // Generates metaDescription, keywords, ogTitle, ogDescription, twitterTitle,
  // twitterDescription for every translation that doesn't already have them.
  // Does NOT re-translate content. Does NOT modify URLs or existing content.
  app.post("/api/admin/backfill-blog-seo", isAuthenticated, isAdmin, async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) return res.status(403).json({ message: "Admin access required" });

      const posts = await storage.getBlogPosts();
      res.json({ message: "SEO backfill started in background", total: posts.length });

      (async () => {
        let updated = 0;
        for (const post of posts) {
          try {
            const existing: any = (post as any).translations ?? {};
            // Check if any primary SEO lang is missing SEO fields
            const needsUpdate = PRIMARY_SEO_LANGS.some(
              (l) => existing[l] && !existing[l].metaDescription
            ) || Object.values(existing).some((t: any) => t && !t.metaDescription);

            if (!needsUpdate) continue;

            const enriched = enrichTranslationsWithSeo(existing);
            await storage.updateBlogPost(post.id, { translations: enriched } as any);
            updated++;
            console.log(`[SEO Backfill] Post ${post.id} enriched`);
          } catch (err) {
            console.error(`[SEO Backfill] Failed for post ${post.id}:`, err);
          }
        }
        console.log(`[SEO Backfill] Done — enriched ${updated}/${posts.length} posts`);
      })();
    } catch (error) {
      console.error("Error starting SEO backfill:", error);
      res.status(500).json({ message: "Failed to start SEO backfill" });
    }
  });

  // ─── Admin: Get SEO status for a single blog post ────────────────────────
  app.get("/api/admin/blog/:id/seo-status", isAuthenticated, isAdmin, async (req, res) => {
    try {
      if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) return res.status(403).json({ message: "Admin access required" });

      const post = await storage.getBlogPostById(parseInt(req.params.id));
      if (!post) return res.status(404).json({ message: "Post not found" });

      const translations: any = (post as any).translations ?? {};
      const allLangs = ["ar", "en", "tr", "he", "ru", "ka", "az", "fa", "zh", "pl", "it", "nl", "de", "sv", "fr"];

      const status = allLangs.reduce((acc: any, lang) => {
        const t = translations[lang];
        acc[lang] = !t
          ? "missing"
          : t.translationStatus === "pending_translation"
          ? "pending_translation"
          : t.metaDescription
          ? t.translationStatus || "generated"
          : "content_only";
        return acc;
      }, {});

      res.json({ postId: post.id, slug: post.slug, status });
    } catch (error) {
      console.error("Error fetching SEO status:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.delete("/api/blog/:id", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const id = parseInt(req.params.id);
      const deleted = await storage.deleteBlogPost(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Blog post not found" });
      }

      res.json({ message: "Blog post deleted" });
    } catch (error) {
      console.error('Error deleting blog post:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/blog/retranslate-all", async (req, res) => {
    try {
      if (!req.session?.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const posts = await storage.getBlogPosts({});
      res.json({ message: `Re-translating ${posts.length} posts in background` });

      for (const post of posts) {
        try {
          const postExcerpt = post.excerpt || post.content.substring(0, 200);
          const translations = await translateBlogPost(post.title, post.content, postExcerpt);
          await storage.updateBlogPost(post.id, { translations } as any);
          console.log(`Re-translated blog post ${post.id}: ${post.title}`);
        } catch (err) {
          console.error(`Failed to re-translate post ${post.id}:`, err);
        }
      }
    } catch (error) {
      console.error('Error re-translating:', error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Serve public objects - temporarily disabled until object storage is fixed
  app.get(/^\/public-objects\/(.*)/, async (req, res) => {
    // TODO: Implement public object serving after fixing Google Cloud Storage issues
    res.status(503).json({ error: "Public object serving temporarily unavailable" });
  });

  // Helper function to get location filter for country/city selection
  function getLocationFilter(cityCode: string): string | null {
    // Handle country-level filtering
    const countryMap: Record<string, string> = {
      'georgia': 'Georgia',
      'uae': 'UAE',
      'northern-cyprus': 'Northern Cyprus',
      'turkey': 'Turkey'
    };
    
    // Handle city-level filtering  
    const cityMap: Record<string, string> = {
      'batumi': 'Batumi',
      'tbilisi': 'Tbilisi', 
      'dubai': 'Dubai',
      'sharjah': 'Sharjah',
      'rasAlKhaimah': 'Ras Al Khaimah',
      'ras-al-khaimah': 'Ras Al Khaimah',
      'lefkosa': 'Lefkoşa',
      'gazimağusa': 'Gazimağusa',
      'girne': 'Girne',
      'iskele': 'İskele',
      'guzelyurt': 'Güzelyurt',
      'esentepe': 'Esentepe',
      'istanbul': 'Istanbul',
      'trabzon': 'Trabzon'
    };
    
    // Return country filter or city filter
    return countryMap[cityCode] || cityMap[cityCode] || null;
  }

  const translationCache = new Map<string, { text: string; timestamp: number }>();
  const TRANSLATION_CACHE_TTL = 24 * 60 * 60 * 1000;
  const MAX_SERVER_CACHE = 1000;

  function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36) + '_' + str.length;
  }

  let translateFn: any = null;

  app.post("/api/translate", async (req, res) => {
    try {
      const { texts, targetLang } = req.body;
      
      if (!texts || !targetLang || !Array.isArray(texts)) {
        return res.status(400).json({ message: "texts (array) and targetLang are required" });
      }

      if (texts.length > 50) {
        return res.status(400).json({ message: "Maximum 50 texts per request" });
      }

      const langMap: Record<string, string> = {
        en: 'en', ar: 'ar', he: 'iw', ru: 'ru', 
        ka: 'ka', az: 'az', tr: 'tr', zh: 'zh-CN', pl: 'pl', it: 'it'
      };
      const target = langMap[targetLang] || targetLang;

      if (!translateFn) {
        const translateModule = await import('google-translate-api-x');
        translateFn = translateModule.default || translateModule.translate;
      }

      if (translationCache.size > MAX_SERVER_CACHE) {
        const entries = Array.from(translationCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
        entries.slice(0, 200).forEach(([key]) => translationCache.delete(key));
      }

      const results: string[] = [];
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      for (let idx = 0; idx < texts.length; idx++) {
        const text = texts[idx];
        if (!text || text.trim().length === 0) {
          results.push(text || '');
          continue;
        }

        const cacheKey = `${simpleHash(text)}_${target}`;
        const cached = translationCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < TRANSLATION_CACHE_TTL) {
          results.push(cached.text);
          continue;
        }

        let translated = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (idx > 0 || attempt > 0) {
              await delay(500 * (attempt + 1));
            }
            const result = await translateFn(text, { to: target });
            translationCache.set(cacheKey, { text: result.text, timestamp: Date.now() });
            results.push(result.text);
            translated = true;
            break;
          } catch (err: any) {
            if (err?.name === 'TooManyRequestsError' || err?.message?.includes('Too Many Requests') || err?.message?.includes('429')) {
              console.log(`Rate limited on attempt ${attempt + 1}, waiting ${3000 * (attempt + 1)}ms...`);
              await delay(3000 * (attempt + 1));
              continue;
            }
            console.error('Translation error:', err);
            break;
          }
        }
        if (!translated) {
          results.push(text);
        }
      }

      res.json({ translations: results });
    } catch (error) {
      console.error('Translation endpoint error:', error);
      res.status(500).json({ message: "Translation failed" });
    }
  });

  // ── Notification Template Routes (Admin) ──────────────────────────────────

  // GET all templates (create defaults if missing)
  app.get("/api/admin/notification-templates", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const triggers = ["welcome", "weekly_update", "inactive_reminder"];
      const types = ["email", "whatsapp"];
      for (const type of types) {
        for (const trigger of triggers) {
          await getOrCreateTemplate(type, trigger);
        }
      }
      const templates = await db.select().from(notificationTemplates);
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PUT update a template
  app.put("/api/admin/notification-templates/:id", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const id = parseInt(req.params.id);
      const { subject, bodyHtml, bodyText, isActive } = req.body;
      const [updated] = await db
        .update(notificationTemplates)
        .set({ subject, bodyHtml, bodyText, isActive, updatedAt: new Date() })
        .where(eq(notificationTemplates.id, id))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST manual send (bulk or test)
  app.post("/api/admin/notifications/send", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const { trigger, channel } = req.body as { trigger: string; channel: string };
      let result = { email: null as any, whatsapp: null as any };
      if (channel === "email" || channel === "all") {
        result.email = await sendBulkEmail(trigger as any);
      }
      if (channel === "whatsapp" || channel === "all") {
        result.whatsapp = await sendBulkWhatsApp(trigger as any);
      }
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET notification logs
  app.get("/api/admin/notification-logs", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const logs = await db
        .select()
        .from(notificationLogs)
        .orderBy(desc(notificationLogs.sentAt))
        .limit(200);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST email campaign — send custom emails to a list of recipients
  app.post("/api/admin/email-campaign", isAuthenticated, isAdmin, async (req, res) => {
    try {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    const { recipients, subject, bodyText, imageUrl, appLink } = req.body;
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ message: "recipients required" });
    }
    if (!subject || !bodyText) {
      return res.status(400).json({ message: "subject and bodyText required" });
    }

    let RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY) {
      try {
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        const r = await pool.query("SELECT value FROM app_settings WHERE key='RESEND_API_KEY'");
        await pool.end();
        if (r.rows.length > 0) RESEND_KEY = r.rows[0].value;
      } catch {}
    }
    console.log(`[EmailCampaign] RESEND_API_KEY available: ${!!RESEND_KEY} (len=${(RESEND_KEY||'').length})`);
    if (!RESEND_KEY) {
      return res.status(503).json({ message: "RESEND_API_KEY not configured" });
    }

    const imageBlock = imageUrl
      ? `<div style="padding:0 32px 24px"><img src="${imageUrl}" alt="offer" style="width:100%;max-height:320px;object-fit:cover;border-radius:12px" /></div>`
      : "";

    const appLinkBlock = appLink
      ? `<div style="text-align:center;padding:8px 0 24px">
           <a href="${appLink}" style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);color:#fff;padding:14px 40px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">
             استكشف العقارات →
           </a>
         </div>`
      : "";

    const logoUrl = `${req.protocol}://${req.get("host")}/watermark-logo.png`;

    const html = `
<div style="background:#f0f9f9;padding:40px 20px;font-family:Arial,Helvetica,sans-serif;direction:rtl">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,84,118,0.10)">
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:40px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800">Kinglike Luxury</h1>
      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">منصة العقارات الفاخرة</p>
    </div>
    ${imageBlock}
    <div style="padding:${imageUrl ? "0" : "32px"} 32px 24px">
      <h2 style="color:#005476;margin-top:${imageUrl ? "24px" : "0"};font-size:20px">${subject}</h2>
      <p style="color:#444;line-height:1.9;font-size:15px;white-space:pre-wrap">${bodyText.replace(/</g, "&lt;")}</p>
    </div>
    ${appLinkBlock}
    <div style="background:#f0f9f9;padding:28px 20px 20px;text-align:center;border-top:1px solid #e5f5f5">
      <img src="${logoUrl}" alt="Kinglike Luxury" style="height:56px;width:auto;object-fit:contain;display:inline-block;margin-bottom:10px" />
      <div style="color:#aaa;font-size:12px">© Kinglike Luxury Real Estate Platform</div>
    </div>
  </div>
</div>`;

    const resend = new Resend(RESEND_KEY);
    const results: { email: string; status: "sent" | "failed"; error?: string }[] = [];

    for (const r of recipients) {
      const email = typeof r === "string" ? r : r.email;
      if (!email) continue;
      try {
        const result = await resend.emails.send({
          from: "Kinglike Luxury <info@kinglikeluxury.app>",
          to: email,
          subject,
          html,
          text: `${bodyText}\n\n${appLink || ""}`,
        });
        if (result.error) {
          results.push({ email, status: "failed", error: result.error.message });
        } else {
          results.push({ email, status: "sent" });
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err: any) {
        results.push({ email, status: "failed", error: err.message });
      }
    }

    const sent = results.filter(r => r.status === "sent").length;
    const failed = results.filter(r => r.status === "failed").length;
    console.log(`[EmailCampaign] sent=${sent} failed=${failed}`);
    res.json({ success: true, sent, failed, results });
    } catch (err: any) {
      console.error(`[EmailCampaign] Unhandled error:`, err.message);
      res.status(500).json({ message: err.message || "Server error" });
    }
  });

  // GET notification system status
  app.get("/api/admin/notification-status", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    res.json({
      emailConfigured: await isEmailConfigured(),
      whatsappConfigured: isWhatsAppConfigured(),
      emailSender: "info@kinglikeluxury.app",
    });
  });

  // ── Consultation Feature ────────────────────────────────────────────────────

  // GET available slots for a date (public)
  app.get("/api/consultation/slots", async (req, res) => {
    try {
      const { date } = req.query;
      if (!date || typeof date !== "string") {
        return res.status(400).json({ message: "date query param required (YYYY-MM-DD)" });
      }

      // Georgia timezone is UTC+4
      const nowGeorgia = new Date(Date.now() + 4 * 60 * 60 * 1000);
      const todayGeorgia = nowGeorgia.toISOString().split("T")[0];

      // Reject requests for past dates
      if (date < todayGeorgia) return res.json([]);

      // Check if slots already exist for this date (admin may have customised them)
      let allSlots = await storage.getConsultationTimeSlots(date);

      // ── Auto-generate default schedule (10:00 – 20:00, 30-min slots) ──────
      if (allSlots.length === 0) {
        const START_HOUR = 10;
        const END_HOUR   = 20;
        for (let h = START_HOUR; h < END_HOUR; h++) {
          for (let m = 0; m < 60; m += 30) {
            const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
            const endH = m === 30 ? h + 1 : h;
            const endM = m === 30 ? 0 : 30;
            const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
            try {
              await storage.createConsultationTimeSlot({ date, startTime, endTime, isAvailable: true });
            } catch (_) { /* skip duplicates */ }
          }
        }
        allSlots = await storage.getConsultationTimeSlots(date);
      }

      // Only return slots the admin hasn't blocked
      let available = allSlots.filter(s => s.isAvailable);

      // For today: hide time slots that have already passed (Georgia time)
      if (date === todayGeorgia) {
        const currentHHMM = nowGeorgia.toISOString().split("T")[1].slice(0, 5); // "HH:MM"
        available = available.filter(s => s.startTime > currentHHMM);
      }

      res.json(available);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // GET all slots (admin)
  app.get("/api/admin/consultation/slots", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const slots = await storage.getConsultationTimeSlots();
      res.json(slots);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // POST create slot (admin)
  app.post("/api/admin/consultation/slots", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const { date, startTime, endTime } = req.body;
      if (!date || !startTime || !endTime) {
        return res.status(400).json({ message: "date, startTime, endTime required" });
      }
      const slot = await storage.createConsultationTimeSlot({ date, startTime, endTime, isAvailable: true });
      res.json(slot);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // POST auto-generate 30-min slots for a date in Georgia time (12:00–20:00)
  app.post("/api/admin/consultation/slots/generate", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const { date } = req.body;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "date (YYYY-MM-DD) required" });
      }
      // Generate 30-min slots: 10:00 → 20:00 Georgia time
      const START_HOUR = 10; // 10:00 AM
      const END_HOUR   = 20; // 8:00 PM (last slot starts at 19:30)
      const created: any[] = [];
      for (let h = START_HOUR; h < END_HOUR; h++) {
        for (let m = 0; m < 60; m += 30) {
          const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          const endH = m === 30 ? h + 1 : h;
          const endM = m === 30 ? 0 : 30;
          const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
          try {
            const slot = await storage.createConsultationTimeSlot({ date, startTime, endTime, isAvailable: true });
            created.push(slot);
          } catch (_) { /* skip duplicates */ }
        }
      }
      res.json({ created: created.length, slots: created });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Server error" });
    }
  });

  // PATCH toggle slot availability (admin)
  app.patch("/api/admin/consultation/slots/:id/toggle", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const id = parseInt(req.params.id);
      const { isAvailable } = req.body;
      if (typeof isAvailable !== "boolean") {
        return res.status(400).json({ message: "isAvailable (boolean) required" });
      }
      const slot = await storage.toggleConsultationTimeSlot(id, isAvailable);
      if (!slot) return res.status(404).json({ message: "Slot not found" });
      res.json(slot);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // DELETE slot (admin)
  app.delete("/api/admin/consultation/slots/:id", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const id = parseInt(req.params.id);
      const ok = await storage.deleteConsultationTimeSlot(id);
      res.json({ success: ok });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // POST create booking (auth required)
  app.post("/api/consultation/bookings", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const user = await storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ message: "User not found" });

      const {
        country, consultationType, consultationMethod, slotId, budget, notes,
        email, whatsappContactNumber, propertyId, propertyTitle, userLanguage,
      } = req.body;

      if (!country || !consultationType || !consultationMethod || !slotId) {
        return res.status(400).json({ message: "country, consultationType, consultationMethod, slotId required" });
      }

      // Check slot still available
      const slot = (await storage.getConsultationTimeSlots(undefined)).find(s => s.id === slotId);
      if (!slot || !slot.isAvailable) {
        return res.status(409).json({ message: "Time slot no longer available" });
      }

      const booking = await storage.createConsultationBooking({
        userId: user.id,
        propertyId: propertyId || null,
        propertyTitle: propertyTitle || null,
        slotId,
        country,
        consultationType,
        consultationMethod,
        budget: budget || null,
        notes: notes || null,
        email: email || null,
        whatsappContactNumber: whatsappContactNumber || null,
        userPhone: user.phoneNumber || "",
        userLanguage: userLanguage || "en",
      });

      // Email is required for booking confirmation
      if (!email) {
        return res.status(400).json({ message: "Email address is required for booking confirmation" });
      }

      // Send booking received email via notificationService
      const slotDate = slot?.date || "TBD";
      const slotTime = slot ? `${slot.startTime} – ${slot.endTime}` : "TBD";
      const whatsappNum = req.body.whatsappContactNumber || user.phoneNumber || "";
      const emailResult = await sendEmail({
        to: email,
        subject: "📅 Consultation Booking Received – Kinglike Luxury",
        html: buildConsultationBookedEmail({
          type: consultationType,
          method: consultationMethod,
          date: slotDate,
          time: slotTime,
          country,
          clientName: user.username,
          whatsappNumber: (consultationMethod.startsWith("whatsapp") && whatsappNum) ? whatsappNum : undefined,
        }),
      });
      console.log(`[Consultation] Booking #${booking.id} email: ${emailResult.sent ? "✓" : "✗ " + emailResult.error}`);

      // Create in-app notification so user sees it immediately
      try {
        const typeLabel = consultationType.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        const methodLabel = consultationMethod.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        await storage.createUserNotification({
          userId: user.id,
          type: "consultation_pending",
          title: "📅 Consultation Booking Received",
          message: `Your ${typeLabel} consultation via ${methodLabel} on ${slotDate} at ${slotTime} has been received. We will confirm it shortly.`,
          data: {
            bookingId: booking.id,
            slotDate,
            slotTime,
            consultationType,
            consultationMethod,
            country,
          },
          isRead: false,
        });
        console.log(`[Consultation] In-app notification created for userId=${user.id} booking #${booking.id}`);
      } catch (notifErr: any) {
        console.error(`[Consultation] In-app notification failed: ${notifErr.message}`);
      }

      res.json(booking);
    } catch (err: any) {
      console.error("[Consultation] booking error:", err);
      res.status(500).json({ message: err.message || "Server error" });
    }
  });

  // GET user's bookings
  app.get("/api/consultation/bookings/mine", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const bookings = await storage.getUserConsultationBookings(req.session.userId);
      res.json(bookings);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // GET all bookings (admin)
  app.get("/api/admin/consultation/bookings", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const { status, country, method } = req.query;
      const bookings = await storage.getConsultationBookings({
        status: typeof status === "string" ? status : undefined,
        country: typeof country === "string" ? country : undefined,
        method: typeof method === "string" ? method : undefined,
      });
      res.json(bookings);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // PATCH update booking (admin) — with full notification delivery status
  app.patch("/api/admin/consultation/bookings/:id", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const id = parseInt(req.params.id);
      const { status, meetingLink, adminNotes } = req.body;

      const existing = await storage.getConsultationBookingById(id);
      if (!existing) return res.status(404).json({ message: "Booking not found" });

      const updated = await storage.updateConsultationBooking(id, {
        ...(status && { status }),
        ...(meetingLink !== undefined && { meetingLink: meetingLink || null }),
        ...(adminNotes !== undefined && { adminNotes: adminNotes || null }),
      });

      // Delivery status — returned to admin UI
      const delivery: { sms?: any; email?: any; inApp?: any } = {};

      const isConfirmed = status === "confirmed";
      const isRejected  = status === "rejected";
      const isCancelled = status === "cancelled";
      const isCompleted = status === "completed";
      const needsNotif  = isConfirmed || isRejected || isCancelled || isCompleted;

      if (needsNotif) {
        // Fetch slot to get date/time for notification content
        let slotDate = "TBD";
        let slotTime = "TBD";
        if (existing.slotId) {
          const slot = await storage.getConsultationSlotById(existing.slotId);
          if (slot) {
            slotDate = slot.date;
            slotTime = `${slot.startTime} – ${slot.endTime}`;
          }
        }

        const typeLabel = existing.consultationType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        const methodLabel = existing.consultationMethod.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        const isWhatsApp = existing.consultationMethod.startsWith("whatsapp");
        const finalMeetingLink = meetingLink || existing.meetingLink || "";

        // Build notification content
        let notifTitle = "";
        let notifMessage = "";
        let notifType = "";

        if (isConfirmed) {
          notifType    = "consultation_confirmed";
          notifTitle   = "✅ Consultation Confirmed – Kinglike Luxury";
          notifMessage = `Your ${typeLabel} consultation on ${slotDate} at ${slotTime} has been confirmed.`;
          if (finalMeetingLink) notifMessage += ` Meeting: ${finalMeetingLink}`;
          else if (isWhatsApp) notifMessage += " Our team will contact you via WhatsApp.";
        } else if (isRejected) {
          notifType    = "consultation_rejected";
          notifTitle   = "❌ Consultation Not Available – Kinglike Luxury";
          notifMessage = `Unfortunately your ${typeLabel} consultation on ${slotDate} could not be scheduled. Please book a new slot.`;
        } else if (isCancelled) {
          notifType    = "consultation_cancelled";
          notifTitle   = "Consultation Cancelled – Kinglike Luxury";
          notifMessage = `Your ${typeLabel} consultation on ${slotDate} has been cancelled.`;
        } else if (isCompleted) {
          notifType    = "consultation_completed";
          notifTitle   = "Consultation Completed – Kinglike Luxury";
          notifMessage = `Your ${typeLabel} consultation has been marked as completed. Thank you for choosing Kinglike Luxury!`;
        }

        // 1. Email (primary confirmation channel)
        if (existing.email) {
          console.log(`[Consultation] Sending email to ${existing.email} for booking #${id} status=${status}`);
          if (isConfirmed) {
            // Get whatsapp number for booking owner
            const bookingUser = existing.userId ? await storage.getUser(existing.userId) : null;
            delivery.email = await sendEmail({
              to: existing.email,
              subject: "✅ Consultation Confirmed – Kinglike Luxury",
              html: buildConsultationConfirmEmail({
                type: existing.consultationType,
                method: existing.consultationMethod,
                date: slotDate,
                time: slotTime,
                meetingLink: finalMeetingLink || undefined,
                country: existing.country,
                clientName: bookingUser?.username,
                whatsappNumber: isWhatsApp ? (existing.whatsappContactNumber || existing.userPhone || undefined) : undefined,
              }),
            });
          } else {
            delivery.email = await sendEmail({
              to: existing.email,
              subject: `Consultation Update – Kinglike Luxury`,
              html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px">
                <div style="background:linear-gradient(135deg,#3bcac4,#005476);padding:16px;border-radius:6px;margin-bottom:20px;text-align:center">
                  <h1 style="color:#fff;margin:0;font-size:18px">Kinglike Luxury</h1>
                </div>
                <h2 style="color:#005476">${notifTitle}</h2>
                <p style="color:#374151">${notifMessage}</p>
                <p style="color:#aaa;font-size:12px">Kinglike Luxury Real Estate</p>
              </div>`,
            });
          }
        } else {
          delivery.email = { sent: false, error: "No email on booking record" };
        }

        // 2. In-app notification
        if (existing.userId) {
          try {
            const notif = await storage.createUserNotification({
              userId: existing.userId,
              type: notifType,
              title: notifTitle,
              message: notifMessage,
              data: {
                bookingId: id,
                slotDate,
                slotTime,
                meetingLink: finalMeetingLink || null,
                consultationType: existing.consultationType,
                consultationMethod: existing.consultationMethod,
              },
              isRead: false,
            });
            delivery.inApp = { sent: true, id: notif.id };
            console.log(`[Notification] ✓ In-app created id=${notif.id} for userId=${existing.userId}`);
          } catch (err: any) {
            console.error(`[Notification] In-app failed: ${err.message}`);
            delivery.inApp = { sent: false, error: err.message };
          }
        } else {
          delivery.inApp = { sent: false, error: "No userId on booking" };
        }

        // 3. Web Push notification
        if (existing.userId) {
          try {
            const subscriptions = await storage.getPushSubscriptionsByUserId(existing.userId);
            if (subscriptions.length === 0) {
              delivery.push = { sent: false, error: "No push subscription on file" };
            } else {
              const pushResults: any[] = [];
              for (const sub of subscriptions) {
                const result = await sendPushNotification(
                  { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
                  {
                    title: notifTitle,
                    body: notifMessage,
                    data: {
                      bookingId: id,
                      slotDate,
                      slotTime,
                      meetingLink: finalMeetingLink || null,
                      consultationType: existing.consultationType,
                    },
                  }
                );
                // If subscription expired, clean it up
                if (!result.sent && result.error === "subscription_expired") {
                  await storage.deletePushSubscriptionByEndpoint(sub.endpoint);
                }
                pushResults.push(result);
              }
              const sent = pushResults.filter(r => r.sent).length;
              delivery.push = { sent: sent > 0, count: pushResults.length, successCount: sent };
            }
          } catch (err: any) {
            console.error(`[Push] Error: ${err.message}`);
            delivery.push = { sent: false, error: err.message };
          }
        } else {
          delivery.push = { sent: false, error: "No userId on booking" };
        }

        console.log(`[Booking #${id}] status=${status} | Email: ${delivery.email?.sent ? "✓" : "✗"} | InApp: ${delivery.inApp?.sent ? "✓" : "✗"} | Push: ${delivery.push?.sent ? "✓" : "✗"}`);
      }

      res.json({ booking: updated, delivery });
    } catch (err: any) {
      console.error("[Consultation] PATCH error:", err);
      res.status(500).json({ message: err.message || "Server error" });
    }
  });

  // ── Notification API routes ─────────────────────────────────────────────────

  // GET user's notifications
  app.get("/api/notifications", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const notifs = await storage.getUserNotifications(req.session.userId);
      res.json(notifs);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // PATCH mark single notification as read
  app.patch("/api/notifications/:id/read", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      await storage.markNotificationRead(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // PATCH mark all as read
  app.patch("/api/notifications/read-all", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      await storage.markAllNotificationsRead(req.session.userId);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // ── Push Subscription API ───────────────────────────────────────────────────

  // Return VAPID public key to client (needed to create subscription)
  app.get("/api/push/vapid-key", (_req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return res.status(503).json({ error: "Push notifications not configured" });
    res.json({ publicKey: key });
  });

  // Save push subscription
  app.post("/api/push/subscribe", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const { endpoint, p256dh, auth, userAgent } = req.body;
      if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({ message: "endpoint, p256dh, auth required" });
      }
      const sub = await storage.savePushSubscription({
        userId: req.session.userId,
        endpoint,
        p256dh,
        auth,
        userAgent: userAgent || null,
      });
      res.json({ success: true, id: sub.id });
    } catch (err: any) {
      console.error("[Push] Subscribe error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // Remove push subscription
  app.delete("/api/push/unsubscribe", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Not authenticated" });
    try {
      const { endpoint } = req.body;
      if (endpoint) await storage.deletePushSubscriptionByEndpoint(endpoint);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: Test Notifications ───────────────────────────────────────────────

  app.post("/api/admin/test-notifications", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    const { email, userId, channels } = req.body;
    const results: Record<string, any> = {};

    if (!channels || channels.includes("email")) {
      if (email) {
        results.email = await sendEmail({
          to: email,
          subject: "Test Notification – Kinglike Luxury",
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px">
            <h2 style="color:#005476">🔔 Test Notification</h2>
            <p>This is a test email from the Kinglike Luxury admin panel.</p>
            <p style="color:#3bcac4;font-weight:bold">Email delivery is working correctly ✓</p>
            <p style="color:#aaa;font-size:12px">Kinglike Luxury Real Estate</p>
          </div>`,
        });
      } else {
        results.email = { sent: false, error: "No email provided" };
      }
    }

    if (!channels || channels.includes("inApp")) {
      if (userId) {
        try {
          const notif = await storage.createUserNotification({
            userId: parseInt(userId),
            type: "test",
            title: "🔔 Test In-App Notification – Kinglike Luxury",
            message: "This is a test in-app notification from the admin panel. In-app delivery is working correctly!",
            data: { test: true },
            isRead: false,
          });
          results.inApp = { sent: true, id: notif.id };
        } catch (err: any) {
          results.inApp = { sent: false, error: err.message };
        }
      } else {
        results.inApp = { sent: false, error: "No userId provided" };
      }
    }

    res.json(results);
  });

  // ── AI Investment Advisor ────────────────────────────────────────────────────
  // Security: OPENAI_API_KEY is ONLY read server-side in aiAdvisor.ts.
  // It is NEVER passed to the frontend or included in any HTTP response.
  // All AI communication flows: Frontend → /api/ai/* → aiAdvisor.ts → OpenAI API
  const { chatWithAdvisor, streamChatWithAdvisor, extractProfileData, isAiAvailable, computeLeadScore, buildScoreReason, extractLeadFromConversation } = await import("./aiAdvisor");

  const MAX_MSGS_PER_CONVERSATION = 20; // max AI exchanges per session
  const PRE_LIMIT_THRESHOLD = 14;       // ~70% — trigger natural consultation transition
  const MAX_MSGS_PER_DAY = 50;         // max AI messages per user per day
  const MAX_CONVS_PER_DAY = 5;
  const MAX_MSGS_PER_MINUTE = 6;       // per-user sliding window rate limit
  // History compression: send summary + last N messages when conversation is long
  const HISTORY_COMPRESS_THRESHOLD = 10; // compress after this many messages
  const HISTORY_RECENT_KEEP = 5;         // keep this many recent messages after compression

  // Per-user sliding-window rate limiter (in-memory)
  const aiMinuteWindows = new Map<number, number[]>();
  function isRateLimited(userId: number): boolean {
    const now = Date.now();
    const timestamps = (aiMinuteWindows.get(userId) || []).filter(t => now - t < 60_000);
    aiMinuteWindows.set(userId, timestamps);
    if (timestamps.length >= MAX_MSGS_PER_MINUTE) return true;
    timestamps.push(now);
    return false;
  }

  // Daily message counter (in-memory, resets at midnight)
  const aiDailyMsgs = new Map<number, { count: number; date: string }>();
  function isDailyLimitReached(userId: number): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const entry = aiDailyMsgs.get(userId);
    if (!entry || entry.date !== today) {
      aiDailyMsgs.set(userId, { count: 1, date: today });
      return false;
    }
    if (entry.count >= MAX_MSGS_PER_DAY) return true;
    entry.count++;
    return false;
  }

  // Build compressed history to save tokens on long conversations
  function buildHistory(
    msgs: { role: string; content: string }[],
    newMessage: string,
    profile: any,
  ): { role: "user" | "assistant"; content: string }[] {
    const all = [...msgs, { role: "user", content: newMessage }];
    if (all.length <= HISTORY_COMPRESS_THRESHOLD) {
      return all.map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    }
    // Build a structured summary of what we know so far
    const p = profile || {};
    const facts = [
      p.goal && `Goal: ${p.goal}`,
      p.budget && `Budget: ${p.budget}`,
      p.paymentPreference && `Payment: ${p.paymentPreference}`,
      p.country && `Country: ${p.country}`,
      p.city && `City: ${p.city}`,
      p.timeline && `Timeline: ${p.timeline}`,
      p.communicationMethod && `Communication: ${p.communicationMethod}`,
      p.leadScore && `Lead temperature: ${p.leadScore}`,
    ].filter(Boolean).join(", ");

    const summary = `[CONVERSATION SUMMARY — do not re-ask confirmed facts]: ${facts || "Still collecting info."}`;
    const recent = all.slice(-HISTORY_RECENT_KEEP);
    return [
      { role: "user" as const, content: summary },
      { role: "assistant" as const, content: "Understood. Continuing naturally based on what we know." },
      ...recent.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];
  }

  // Complexity detector — uses gpt-4o for complex/hot cases, gpt-4o-mini for simple
  function isComplexMessage(lastMessage: string, score: string): boolean {
    if (score === "hot") return true;
    const complexPatterns = [
      /compar|versus|\bvs\b|analysis|report|legal|citizenship|tax|risk|pros.+cons|which.+better|recommend/i,
      /مقارن|تحليل|قانون|جنسي|ضريب|مخاطر|أيهم|توصي|تقرير|دراس|تفصيل|أفضل.*مشروع/i,
    ];
    return complexPatterns.some(re => re.test(lastMessage));
  }

  const AI_UNAVAILABLE_MSG = "AI advisor is temporarily unavailable. Please try again later.";

  // POST /api/ai/start — begin a new conversation
  app.post("/api/ai/start", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.session.userId;

    if (!isAiAvailable()) {
      console.warn(`[AI] /api/ai/start — key missing, userId=${userId}`);
      return res.json({ conversationId: null, greeting: AI_UNAVAILABLE_MSG });
    }

    try {
      // Rate limit: max 5 conversations per day
      const todayCount = await storage.countTodayConversations(userId);
      if (todayCount >= MAX_CONVS_PER_DAY) {
        return res.status(429).json({ message: "Daily conversation limit reached. Please try again tomorrow." });
      }

      const lang = req.body.language || "en";
      const conv = await storage.createAiConversation(userId, lang);

      const user = await storage.getUser(userId);
      const userPhone = user?.phoneNumber || user?.whatsappNumber || undefined;

      // Check for previous investor profile (memory feature)
      const previousProfile = await storage.getLatestInvestorProfileByUser(userId);
      let triggerMessage: string;

      if (previousProfile && (previousProfile.goal || previousProfile.budget || previousProfile.country)) {
        const mem = {
          goal: previousProfile.goal,
          budget: previousProfile.budget,
          country: previousProfile.country,
          city: previousProfile.city,
          timeline: previousProfile.timeline,
        };
        triggerMessage = `[PREVIOUS PROFILE: ${JSON.stringify(mem)}] The user is returning. Greet them warmly by name referencing their previous interest. Ask if their goal has changed or if they want to continue from where they left off.`;
        console.log(`[AI] /api/ai/start — returning user userId=${userId} with previous profile`);
      } else {
        triggerMessage = "[NEW USER] Start with a warm premium greeting introducing yourself as the Kinglike Luxury AI Investment Advisor, then ask about their main purchase goal.";
        console.log(`[AI] /api/ai/start — new user userId=${userId}`);
      }

      // Generate AI greeting (personalised for new or returning users)
      const aiResp = await chatWithAdvisor(
        [{ role: "user", content: triggerMessage }],
        lang,
        userPhone,
        userId
      );

      const greeting = aiResp.message;
      await storage.addAiMessage(conv.id, "assistant", greeting);
      await storage.incrementConversationMessages(conv.id);

      res.json({ conversationId: conv.id, greeting });
    } catch (err: any) {
      console.error(`[AI] start error — userId=${req.session.userId} message=${err.message}`);
      res.status(500).json({ message: "Failed to start conversation" });
    }
  });

  // POST /api/ai/chat — streaming SSE response
  app.post("/api/ai/chat", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    const userId = req.session.userId;

    // Set SSE headers EARLY so ALL responses (including limit exits) use the stream path
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const { conversationId, message, language } = req.body;

    if (!isAiAvailable()) {
      send({ done: true, message: AI_UNAVAILABLE_MSG });
      res.end(); return;
    }
    if (isRateLimited(userId)) {
      send({ error: true, message: "Too many messages. Please wait a moment." });
      res.end(); return;
    }
    if (!conversationId || !message?.trim()) {
      send({ error: true, message: "Missing fields" });
      res.end(); return;
    }

    // Daily cap — show consultation CTA instead of hard stopping
    if (isDailyLimitReached(userId)) {
      const limitMsg = language === "ar"
        ? "لإعداد توصية أدق تتناسب مع أهدافك، يسعدنا تخصيص استشارة شخصية معك. فريقنا سيكون معك خطوة بخطوة."
        : "To prepare a more accurate recommendation based on your goals, please complete the consultation form and our advisory team will follow up with you personally.";
      send({ done: true, message: limitMsg, limitReached: true, showConsultationCta: true });
      res.end(); return;
    }

    const msgs = await storage.getAiMessages(conversationId);
    if (msgs.length >= MAX_MSGS_PER_CONVERSATION) {
      const limitMsg = language === "ar"
        ? "لإعداد توصية أدق تتناسب مع أهدافك، يسعدنا تخصيص استشارة شخصية معك. فريقنا سيكون معك خطوة بخطوة."
        : "To prepare a more accurate recommendation based on your goals, please complete the consultation form and our advisory team will follow up with you personally.";
      send({ done: true, message: limitMsg, limitReached: true, showConsultationCta: true });
      res.end(); return;
    }

    const nearLimit = msgs.length >= PRE_LIMIT_THRESHOLD;

    // Save user message first
    await storage.addAiMessage(conversationId, "user", message.trim());
    await storage.incrementConversationMessages(conversationId);

    const [user, existingProfile] = await Promise.all([
      storage.getUser(userId),
      storage.getInvestorProfileByConversation(conversationId),
    ]);
    const userPhone = user?.phoneNumber || user?.whatsappNumber || undefined;
    const currentScore = (existingProfile?.leadScore as "hot" | "warm" | "cold") || "cold";

    // Smart model routing: use gpt-4o for complex questions or hot leads
    const useComplexModel = isComplexMessage(message.trim(), currentScore);

    // Compressed history: send summary + recent messages for long conversations
    const history = buildHistory(msgs, message.trim(), existingProfile);

    try {
      const aiResp = await streamChatWithAdvisor(
        history,
        language || "en",
        userPhone,
        userId,
        currentScore,
        (delta: string) => send({ t: delta }),
        useComplexModel,
        nearLimit,
      );

      // Save full clean response to DB
      await storage.addAiMessage(conversationId, "assistant", aiResp.message);
      await storage.incrementConversationMessages(conversationId);

      // Server-side lead extraction — runs on every turn, reads full conversation history
      let finalScore: "hot" | "warm" | "cold" = currentScore;
      try {
        const fullHistory: { role: "user" | "assistant"; content: string }[] = [
          ...msgs,
          { role: "user", content: message.trim() },
          { role: "assistant", content: aiResp.message },
        ];
        const extracted = await extractLeadFromConversation(fullHistory);
        const hasAnyData = Object.values(extracted).some((v) => v !== null);

        if (hasAnyData) {
          // Merge: existing → extracted non-null → AI-emitted non-null (highest priority)
          const nonNullExtracted = Object.fromEntries(
            Object.entries(extracted).filter(([, v]) => v !== null)
          );
          const nonNullAi = Object.fromEntries(
            Object.entries(aiResp.profileData || {}).filter(([, v]) => v !== null && v !== undefined)
          );
          const merged = { ...(existingProfile || {}), ...nonNullExtracted, ...nonNullAi };
          finalScore = computeLeadScore({ ...merged, accountPhone: userPhone });
          const scoreReason = buildScoreReason(merged, finalScore);

          await storage.upsertInvestorProfile({
            conversationId,
            userId,
            accountPhone: userPhone,
            ...merged,
            leadScore: finalScore,
            scoreReason,
            language: language || "en",
            lastUserMessage: message.trim(),
            lastUserMessageAt: new Date(),
          });
          console.log(`[AI] lead saved — conv=${conversationId} score=${finalScore} fields=${Object.keys(nonNullExtracted).join(",")}`);

          // Fire hot lead notification (first time reaching HOT only)
          const hasWhatsApp = !!(merged.whatsappContactNumber || userPhone);
          const wasAlreadyHot = existingProfile?.leadScore === "hot";
          if (finalScore === "hot" && hasWhatsApp && !wasAlreadyHot) {
            console.log(`[AI] 🔥 Hot lead — userId=${userId}`);
            try {
              await storage.createUserNotification({
                userId: 1, type: "consultation_pending",
                title: "🔥 Hot AI Lead Ready",
                message: `Hot lead from ${merged.whatsappContactNumber || userPhone || "unknown"} — Goal: ${merged.goal || "?"}, Budget: ${merged.budget || "?"}, Country: ${merged.country || "?"}`,
                data: { leadType: "ai_hot", conversationId, userId }, isRead: false,
              });
            } catch (_) {}
            const resendKey = process.env.RESEND_API_KEY;
            if (resendKey) {
              try {
                const { Resend } = await import("resend");
                const resend = new Resend(resendKey);
                await resend.emails.send({
                  from: "noreply@kinglikeluxury.com",
                  to: "admin@kinglikeluxury.com",
                  subject: "🔥 Hot AI Lead Ready — Kinglike Luxury",
                  html: `<h2 style="color:#005476">🔥 Hot AI Lead</h2>
                    <p>Goal: ${merged.goal || "N/A"} | Budget: ${merged.budget || "N/A"} | Country: ${merged.country || "N/A"}${merged.city ? ` — ${merged.city}` : ""}</p>
                    <p>WhatsApp: ${merged.whatsappContactNumber || userPhone || "N/A"}</p>
                    <p>Timeline: ${merged.timeline || "N/A"} | Score reason: ${scoreReason}</p>
                    <p style="color:#3bcac4;font-weight:bold">→ Call immediately on WhatsApp</p>`,
                });
              } catch (_) {}
            }
          }
        }
      } catch (extractErr: any) {
        console.warn(`[AI] lead extraction failed — ${extractErr.message}`);
      }

      // Final SSE event — includes clean message, lead score, and pre-limit CTA flag
      const mergedProfile = { ...(existingProfile || {}), ...(aiResp.profileData || {}) };
      send({
        done: true,
        message: aiResp.message,
        leadScore: finalScore,
        showConsultationCta: nearLimit,
        ...(nearLimit ? { profileData: mergedProfile } : {}),
      });
      res.end();

    } catch (err: any) {
      const code = err?.status ?? err?.code ?? "unknown";
      console.error(`[AI] stream error — userId=${userId} code=${code} msg=${err.message}`);
      send({ error: true, message: AI_UNAVAILABLE_MSG });
      res.end();
    }
  });

  // GET /api/admin/ai-leads — admin view all investor profiles
  app.get("/api/admin/ai-leads", isAuthenticated, isAdmin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const profiles = await storage.getAllInvestorProfiles();
      res.json(profiles);
    } catch (err: any) {
      console.error("[AI] admin leads error:", err.message);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  // ── Admin Users ─────────────────────────────────────────────────────────
  app.get("/api/admin/users", isAuthenticated, async (req, res) => {
    try {
      if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
      const allUsers = await storage.getAllUsers();
      res.json(allUsers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/users/:id", isAuthenticated, async (req, res) => {
    try {
      if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
      const id = Number(req.params.id);
      const { isAdmin } = req.body;
      const updated = await storage.updateUser(id, { isAdmin });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/users/:id", isAuthenticated, async (req, res) => {
    try {
      if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
      const id = Number(req.params.id);
      if (id === req.session.userId) return res.status(400).json({ message: "Cannot delete yourself" });
      await storage.deleteUser(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Admin: Projects list for camera assignment ──────────────────────────
  app.get("/api/admin/projects-for-cameras", isAuthenticated, isAdmin, async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const projectProperties = await storage.getProperties({ type: PROPERTY_TYPES.PROJECT });
      const simplified = projectProperties.map(p => ({
        id: p.id,
        title: p.title,
        location: p.location,
        status: p.status,
        liveCountry: p.liveCountry,
        liveCity: p.liveCity,
      }));
      res.json(simplified);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Live Projects (public) — returns active cameras from project_live_cameras ─
  app.get("/api/live-projects", async (_req, res) => {
    try {
      const cameras = await storage.getLiveCameras({ isActive: true });
      res.json(cameras);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/live-projects/:propertyId/cameras", async (req, res) => {
    try {
      const cameras = await storage.getLiveCamerasForProperty(Number(req.params.propertyId));
      res.json(cameras.filter(c => c.isActive));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Live Cameras Admin ──────────────────────────────────────────────────
  app.get("/api/admin/live-cameras", isAuthenticated, isAdmin, async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const cameras = await storage.getLiveCameras();
      res.json(cameras);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/live-cameras", isAuthenticated, isAdmin, async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const { propertyId, label, embedUrl, thumbnailUrl, country, city, isActive, status } = req.body;
      if (!propertyId || !embedUrl || !city) return res.status(400).json({ message: "propertyId, embedUrl, city required" });
      const cam = await storage.createLiveCamera({ propertyId: Number(propertyId), label: label || "Main Camera", embedUrl, thumbnailUrl: thumbnailUrl || null, country: country || "georgia", city, isActive: isActive !== false, status: status || "active" });
      res.status(201).json(cam);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/live-cameras/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const cam = await storage.updateLiveCamera(Number(req.params.id), req.body);
      if (!cam) return res.status(404).json({ message: "Camera not found" });
      res.json(cam);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/live-cameras/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const ok = await storage.deleteLiveCamera(Number(req.params.id));
      if (!ok) return res.status(404).json({ message: "Camera not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  registerAiIntelligenceRoutes(app);
  registerMetaLeadsRoutes(app);

  // ── Kinglike CRM Admin Endpoints ──────────────────────────────────────────

  // CRM access helpers
  const isCrmUser = (req: any) => req.session.isAdmin || req.session.role === "sub_agent";
  const canAccessLead = async (req: any, leadId: number): Promise<boolean> => {
    if (req.session.isAdmin) return true;
    const lead = await storage.getCrmLead(leadId);
    return lead?.assignedTo === req.session.userId;
  };

  /** GET /api/admin/crm/stats — scoped lead counts (admin: global, sub_agent: own) */
  app.get("/api/admin/crm/stats", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const isAgent = !req.session.isAdmin && req.session.role === "sub_agent";
      const uid = req.session.userId as number;
      const scope = isAgent ? eq(crmLeads.assignedTo, uid) : undefined;

      async function cnt(extra?: any): Promise<number> {
        const [row] = await db
          .select({ n: sqlCount() })
          .from(crmLeads)
          .where(scope && extra ? and(scope, extra) : scope ?? extra);
        return Number(row?.n ?? 0);
      }

      const [total, newLeads, hotLeads, qualified, converted, aiHot, aiWarm, aiCold] = await Promise.all([
        cnt(),
        cnt(eq(crmLeads.status, "new")),
        cnt(eq(crmLeads.leadScore, "hot")),
        cnt(eq(crmLeads.status, "qualified")),
        cnt(eq(crmLeads.status, "converted")),
        cnt(drizzleSql`ai_score_category = 'HOT'`),
        cnt(drizzleSql`ai_score_category = 'WARM'`),
        cnt(drizzleSql`ai_score_category = 'COLD'`),
      ]);

      res.json({ total, new: newLeads, hot: hotLeads, qualified, converted, aiHot, aiWarm, aiCold });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** GET /api/admin/crm/health — full CRM health dashboard data (admin only) */
  app.get("/api/admin/crm/health", isAuthenticated, async (req: any, res) => {
    if (!req.session?.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const { pool: pgPool } = await import("./db");
      const c = await pgPool.connect();
      try {
        const [statusRow, agentRows, metaRow, waRow, emailRow] = await Promise.all([
          c.query(`
            SELECT
              COUNT(*)                                                                          AS total,
              COUNT(*) FILTER(WHERE status IN ('new','new_fresh_after_3_no_answer'))           AS new_leads,
              COUNT(*) FILTER(WHERE created_at >= CURRENT_DATE)                                AS new_today,
              COUNT(*) FILTER(WHERE status = 'no_answer_1')                                    AS no_answer_1,
              COUNT(*) FILTER(WHERE status = 'no_answer_2')                                    AS no_answer_2,
              COUNT(*) FILTER(WHERE status = 'no_answer_3')                                    AS no_answer_3,
              COUNT(*) FILTER(WHERE status = 'no_answer_4')                                    AS no_answer_4,
              COUNT(*) FILTER(WHERE status = 'follow_up')                                      AS follow_up,
              COUNT(*) FILTER(WHERE status = 'interested')                                     AS interested,
              COUNT(*) FILTER(WHERE status = 'qualified')                                      AS qualified,
              COUNT(*) FILTER(WHERE qualification_score IN ('HOT','VIP') OR lead_score = 'hot') AS hot_buyers,
              COUNT(*) FILTER(WHERE qualification_score = 'VIP')                               AS vip_buyers,
              COUNT(*) FILTER(WHERE status IN ('converted','sold_by_kinglike_luxury'))                                  AS sold,
              COUNT(*) FILTER(WHERE status IN ('lost_competition','not_interested','junk_lead','not_qualified'))       AS lost,
              COUNT(*) FILTER(WHERE status = 're_sale')                                                               AS re_sale
            FROM crm_leads
          `),
          c.query(`
            SELECT
              COALESCE(u.username, 'Unassigned') AS agent,
              COUNT(l.id)::int                   AS cnt
            FROM crm_leads l
            LEFT JOIN users u ON u.id = l.assigned_to
            GROUP BY u.username
            ORDER BY cnt DESC
          `),
          c.query(`
            SELECT COUNT(*)::int AS cnt
            FROM crm_leads
            WHERE (lead_source ILIKE '%meta%' OR lead_source ILIKE '%facebook%' OR lead_source = 'meta_ad')
              AND created_at >= CURRENT_DATE
          `),
          c.query(`
            SELECT COUNT(*)::int AS cnt
            FROM whatsapp_api_conversations
            WHERE last_message_at >= CURRENT_DATE
          `),
          c.query(`
            SELECT COUNT(*)::int AS cnt
            FROM lead_email_events
            WHERE event_type IN ('email_sent','email_skipped_disabled')
              AND created_at >= CURRENT_DATE
          `),
        ]);

        const s = statusRow.rows[0];
        res.json({
          totals: {
            total:       Number(s.total),
            new:         Number(s.new_leads),
            newToday:    Number(s.new_today),
            noAnswer1:   Number(s.no_answer_1),
            noAnswer2:   Number(s.no_answer_2),
            noAnswer3:   Number(s.no_answer_3),
            noAnswer4:   Number(s.no_answer_4),
            followUp:    Number(s.follow_up),
            interested:  Number(s.interested),
            qualified:   Number(s.qualified),
            hotBuyers:   Number(s.hot_buyers),
            vipBuyers:   Number(s.vip_buyers),
            sold:        Number(s.sold),
            lost:        Number(s.lost),
            reSale:      Number(s.re_sale),
          },
          agentsBreakdown: agentRows.rows,
          activityToday: {
            metaLeads:    metaRow.rows[0].cnt,
            whatsappConvs: waRow.rows[0].cnt,
            emailSends:   emailRow.rows[0].cnt,
          },
          generatedAt: new Date().toISOString(),
        });
      } finally { c.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** GET /api/admin/crm/country-insights — phone-code country analytics (admin only) */
  app.get("/api/admin/crm/country-insights", isAuthenticated, async (req: any, res) => {
    if (!req.session?.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const { pool: pgPool } = await import("./db");
      const c = await pgPool.connect();
      try {
        const rows = await c.query(`
          SELECT phone, lead_score, qualification_score, status
          FROM crm_leads
          WHERE phone IS NOT NULL AND phone != ''
        `);

        // ── Phone-prefix → country map (longest-prefix first) ──────────────────
        type CountryDef = { prefix: string; name: string; flag: string; code: string };
        const PREFIXES: CountryDef[] = [
          // 3-digit prefixes
          { prefix: "972", name: "Israel",           flag: "🇮🇱", code: "+972" },
          { prefix: "966", name: "Saudi Arabia",     flag: "🇸🇦", code: "+966" },
          { prefix: "971", name: "UAE",              flag: "🇦🇪", code: "+971" },
          { prefix: "965", name: "Kuwait",           flag: "🇰🇼", code: "+965" },
          { prefix: "974", name: "Qatar",            flag: "🇶🇦", code: "+974" },
          { prefix: "973", name: "Bahrain",          flag: "🇧🇭", code: "+973" },
          { prefix: "968", name: "Oman",             flag: "🇴🇲", code: "+968" },
          { prefix: "970", name: "Palestine",        flag: "🇵🇸", code: "+970" },
          { prefix: "963", name: "Syria",            flag: "🇸🇾", code: "+963" },
          { prefix: "961", name: "Lebanon",          flag: "🇱🇧", code: "+961" },
          { prefix: "962", name: "Jordan",           flag: "🇯🇴", code: "+962" },
          { prefix: "964", name: "Iraq",             flag: "🇮🇶", code: "+964" },
          { prefix: "967", name: "Yemen",            flag: "🇾🇪", code: "+967" },
          { prefix: "995", name: "Georgia",          flag: "🇬🇪", code: "+995" },
          { prefix: "994", name: "Azerbaijan",       flag: "🇦🇿", code: "+994" },
          { prefix: "993", name: "Turkmenistan",     flag: "🇹🇲", code: "+993" },
          { prefix: "992", name: "Tajikistan",       flag: "🇹🇯", code: "+992" },
          { prefix: "998", name: "Uzbekistan",       flag: "🇺🇿", code: "+998" },
          { prefix: "996", name: "Kyrgyzstan",       flag: "🇰🇬", code: "+996" },
          { prefix: "380", name: "Ukraine",          flag: "🇺🇦", code: "+380" },
          { prefix: "375", name: "Belarus",          flag: "🇧🇾", code: "+375" },
          { prefix: "374", name: "Armenia",          flag: "🇦🇲", code: "+374" },
          { prefix: "373", name: "Moldova",          flag: "🇲🇩", code: "+373" },
          { prefix: "370", name: "Lithuania",        flag: "🇱🇹", code: "+370" },
          { prefix: "371", name: "Latvia",           flag: "🇱🇻", code: "+371" },
          { prefix: "372", name: "Estonia",          flag: "🇪🇪", code: "+372" },
          { prefix: "358", name: "Finland",          flag: "🇫🇮", code: "+358" },
          { prefix: "420", name: "Czech Republic",   flag: "🇨🇿", code: "+420" },
          { prefix: "421", name: "Slovakia",         flag: "🇸🇰", code: "+421" },
          { prefix: "359", name: "Bulgaria",         flag: "🇧🇬", code: "+359" },
          { prefix: "351", name: "Portugal",         flag: "🇵🇹", code: "+351" },
          { prefix: "212", name: "Morocco",          flag: "🇲🇦", code: "+212" },
          { prefix: "213", name: "Algeria",          flag: "🇩🇿", code: "+213" },
          { prefix: "216", name: "Tunisia",          flag: "🇹🇳", code: "+216" },
          { prefix: "218", name: "Libya",            flag: "🇱🇾", code: "+218" },
          { prefix: "249", name: "Sudan",            flag: "🇸🇩", code: "+249" },
          { prefix: "234", name: "Nigeria",          flag: "🇳🇬", code: "+234" },
          { prefix: "254", name: "Kenya",            flag: "🇰🇪", code: "+254" },
          { prefix: "880", name: "Bangladesh",       flag: "🇧🇩", code: "+880" },
          { prefix: "852", name: "Hong Kong",        flag: "🇭🇰", code: "+852" },
          { prefix: "855", name: "Cambodia",         flag: "🇰🇭", code: "+855" },
          { prefix: "856", name: "Laos",             flag: "🇱🇦", code: "+856" },
          { prefix: "853", name: "Macau",            flag: "🇲🇴", code: "+853" },
          { prefix: "886", name: "Taiwan",           flag: "🇹🇼", code: "+886" },
          { prefix: "960", name: "Maldives",         flag: "🇲🇻", code: "+960" },
          // 2-digit prefixes
          { prefix: "90", name: "Turkey",            flag: "🇹🇷", code: "+90" },
          { prefix: "44", name: "UK",                flag: "🇬🇧", code: "+44" },
          { prefix: "46", name: "Sweden",            flag: "🇸🇪", code: "+46" },
          { prefix: "33", name: "France",            flag: "🇫🇷", code: "+33" },
          { prefix: "49", name: "Germany",           flag: "🇩🇪", code: "+49" },
          { prefix: "48", name: "Poland",            flag: "🇵🇱", code: "+48" },
          { prefix: "86", name: "China",             flag: "🇨🇳", code: "+86" },
          { prefix: "81", name: "Japan",             flag: "🇯🇵", code: "+81" },
          { prefix: "82", name: "South Korea",       flag: "🇰🇷", code: "+82" },
          { prefix: "91", name: "India",             flag: "🇮🇳", code: "+91" },
          { prefix: "92", name: "Pakistan",          flag: "🇵🇰", code: "+92" },
          { prefix: "93", name: "Afghanistan",       flag: "🇦🇫", code: "+93" },
          { prefix: "98", name: "Iran",              flag: "🇮🇷", code: "+98" },
          { prefix: "20", name: "Egypt",             flag: "🇪🇬", code: "+20" },
          { prefix: "34", name: "Spain",             flag: "🇪🇸", code: "+34" },
          { prefix: "39", name: "Italy",             flag: "🇮🇹", code: "+39" },
          { prefix: "31", name: "Netherlands",       flag: "🇳🇱", code: "+31" },
          { prefix: "32", name: "Belgium",           flag: "🇧🇪", code: "+32" },
          { prefix: "41", name: "Switzerland",       flag: "🇨🇭", code: "+41" },
          { prefix: "43", name: "Austria",           flag: "🇦🇹", code: "+43" },
          { prefix: "45", name: "Denmark",           flag: "🇩🇰", code: "+45" },
          { prefix: "47", name: "Norway",            flag: "🇳🇴", code: "+47" },
          { prefix: "36", name: "Hungary",           flag: "🇭🇺", code: "+36" },
          { prefix: "40", name: "Romania",           flag: "🇷🇴", code: "+40" },
          { prefix: "30", name: "Greece",            flag: "🇬🇷", code: "+30" },
          { prefix: "55", name: "Brazil",            flag: "🇧🇷", code: "+55" },
          { prefix: "52", name: "Mexico",            flag: "🇲🇽", code: "+52" },
          { prefix: "54", name: "Argentina",         flag: "🇦🇷", code: "+54" },
          { prefix: "57", name: "Colombia",          flag: "🇨🇴", code: "+57" },
          { prefix: "56", name: "Chile",             flag: "🇨🇱", code: "+56" },
          { prefix: "51", name: "Peru",              flag: "🇵🇪", code: "+51" },
          { prefix: "27", name: "South Africa",      flag: "🇿🇦", code: "+27" },
          { prefix: "60", name: "Malaysia",          flag: "🇲🇾", code: "+60" },
          { prefix: "62", name: "Indonesia",         flag: "🇮🇩", code: "+62" },
          { prefix: "65", name: "Singapore",         flag: "🇸🇬", code: "+65" },
          { prefix: "66", name: "Thailand",          flag: "🇹🇭", code: "+66" },
          { prefix: "84", name: "Vietnam",           flag: "🇻🇳", code: "+84" },
          { prefix: "63", name: "Philippines",       flag: "🇵🇭", code: "+63" },
          { prefix: "61", name: "Australia",         flag: "🇦🇺", code: "+61" },
          { prefix: "64", name: "New Zealand",       flag: "🇳🇿", code: "+64" },
          // 1-digit prefixes (last resort)
          { prefix: "1", name: "USA/Canada",         flag: "🇺🇸", code: "+1"  },
          { prefix: "7", name: "Russia/Kazakhstan",  flag: "🇷🇺", code: "+7"  },
        ].sort((a, b) => b.prefix.length - a.prefix.length);

        function detectCountry(raw: string): CountryDef | null {
          if (!raw) return null;
          const trimmed = raw.trim();
          // Normalise to digit string
          let digits: string;
          if (trimmed.startsWith("+")) {
            digits = trimmed.slice(1).replace(/\D/g, "");
          } else if (trimmed.startsWith("00")) {
            digits = trimmed.slice(2).replace(/\D/g, "");
          } else {
            digits = trimmed.replace(/\D/g, "");
          }
          if (!digits || digits.length < 7) return null;
          for (const c of PREFIXES) {
            if (digits.startsWith(c.prefix)) return c;
          }
          return null;
        }

        // ── Aggregate ──────────────────────────────────────────────────────────
        type CountryAgg = {
          name: string; flag: string; code: string;
          total: number; qualified: number; hot: number; sold: number;
        };
        const map = new Map<string, CountryAgg>();
        let unknownTotal = 0, unknownQualified = 0, unknownHot = 0, unknownSold = 0;

        for (const row of rows.rows) {
          const isQualified = row.status === "qualified";
          const isHot = row.qualification_score === "HOT" || row.qualification_score === "VIP" || row.lead_score === "hot";
          const isSold = row.status === "converted" || row.status === "sold_by_kinglike_luxury";

          const country = detectCountry(row.phone as string);
          if (!country) {
            unknownTotal++;
            if (isQualified) unknownQualified++;
            if (isHot) unknownHot++;
            if (isSold) unknownSold++;
            continue;
          }

          let agg = map.get(country.name);
          if (!agg) {
            agg = { name: country.name, flag: country.flag, code: country.code, total: 0, qualified: 0, hot: 0, sold: 0 };
            map.set(country.name, agg);
          }
          agg.total++;
          if (isQualified) agg.qualified++;
          if (isHot) agg.hot++;
          if (isSold) agg.sold++;
        }

        // Sort by total DESC
        const countries = [...map.values()].sort((a, b) => b.total - a.total);
        const grandTotal = rows.rows.length;

        res.json({
          countries,
          unknown: { total: unknownTotal, qualified: unknownQualified, hot: unknownHot, sold: unknownSold },
          grandTotal,
          generatedAt: new Date().toISOString(),
        });
      } finally { c.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** GET /api/admin/crm/employee-dashboard — employee stats dashboard */
  app.get("/api/admin/crm/employee-dashboard", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const { pool: pgPool } = await import("./db");
      const { users: usersTable } = await import("../shared/schema");
      const { eq: eqOp } = await import("drizzle-orm");

      // Determine which agent's data to show
      let agentId: number;
      if (req.session.isAdmin && req.query.agentId) {
        agentId = Number(req.query.agentId);
      } else if (req.session.role === "sub_agent") {
        agentId = req.session.userId;
      } else if (req.session.isAdmin) {
        // Admin with no agentId: show global totals (agentId = 0 = all)
        agentId = 0;
      } else {
        return res.status(403).json({ message: "Forbidden" });
      }

      // Resolve agent name
      let agentName = "All Employees";
      if (agentId > 0) {
        const [u] = await db.select({ username: usersTable.username }).from(usersTable).where(eqOp(usersTable.id, agentId));
        agentName = u?.username ?? "Unknown";
      }

      const c = await pgPool.connect();
      try {
        const assignFilter = agentId > 0 ? `AND assigned_to = ${agentId}` : "";

        // ── Lead counts by status ─────────────────────────────────────────────
        const statusRows = await c.query(`
          SELECT status, COUNT(*)::int AS cnt
          FROM crm_leads
          WHERE 1=1 ${assignFilter}
          GROUP BY status
        `);
        const statusMap: Record<string, number> = {};
        for (const r of statusRows.rows) statusMap[r.status] = r.cnt;

        const total       = statusRows.rows.reduce((s: number, r: any) => s + r.cnt, 0);
        const newLeads    = statusMap["new"] ?? 0;
        const qualified   = statusMap["qualified"] ?? 0;
        const hotBuyer    = statusMap["hot_buyer"] ?? 0;
        const followUp    = statusMap["follow_up"] ?? 0;
        const noAnswer    = (statusMap["no_answer"] ?? 0) + (statusMap["no_answer_1"] ?? 0) +
                            (statusMap["no_answer_2"] ?? 0) + (statusMap["no_answer_3"] ?? 0) +
                            (statusMap["no_answer_4"] ?? 0);
        const deposited   = statusMap["deposited"] ?? 0;
        const reserved    = statusMap["reserved"] ?? 0;
        const purchased   = statusMap["purchased"] ?? 0;

        // Lead score "hot" from lead_score field
        const scoreRows = await c.query(`
          SELECT lead_score, COUNT(*)::int AS cnt
          FROM crm_leads WHERE 1=1 ${assignFilter}
          GROUP BY lead_score
        `);
        const scoreMap: Record<string, number> = {};
        for (const r of scoreRows.rows) scoreMap[r.lead_score ?? ""] = r.cnt;
        const hotScore = scoreMap["hot"] ?? 0;

        // ── Lead sources ───────────────────────────────────────────────────────
        const sourceRows = await c.query(`
          SELECT lead_source, COUNT(*)::int AS cnt
          FROM crm_leads WHERE 1=1 ${assignFilter}
          GROUP BY lead_source ORDER BY cnt DESC
        `);
        const sources = sourceRows.rows.map((r: any) => ({ source: r.lead_source as string, count: r.cnt as number }));

        // ── Country breakdown from phones ─────────────────────────────────────
        const phoneRows = await c.query(`
          SELECT phone FROM crm_leads
          WHERE phone IS NOT NULL AND phone != '' ${assignFilter}
        `);

        type CountryDef = { prefix: string; name: string; flag: string };
        const PFXS: CountryDef[] = [
          { prefix: "972", name: "Israel",          flag: "🇮🇱" },
          { prefix: "966", name: "Saudi Arabia",    flag: "🇸🇦" },
          { prefix: "971", name: "UAE",             flag: "🇦🇪" },
          { prefix: "965", name: "Kuwait",          flag: "🇰🇼" },
          { prefix: "974", name: "Qatar",           flag: "🇶🇦" },
          { prefix: "973", name: "Bahrain",         flag: "🇧🇭" },
          { prefix: "968", name: "Oman",            flag: "🇴🇲" },
          { prefix: "970", name: "Palestine",       flag: "🇵🇸" },
          { prefix: "963", name: "Syria",           flag: "🇸🇾" },
          { prefix: "961", name: "Lebanon",         flag: "🇱🇧" },
          { prefix: "962", name: "Jordan",          flag: "🇯🇴" },
          { prefix: "964", name: "Iraq",            flag: "🇮🇶" },
          { prefix: "967", name: "Yemen",           flag: "🇾🇪" },
          { prefix: "995", name: "Georgia",         flag: "🇬🇪" },
          { prefix: "994", name: "Azerbaijan",      flag: "🇦🇿" },
          { prefix: "998", name: "Uzbekistan",      flag: "🇺🇿" },
          { prefix: "380", name: "Ukraine",         flag: "🇺🇦" },
          { prefix: "375", name: "Belarus",         flag: "🇧🇾" },
          { prefix: "374", name: "Armenia",         flag: "🇦🇲" },
          { prefix: "212", name: "Morocco",         flag: "🇲🇦" },
          { prefix: "213", name: "Algeria",         flag: "🇩🇿" },
          { prefix: "216", name: "Tunisia",         flag: "🇹🇳" },
          { prefix: "218", name: "Libya",           flag: "🇱🇾" },
          { prefix: "249", name: "Sudan",           flag: "🇸🇩" },
          { prefix: "234", name: "Nigeria",         flag: "🇳🇬" },
          { prefix: "880", name: "Bangladesh",      flag: "🇧🇩" },
          { prefix: "886", name: "Taiwan",          flag: "🇹🇼" },
          { prefix: "90",  name: "Turkey",          flag: "🇹🇷" },
          { prefix: "44",  name: "UK",              flag: "🇬🇧" },
          { prefix: "33",  name: "France",          flag: "🇫🇷" },
          { prefix: "49",  name: "Germany",         flag: "🇩🇪" },
          { prefix: "48",  name: "Poland",          flag: "🇵🇱" },
          { prefix: "86",  name: "China",           flag: "🇨🇳" },
          { prefix: "91",  name: "India",           flag: "🇮🇳" },
          { prefix: "92",  name: "Pakistan",        flag: "🇵🇰" },
          { prefix: "20",  name: "Egypt",           flag: "🇪🇬" },
          { prefix: "34",  name: "Spain",           flag: "🇪🇸" },
          { prefix: "39",  name: "Italy",           flag: "🇮🇹" },
          { prefix: "55",  name: "Brazil",          flag: "🇧🇷" },
          { prefix: "60",  name: "Malaysia",        flag: "🇲🇾" },
          { prefix: "62",  name: "Indonesia",       flag: "🇮🇩" },
          { prefix: "65",  name: "Singapore",       flag: "🇸🇬" },
          { prefix: "66",  name: "Thailand",        flag: "🇹🇭" },
          { prefix: "61",  name: "Australia",       flag: "🇦🇺" },
          { prefix: "1",   name: "USA/Canada",      flag: "🇺🇸" },
          { prefix: "7",   name: "Russia/Kazakhstan", flag: "🇷🇺" },
        ].sort((a, b) => b.prefix.length - a.prefix.length);

        function detectPfx(raw: string): CountryDef | null {
          if (!raw) return null;
          const t = raw.trim();
          let d = t.startsWith("+") ? t.slice(1).replace(/\D/g, "") :
                  t.startsWith("00") ? t.slice(2).replace(/\D/g, "") :
                  t.replace(/\D/g, "");
          if (!d || d.length < 7) return null;
          for (const c of PFXS) if (d.startsWith(c.prefix)) return c;
          return null;
        }

        const cmap = new Map<string, { name: string; flag: string; count: number }>();
        for (const row of phoneRows.rows) {
          const cd = detectPfx(row.phone as string);
          if (!cd) continue;
          const ex = cmap.get(cd.name);
          if (ex) ex.count++;
          else cmap.set(cd.name, { name: cd.name, flag: cd.flag, count: 1 });
        }
        const countries = [...cmap.values()].sort((a, b) => b.count - a.count);

        // ── Tasks ─────────────────────────────────────────────────────────────
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const taskRows = await c.query(`
          SELECT t.id, t.title, t.description, t.due_date, t.due_time, t.priority,
                 l.id AS lead_id, l.full_name AS lead_name, l.phone AS lead_phone
          FROM crm_tasks t
          JOIN crm_leads l ON l.id = t.lead_id
          WHERE t.completed_at IS NULL ${agentId > 0 ? `AND l.assigned_to = ${agentId}` : ""}
          ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC
          LIMIT 200
        `);

        const todayTasks: any[] = [];
        const overdueTasks: any[] = [];
        const upcomingTasks: any[] = [];
        for (const t of taskRows.rows) {
          const row = { id: t.id, title: t.title, description: t.description, dueDate: t.due_date, dueTime: t.due_time, priority: t.priority, leadId: t.lead_id, leadName: t.lead_name, leadPhone: t.lead_phone };
          if (!t.due_date) { upcomingTasks.push(row); continue; }
          if (t.due_date === today) todayTasks.push(row);
          else if (t.due_date < today) overdueTasks.push(row);
          else upcomingTasks.push(row);
        }

        // ── Top hot leads ─────────────────────────────────────────────────────
        const hotRows = await c.query(`
          SELECT id, full_name, phone, status, lead_score, created_at, updated_at
          FROM crm_leads
          WHERE (lead_score = 'hot' OR status = 'hot_buyer') ${assignFilter}
          ORDER BY updated_at DESC LIMIT 10
        `);
        const topHotLeads = hotRows.rows.map((r: any) => ({
          id: r.id, name: r.full_name, phone: r.phone,
          status: r.status, leadScore: r.lead_score, updatedAt: r.updated_at,
        }));

        // ── Recently assigned leads ───────────────────────────────────────────
        const recentRows = await c.query(`
          SELECT id, full_name, phone, status, lead_score, created_at
          FROM crm_leads WHERE 1=1 ${assignFilter}
          ORDER BY created_at DESC LIMIT 10
        `);
        const recentLeads = recentRows.rows.map((r: any) => ({
          id: r.id, name: r.full_name, phone: r.phone,
          status: r.status, leadScore: r.lead_score, createdAt: r.created_at,
        }));

        const conversionRate = total > 0 ? ((purchased / total) * 100).toFixed(1) : "0.0";

        return res.json({
          agentId, agentName,
          stats: {
            total, new: newLeads, qualified, hot: hotBuyer, hotScore, followUp,
            noAnswer, deposited, reserved, purchased,
            pendingTasks: taskRows.rows.length,
            overdueTasks: overdueTasks.length,
            todayTasks: todayTasks.length,
          },
          performance: { total, qualified, hot: hotBuyer, deposited, purchased, conversionRate },
          countries,
          sources,
          tasks: { today: todayTasks, upcoming: upcomingTasks.slice(0, 20), overdue: overdueTasks },
          topHotLeads,
          recentLeads,
        });
      } finally { c.release(); }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** GET /api/admin/crm/leads — paginated list with optional filters */
  app.get("/api/admin/crm/leads", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const { search, status, source, assignedTo, expectedMonth, contactDate, sortOrder, page, limit, qualScore, aiScore, projectInterest } = req.query as Record<string, string>;
      const pageNum  = Math.max(1, parseInt(page  ?? "1",  10) || 1);
      const limitNum = Math.min(50, Math.max(1, parseInt(limit ?? "50", 10) || 50));
      const offset   = (pageNum - 1) * limitNum;

      const splitParam = (v: string | undefined) =>
        v ? v.split(",").map(s => s.trim()).filter(Boolean) : [];

      const filters: any = { limit: limitNum, offset };
      if (search) filters.search = search;
      if (status) filters.status = splitParam(status);
      if (source) filters.source = splitParam(source);
      if (!req.session.isAdmin && req.session.role === "sub_agent") {
        // Sub-agents can only see leads assigned to them — backend-enforced
        filters.assignedTo = [req.session.userId];
      } else if (assignedTo) {
        filters.assignedTo = assignedTo.split(",").map(v => {
          const t = v.trim();
          return t === "unassigned" ? null : Number(t);
        }).filter(v => v === null || !isNaN(v as number));
      }
      if (expectedMonth) filters.expectedMonth = splitParam(expectedMonth);
      if (contactDate && contactDate !== "all") filters.contactDate = contactDate;
      if (sortOrder === "oldest") filters.sortOrder = "oldest";
      if (qualScore) filters.qualScore = splitParam(qualScore);
      if (aiScore)   filters.aiScore   = splitParam(aiScore);
      if (projectInterest) filters.projectInterest = splitParam(projectInterest);
      const { leads, total } = await storage.getCrmLeads(filters);
      res.json({ leads, total, page: pageNum, limit: limitNum });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/admin/crm/leads — create a new lead */
  app.post("/api/admin/crm/leads", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const {
        fullName, firstName, lastName, phone, email, country, city,
        interestedCountry, projectInterest, budget, expectedPurchaseMonth, description,
        leadSource, leadScore, status, notes,
        campaignName, adsetName, adName, formName, externalLeadId,
      } = req.body;

      // Phone validation (required)
      const phoneResult = vPhone(phone ?? "");
      if (!phoneResult.valid) {
        return res.status(400).json({ message: phoneResult.error ?? "Invalid phone number." });
      }
      // Email validation (optional)
      if (email?.trim()) {
        const emailResult = vEmail(email);
        if (!emailResult.valid) {
          return res.status(400).json({ message: emailResult.error ?? "Invalid email address." });
        }
      }

      const { pickNextSubAgentIdForTx: pickAgentTx } = await import("./leadAssignmentService");
      const { lead, autoAssignedTo } = await db.transaction(async (tx) => {
        const agentId = await pickAgentTx(tx, "Manual CRM");
        const [newLead] = await tx.insert(crmLeads).values({
          fullName, firstName, lastName, phone, email,
          country: country || (phone ? (phoneResult.country || null) : null),
          city,
          interestedCountry, projectInterest, budget, expectedPurchaseMonth, description,
          campaignName, adsetName, adName, formName, externalLeadId, notes,
          leadSource: leadSource || "manual",
          leadScore:  leadScore  || "cold",
          status:     status     || "new",
          assignedTo: agentId,
          updatedAt: new Date(),
        }).returning();
        return { lead: newLead, autoAssignedTo: agentId };
      });
      if (autoAssignedTo) {
        console.log(`[LeadAssignment] Lead #${lead.id} committed — assigned to userId=${autoAssignedTo}`);
        import("./leadAssignmentNotificationService").then(({ notifyAgentOfLeadAssignment }) =>
          notifyAgentOfLeadAssignment({
            leadId: lead.id, leadName: lead.fullName, leadPhone: lead.phone,
            leadEmail: lead.email, leadSource: lead.leadSource,
            assignedToUserId: autoAssignedTo, context: "new",
          })
        ).catch(() => {});
      }
      // Admin + client welcome emails for every new lead (fire-and-forget)
      import("./crmLeadEmailService").then(({ sendNewLeadNotifications }) =>
        sendNewLeadNotifications({
          id: lead.id, fullName: lead.fullName, firstName: lead.firstName,
          lastName: lead.lastName, phone: lead.phone, email: lead.email,
          leadSource: lead.leadSource, country: lead.country,
          interestedCountry: lead.interestedCountry,
          projectInterest: lead.projectInterest, budget: lead.budget,
          assignedTo: lead.assignedTo,
        })
      ).catch(() => {});
      // Developer Registration: prepare records for all active developer companies (fire-and-forget)
      import("./developerRegistrationService").then(({ initDeveloperRegistrationsForLead }) =>
        initDeveloperRegistrationsForLead(lead.id, {
          id:              lead.id,
          fullName:        lead.fullName,
          firstName:       lead.firstName,
          lastName:        lead.lastName,
          phone:           lead.phone,
          country:         lead.country,
          city:            lead.city,
          budget:          lead.budget,
          projectInterest: lead.projectInterest,
        })
      ).catch(() => {});
      // Email Nurturing: start sequence for new lead (fire-and-forget)
      import("./emailNurturingService").then(({ initNurturingForLead }) =>
        initNurturingForLead(lead.id, lead.email, { firstName: lead.firstName, fullName: lead.fullName })
      ).catch(() => {});
      // WhatsApp AI Qualification — trigger for all new leads with a valid phone (fire-and-forget)
      import("./waQualService").then(({ checkAndTrigger }) =>
        checkAndTrigger(lead.id, lead.phone, lead.firstName)
      ).catch(err => console.error(`[WaQual] Trigger failed leadId=${lead.id}: ${err.message}`));
      // AI Lead Scoring — score new lead in background (fire-and-forget)
      setTimeout(() => {
        import("./aiLeadScoringService").then(({ scoreAndSaveLead }) =>
          scoreAndSaveLead(lead.id)
        ).catch(() => {});
      }, 500);
      res.status(201).json(lead);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── CRM Export / Import ────────────────────────────────────────────────────

  /** GET /api/admin/crm/leads/export — download all leads as .xlsx (admin only) */
  app.get("/api/admin/crm/leads/export", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const XLSX = await import("xlsx");
      const { leads } = await storage.getCrmLeads({ limit: 100_000, offset: 0 });

      const rows = leads.map((l: any) => ({
        "ID":                   l.id,
        "Full Name":            l.fullName            ?? "",
        "First Name":           l.firstName           ?? "",
        "Last Name":            l.lastName            ?? "",
        "Phone":                l.phone               ?? "",
        "Email":                l.email               ?? "",
        "Country":              l.country             ?? "",
        "Source":               l.leadSource          ?? "",
        "Status":               l.status              ?? "",
        "Assigned Agent":       l.assigneeName         ?? "",
        "Budget":               l.budget              ?? "",
        "Interest / Project":   l.projectInterest     ?? "",
        "Interested Country":   l.interestedCountry   ?? "",
        "City":                 l.city                ?? "",
        "Expected Month":       l.expectedPurchaseMonth ?? "",
        "Comment":              l.description         ?? "",
        "Notes":                l.notes               ?? "",
        "Last Contact":         l.lastContactAt  ? new Date(l.lastContactAt).toISOString()  : "",
        "Created At":           l.createdAt      ? new Date(l.createdAt).toISOString()      : "",
        "Updated At":           l.updatedAt      ? new Date(l.updatedAt).toISOString()      : "",
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "CRM Leads");
      const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="crm-leads-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.send(buf);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── CRM Excel / CSV Import helpers ─────────────────────────────────────────

  /** Normalise a column header for fuzzy matching (lowercase, strip punctuation) */
  const normHdr = (s: string) =>
    (s ?? "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[\s_\-().'،,]/g, "");

  /** CRM field → accepted header name variants (pre-normalised) */
  const IMPORT_FIELD_MAP: Record<string, string[]> = {
    firstName:            ["leadname","firstname","name","first"],
    lastName:             ["lastname","surname","familyname","lastnameofclient"],
    phone:                ["phone","mobile","whatsapp","contactnumber","phonenumber","رقمالهاتف","هاتف","موبايل","واتساب"],
    email:                ["email","emailaddress","البريدالإلكتروني","إيميل","بريد"],
    country:              ["origincountry","country","البلد","الدولة","بلدالأصل"],
    city:                 ["city","المدينة","مدينة"],
    budget:               ["budget","totalbudget","الميزانية","ميزانية"],
    projectInterest:      ["projectinterested","projectinterestedin","projectinteresteding","projectinteresting","projectinterest","project","interestedproject","المشروع","مشروع"],
    notes:                ["comment","comments","notes","description","note","ملاحظات","تعليق","ملاحظة","وصف"],
    status:               ["leadstatus","status","الحالة","حالة"],
    leadSource:           ["leadsource","source","المصدر","مصدر"],
    assignedAgent:        ["leadowner","owner","agent","assignedto","salesagent","salesmanager","employee","الموظف","المسؤول","المندوب"],
    lastActivityTime:     ["lastactivitytime","lastactivity","activitydate","lastcontacted","lastcontact","آخرنشاط","تاريخآخرتواصل"],
    expectedPurchaseMonth:["expectedpurchasemonth","expectedmonth","purchasemonth","expectingpurchasemonth","expectedbuyingmonth","الشهرالمتوقع","شهرالشراءالمتوقع"],
  };

  const normalizePhone = (raw: string): string => {
    const t = String(raw ?? "").trim();
    if (!t) return "";
    const digits = t.replace(/[^\d]/g, "");
    return digits ? "+" + digits : "";  // always ensure + prefix
  };

  /** Normalise Excel status labels → CRM DB keys */
  const normalizeImportStatus = (raw: string): string => {
    // Strip parens / slashes / brackets, then collapse separators
    const s = raw.toLowerCase().trim()
      .replace(/[()\/\[\]]/g, " ")
      .replace(/[\s\-_]+/g, " ")
      .trim();

    // Priority checks — order matters; these must run BEFORE the generic map
    if (s.includes("whatsapp contacted"))
      return "after_3_no_answer_whatsapp_contacted";
    if (s.includes("not interested") && (s.includes("maybe later") || s.includes("for now")))
      return "not_interested_maybe_later";
    if (s === "maybe later")
      return "not_interested_maybe_later";
    if ((s.includes("sold") || s.includes("closed") || s.includes("converted")) && s.includes("kinglike"))
      return "sold_by_kinglike_luxury";

    // "new fresh" variations → new_fresh_after_3_no_answer
    if (s.includes("new fresh") || s.includes("fresh after 3"))
      return "new_fresh_after_3_no_answer";

    const map: Record<string, string> = {
      "new":                    "new",
      "follow up":              "follow_up",
      "followup":               "follow_up",
      "no answer":              "no_answer_1",
      "no answer 1":            "no_answer_1",
      "no answer 2":            "no_answer_2",
      "no answer 3":            "no_answer_3",
      "no answer 4":            "no_answer_4",
      "after 3 no answer":      "no_answer_3",
      "will think":             "will_think",
      "hot buyer":              "hot_buyer",
      "hot":                    "hot_buyer",
      "entering lead":          "entering_lead",
      "deposited":              "deposited",
      "reserved":               "reserved",
      "purchased":              "purchased",
      "sold":                   "purchased",
      "broker":                 "broker",
      "second hand":            "second_hand",
      "junk lead":              "junk_lead",
      "junk":                   "junk_lead",
      "not qualified":          "not_qualified",
      "re sale":                "re_sale",
      "resale":                 "re_sale",
      "lost competition":       "lost_competition",
      "interested":             "interested",
      "qualified":              "qualified",
      "converted":              "converted",
      "lost":                   "lost",
      "agency":                 "agency",
    };
    return map[s] ?? "new";  // unknown statuses default to "new"
  };

  /**
   * Normalise an agent/owner name to a compact slug for fuzzy matching.
   * Handles Latin + Arabic first-name lookup.
   * "Fadi al-Mofti", "Fadi Al-Moufti", "Fadi al moufti", "فادي" → "fadialmofti"
   */
  const ARABIC_AGENT_MAP: Record<string, string> = {
    "فادي": "fadi",
    "سامر": "samer",
    "سامير": "samer",
  };
  const slugifyAgent = (raw: string): string => {
    let s = raw.toLowerCase().trim();
    // Arabic → Latin lookup (full word)
    if (/[\u0600-\u06FF]/.test(s)) {
      const mapped = ARABIC_AGENT_MAP[s];
      if (mapped) s = mapped;
      else return s; // unknown Arabic — return as-is so matching may still work on contains
    }
    return s
      .replace(/['\u2018\u2019`]/g, "")  // remove apostrophes
      .replace(/[\s\-_.]/g, "")           // collapse separators
      .replace(/moufti/g, "mofti");       // spelling normalisation
  };

  /**
   * Slugs that mean "assign to admin".
   * slugifyAgent("info") → "info", slugifyAgent("admin") → "admin",
   * slugifyAgent("kinglike_admin") / slugifyAgent("Kinglike Admin") → "kinglikeadmin"
   */
  const ADMIN_ALIAS_SLUGS = new Set(["info", "admin", "kinglikeadmin"]);

  /** Parse budget strings like "80k", "50k-80k", "$50,000 - $80,000" → highest numeric value */
  const parseBudgetToNumber = (raw: string): number | null => {
    if (!raw) return null;
    const s = raw.toLowerCase().replace(/[$,\u202f\u00a0]/g, "");
    const re = /(\d+(?:\.\d+)?)\s*([km]?)/g;
    const nums: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      let n = parseFloat(m[1]);
      if (m[2] === "k") n *= 1_000;
      else if (m[2] === "m") n *= 1_000_000;
      if (n >= 1_000) nums.push(n);   // ignore small stray numbers (e.g. "3" from "Within 3 Months")
    }
    if (!nums.length) return null;
    return Math.max(...nums);
  };

  /** Auto-detect column header → CRM field mapping */
  const autoMapColumns = (headers: string[]): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const h of headers) {
      const nk = normHdr(h);
      let matched = "(skip)";
      outer: for (const [field, variants] of Object.entries(IMPORT_FIELD_MAP)) {
        for (const v of variants) {
          if (nk === v || nk.startsWith(v) || v.startsWith(nk)) { matched = field; break outer; }
        }
      }
      result[h] = matched;
    }
    return result;
  };

  /** Build a lead field map from one row using the provided column mapping */
  const mapImportRow = (row: Record<string, any>, mapping: Record<string, string>): Record<string, string> => {
    const lead: Record<string, string> = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field === "(skip)") continue;
      const raw = String(row[header] ?? "").trim();
      if (!raw || lead[field]) continue;
      lead[field] = field === "phone" ? normalizePhone(raw) : raw;
    }
    if (!lead.fullName && (lead.firstName || lead.lastName))
      lead.fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
    return lead;
  };

  const excelUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const validMime = [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv", "application/csv", "text/plain",
      ];
      const validExt = /\.(xlsx|xls|csv)$/i.test(file.originalname);
      if (validMime.includes(file.mimetype) || validExt) cb(null, true);
      else cb(new Error("Only .xlsx, .xls and .csv files are allowed"));
    },
  });

  /** POST /api/admin/crm/leads/import/preview — parse & auto-map, no DB writes */
  app.post("/api/admin/crm/leads/import/preview", isAuthenticated, excelUpload.single("file"), async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    if (!req.file)            return res.status(400).json({ message: "No file uploaded" });
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      if (!wb.SheetNames.length) return res.status(400).json({ message: "Empty file" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!rawRows.length) return res.json({
        headers: [], detectedMapping: {}, sampleRows: [],
        stats: { total: 0, withPhone: 0, withEmail: 0, withNeither: 0, estimatedDuplicates: 0 },
        warnings: [],
      });

      const headers = Object.keys(rawRows[0]);
      const detectedMapping = autoMapColumns(headers);
      const sampleRows = rawRows.slice(0, 5).map(r =>
        Object.fromEntries(headers.map(h => [h, String(r[h] ?? "").trim()]))
      );

      let withPhone = 0, withEmail = 0, withNeither = 0, estimatedDuplicates = 0;
      for (const row of rawRows) {
        const lead = mapImportRow(row, detectedMapping);
        const ph = normalizePhone(lead.phone ?? "");
        const em = (lead.email ?? "").trim();
        if (!ph && !em) { withNeither++; continue; }
        if (ph) withPhone++;
        if (em) withEmail++;
        if (ph) {
          const [dup] = await db.select({ id: crmLeads.id }).from(crmLeads).where(eq(crmLeads.phone, ph)).limit(1);
          if (dup) { estimatedDuplicates++; continue; }
        }
        if (em) {
          const [dup] = await db.select({ id: crmLeads.id }).from(crmLeads).where(eq(crmLeads.email, em)).limit(1);
          if (dup) { estimatedDuplicates++; }
        }
      }

      // Agent name matching — load users once for preview warnings
      const { users: usersTable } = await import("@shared/schema");
      const allUsers = await db.select({ id: usersTable.id, username: usersTable.username, isAdmin: usersTable.isAdmin }).from(usersTable);
      const userSlugs = allUsers.map(u => ({ id: u.id, username: u.username, slug: slugifyAgent(u.username), isAdmin: u.isAdmin }));
      // Helper: resolve an admin alias slug → the preferred admin user
      const resolveAdminUser = () =>
        userSlugs.find(u => u.slug === "kinglikeadmin") ??
        userSlugs.find(u => u.isAdmin) ?? null;
      let unmatchedAgentCount = 0;
      const agentHeader = headers.find(h => detectedMapping[h] === "assignedAgent");
      if (agentHeader) {
        for (const row of rawRows) {
          const agentRaw = String(row[agentHeader] ?? "").trim();
          if (!agentRaw) continue;
          const aSlug = slugifyAgent(agentRaw);
          // Admin aliases always resolve
          if (ADMIN_ALIAS_SLUGS.has(aSlug)) continue;
          const matched = userSlugs.some(u =>
            u.slug === aSlug || u.slug.includes(aSlug) || aSlug.includes(u.slug)
          );
          if (!matched) unmatchedAgentCount++;
        }
      }

      const skipped = headers.filter(h => detectedMapping[h] === "(skip)");
      const warnings: string[] = [];
      if (skipped.length) {
        warnings.push(`${skipped.length} column(s) could not be auto-mapped and are set to "Skip": ${skipped.slice(0, 4).join(", ")}${skipped.length > 4 ? "…" : ""}`);
      }
      if (unmatchedAgentCount > 0) {
        warnings.push(`${unmatchedAgentCount} agent name(s) in "Lead Owner" column did not match an existing user — will be left unassigned`);
      }

      // Build enriched preview rows (first 5) showing parsed/resolved values
      const previewRows = rawRows.slice(0, 5).map(row => {
        const lead = mapImportRow(row, detectedMapping);
        const rawPhone = String(row[headers.find(h => detectedMapping[h] === "phone") ?? ""] ?? "").trim();
        const normalizedPhone = normalizePhone(rawPhone);
        const parsedBudgetNum = parseBudgetToNumber(lead.budget ?? "");
        let matchedAgent = "";
        if (lead.assignedAgent) {
          const aSlug = slugifyAgent(lead.assignedAgent);
          if (ADMIN_ALIAS_SLUGS.has(aSlug)) {
            const adminUser = resolveAdminUser();
            matchedAgent = adminUser ? adminUser.username : `⚠ No admin user found`;
          } else {
            const found = userSlugs.find(u =>
              u.slug === aSlug || u.slug.includes(aSlug) || aSlug.includes(u.slug)
            );
            matchedAgent = found ? found.username : `⚠ No match — will remain unassigned`;
          }
        }
        return {
          originalPhone:         rawPhone,
          normalizedPhone,
          excelAgent:            lead.assignedAgent            ?? "",
          matchedAgent,
          excelStatus:           lead.status                   ?? "",
          mappedStatus:          lead.status ? normalizeImportStatus(lead.status) : "",
          rawBudget:             lead.budget                   ?? "",
          parsedBudget:          parsedBudgetNum !== null ? String(parsedBudgetNum) : "",
          projectInterest:       lead.projectInterest          ?? "",
          expectedPurchaseMonth: lead.expectedPurchaseMonth    ?? "",
        };
      });

      res.json({ headers, detectedMapping, sampleRows, previewRows, stats: { total: rawRows.length, withPhone, withEmail, withNeither, estimatedDuplicates }, warnings });
    } catch (err: any) {
      console.error("CRM Import Analysis Error", err);
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/admin/crm/leads/import — import leads with provided column mapping */
  app.post("/api/admin/crm/leads/import", isAuthenticated, excelUpload.single("file"), async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    if (!req.file)            return res.status(400).json({ message: "No file uploaded" });
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      if (!wb.SheetNames.length) return res.status(400).json({ message: "Empty workbook" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      let columnMapping: Record<string, string> = {};
      if (req.body.columnMapping) {
        try { columnMapping = JSON.parse(req.body.columnMapping); } catch {}
      }
      if (!Object.keys(columnMapping).length && rawRows.length) {
        columnMapping = autoMapColumns(Object.keys(rawRows[0]));
      }
      const skipNurturing   = req.body.skipNurturing   === "true" || req.body.skipNurturing   === true;
      const autoDistribute  = req.body.autoDistribute  === "true" || req.body.autoDistribute  === true;

      // Pre-load users once for agent name resolution
      const { users: usersTable2 } = await import("@shared/schema");
      const importUsers = await db.select({ id: usersTable2.id, username: usersTable2.username, isAdmin: usersTable2.isAdmin }).from(usersTable2);
      const importUserList = importUsers.map(u => ({ id: u.id, name: u.username, slug: slugifyAgent(u.username), isAdmin: u.isAdmin }));
      // Helper: resolve admin alias → preferred admin user (kinglike_admin first, then any isAdmin)
      const resolveImportAdmin = () =>
        importUserList.find(u => u.slug === "kinglikeadmin") ??
        importUserList.find(u => u.isAdmin) ?? null;

      // Global cursor assignment — each lead advances the shared alternating counter
      const {
        pickNextSubAgentId: pickImportAgent,
        pickNextSubAgentIdForTx: pickImportAgentTx,
      } = await import("./leadAssignmentService");

      let importedCount = 0, duplicates = 0, failed = 0;
      const failedRows: { row: number; reason: string }[] = [];
      const importAssignCounts = new Map<number, number[]>();

      for (let i = 0; i < rawRows.length; i++) {
        const rowNum = i + 2;
        try {
          const lead  = mapImportRow(rawRows[i], columnMapping);
          const phone = normalizePhone(lead.phone ?? "");
          const email = (lead.email ?? "").trim();

          if (!phone && !email) {
            failed++;
            failedRows.push({ row: rowNum, reason: "Phone or email is required" });
            continue;
          }

          let isDuplicate = false;
          if (phone) {
            const [dup] = await db.select({ id: crmLeads.id }).from(crmLeads).where(eq(crmLeads.phone, phone)).limit(1);
            if (dup) { isDuplicate = true; failedRows.push({ row: rowNum, reason: `Duplicate phone: ${phone}` }); }
          }
          if (!isDuplicate && email) {
            const [dup] = await db.select({ id: crmLeads.id }).from(crmLeads).where(eq(crmLeads.email, email)).limit(1);
            if (dup) { isDuplicate = true; failedRows.push({ row: rowNum, reason: `Duplicate email: ${email}` }); }
          }
          if (isDuplicate) { duplicates++; continue; }

          // Resolve assignedAgent → assignedTo (user id)
          // hasExcelAgent = Lead Owner column had a value (even if it didn't match any CRM user)
          let assignedToId: number | null = null;
          let hasExcelAgent = false;
          const metaNotes: string[] = [];
          if (lead.assignedAgent) {
            hasExcelAgent = true;
            const aSlug = slugifyAgent(lead.assignedAgent);
            if (ADMIN_ALIAS_SLUGS.has(aSlug)) {
              // "info" / "admin" / "kinglike_admin" → assign to admin user, never round-robin
              const adminUser = resolveImportAdmin();
              if (adminUser) assignedToId = adminUser.id;
              else metaNotes.push(`Lead Owner: ${lead.assignedAgent} (no admin user found)`);
            } else {
              const matched = importUserList.find(u =>
                u.slug === aSlug || u.slug.includes(aSlug) || aSlug.includes(u.slug)
              );
              if (matched) {
                assignedToId = matched.id;
              } else {
                // Unmatched agent — preserve in notes, do NOT fall back to round-robin
                metaNotes.push(`Lead Owner: ${lead.assignedAgent}`);
              }
            }
          }

          // Resolve lastActivityTime → lastContactAt or notes
          let lastContactAtDate: Date | null = null;
          if (lead.lastActivityTime) {
            const parsed = new Date(lead.lastActivityTime);
            if (!isNaN(parsed.getTime())) {
              lastContactAtDate = parsed;
            } else {
              metaNotes.push(`Last Activity: ${lead.lastActivityTime}`);
            }
          }

          // Build final notes — original + any unresolved metadata
          const finalNotes = [lead.notes, ...metaNotes].filter(Boolean).join(" | ") || null;

          // Parse budget → store the highest parsed numeric value as text
          const parsedBudget = parseBudgetToNumber(lead.budget ?? "");

          // Alternating round-robin ONLY when: no agent in Excel AND autoDistribute is enabled
          const shouldRoundRobin = !hasExcelAgent && autoDistribute;

          // Shared field data for both paths
          const importLeadBase = {
            fullName:              lead.fullName              || null,
            firstName:             lead.firstName             || null,
            lastName:              lead.lastName              || null,
            phone:                 phone                      || null,
            email:                 email                      || null,
            country:               lead.country               || (phone ? (vPhone(phone).country || null) : null),
            city:                  lead.city                  || null,
            interestedCountry:     null as null,
            budget:                parsedBudget !== null ? String(parsedBudget) : (lead.budget || null),
            projectInterest:       lead.projectInterest       || null,
            expectedPurchaseMonth: lead.expectedPurchaseMonth || null,
            description:           null as null,
            notes:                 finalNotes,
            leadSource:            lead.leadSource            || "excel_import",
            leadScore:             "cold",
            status:                (lead.status ? normalizeImportStatus(lead.status) : "new") as string,
            lastContactAt:         lastContactAtDate,
          };

          // When round-robin is active: wrap cursor + insert in ONE transaction so a failed
          // insert never wastes a counter slot and strict Fadi↔Samer alternation is preserved.
          let importedLead;
          if (shouldRoundRobin) {
            importedLead = await db.transaction(async (tx) => {
              const agentId = await pickImportAgentTx(tx, "Excel Import");
              const [row] = await tx.insert(crmLeads).values({
                ...importLeadBase,
                assignedTo: agentId,
                updatedAt: new Date(),
              }).returning();
              return row;
            });
          } else {
            importedLead = await storage.createCrmLead({
              ...importLeadBase,
              assignedTo: assignedToId,
            });
          }

          import("./developerRegistrationService").then(({ initDeveloperRegistrationsForLead }) =>
            initDeveloperRegistrationsForLead(importedLead.id, {
              id: importedLead.id, fullName: importedLead.fullName,
              firstName: importedLead.firstName, lastName: importedLead.lastName,
              phone: importedLead.phone, country: importedLead.country,
              city: importedLead.city, budget: importedLead.budget,
              projectInterest: importedLead.projectInterest,
            })
          ).catch(() => {});

          // Email Nurturing — ON by default; skipped only if admin checked "Do not start"
          if (!skipNurturing) {
            import("./emailNurturingService").then(({ initNurturingForLead }) =>
              initNurturingForLead(importedLead.id, importedLead.email, { firstName: importedLead.firstName, fullName: importedLead.fullName })
            ).catch(err => console.error(`[EmailNurturing] Import init failed leadId=${importedLead.id}: ${err.message}`));
          }
          // WhatsApp AI Qualification — trigger for each imported lead with a phone (fire-and-forget)
          import("./waQualService").then(({ checkAndTrigger }) =>
            checkAndTrigger(importedLead.id, importedLead.phone, importedLead.firstName)
          ).catch(err => console.error(`[WaQual] Trigger failed leadId=${importedLead.id}: ${err.message}`));
          // Admin + client welcome emails for every imported lead (fire-and-forget)
          import("./crmLeadEmailService").then(({ sendNewLeadNotifications }) =>
            sendNewLeadNotifications({
              id: importedLead.id, fullName: importedLead.fullName,
              firstName: importedLead.firstName, lastName: importedLead.lastName,
              phone: importedLead.phone, email: importedLead.email,
              leadSource: importedLead.leadSource, country: importedLead.country,
              interestedCountry: (importedLead as any).interestedCountry ?? null,
              projectInterest: importedLead.projectInterest, budget: importedLead.budget,
              assignedTo: importedLead.assignedTo,
            })
          ).catch(() => {});

          importedCount++;
          // Track assignment for post-import bulk notification
          if (importedLead.assignedTo) {
            if (!importAssignCounts.has(importedLead.assignedTo)) importAssignCounts.set(importedLead.assignedTo, []);
            importAssignCounts.get(importedLead.assignedTo)!.push(importedLead.id);
          }
        } catch (rowErr: any) {
          failed++;
          failedRows.push({ row: rowNum, reason: rowErr.message ?? "Unknown error" });
        }
      }

      // Notify each assigned agent with a bulk summary (one email per agent)
      if (importAssignCounts.size > 0) {
        import("./leadAssignmentNotificationService").then(({ notifyAgentOfBulkAssignment }) => {
          Array.from(importAssignCounts.entries()).forEach(([agentId, leadIds]) => {
            notifyAgentOfBulkAssignment({ assignedToUserId: agentId, leadCount: leadIds.length, leadIds }).catch(() => {});
          });
        }).catch(() => {});
      }

      res.json({ total: rawRows.length, imported: importedCount, duplicates, failed, failedRows });
    } catch (err: any) {
      console.error("CRM Import Error", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── CRM Project management ─────────────────────────────────────────────────

  /** GET /api/admin/crm/projects — list all projects (admins + sub_agents can read) */
  app.get("/api/admin/crm/projects", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    try { res.json(await storage.getCrmProjects()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  /** POST /api/admin/crm/projects — create project (admin only) */
  app.post("/api/admin/crm/projects", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const { name, isActive, sortOrder } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Project name is required" });
      const p = await storage.createCrmProject({ name: name.trim(), isActive: isActive ?? true, sortOrder: sortOrder ?? 0 });
      res.status(201).json(p);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  /** PATCH /api/admin/crm/projects/:id — update project */
  app.patch("/api/admin/crm/projects/:id", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const p = await storage.updateCrmProject(Number(req.params.id), req.body);
      if (!p) return res.status(404).json({ message: "Project not found" });
      res.json(p);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  /** DELETE /api/admin/crm/projects/:id — delete project */
  app.delete("/api/admin/crm/projects/:id", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const ok = await storage.deleteCrmProject(Number(req.params.id));
      if (!ok) return res.status(404).json({ message: "Project not found" });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── CRM Task management ────────────────────────────────────────────────────

  /** GET /api/admin/crm/leads/:id/tasks — list tasks for a lead */
  app.get("/api/admin/crm/leads/:id/tasks", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    if (!req.session.isAdmin && !await canAccessLead(req, Number(req.params.id)))
      return res.status(403).json({ message: "Access denied" });
    try { res.json(await storage.getCrmTasks(Number(req.params.id))); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  /** POST /api/admin/crm/leads/:id/tasks — create a task */
  app.post("/api/admin/crm/leads/:id/tasks", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    if (!req.session.isAdmin && !await canAccessLead(req, Number(req.params.id)))
      return res.status(403).json({ message: "Access denied" });
    try {
      const { title, description, dueDate, dueTime, priority } = req.body;
      if (!title?.trim()) return res.status(400).json({ message: "Task title is required" });
      const task = await storage.createCrmTask({
        leadId: Number(req.params.id),
        title: title.trim(),
        description: description ?? null,
        dueDate: dueDate ?? null,
        dueTime: dueTime ?? null,
        priority: priority || "medium",
        createdBy: req.session.userId ?? null,
        completedAt: null,
      });
      res.status(201).json(task);
      // Notify admin when a sub-admin / employee adds a task
      if (!req.session.isAdmin) {
        const lead = await storage.getCrmLead(Number(req.params.id));
        const changer = req.session.userId ? await storage.getUser(req.session.userId) : null;
        const leadName = lead ? (lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—") : "—";
        sendLeadTaskChangeNotification({
          leadId: Number(req.params.id), leadName, leadPhone: lead?.phone ?? "—",
          changedBy: changer?.username ?? "Unknown", changedAt: new Date(),
          action: "added", taskTitle: task.title, taskDetails: task.description ?? undefined,
        }).catch(() => {});
      }
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  /** PATCH /api/admin/crm/leads/:id/tasks/:taskId — update task (e.g. complete) */
  app.patch("/api/admin/crm/leads/:id/tasks/:taskId", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    if (!req.session.isAdmin && !await canAccessLead(req, Number(req.params.id)))
      return res.status(403).json({ message: "Access denied" });
    try {
      // If due date or time is being changed, reset reminder so it re-fires at the new time
      const updateData = { ...req.body };
      if ("dueDate" in req.body || "dueTime" in req.body) {
        updateData.reminderSentAt = null;
      }
      const task = await storage.updateCrmTask(Number(req.params.taskId), updateData);
      if (!task) return res.status(404).json({ message: "Task not found" });
      res.json(task);
      // Notify admin when a sub-admin / employee updates a task
      if (!req.session.isAdmin) {
        const lead = await storage.getCrmLead(Number(req.params.id));
        const changer = req.session.userId ? await storage.getUser(req.session.userId) : null;
        const leadName = lead ? (lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—") : "—";
        sendLeadTaskChangeNotification({
          leadId: Number(req.params.id), leadName, leadPhone: lead?.phone ?? "—",
          changedBy: changer?.username ?? "Unknown", changedAt: new Date(),
          action: "updated", taskTitle: task.title, taskDetails: task.description ?? undefined,
        }).catch(() => {});
      }
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  /** DELETE /api/admin/crm/leads/:id/tasks/:taskId — delete task */
  app.delete("/api/admin/crm/leads/:id/tasks/:taskId", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    if (!req.session.isAdmin && !await canAccessLead(req, Number(req.params.id)))
      return res.status(403).json({ message: "Access denied" });
    try {
      // Fetch task before deletion so we can include its title in the notification
      const tasksBefore = !req.session.isAdmin ? await storage.getCrmTasks(Number(req.params.id)) : [];
      const taskToDelete = tasksBefore.find(t => t.id === Number(req.params.taskId));
      const ok = await storage.deleteCrmTask(Number(req.params.taskId));
      if (!ok) return res.status(404).json({ message: "Task not found" });
      res.json({ success: true });
      // Notify admin when a sub-admin / employee deletes a task
      if (!req.session.isAdmin && taskToDelete) {
        const lead = await storage.getCrmLead(Number(req.params.id));
        const changer = req.session.userId ? await storage.getUser(req.session.userId) : null;
        const leadName = lead ? (lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—") : "—";
        sendLeadTaskChangeNotification({
          leadId: Number(req.params.id), leadName, leadPhone: lead?.phone ?? "—",
          changedBy: changer?.username ?? "Unknown", changedAt: new Date(),
          action: "deleted", taskTitle: taskToDelete.title,
        }).catch(() => {});
      }
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── CRM Bulk Operations ───────────────────────────────────────────────────

  /** GET /api/admin/crm/leads/export-selected?ids=1,2,3 — xlsx of specific leads */
  app.get("/api/admin/crm/leads/export-selected", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const raw = (req.query.ids as string) ?? "";
      const ids = raw.split(",").map(Number).filter(n => !isNaN(n) && n > 0);
      if (ids.length === 0) return res.status(400).json({ message: "No IDs provided" });
      if (ids.length > 1000) return res.status(400).json({ message: "Too many IDs (max 1000)" });

      const { users } = await import("../shared/schema");
      // Sub-agents may only export leads assigned to themselves
      const isAgent = !req.session.isAdmin && req.session.role === "sub_agent";
      const exportWhere = isAgent
        ? and(inArray(crmLeads.id, ids), eq(crmLeads.assignedTo, req.session.userId as number))
        : inArray(crmLeads.id, ids);

      const rows_data = await db
        .select({
          id: crmLeads.id,
          fullName: crmLeads.fullName,
          firstName: crmLeads.firstName,
          lastName: crmLeads.lastName,
          phone: crmLeads.phone,
          email: crmLeads.email,
          country: crmLeads.country,
          leadSource: crmLeads.leadSource,
          status: crmLeads.status,
          assigneeName: users.username,
          budget: crmLeads.budget,
          projectInterest: crmLeads.projectInterest,
          interestedCountry: crmLeads.interestedCountry,
          city: crmLeads.city,
          expectedPurchaseMonth: crmLeads.expectedPurchaseMonth,
          description: crmLeads.description,
          notes: crmLeads.notes,
          lastContactedAt: crmLeads.lastContactedAt,
          createdAt: crmLeads.createdAt,
          updatedAt: crmLeads.updatedAt,
        })
        .from(crmLeads)
        .leftJoin(users, eq(crmLeads.assignedTo, users.id))
        .where(exportWhere);

      const XLSX = await import("xlsx");
      const rows = rows_data.map((l: any) => ({
        "ID":                     l.id,
        "Full Name":              l.fullName ?? "",
        "First Name":             l.firstName ?? "",
        "Last Name":              l.lastName ?? "",
        "Phone":                  l.phone ?? "",
        "Email":                  l.email ?? "",
        "Country":                l.country ?? "",
        "Source":                 l.leadSource ?? "",
        "Status":                 l.status ?? "",
        "Assigned Agent":         l.assigneeName ?? "",
        "Budget":                 l.budget ?? "",
        "Project Interest":       l.projectInterest ?? "",
        "Interested Country":     l.interestedCountry ?? "",
        "City":                   l.city ?? "",
        "Expected Purchase Month": l.expectedPurchaseMonth ?? "",
        "Description":            l.description ?? "",
        "Notes":                  l.notes ?? "",
        "Last Contacted":         l.lastContactedAt ? new Date(l.lastContactedAt).toISOString() : "",
        "Created At":             l.createdAt ? new Date(l.createdAt).toISOString() : "",
        "Updated At":             l.updatedAt ? new Date(l.updatedAt).toISOString() : "",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Leads");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Disposition", `attachment; filename="crm-selected-${date}.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/admin/crm/leads/bulk-update — bulk status or agent assignment */
  app.post("/api/admin/crm/leads/bulk-update", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const { ids, status, assignedTo } = req.body as {
        ids: number[];
        status?: string;
        assignedTo?: number | null;
      };
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids array required" });
      if (ids.length > 1000) return res.status(400).json({ message: "Too many IDs (max 1000)" });
      if (!status && assignedTo === undefined) return res.status(400).json({ message: "Provide status or assignedTo" });

      // Sub-agents may not reassign leads
      if (!req.session.isAdmin && assignedTo !== undefined) {
        return res.status(403).json({ message: "Sub-agents cannot reassign leads" });
      }

      // Validate assignee if provided
      if (req.session.isAdmin && assignedTo != null) {
        const { users } = await import("../shared/schema");
        const [target] = await db
          .select({ id: users.id, isAdmin: users.isAdmin, role: users.role })
          .from(users)
          .where(eq(users.id, Number(assignedTo)));
        if (!target || (!target.isAdmin && target.role !== "sub_agent")) {
          return res.status(400).json({ message: "Leads can only be assigned to admin or sub_agent users" });
        }
      }

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (status)              updateData.status     = status;
      if (assignedTo !== undefined) updateData.assignedTo = assignedTo;

      // Sub-agents may only update leads assigned to themselves
      const isAgent = !req.session.isAdmin && req.session.role === "sub_agent";
      const bulkWhere = isAgent
        ? and(inArray(crmLeads.id, ids), eq(crmLeads.assignedTo, req.session.userId as number))
        : inArray(crmLeads.id, ids);

      await db.update(crmLeads).set(updateData).where(bulkWhere);
      res.json({ updated: ids.length });
      // Notify agent of bulk assignment (admin only)
      if (req.session.isAdmin && assignedTo != null) {
        import("./leadAssignmentNotificationService").then(({ notifyAgentOfBulkAssignment }) =>
          notifyAgentOfBulkAssignment({ assignedToUserId: assignedTo, leadCount: ids.length, leadIds: ids })
        ).catch(() => {});
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/admin/crm/leads/bulk-delete — admin only */
  app.post("/api/admin/crm/leads/bulk-delete", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const { ids } = req.body as { ids: number[] };
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids array required" });
      if (ids.length > 1000) return res.status(400).json({ message: "Too many IDs (max 1000)" });
      await db.delete(crmLeads).where(inArray(crmLeads.id, ids));
      res.json({ deleted: ids.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/admin/crm/leads/assign-unassigned — round-robin assign all leads with assigned_to=null */
  app.post("/api/admin/crm/leads/assign-unassigned", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const { backfillUnassignedLeads } = await import("./leadAssignmentService");
      const result = await backfillUnassignedLeads();
      if (result.agentCount === 0) {
        return res.json({ assigned: 0, message: "No eligible sub-agents found. Add sub-agents first." });
      }
      res.json({ assigned: result.assigned, agentCount: result.agentCount, message: `Assigned ${result.assigned} leads across ${result.agentCount} sub-agent(s)` });
      // Notify each agent of their newly assigned leads (one bulk email per agent)
      if (result.assignments.length > 0) {
        import("./leadAssignmentNotificationService").then(({ notifyAgentOfBulkAssignment }) => {
          const byAgent = new Map<number, number[]>();
          for (const { leadId, agentId } of result.assignments) {
            if (!byAgent.has(agentId)) byAgent.set(agentId, []);
            byAgent.get(agentId)!.push(leadId);
          }
          Array.from(byAgent.entries()).forEach(([agentId, leadIds]) => {
            notifyAgentOfBulkAssignment({ assignedToUserId: agentId, leadCount: leadIds.length, leadIds }).catch(() => {});
          });
        }).catch(() => {});
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** GET /api/admin/crm/assignment-audit — cursor state + agent roster */
  app.get("/api/admin/crm/assignment-audit", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const { getAssignmentCursorState } = await import("./leadAssignmentService");
      const state = await getAssignmentCursorState();
      res.json({ ok: true, ...state });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/admin/crm/assignment-validate — dry-run N assignments (no DB writes to leads) */
  app.post("/api/admin/crm/assignment-validate", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const count = Math.max(1, Math.min(20, Number(req.body?.count ?? 6)));
      const { getEligibleSubAgents, getAssignmentCursorState } = await import("./leadAssignmentService");
      const [agents, state] = await Promise.all([getEligibleSubAgents(), getAssignmentCursorState()]);

      if (!agents.length) {
        return res.json({ ok: false, message: "No eligible sub-agents", simulation: [] });
      }

      const simulation: Array<{ slot: number; agent: string; userId: number }> = [];
      let cursor = state.counter;
      for (let i = 0; i < count; i++) {
        const idx = cursor % agents.length;
        simulation.push({ slot: i + 1, agent: agents[idx].username, userId: agents[idx].id });
        cursor++;
      }

      res.json({
        ok: true,
        currentCounter: state.counter,
        lastAgentId: state.lastAgentId,
        agentOrder: agents.map(a => a.username),
        simulation,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** GET /api/admin/crm/leads/:id — lead detail with notes + assignee */
  app.get("/api/admin/crm/leads/:id", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    const _notesOnlyViewIds = [24, 29];
    if (!_notesOnlyViewIds.includes(req.session.userId) && !await canAccessLead(req, Number(req.params.id)))
      return res.status(403).json({ message: "Access denied: lead not assigned to you" });
    try {
      const lead = await storage.getCrmLead(Number(req.params.id));
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      res.json(lead);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** PATCH /api/admin/crm/leads/:id — update any lead fields */
  app.patch("/api/admin/crm/leads/:id", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    const _notesOnlyPatchIds = [24, 29];
    if (!req.session.isAdmin && !_notesOnlyPatchIds.includes(req.session.userId) && !await canAccessLead(req, Number(req.params.id)))
      return res.status(403).json({ message: "Access denied: lead not assigned to you" });
    // Meta Attribution fields are protected — non-admins cannot modify them
    if (!req.session.isAdmin) {
      const META_ATTRIBUTION_KEYS = ["campaignName", "adsetName", "adName", "formName", "metaCampaignId", "metaAdId", "metaAdsetId", "metaFormId"];
      META_ATTRIBUTION_KEYS.forEach(k => delete req.body[k]);
    }
    try {
      // Extract sub-agent comment (required for all sub-agent changes)
      const _comment = (req.body._comment as string | undefined)?.trim() ?? "";
      delete req.body._comment;

      // Sub-agents cannot reassign leads (always blocked)
      if (!req.session.isAdmin) {
        delete req.body.assignedTo;
      }

      // Admins: validate assignedTo is an admin or sub_agent (not a regular user)
      if (req.session.isAdmin && req.body.assignedTo != null) {
        const { db } = await import("./db");
        const { users } = await import("../shared/schema");
        const { eq } = await import("drizzle-orm");
        const [target] = await db
          .select({ id: users.id, isAdmin: users.isAdmin, role: users.role })
          .from(users)
          .where(eq(users.id, Number(req.body.assignedTo)));
        if (!target || (!target.isAdmin && target.role !== "sub_agent")) {
          return res.status(400).json({ message: "Leads can only be assigned to admin or sub_agent users" });
        }
      }

      // Sub-agents must provide a comment — except for routine field edits and non-critical status changes
      const _bodyKeys = Object.keys(req.body);
      // Fields that sub-agents may save without a comment (mirrors frontend NO_REASON_FIELDS)
      const SUB_AGENT_NO_REASON_FIELDS = [
        "fullName","firstName","lastName","phone","email","country",
        "interestedCountry","city","projectInterest","budget",
        "expectedPurchaseMonth","leadSource","description","notes",
      ];
      // Statuses that require a written reason (mirrors frontend REQUIRES_REASON)
      const REQUIRES_REASON_STATUSES = [
        "purchased","reserved","deposited","junk_lead","lost_competition","not_qualified","re_sale",
      ];
      const _isNoReasonFieldChange = _bodyKeys.length > 0 && _bodyKeys.every((k: string) => SUB_AGENT_NO_REASON_FIELDS.includes(k));
      const _isRoutineStatusChange  = _bodyKeys.length === 1 && _bodyKeys[0] === "status" && !REQUIRES_REASON_STATUSES.includes(req.body.status);
      if (!req.session.isAdmin && req.session.role === "sub_agent" && !_comment && !_isNoReasonFieldChange && !_isRoutineStatusChange) {
        return res.status(400).json({ message: "A comment/reason is required for all changes" });
      }

      const { phone, email } = req.body;
      // Validate phone if being updated
      if (phone !== undefined) {
        const phoneResult = vPhone(phone ?? "");
        if (!phoneResult.valid) {
          return res.status(400).json({ message: phoneResult.error ?? "Invalid phone number." });
        }
      }
      // Validate email if being updated and non-empty
      if (email !== undefined && email?.trim()) {
        const emailResult = vEmail(email);
        if (!emailResult.valid) {
          return res.status(400).json({ message: emailResult.error ?? "Invalid email address." });
        }
      }
      // Fetch current lead before update (needed for change comparison in notification)
      const leadBefore = !req.session.isAdmin ? await storage.getCrmLead(Number(req.params.id)) : null;
      const updated = await storage.updateCrmLead(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Lead not found" });
      res.json(updated);
      // AI Lead Scoring — re-score on field updates (fire-and-forget)
      import("./aiLeadScoringService").then(({ scoreAndSaveLead }) =>
        scoreAndSaveLead(Number(req.params.id))
      ).catch(() => {});
      // Notify agent when admin assigns/reassigns lead via PATCH
      if (req.session.isAdmin && req.body.assignedTo != null) {
        import("./leadAssignmentNotificationService").then(({ notifyAgentOfLeadAssignment }) =>
          notifyAgentOfLeadAssignment({
            leadId: updated.id, leadName: updated.fullName, leadPhone: updated.phone,
            leadEmail: updated.email, leadSource: updated.leadSource,
            assignedToUserId: Number(req.body.assignedTo), context: "reassigned",
          })
        ).catch(() => {});
        // Advance WhatsApp conversation stage to Advisor Assigned
        import("./db").then(({ pool }) =>
          pool.connect().then(async client => {
            try {
              await client.query(
                `UPDATE crm_leads SET wa_stage = 'advisor_assigned' WHERE id = $1`,
                [updated.id]
              );
            } finally { client.release(); }
          })
        ).catch(() => {});
      }
      // No Answer 2 recovery — fire in background, never blocks response
      if (req.body.status === "no_answer_2") {
        import("./whatsappAiService").then(({ triggerNoAnswer2Recovery }) =>
          triggerNoAnswer2Recovery(updated.id, {
            fullName:        updated.fullName,
            firstName:       updated.firstName,
            phone:           updated.phone,
            country:         updated.country,
            city:            updated.city,
            budget:          updated.budget,
            projectInterest: updated.projectInterest,
            assignedTo:      updated.assignedTo,
          })
        ).catch(() => {});
      }
      // No Answer 3 recovery — fire in background, never blocks response
      if (req.body.status === "no_answer_3") {
        import("./whatsappAiService").then(({ triggerNoAnswer3Recovery }) =>
          triggerNoAnswer3Recovery(updated.id, {
            fullName:        updated.fullName,
            firstName:       updated.firstName,
            phone:           updated.phone,
            country:         updated.country,
            city:            updated.city,
            budget:          updated.budget,
            projectInterest: updated.projectInterest,
            assignedTo:      updated.assignedTo,
          })
        ).catch(() => {});
      }
      // Developer Registration: stop registrations if status is a stop status
      if (req.body.status) {
        import("./developerRegistrationService").then(({ handleDevRegLeadStatusChange }) =>
          handleDevRegLeadStatusChange(updated.id, req.body.status)
        ).catch(() => {});
      }
      // Email Nurturing: stop sequence on terminal statuses
      if (req.body.status) {
        import("./emailNurturingService").then(({ handleLeadStatusChangeForNurturing }) =>
          handleLeadStatusChangeForNurturing(updated.id, req.body.status)
        ).catch(() => {});
      }
      // Notify admin when a sub-admin / employee (non-admin) makes changes.
      // Status changes are handled via the notes endpoint (which includes the reason).
      if (!req.session.isAdmin && leadBefore) {
        const MONITORED: Record<string, string> = {
          phone: "Phone", email: "Email",
          interestedCountry: "Interested Country", city: "City",
          projectInterest: "Project Interest", budget: "Budget",
          expectedPurchaseMonth: "Expected Purchase Month", leadSource: "Source",
          description: "Description", notes: "Internal Notes",
        };
        const changes: { field: string; label: string; oldValue: string; newValue: string }[] = [];
        for (const [key, label] of Object.entries(MONITORED)) {
          if (key in req.body) {
            const oldVal = String((leadBefore as any)[key] ?? "");
            const newVal = String((req.body as any)[key] ?? "");
            if (oldVal !== newVal) changes.push({ field: key, label, oldValue: oldVal || "—", newValue: newVal || "—" });
          }
        }
        if (changes.length > 0) {
          const changer = req.session.userId ? await storage.getUser(req.session.userId) : null;
          const leadName = updated.fullName || [updated.firstName, updated.lastName].filter(Boolean).join(" ") || "—";
          sendLeadChangeNotification({
            leadId: updated.id, leadName, leadPhone: updated.phone ?? "—",
            changedBy: changer?.username ?? "Unknown", changedAt: new Date(), changes,
            comment: _comment || undefined,
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/admin/crm/leads/:id/rescore — manually trigger AI re-scoring (admin only) */
  app.post("/api/admin/crm/leads/:id/rescore", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const leadId = Number(req.params.id);
      const { scoreAndSaveLead } = await import("./aiLeadScoringService");
      await scoreAndSaveLead(leadId);
      const updated = await storage.getCrmLead(leadId);
      if (!updated) return res.status(404).json({ message: "Lead not found" });
      res.json({
        success: true,
        aiScore:         (updated as any).ai_score,
        aiScoreCategory: (updated as any).ai_score_category,
        aiScoreReason:   (updated as any).ai_score_reason,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** DELETE /api/admin/crm/leads/:id — hard delete */
  app.delete("/api/admin/crm/leads/:id", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const ok = await storage.deleteCrmLead(Number(req.params.id));
      if (!ok) return res.status(404).json({ message: "Lead not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /**
   * POST /api/admin/crm/leads/:id/reassign
   * Reassign a lead to a different admin or sub_agent.
   * Both admin and sub_agent may call this endpoint.
   * Sub-agent rules (backend-enforced):
   *   - Lead must currently be assigned to the calling sub-agent.
   *   - targetId must be an admin or sub_agent user (not a regular user).
   *   - targetId cannot be null (sub-agents cannot set Unassigned).
   *   - comment is mandatory.
   * Admin rules:
   *   - May reassign any lead to any admin or sub_agent.
   *   - May set targetId = null (Unassigned).
   *   - comment is optional.
   * Always saves a [Reassignment] timeline note with old/new assignee, comment, changer, timestamp.
   */
  app.post("/api/admin/crm/leads/:id/reassign", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    const leadId = Number(req.params.id);
    const { targetId, comment } = req.body as { targetId: number | null; comment?: string };
    const trimmedComment = (comment ?? "").trim();

    try {
      const { db } = await import("./db");
      const { users } = await import("../shared/schema");
      const { eq } = await import("drizzle-orm");

      // Fetch current lead (needed for access check + old assignee name)
      const currentLead = await storage.getCrmLead(leadId);
      if (!currentLead) return res.status(404).json({ message: "Lead not found" });

      // Sub-agent specific enforcement
      if (!req.session.isAdmin) {
        // Must own the lead
        if (currentLead.assignedTo !== req.session.userId) {
          return res.status(403).json({ message: "You can only transfer leads assigned to you" });
        }
        // Cannot set Unassigned
        if (targetId == null) {
          return res.status(403).json({ message: "Sub-agents cannot set a lead to Unassigned" });
        }
        // Comment is required
        if (!trimmedComment) {
          return res.status(400).json({ message: "A transfer comment is required" });
        }
      }

      // Validate target user (if not Unassigned)
      let targetUser: { id: number; username: string; isAdmin: boolean | null; role: string | null } | null = null;
      if (targetId != null) {
        const [target] = await db
          .select({ id: users.id, username: users.username, isAdmin: users.isAdmin, role: users.role })
          .from(users)
          .where(eq(users.id, Number(targetId)));
        if (!target || (!target.isAdmin && target.role !== "sub_agent")) {
          return res.status(400).json({ message: "Leads can only be assigned to admin or sub_agent users" });
        }
        targetUser = target;
      }

      // Resolve names for timeline note
      const oldAssigneeName = currentLead.assigneeName ??
        (currentLead.assignedTo
          ? (await storage.getUser(currentLead.assignedTo))?.username ?? String(currentLead.assignedTo)
          : "Unassigned");
      const newAssigneeName = targetUser?.username ?? "Unassigned";
      const changer = req.session.userId ? await storage.getUser(req.session.userId) : null;
      const changerName = changer?.username ?? "Unknown";

      // Perform the reassignment
      const updated = await storage.updateCrmLead(leadId, { assignedTo: targetUser ? targetUser.id : null });
      if (!updated) return res.status(404).json({ message: "Lead not found" });

      // Save [Reassignment] timeline note (always)
      const commentLine = trimmedComment ? `\nComment: ${trimmedComment}` : "";
      await storage.addCrmNote({
        leadId,
        userId: req.session.userId ?? null,
        note: `[Reassignment] ${oldAssigneeName} → ${newAssigneeName}${commentLine}\nChanged by: ${changerName}`,
      });

      res.json(updated);
      // Notify the newly assigned agent
      if (targetUser) {
        import("./leadAssignmentNotificationService").then(({ notifyAgentOfLeadAssignment }) =>
          notifyAgentOfLeadAssignment({
            leadId: updated.id, leadName: updated.fullName, leadPhone: updated.phone,
            leadEmail: updated.email, leadSource: updated.leadSource,
            assignedToUserId: targetUser.id, context: "reassigned",
          })
        ).catch(() => {});
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/admin/crm/leads/:id/notes — add a note to a lead */
  app.post("/api/admin/crm/leads/:id/notes", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    const _notesOnlyNoteIds = [24, 29];
    if (!req.session.isAdmin && !_notesOnlyNoteIds.includes(req.session.userId) && !await canAccessLead(req, Number(req.params.id)))
      return res.status(403).json({ message: "Access denied: lead not assigned to you" });
    try {
      const { note } = req.body;
      if (!note?.trim()) return res.status(400).json({ message: "Note text is required" });
      const created = await storage.addCrmNote({
        leadId: Number(req.params.id),
        userId: req.session.userId ?? null,
        note: note.trim(),
      });
      res.status(201).json(created);
      // Status-change notes carry the change reason — send admin notification for sub-admin changes
      if (!req.session.isAdmin && note.trim().startsWith("[Status Change]")) {
        try {
          const firstLine = note.trim().split("\n")[0]; // "[Status Change] OldLabel → NewLabel"
          const statusPart = firstLine.replace(/^\[Status Change\]\s*/, ""); // "OldLabel → NewLabel"
          const [oldStatus, newStatus] = statusPart.split(" → ").map((s: string) => s.trim());
          const reasonLine = note.trim().split("\n").slice(1).join("\n");
          const reason = reasonLine.replace(/^Note:\s*/i, "").trim() || undefined;
          const lead = await storage.getCrmLead(Number(req.params.id));
          const changer = req.session.userId ? await storage.getUser(req.session.userId) : null;
          const leadName = lead ? (lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—") : "—";
          sendLeadChangeNotification({
            leadId: Number(req.params.id), leadName, leadPhone: lead?.phone ?? "—",
            changedBy: changer?.username ?? "Unknown", changedAt: new Date(),
            changes: [{ field: "status", label: "Status", oldValue: oldStatus || "—", newValue: newStatus || "—" }],
            statusChangeNote: reason,
          }).catch(() => {});
        } catch { /* non-critical */ }
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** PATCH /api/admin/crm/leads/:leadId/notes/:noteId — edit own manual note */
  app.patch("/api/admin/crm/leads/:leadId/notes/:noteId", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    const leadId = Number(req.params.leadId);
    const noteId = Number(req.params.noteId);
    const { note: newText } = req.body;
    if (!newText?.trim()) return res.status(400).json({ message: "Note text cannot be blank" });
    try {
      const { db } = await import("./db");
      // Load note — confirm it exists and belongs to this lead
      const rows = await db.execute(
        `SELECT id, lead_id, user_id, note FROM crm_notes WHERE id = $1 AND lead_id = $2 LIMIT 1`,
        [noteId, leadId]
      ) as any;
      const row = rows?.rows?.[0] ?? rows?.[0] ?? null;
      if (!row) return res.status(404).json({ message: "Note not found" });
      // Ownership: only the creator may edit
      if (row.user_id !== req.session.userId) return res.status(403).json({ message: "You can only edit your own notes" });
      // Block editing system/auto entries
      const text: string = row.note ?? "";
      if (text.startsWith("[Status Change]") || text.startsWith("[Reassignment]") || text.startsWith("[Updated]")) {
        return res.status(403).json({ message: "System notes cannot be edited" });
      }
      await db.execute(
        `UPDATE crm_notes SET note = $1 WHERE id = $2`,
        [newText.trim(), noteId]
      );
      const updated = await db.execute(
        `SELECT id, lead_id AS "leadId", user_id AS "userId", note, created_at AS "createdAt" FROM crm_notes WHERE id = $1`,
        [noteId]
      ) as any;
      const updatedRow = updated?.rows?.[0] ?? updated?.[0] ?? { id: noteId, leadId, note: newText.trim() };
      res.json(updatedRow);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Sub-Agent Management ─────────────────────────────────────────────────

  /** GET /api/admin/crm/assignable-agents — list users who can be assigned leads (admins + sub_agents only) */
  app.get("/api/admin/crm/assignable-agents", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const { db } = await import("./db");
      const { users } = await import("../shared/schema");
      const { or, eq } = await import("drizzle-orm");
      const agents = await db
        .select({ id: users.id, username: users.username, role: users.role })
        .from(users)
        .where(or(eq(users.isAdmin, true), eq(users.role, "sub_agent")));
      res.json(agents);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** GET /api/admin/crm/sub-agents — list all sub-agent accounts */
  app.get("/api/admin/crm/sub-agents", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const { db } = await import("./db");
      const { users } = await import("../shared/schema");
      const { eq } = await import("drizzle-orm");
      const agents = await db
        .select({ id: users.id, username: users.username, email: users.email })
        .from(users)
        .where(eq(users.role, "sub_agent"));
      res.json(agents);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** DELETE /api/admin/crm/sub-agents/:id — remove a sub-agent account */
  app.delete("/api/admin/crm/sub-agents/:id", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const { db } = await import("./db");
      const { users } = await import("../shared/schema");
      const { eq, and } = await import("drizzle-orm");
      await db.delete(users)
        .where(and(eq(users.id, Number(req.params.id)), eq(users.role, "sub_agent")));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/admin/crm/sub-agents — create a new sub-agent account */
  app.post("/api/admin/crm/sub-agents", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const { username, email, password } = req.body;
      if (!username?.trim()) return res.status(400).json({ message: "Username is required" });
      if (!password || password.length < 6)
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      const hashedPassword = await bcrypt.hash(password, 10);
      const agent = await storage.createUser({
        username: username.trim(),
        password: hashedPassword,
        email: email?.trim() || null,
        phoneNumber: null,
        whatsappNumber: null,
        facebookId: null,
        authMethod: "email",
        isAdmin: false,
        isVerified: true,
        role: "sub_agent",
      });
      res.status(201).json({ id: agent.id, username: agent.username, email: agent.email, role: agent.role });
    } catch (err: any) {
      if ((err as any).code === "23505")
        return res.status(400).json({ message: "Username or email already exists" });
      res.status(500).json({ message: err.message });
    }
  });

  // ── OTP Security Admin Endpoints ──────────────────────────────────────────

  /** GET /api/admin/otp-logs — returns recent OTP log entries + blocked IP list */
  app.get("/api/admin/otp-logs", isAuthenticated, isAdmin, async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
    res.json({
      logs: [...otpLogs].reverse(), // newest first
      blockedIPs: Array.from(blockedIPs),
    });
  });

  /** POST /api/admin/otp-block — manually block an IP address */
  app.post("/api/admin/otp-block", isAuthenticated, isAdmin, async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
    const { ip } = req.body;
    if (!ip || typeof ip !== 'string') return res.status(400).json({ message: "IP address required" });
    blockedIPs.add(ip.trim());
    console.log(`[OTP Security] Admin manually blocked IP: ${ip.trim()}`);
    res.json({ success: true, blockedIPs: Array.from(blockedIPs) });
  });

  /** DELETE /api/admin/otp-block/:ip — unblock an IP address */
  app.delete("/api/admin/otp-block/:ip", isAuthenticated, isAdmin, async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
    const target = decodeURIComponent(req.params.ip);
    blockedIPs.delete(target);
    console.log(`[OTP Security] Admin unblocked IP: ${target}`);
    res.json({ success: true, blockedIPs: Array.from(blockedIPs) });
  });

  // ── One-time startup: backfill country for leads that have a phone but no country ──
  // Runs silently in the background after server starts; never blocks startup.
  setImmediate(async () => {
    try {
      const rows = await pool.query<{ id: number; phone: string }>(
        "SELECT id, phone FROM crm_leads WHERE (country IS NULL OR country = '') AND phone IS NOT NULL AND phone != '' ORDER BY id ASC"
      );
      if (rows.rows.length === 0) return;
      let backfilled = 0;
      for (const row of rows.rows) {
        const result = vPhone(row.phone);
        if (result.valid && result.country) {
          await pool.query(
            "UPDATE crm_leads SET country=$1, updated_at=NOW() WHERE id=$2 AND (country IS NULL OR country = '')",
            [result.country, row.id]
          );
          backfilled++;
        }
      }
      if (backfilled > 0) {
        console.log(`[CountryBackfill] Auto-detected country for ${backfilled} lead(s) from phone prefix`);
      }
    } catch (err: any) {
      console.error(`[CountryBackfill] Failed: ${err.message}`);
    }
  });

  // ── AI Marketing Center routes ────────────────────────────────────────────

  // Campaign Plans
  app.get("/api/admin/ai-marketing/campaign-plans", isAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM ai_marketing_campaign_plans ORDER BY created_at DESC"
      );
      res.json(rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/ai-marketing/campaign-plans", isAdmin, async (req, res) => {
    try {
      const { name, related_project_id, related_property_id, target_country,
              language, daily_budget, objective, status, notes } = req.body;
      if (!name) return res.status(400).json({ error: "name is required" });
      const { rows } = await pool.query(
        `INSERT INTO ai_marketing_campaign_plans
          (name, related_project_id, related_property_id, target_country, language,
           daily_budget, objective, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [name, related_project_id||null, related_property_id||null,
         target_country||null, language||null, daily_budget||null,
         objective||"Lead Form", status||"draft", notes||null]
      );
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/admin/ai-marketing/campaign-plans/:id", isAdmin, async (req, res) => {
    try {
      const { name, related_project_id, related_property_id, target_country,
              language, daily_budget, objective, status, notes } = req.body;
      const { rows } = await pool.query(
        `UPDATE ai_marketing_campaign_plans SET
          name=$1, related_project_id=$2, related_property_id=$3,
          target_country=$4, language=$5, daily_budget=$6,
          objective=$7, status=$8, notes=$9, updated_at=NOW()
         WHERE id=$10 RETURNING *`,
        [name, related_project_id||null, related_property_id||null,
         target_country||null, language||null, daily_budget||null,
         objective||"Lead Form", status||"draft", notes||null, Number(req.params.id)]
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/ai-marketing/campaign-plans/:id", isAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM ai_marketing_campaign_plans WHERE id=$1", [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Creatives
  app.get("/api/admin/ai-marketing/creatives", isAdmin, async (req, res) => {
    try {
      const cpId = req.query.campaign_plan_id;
      const q = cpId
        ? await pool.query("SELECT * FROM ai_marketing_creatives WHERE campaign_plan_id=$1 ORDER BY created_at DESC", [cpId])
        : await pool.query("SELECT * FROM ai_marketing_creatives ORDER BY created_at DESC");
      res.json(q.rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/ai-marketing/creatives", isAdmin, async (req, res) => {
    try {
      const { campaign_plan_id, primary_text, headline, description, image_notes, video_notes } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO ai_marketing_creatives
          (campaign_plan_id, primary_text, headline, description, image_notes, video_notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [campaign_plan_id||null, primary_text||null, headline||null,
         description||null, image_notes||null, video_notes||null]
      );
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/admin/ai-marketing/creatives/:id", isAdmin, async (req, res) => {
    try {
      const { campaign_plan_id, primary_text, headline, description, image_notes, video_notes } = req.body;
      const { rows } = await pool.query(
        `UPDATE ai_marketing_creatives SET
          campaign_plan_id=$1, primary_text=$2, headline=$3,
          description=$4, image_notes=$5, video_notes=$6, updated_at=NOW()
         WHERE id=$7 RETURNING *`,
        [campaign_plan_id||null, primary_text||null, headline||null,
         description||null, image_notes||null, video_notes||null, Number(req.params.id)]
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/ai-marketing/creatives/:id", isAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM ai_marketing_creatives WHERE id=$1", [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Audiences
  app.get("/api/admin/ai-marketing/audiences", isAdmin, async (req, res) => {
    try {
      const cpId = req.query.campaign_plan_id;
      const q = cpId
        ? await pool.query("SELECT * FROM ai_marketing_audiences WHERE campaign_plan_id=$1 ORDER BY created_at DESC", [cpId])
        : await pool.query("SELECT * FROM ai_marketing_audiences ORDER BY created_at DESC");
      res.json(q.rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/ai-marketing/audiences", isAdmin, async (req, res) => {
    try {
      const { campaign_plan_id, country, city_region, language, age_min, age_max,
              interests, exclusions, notes } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO ai_marketing_audiences
          (campaign_plan_id, country, city_region, language, age_min, age_max, interests, exclusions, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [campaign_plan_id||null, country||null, city_region||null,
         language||null, age_min||18, age_max||65,
         interests||null, exclusions||null, notes||null]
      );
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/admin/ai-marketing/audiences/:id", isAdmin, async (req, res) => {
    try {
      const { campaign_plan_id, country, city_region, language, age_min, age_max,
              interests, exclusions, notes } = req.body;
      const { rows } = await pool.query(
        `UPDATE ai_marketing_audiences SET
          campaign_plan_id=$1, country=$2, city_region=$3, language=$4,
          age_min=$5, age_max=$6, interests=$7, exclusions=$8, notes=$9, updated_at=NOW()
         WHERE id=$10 RETURNING *`,
        [campaign_plan_id||null, country||null, city_region||null,
         language||null, age_min||18, age_max||65,
         interests||null, exclusions||null, notes||null, Number(req.params.id)]
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/ai-marketing/audiences/:id", isAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM ai_marketing_audiences WHERE id=$1", [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Performance Snapshots
  app.get("/api/admin/ai-marketing/performance", isAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM ai_marketing_performance_snapshots ORDER BY created_at DESC"
      );
      res.json(rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/ai-marketing/performance", isAdmin, async (req, res) => {
    try {
      const f = req.body;
      const { rows } = await pool.query(
        `INSERT INTO ai_marketing_performance_snapshots
          (campaign_plan_id, meta_campaign_id, meta_ad_set_id, meta_ad_id,
           campaign_name, ad_set_name, ad_name, spend, leads_count, cpl, ctr, cpc,
           hot_leads, warm_leads, cold_leads, no_answer_count, appointments_count,
           sales_count, cost_per_hot_lead, cost_per_appointment, cost_per_sale, snapshot_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING *`,
        [f.campaign_plan_id||null, f.meta_campaign_id||null, f.meta_ad_set_id||null,
         f.meta_ad_id||null, f.campaign_name||null, f.ad_set_name||null, f.ad_name||null,
         f.spend||0, f.leads_count||0, f.cpl||0, f.ctr||0, f.cpc||0,
         f.hot_leads||0, f.warm_leads||0, f.cold_leads||0, f.no_answer_count||0,
         f.appointments_count||0, f.sales_count||0,
         f.cost_per_hot_lead||0, f.cost_per_appointment||0, f.cost_per_sale||0,
         f.snapshot_date||null]
      );
      const snap = rows[0];
      // Auto-generate rule-based recommendations
      const recs: {type:string; title:string; message:string; severity:string}[] = [];
      const spend = Number(snap.spend), hot = Number(snap.hot_leads),
            leads = Number(snap.leads_count), ctr = Number(snap.ctr),
            noAns = Number(snap.no_answer_count), cphl = Number(snap.cost_per_hot_lead);
      if (spend > 30 && hot === 0)
        recs.push({ type:"pause_ad", title:"⚠️ Stop Weak Ad",
          message:`Spent $${spend} with zero HOT leads — consider pausing this ad.`, severity:"critical" });
      if (cphl > 0 && cphl < 20)
        recs.push({ type:"increase_budget", title:"💰 Increase Budget",
          message:`Cost per HOT lead is only $${cphl} — great ROI, consider increasing daily budget.`, severity:"info" });
      if (leads > 5 && noAns > leads * 0.5)
        recs.push({ type:"lead_form", title:"📋 High No-Answer Rate",
          message:"Over 50% of leads are not answering — consider improving lead form questions.", severity:"warning" });
      if (spend > 10 && ctr < 1)
        recs.push({ type:"new_creative", title:"🎨 Low CTR — New Creative Needed",
          message:`CTR is ${ctr}% — try a new creative variation to improve click-through.`, severity:"warning" });
      if (hot > 0 && leads > 0 && (hot/leads) > 0.3)
        recs.push({ type:"scale", title:"🔥 Great HOT Lead Ratio",
          message:`${Math.round((hot/leads)*100)}% HOT leads — this audience is performing well, consider scaling.`, severity:"info" });
      for (const r of recs) {
        await pool.query(
          `INSERT INTO ai_marketing_recommendations
            (performance_snapshot_id, type, title, message, severity)
           VALUES ($1,$2,$3,$4,$5)`,
          [snap.id, r.type, r.title, r.message, r.severity]
        );
      }
      res.json(snap);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/ai-marketing/performance/:id", isAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM ai_marketing_performance_snapshots WHERE id=$1", [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Recommendations
  app.get("/api/admin/ai-marketing/recommendations", isAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM ai_marketing_recommendations WHERE is_dismissed=FALSE ORDER BY created_at DESC"
      );
      res.json(rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/admin/ai-marketing/recommendations/:id/dismiss", isAdmin, async (req, res) => {
    try {
      await pool.query(
        "UPDATE ai_marketing_recommendations SET is_dismissed=TRUE WHERE id=$1",
        [Number(req.params.id)]
      );
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Safety Settings (singleton row id=1)
  app.get("/api/admin/ai-marketing/safety-settings", isAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM ai_marketing_safety_settings WHERE id=1");
      res.json(rows[0] || {
        manual_approval_required: true, auto_launch: false, auto_pause: false,
        auto_budget_increase: false, max_daily_budget_limit: 100, require_admin_confirmation: true
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/admin/ai-marketing/safety-settings", isAdmin, async (req, res) => {
    try {
      const { manual_approval_required, auto_launch, auto_pause, auto_budget_increase,
              max_daily_budget_limit, require_admin_confirmation } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO ai_marketing_safety_settings
          (id, manual_approval_required, auto_launch, auto_pause,
           auto_budget_increase, max_daily_budget_limit, require_admin_confirmation, updated_at)
         VALUES (1,$1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (id) DO UPDATE SET
          manual_approval_required=$1, auto_launch=$2, auto_pause=$3,
          auto_budget_increase=$4, max_daily_budget_limit=$5,
          require_admin_confirmation=$6, updated_at=NOW()
         RETURNING *`,
        [manual_approval_required??true, auto_launch??false, auto_pause??false,
         auto_budget_increase??false, max_daily_budget_limit??100, require_admin_confirmation??true]
      );
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── AI Marketing Revenue Intelligence routes ─────────────────────────────

  // Lead Attribution
  app.get("/api/admin/ai-marketing/attribution", isAdmin, async (req, res) => {
    try {
      const leadId = req.query.lead_id;
      const q = leadId
        ? await pool.query("SELECT * FROM ai_marketing_lead_attribution WHERE lead_id=$1 ORDER BY created_at DESC", [leadId])
        : await pool.query("SELECT * FROM ai_marketing_lead_attribution ORDER BY created_at DESC LIMIT 200");
      res.json(q.rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/ai-marketing/attribution", isAdmin, async (req, res) => {
    try {
      const f = req.body;
      if (!f.lead_id) return res.status(400).json({ error: "lead_id required" });
      const { rows } = await pool.query(
        `INSERT INTO ai_marketing_lead_attribution
          (lead_id, source_type, meta_campaign_id, meta_campaign_name, meta_adset_id,
           meta_adset_name, meta_ad_id, meta_ad_name, creative_name, audience_name,
           language, country, city, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [f.lead_id, f.source_type||"meta_lead", f.meta_campaign_id||null,
         f.meta_campaign_name||null, f.meta_adset_id||null, f.meta_adset_name||null,
         f.meta_ad_id||null, f.meta_ad_name||null, f.creative_name||null,
         f.audience_name||null, f.language||null, f.country||null, f.city||null, f.notes||null]
      );
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/admin/ai-marketing/attribution/:id", isAdmin, async (req, res) => {
    try {
      const f = req.body;
      const { rows } = await pool.query(
        `UPDATE ai_marketing_lead_attribution SET
          source_type=$1, meta_campaign_id=$2, meta_campaign_name=$3, meta_adset_id=$4,
          meta_adset_name=$5, meta_ad_id=$6, meta_ad_name=$7, creative_name=$8,
          audience_name=$9, language=$10, country=$11, city=$12, notes=$13, updated_at=NOW()
         WHERE id=$14 RETURNING *`,
        [f.source_type||"meta_lead", f.meta_campaign_id||null, f.meta_campaign_name||null,
         f.meta_adset_id||null, f.meta_adset_name||null, f.meta_ad_id||null, f.meta_ad_name||null,
         f.creative_name||null, f.audience_name||null, f.language||null,
         f.country||null, f.city||null, f.notes||null, Number(req.params.id)]
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/ai-marketing/attribution/:id", isAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM ai_marketing_lead_attribution WHERE id=$1", [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Sales Outcomes (upsert per lead_id)
  app.get("/api/admin/ai-marketing/sales-outcomes", isAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM ai_marketing_sales_outcomes ORDER BY updated_at DESC LIMIT 200"
      );
      res.json(rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/ai-marketing/sales-outcomes", isAdmin, async (req, res) => {
    try {
      const f = req.body;
      if (!f.lead_id) return res.status(400).json({ error: "lead_id required" });
      const { rows } = await pool.query(
        `INSERT INTO ai_marketing_sales_outcomes
          (lead_id, appointment_scheduled, appointment_date, site_visit_completed,
           sale_closed, sale_amount, sale_currency, sale_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (lead_id) DO UPDATE SET
          appointment_scheduled=$2, appointment_date=$3, site_visit_completed=$4,
          sale_closed=$5, sale_amount=$6, sale_currency=$7, sale_date=$8,
          notes=$9, updated_at=NOW()
         RETURNING *`,
        [f.lead_id, f.appointment_scheduled??false, f.appointment_date||null,
         f.site_visit_completed??false, f.sale_closed??false,
         f.sale_amount||0, f.sale_currency||"USD", f.sale_date||null, f.notes||null]
      );
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/ai-marketing/sales-outcomes/:id", isAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM ai_marketing_sales_outcomes WHERE id=$1", [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Journey Events
  app.get("/api/admin/ai-marketing/journey-events", isAdmin, async (req, res) => {
    try {
      const leadId = req.query.lead_id;
      const q = leadId
        ? await pool.query("SELECT * FROM ai_marketing_lead_journey_events WHERE lead_id=$1 ORDER BY event_time DESC", [leadId])
        : await pool.query("SELECT * FROM ai_marketing_lead_journey_events ORDER BY created_at DESC LIMIT 100");
      res.json(q.rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/ai-marketing/journey-events", isAdmin, async (req, res) => {
    try {
      const { lead_id, event_type, event_time, old_value, new_value, created_by, notes } = req.body;
      if (!lead_id || !event_type) return res.status(400).json({ error: "lead_id and event_type required" });
      const { rows } = await pool.query(
        `INSERT INTO ai_marketing_lead_journey_events
          (lead_id, event_type, event_time, old_value, new_value, created_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [lead_id, event_type, event_time||new Date(), old_value||null,
         new_value||null, created_by||null, notes||null]
      );
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Quality Snapshots
  app.get("/api/admin/ai-marketing/quality-snapshots", isAdmin, async (req, res) => {
    try {
      const leadId = req.query.lead_id;
      const q = leadId
        ? await pool.query("SELECT * FROM ai_marketing_quality_snapshots WHERE lead_id=$1 ORDER BY snapshot_time DESC", [leadId])
        : await pool.query("SELECT * FROM ai_marketing_quality_snapshots ORDER BY created_at DESC LIMIT 100");
      res.json(q.rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/ai-marketing/quality-snapshots", isAdmin, async (req, res) => {
    try {
      const { lead_id, lead_score, lead_temperature, lead_status, no_answer_count,
              qualification_completed, whatsapp_started, whatsapp_completed, snapshot_time } = req.body;
      if (!lead_id) return res.status(400).json({ error: "lead_id required" });
      const { rows } = await pool.query(
        `INSERT INTO ai_marketing_quality_snapshots
          (lead_id, lead_score, lead_temperature, lead_status, no_answer_count,
           qualification_completed, whatsapp_started, whatsapp_completed, snapshot_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [lead_id, lead_score||null, lead_temperature||null, lead_status||null,
         no_answer_count||0, qualification_completed??false,
         whatsapp_started??false, whatsapp_completed??false, snapshot_time||new Date()]
      );
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Learning History
  app.get("/api/admin/ai-marketing/learning-history", isAdmin, async (req, res) => {
    try {
      const entityType = req.query.entity_type as string | undefined;
      const q = entityType
        ? await pool.query("SELECT * FROM ai_marketing_learning_history WHERE entity_type=$1 ORDER BY updated_at DESC", [entityType])
        : await pool.query("SELECT * FROM ai_marketing_learning_history ORDER BY updated_at DESC LIMIT 200");
      res.json(q.rows);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/admin/ai-marketing/learning-history", isAdmin, async (req, res) => {
    try {
      const f = req.body;
      if (!f.entity_type || !f.entity_name) return res.status(400).json({ error: "entity_type and entity_name required" });
      const { rows } = await pool.query(
        `INSERT INTO ai_marketing_learning_history
          (entity_type, entity_name, entity_id, leads_count, hot_count, warm_count, cold_count,
           no_answer_count, appointments_count, sales_count, revenue_total, spend, cpl,
           cost_per_hot_lead, cost_per_appointment, cost_per_sale, quality_score,
           period_start, period_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING *`,
        [f.entity_type, f.entity_name, f.entity_id||null,
         f.leads_count||0, f.hot_count||0, f.warm_count||0, f.cold_count||0,
         f.no_answer_count||0, f.appointments_count||0, f.sales_count||0,
         f.revenue_total||0, f.spend||0, f.cpl||0,
         f.cost_per_hot_lead||0, f.cost_per_appointment||0, f.cost_per_sale||0,
         f.quality_score||0, f.period_start||null, f.period_end||null]
      );
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.patch("/api/admin/ai-marketing/learning-history/:id", isAdmin, async (req, res) => {
    try {
      const f = req.body;
      const { rows } = await pool.query(
        `UPDATE ai_marketing_learning_history SET
          entity_type=$1, entity_name=$2, entity_id=$3,
          leads_count=$4, hot_count=$5, warm_count=$6, cold_count=$7,
          no_answer_count=$8, appointments_count=$9, sales_count=$10,
          revenue_total=$11, spend=$12, cpl=$13, cost_per_hot_lead=$14,
          cost_per_appointment=$15, cost_per_sale=$16, quality_score=$17,
          period_start=$18, period_end=$19, updated_at=NOW()
         WHERE id=$20 RETURNING *`,
        [f.entity_type, f.entity_name, f.entity_id||null,
         f.leads_count||0, f.hot_count||0, f.warm_count||0, f.cold_count||0,
         f.no_answer_count||0, f.appointments_count||0, f.sales_count||0,
         f.revenue_total||0, f.spend||0, f.cpl||0,
         f.cost_per_hot_lead||0, f.cost_per_appointment||0, f.cost_per_sale||0,
         f.quality_score||0, f.period_start||null, f.period_end||null, Number(req.params.id)]
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/admin/ai-marketing/learning-history/:id", isAdmin, async (req, res) => {
    try {
      await pool.query("DELETE FROM ai_marketing_learning_history WHERE id=$1", [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Revenue Dashboard — aggregate summary
  app.get("/api/admin/ai-marketing/revenue-dashboard", isAdmin, async (_req, res) => {
    try {
      const [attrib, sales, learning] = await Promise.all([
        pool.query("SELECT COUNT(*) AS total_attributed, source_type, COUNT(*) AS cnt FROM ai_marketing_lead_attribution GROUP BY source_type ORDER BY cnt DESC"),
        pool.query(`SELECT COUNT(*) AS total, SUM(CASE WHEN appointment_scheduled THEN 1 ELSE 0 END) AS appts,
          SUM(CASE WHEN site_visit_completed THEN 1 ELSE 0 END) AS visits,
          SUM(CASE WHEN sale_closed THEN 1 ELSE 0 END) AS sales,
          SUM(sale_amount) AS revenue FROM ai_marketing_sales_outcomes`),
        pool.query("SELECT entity_type, entity_name, leads_count, hot_count, warm_count, cold_count, no_answer_count, appointments_count, sales_count, revenue_total, spend, cost_per_hot_lead, cost_per_sale FROM ai_marketing_learning_history ORDER BY hot_count DESC LIMIT 50"),
      ]);
      const s = sales.rows[0];
      res.json({
        attribution_by_source: attrib.rows,
        totals: {
          total_leads_attributed: Number(s?.total || 0),
          appointments: Number(s?.appts || 0),
          site_visits: Number(s?.visits || 0),
          sales: Number(s?.sales || 0),
          revenue: Number(s?.revenue || 0),
        },
        learning_history: learning.rows,
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Revenue Recommendations — rule-based from learning_history (with cost evidence)
  app.get("/api/admin/ai-marketing/revenue-recommendations", isAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM ai_marketing_learning_history ORDER BY updated_at DESC LIMIT 100"
      );
      const recs: { type: string; title: string; message: string; severity: string; entity: string }[] = [];
      for (const r of rows) {
        const leads = Number(r.leads_count), hot   = Number(r.hot_count),
              warm  = Number(r.warm_count),  cold  = Number(r.cold_count),
              noAns = Number(r.no_answer_count),
              sales = Number(r.sales_count), revenue = Number(r.revenue_total),
              spend = Number(r.spend),       cphl  = Number(r.cost_per_hot_lead),
              qs    = Number(r.quality_score);
        const entity = `${r.entity_type}: ${r.entity_name}`;

        // ── Cost evidence helpers ─────────────────────────────────────────────
        const $s  = (v: number) => `$${v.toFixed(2)}`;
        const spendLine = spend > 0 ? ` Spent ${$s(spend)}.` : "";
        const cplLine   = spend > 0 && leads > 0 ? ` CPL = ${$s(spend/leads)}.` : "";
        const cphlLine  = spend > 0 && hot  > 0 ? ` Cost per HOT Lead = ${$s(spend/hot)}.`
                        : spend > 0 && hot === 0 ? " Cost per HOT Lead = ∞ (no HOT leads)." : "";
        const cpwLine   = spend > 0 && warm > 0 ? ` Cost per WARM Lead = ${$s(spend/warm)}.` : "";
        const cpcLine   = spend > 0 && cold > 0 ? ` Cost per COLD Lead = ${$s(spend/cold)}.` : "";
        const cpnaLine  = spend > 0 && noAns> 0 ? ` Cost per No Answer = ${$s(spend/noAns)}.` : "";
        const qsLine    = qs   > 0              ? ` Quality Score: ${qs.toFixed(1)}.`         : "";

        if (leads > 5 && noAns > leads * 0.5)
          recs.push({ type:"high_no_answer", title:"📋 High No-Answer Rate", severity:"warning",
            message:`${entity} has ${noAns}/${leads} leads (${Math.round((noAns/leads)*100)}%) not answering.${spendLine}${cpnaLine} Consider changing lead form questions or contact strategy.`, entity });

        if (hot > 0 && leads > 0 && (hot/leads) > 0.3)
          recs.push({ type:"scale", title:"🔥 Strong HOT Lead Ratio", severity:"info",
            message:`${entity} has ${hot}/${leads} HOT leads (${Math.round((hot/leads)*100)}%).${spendLine}${cphlLine} Consider increasing budget manually.`, entity });

        if (leads > 10 && sales === 0)
          recs.push({ type:"review_quality", title:"⚠️ High Leads, Zero Sales", severity:"warning",
            message:`${entity} generated ${leads} leads but no sales.${spendLine}${cplLine} Review audience quality.`, entity });

        if (revenue > 0 && spend > 0 && (revenue/spend) > 5)
          recs.push({ type:"strong_roas", title:"💰 Strong ROAS", severity:"info",
            message:`${entity} shows ${(revenue/spend).toFixed(1)}x ROAS.${spendLine}${cphlLine} Scale this campaign manually.`, entity });

        if (warm > hot * 2 && leads > 5)
          recs.push({ type:"conversion", title:"🟡 Many WARM Leads Unconverted", severity:"warning",
            message:`${entity} has ${warm} WARM vs ${hot} HOT leads.${spendLine}${cpwLine} Improve follow-up to convert warm leads.`, entity });

        if (cphl > 0 && cphl < 15 && hot > 0)
          recs.push({ type:"low_cphl", title:"✅ Low Cost per HOT Lead", severity:"info",
            message:`${entity} costs ${$s(cphl)} per HOT lead.${cplLine}${qsLine} Excellent efficiency — consider increasing budget manually.`, entity });

        if (spend > 0 && hot === 0 && leads > 3)
          recs.push({ type:"zero_hot_spend", title:"🚫 Budget Spent with No HOT Leads", severity:"critical",
            message:`${entity} spent ${$s(spend)} generating ${leads} leads but zero HOT leads.${cplLine}${cpcLine} Review this campaign's creative and audience urgently.`, entity });
      }
      res.json(recs.slice(0, 20));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/admin/ai-marketing/cost-intelligence — ranked cost metrics from learning_history
  // Read-only. Admin only. No Meta writes. Railway compatible.
  app.get("/api/admin/ai-marketing/cost-intelligence", isAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT entity_type, entity_name, leads_count, hot_count, warm_count, cold_count,
               no_answer_count, spend, cpl, cost_per_hot_lead, cost_per_appointment,
               cost_per_sale, quality_score
        FROM ai_marketing_learning_history
        WHERE leads_count > 0
        ORDER BY updated_at DESC LIMIT 100
      `);

      if (rows.length === 0) return res.json({ insufficient: true, allRows: [], bestCphl: null, worstCphl: null, bestCpl: null, highestNoAnswerCost: null, bestQuality: null, worstQuality: null });

      const enriched = rows.map((r: any) => {
        const leads = Number(r.leads_count), hot = Number(r.hot_count),
              warm  = Number(r.warm_count),  cold = Number(r.cold_count),
              noAns = Number(r.no_answer_count), spend = Number(r.spend),
              cphlStored = Number(r.cost_per_hot_lead), qs = Number(r.quality_score);
        return {
          entityType:       r.entity_type,
          entityName:       r.entity_name,
          leadsCount:       leads, hotCount: hot, warmCount: warm, coldCount: cold, noAnswerCount: noAns,
          spend,
          cpl:              spend > 0 && leads > 0 ? spend / leads           : null,
          costPerHotLead:   cphlStored > 0          ? cphlStored             : spend > 0 && hot  > 0 ? spend / hot  : null,
          costPerWarmLead:  spend > 0 && warm > 0   ? spend / warm           : null,
          costPerColdLead:  spend > 0 && cold > 0   ? spend / cold           : null,
          costPerNoAnswer:  spend > 0 && noAns > 0  ? spend / noAns          : null,
          qualityScore:     qs > 0                  ? qs                     : null,
        };
      });

      const withSpend = enriched.filter((r: any) => r.spend > 0);
      const withCphl  = withSpend.filter((r: any) => r.costPerHotLead !== null);
      const withQs    = enriched.filter((r: any) => r.qualityScore    !== null);
      const withCpl   = withSpend.filter((r: any) => r.cpl            !== null);
      const withNa    = withSpend.filter((r: any) => r.costPerNoAnswer !== null);

      res.json({
        insufficient:       withSpend.length === 0,
        allRows:            enriched,
        bestCphl:           withCphl.length > 0 ? [...withCphl].sort((a: any, b: any) => a.costPerHotLead - b.costPerHotLead)[0] : null,
        worstCphl:          withCphl.length > 0 ? [...withCphl].sort((a: any, b: any) => b.costPerHotLead - a.costPerHotLead)[0] : null,
        bestCpl:            withCpl.length  > 0 ? [...withCpl ].sort((a: any, b: any) => a.cpl            - b.cpl)[0]            : null,
        highestNoAnswerCost: withNa.length  > 0 ? [...withNa  ].sort((a: any, b: any) => b.costPerNoAnswer - a.costPerNoAnswer)[0] : null,
        bestQuality:        withQs.length   > 0 ? [...withQs  ].sort((a: any, b: any) => b.qualityScore   - a.qualityScore)[0]    : null,
        worstQuality:       withQs.length   > 0 ? [...withQs  ].sort((a: any, b: any) => a.qualityScore   - b.qualityScore)[0]    : null,
      });
    } catch (err: any) {
      console.error("[CostIntelligence] error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Meta Marketing Read-Only routes ──────────────────────────────────────

  // Diagnostic: verifies all four reads, never exposes credentials
  app.get("/api/admin/ai-marketing/meta-read-test", isAdmin, async (_req, res) => {
    try {
      const { runMetaReadTest } = await import("./metaMarketingService");
      const result = await runMetaReadTest();
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Config status — booleans only, never token values
  app.get("/api/admin/ai-marketing/meta-config", isAdmin, async (_req, res) => {
    try {
      const { getMetaMarketingConfig } = await import("./metaMarketingService");
      res.json(getMetaMarketingConfig());
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Campaigns — read-only GET
  app.get("/api/admin/ai-marketing/meta-campaigns", isAdmin, async (req, res) => {
    try {
      const { getCampaigns } = await import("./metaMarketingService");
      const limit = Math.min(50, parseInt((req.query.limit as string) || "25"));
      const result = await getCampaigns(limit);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Ad Sets — read-only GET
  app.get("/api/admin/ai-marketing/meta-adsets", isAdmin, async (req, res) => {
    try {
      const { getAdSets } = await import("./metaMarketingService");
      const limit = Math.min(50, parseInt((req.query.limit as string) || "25"));
      const result = await getAdSets(limit);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Ads — read-only GET
  app.get("/api/admin/ai-marketing/meta-ads", isAdmin, async (req, res) => {
    try {
      const { getAds } = await import("./metaMarketingService");
      const limit = Math.min(50, parseInt((req.query.limit as string) || "25"));
      const result = await getAds(limit);
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Insights — read-only GET
  app.get("/api/admin/ai-marketing/meta-insights", isAdmin, async (req, res) => {
    try {
      const { getInsights } = await import("./metaMarketingService");
      const datePreset = (req.query.date_preset as string) || "last_30d";
      const level      = (req.query.level      as string) || "campaign";
      const limit      = Math.min(50, parseInt((req.query.limit as string) || "25"));
      const result     = await getInsights({ datePreset, level, limit });
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase 4: Campaign Attribution Engine — READ-ONLY ─────────────────────
  // Aggregates existing CRM lead data (campaign_name, adset_name, ad_name,
  // lead_score, status) into performance summaries per campaign entity.
  // No writes. No Meta API calls. Uses only crm_leads + ai_marketing_sales_outcomes.

  // Discovered CRM statuses (exact values — do not rename):
  //   HOT         = lead_score = 'hot'
  //   WARM        = lead_score = 'warm'
  //   COLD        = lead_score = 'cold'
  //   No Answer   = status IN ('no_answer_1','no_answer_2','no_answer_3','no_answer_4',
  //                            'after_3_no_answer_whatsapp_contacted',
  //                            'new_fresh_after_3_no_answer','no_answer_converted')
  //   Appointment = status = 'qualified'
  //   Sale        = status IN ('purchased','sold_by_kinglike_luxury','deposited','reserved')

  const NO_ANSWER_STATUSES = `('no_answer_1','no_answer_2','no_answer_3','no_answer_4',
    'after_3_no_answer_whatsapp_contacted','new_fresh_after_3_no_answer','no_answer_converted')`;
  const SALE_STATUSES = `('purchased','sold_by_kinglike_luxury','deposited','reserved')`;

  // GET /api/admin/ai-marketing/campaign-attribution — full attribution overview
  app.get("/api/admin/ai-marketing/campaign-attribution", isAdmin, async (_req, res) => {
    try {
      const [byCampaign, byAdset, byAd, revenueCheck] = await Promise.all([
        // ── By Campaign ──────────────────────────────────────────────────────
        pool.query(`
          SELECT
            cl.campaign_name                                                           AS name,
            liq.campaign_id                                                            AS entity_id,
            COUNT(*)                                                                   AS leads_count,
            COUNT(*) FILTER(WHERE cl.lead_score = 'hot')                              AS hot_leads,
            COUNT(*) FILTER(WHERE cl.lead_score = 'warm')                             AS warm_leads,
            COUNT(*) FILTER(WHERE cl.lead_score = 'cold')                             AS cold_leads,
            COUNT(*) FILTER(WHERE cl.status IN ${NO_ANSWER_STATUSES})                 AS no_answer_count,
            COUNT(*) FILTER(WHERE cl.status = 'qualified')                            AS appointments_count,
            COUNT(*) FILTER(WHERE cl.status IN ${SALE_STATUSES})                      AS sales_count,
            COALESCE(SUM(so.sale_amount) FILTER(WHERE so.sale_closed = TRUE), 0)      AS revenue_total
          FROM crm_leads cl
          LEFT JOIN lead_import_queue liq ON liq.crm_lead_id = cl.id
          LEFT JOIN ai_marketing_sales_outcomes so ON so.lead_id = cl.id
          WHERE cl.campaign_name IS NOT NULL AND cl.campaign_name <> ''
          GROUP BY cl.campaign_name, liq.campaign_id
          ORDER BY leads_count DESC
          LIMIT 50
        `),
        // ── By Ad Set ────────────────────────────────────────────────────────
        pool.query(`
          SELECT
            cl.adset_name                                                              AS name,
            liq.adgroup_id                                                             AS entity_id,
            COUNT(*)                                                                   AS leads_count,
            COUNT(*) FILTER(WHERE cl.lead_score = 'hot')                              AS hot_leads,
            COUNT(*) FILTER(WHERE cl.lead_score = 'warm')                             AS warm_leads,
            COUNT(*) FILTER(WHERE cl.lead_score = 'cold')                             AS cold_leads,
            COUNT(*) FILTER(WHERE cl.status IN ${NO_ANSWER_STATUSES})                 AS no_answer_count,
            COUNT(*) FILTER(WHERE cl.status = 'qualified')                            AS appointments_count,
            COUNT(*) FILTER(WHERE cl.status IN ${SALE_STATUSES})                      AS sales_count,
            COALESCE(SUM(so.sale_amount) FILTER(WHERE so.sale_closed = TRUE), 0)      AS revenue_total
          FROM crm_leads cl
          LEFT JOIN lead_import_queue liq ON liq.crm_lead_id = cl.id
          LEFT JOIN ai_marketing_sales_outcomes so ON so.lead_id = cl.id
          WHERE cl.adset_name IS NOT NULL AND cl.adset_name <> ''
          GROUP BY cl.adset_name, liq.adgroup_id
          ORDER BY leads_count DESC
          LIMIT 50
        `),
        // ── By Ad ────────────────────────────────────────────────────────────
        pool.query(`
          SELECT
            cl.ad_name                                                                 AS name,
            liq.ad_id                                                                  AS entity_id,
            COUNT(*)                                                                   AS leads_count,
            COUNT(*) FILTER(WHERE cl.lead_score = 'hot')                              AS hot_leads,
            COUNT(*) FILTER(WHERE cl.lead_score = 'warm')                             AS warm_leads,
            COUNT(*) FILTER(WHERE cl.lead_score = 'cold')                             AS cold_leads,
            COUNT(*) FILTER(WHERE cl.status IN ${NO_ANSWER_STATUSES})                 AS no_answer_count,
            COUNT(*) FILTER(WHERE cl.status = 'qualified')                            AS appointments_count,
            COUNT(*) FILTER(WHERE cl.status IN ${SALE_STATUSES})                      AS sales_count,
            COALESCE(SUM(so.sale_amount) FILTER(WHERE so.sale_closed = TRUE), 0)      AS revenue_total
          FROM crm_leads cl
          LEFT JOIN lead_import_queue liq ON liq.crm_lead_id = cl.id
          LEFT JOIN ai_marketing_sales_outcomes so ON so.lead_id = cl.id
          WHERE cl.ad_name IS NOT NULL AND cl.ad_name <> ''
          GROUP BY cl.ad_name, liq.ad_id
          ORDER BY leads_count DESC
          LIMIT 50
        `),
        // ── Revenue check — is any sale_amount > 0? ──────────────────────────
        pool.query(`
          SELECT COUNT(*) AS cnt
          FROM ai_marketing_sales_outcomes
          WHERE sale_closed = TRUE AND sale_amount > 0
        `),
      ]);

      const revenueEnabled = Number(revenueCheck.rows[0]?.cnt ?? 0) > 0;

      res.json({
        byCampaign:     byCampaign.rows.map(r => ({
          name:               r.name,
          entityId:           r.entity_id || null,
          leadsCount:         Number(r.leads_count),
          hotLeads:           Number(r.hot_leads),
          warmLeads:          Number(r.warm_leads),
          coldLeads:          Number(r.cold_leads),
          noAnswerCount:      Number(r.no_answer_count),
          appointmentsCount:  Number(r.appointments_count),
          salesCount:         Number(r.sales_count),
          revenueTotal:       Number(r.revenue_total),
        })),
        byAdset: byAdset.rows.map(r => ({
          name:               r.name,
          entityId:           r.entity_id || null,
          leadsCount:         Number(r.leads_count),
          hotLeads:           Number(r.hot_leads),
          warmLeads:          Number(r.warm_leads),
          coldLeads:          Number(r.cold_leads),
          noAnswerCount:      Number(r.no_answer_count),
          appointmentsCount:  Number(r.appointments_count),
          salesCount:         Number(r.sales_count),
          revenueTotal:       Number(r.revenue_total),
        })),
        byAd: byAd.rows.map(r => ({
          name:               r.name,
          entityId:           r.entity_id || null,
          leadsCount:         Number(r.leads_count),
          hotLeads:           Number(r.hot_leads),
          warmLeads:          Number(r.warm_leads),
          coldLeads:          Number(r.cold_leads),
          noAnswerCount:      Number(r.no_answer_count),
          appointmentsCount:  Number(r.appointments_count),
          salesCount:         Number(r.sales_count),
          revenueTotal:       Number(r.revenue_total),
        })),
        revenueEnabled,
        statusMapping: {
          hot:         "lead_score = 'hot'",
          warm:        "lead_score = 'warm'",
          cold:        "lead_score = 'cold'",
          noAnswer:    "status IN (no_answer_1..4, after_3_no_answer_whatsapp_contacted, new_fresh_after_3_no_answer, no_answer_converted)",
          appointment: "status = 'qualified'",
          sale:        "status IN (purchased, sold_by_kinglike_luxury, deposited, reserved)",
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/revenue-recommendations — rule-based campaign recommendations
  // Read-only. No Meta write actions. Admin only. Railway compatible.
  app.get("/api/admin/ai-marketing/revenue-recommendations", isAdmin, async (_req, res) => {
    try {
      const NA = `('no_answer_1','no_answer_2','no_answer_3','no_answer_4',
                   'after_3_no_answer_whatsapp_contacted','new_fresh_after_3_no_answer','no_answer_converted')`;

      const [byCamp, byAdset, byAd] = await Promise.all([
        pool.query(`
          SELECT
            cl.campaign_name                                              AS name,
            COUNT(*)                                                       AS leads_count,
            COUNT(*) FILTER(WHERE cl.lead_score = 'hot')                  AS hot_leads,
            COUNT(*) FILTER(WHERE cl.lead_score = 'warm')                 AS warm_leads,
            COUNT(*) FILTER(WHERE cl.lead_score = 'cold')                 AS cold_leads,
            COUNT(*) FILTER(WHERE cl.status IN ${NA})                     AS no_answer_count
          FROM crm_leads cl
          WHERE cl.campaign_name IS NOT NULL AND cl.campaign_name <> ''
          GROUP BY cl.campaign_name
          ORDER BY leads_count DESC LIMIT 50
        `),
        pool.query(`
          SELECT
            cl.adset_name                                                  AS name,
            COUNT(*)                                                       AS leads_count,
            COUNT(*) FILTER(WHERE cl.lead_score = 'hot')                  AS hot_leads,
            COUNT(*) FILTER(WHERE cl.status IN ${NA})                     AS no_answer_count
          FROM crm_leads cl
          WHERE cl.adset_name IS NOT NULL AND cl.adset_name <> ''
          GROUP BY cl.adset_name
          ORDER BY leads_count DESC LIMIT 50
        `),
        pool.query(`
          SELECT
            cl.ad_name                                                     AS name,
            COUNT(*)                                                       AS leads_count,
            COUNT(*) FILTER(WHERE cl.lead_score = 'cold')                 AS cold_leads
          FROM crm_leads cl
          WHERE cl.ad_name IS NOT NULL AND cl.ad_name <> ''
          GROUP BY cl.ad_name
          ORDER BY leads_count DESC LIMIT 50
        `),
      ]);

      type Rec = { type: string; title: string; message: string; severity: string; entity: string };
      const recs: Rec[] = [];

      // ── Campaign-level rules ──────────────────────────────────────────────────
      for (const r of byCamp.rows) {
        const n       = Number(r.leads_count);
        const hot     = Number(r.hot_leads);
        const cold    = Number(r.cold_leads);
        const noAns   = Number(r.no_answer_count);
        const hotRate = n > 0 ? hot / n : 0;
        const noRate  = n > 0 ? noAns / n : 0;
        const name    = r.name as string;

        if (n >= 10 && hotRate >= 0.5) {
          recs.push({
            type: "strong_campaign", severity: "positive",
            title: "Strong Campaign",
            message: `${Math.round(hotRate * 100)}% of leads are HOT — excellent performance from "${name}".`,
            entity: `Campaign: ${name} · ${n} total leads · ${hot} HOT · Suggested action: Keep monitoring and consider increasing budget manually.`,
          });
        } else if (n >= 15 && hotRate < 0.15) {
          recs.push({
            type: "many_low_quality", severity: "critical",
            title: "Many Leads but Low Quality",
            message: `"${name}" has ${n} leads but only ${Math.round(hotRate * 100)}% are HOT.`,
            entity: `Campaign: ${name} · ${n} leads · ${hot} HOT · Suggested action: Review urgently — consider reducing budget manually or testing a new creative.`,
          });
        } else if (n >= 10 && hotRate < 0.2 && noRate < 0.5) {
          recs.push({
            type: "weak_campaign", severity: "warning",
            title: "Weak Campaign",
            message: `"${name}" has many leads but fewer than 20% are HOT.`,
            entity: `Campaign: ${name} · ${n} leads · ${hot} HOT · Suggested action: Review this campaign — consider testing a new audience or creative.`,
          });
        }

        if (n >= 5 && noRate >= 0.5) {
          recs.push({
            type: "high_no_answer", severity: "warning",
            title: "High No Answer Rate",
            message: `${Math.round(noRate * 100)}% of leads from "${name}" are not answering.`,
            entity: `Campaign: ${name} · ${noAns} of ${n} leads no-answer · Suggested action: Review follow-up timing or contact strategy.`,
          });
        }

        if (n >= 2 && n <= 5 && hotRate >= 0.75) {
          recs.push({
            type: "low_leads_high_quality", severity: "positive",
            title: "Low Leads but High Quality",
            message: `"${name}" has few leads but ${Math.round(hotRate * 100)}% are HOT — strong signal.`,
            entity: `Campaign: ${name} · ${n} leads · ${hot} HOT · Suggested action: Increase attention to this campaign — it shows strong early signals.`,
          });
        }

        if (n >= 3 && n <= 8 && hotRate < 0.5 && noRate < 0.5) {
          recs.push({
            type: "keep_monitoring", severity: "info",
            title: "Keep Monitoring",
            message: `"${name}" does not yet have enough data for a definitive conclusion.`,
            entity: `Campaign: ${name} · ${n} leads so far · Suggested action: Keep monitoring this campaign.`,
          });
        }
      }

      // ── Ad Set-level rules ────────────────────────────────────────────────────
      for (const r of byAdset.rows) {
        const n      = Number(r.leads_count);
        const noAns  = Number(r.no_answer_count);
        const noRate = n > 0 ? noAns / n : 0;
        const name   = r.name as string;
        if (n >= 5 && noRate >= 0.6) {
          recs.push({
            type: "review_audience", severity: "warning",
            title: "Review Audience",
            message: `Ad set "${name}" has a ${Math.round(noRate * 100)}% no-answer rate.`,
            entity: `Ad Set: ${name} · ${noAns} of ${n} leads no-answer · Suggested action: Consider testing a new audience.`,
          });
        }
      }

      // ── Ad-level rules ────────────────────────────────────────────────────────
      for (const r of byAd.rows) {
        const n        = Number(r.leads_count);
        const cold     = Number(r.cold_leads);
        const coldRate = n > 0 ? cold / n : 0;
        const name     = r.name as string;
        if (n >= 5 && coldRate >= 0.6) {
          recs.push({
            type: "review_creative", severity: "warning",
            title: "Review Creative",
            message: `Ad "${name}" generates ${Math.round(coldRate * 100)}% COLD leads.`,
            entity: `Ad: ${name} · ${cold} of ${n} leads are COLD · Suggested action: Consider changing the creative.`,
          });
        }
      }

      // ── Sort by severity priority and cap at 25 ───────────────────────────────
      const SEV_ORDER: Record<string, number> = { critical: 0, warning: 1, positive: 2, info: 3 };
      recs.sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));

      res.json(recs.slice(0, 25));
    } catch (err: any) {
      console.error("[AI Recommendations] error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/creative-attribution — creative dashboard (read-only, admin only)
  app.get("/api/admin/ai-marketing/creative-attribution", isAdmin, async (_req, res) => {
    try {
      const [creatives, summary, attrCount] = await Promise.all([
        pool.query(`
          SELECT
            ca.id, ca.creative_id, ca.creative_name, ca.ad_id, ca.ad_name,
            ca.adset_id, ca.adset_name, ca.campaign_id, ca.campaign_name,
            ca.thumbnail_url, ca.status, ca.last_synced_at,
            COUNT(DISTINCT cl.id)                                            AS total_leads,
            COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score = 'hot')        AS hot_leads,
            COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score = 'warm')       AS warm_leads,
            COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score = 'cold')       AS cold_leads
          FROM ai_creative_attribution ca
          LEFT JOIN ai_campaign_attribution aca ON aca.ad_id = ca.ad_id
          LEFT JOIN crm_leads cl              ON cl.id       = aca.crm_lead_id
          GROUP BY ca.id
          ORDER BY total_leads DESC, ca.ad_name
          LIMIT 100
        `),
        pool.query(`
          SELECT
            COUNT(*)                                                              AS total_ads,
            COUNT(DISTINCT creative_id) FILTER(WHERE creative_id IS NOT NULL)    AS unique_creatives,
            COUNT(DISTINCT campaign_id) FILTER(WHERE campaign_id IS NOT NULL)    AS campaigns
          FROM ai_creative_attribution
        `),
        pool.query(`SELECT COUNT(*) AS attribution_count FROM ai_campaign_attribution`),
      ]);

      res.json({
        rows: creatives.rows.map((r: any) => ({
          id: r.id, creativeId: r.creative_id, creativeName: r.creative_name,
          adId: r.ad_id, adName: r.ad_name,
          adsetId: r.adset_id, adsetName: r.adset_name,
          campaignId: r.campaign_id, campaignName: r.campaign_name,
          thumbnailUrl: r.thumbnail_url, status: r.status,
          lastSyncedAt: r.last_synced_at,
          totalLeads: Number(r.total_leads), hotLeads: Number(r.hot_leads),
          warmLeads: Number(r.warm_leads), coldLeads: Number(r.cold_leads),
        })),
        summary: {
          totalAds:          Number(summary.rows[0]?.total_ads         ?? 0),
          uniqueCreatives:   Number(summary.rows[0]?.unique_creatives   ?? 0),
          campaigns:         Number(summary.rows[0]?.campaigns          ?? 0),
          attributionCount:  Number(attrCount.rows[0]?.attribution_count ?? 0),
        },
      });
    } catch (err: any) {
      console.error("[CreativeAttribution] dashboard error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/creative-attribution/sync — pull from Meta, upsert table (read-only Meta)
  app.get("/api/admin/ai-marketing/creative-attribution/sync", isAdmin, async (_req, res) => {
    try {
      const { getAdsWithCreatives } = await import("./metaMarketingService");
      const result = await getAdsWithCreatives(50);
      if (!result.ok) return res.json({ ok: false, error: result.error, inserted: 0, updated: 0, skipped: 0 });

      let inserted = 0, updated = 0, skipped = 0;
      for (const ad of result.data) {
        const adId       = ad.id       as string;
        const adName     = (ad.name    as string | null) ?? null;
        const adsetId    = (ad.adset_id   as string | null) ?? null;
        const adsetName  = (ad.adset_name as string | null) ?? null;
        const campaignId = (ad.campaign?.id   as string | null) ?? null;
        const campName   = (ad.campaign?.name as string | null) ?? null;
        const creativeId   = (ad.creative?.id           as string | null) ?? null;
        const creativeName = (ad.creative?.name         as string | null) ?? null;
        const thumbUrl     = (ad.creative?.thumbnail_url as string | null) ?? null;
        const adStatus     = (ad.status as string | null) ?? null;

        if (!adId) { skipped++; continue; }

        const ex = await pool.query(`SELECT id FROM ai_creative_attribution WHERE ad_id = $1`, [adId]);
        if (ex.rows.length > 0) {
          await pool.query(`
            UPDATE ai_creative_attribution
            SET creative_id=$1, creative_name=$2, ad_name=$3, adset_id=$4, adset_name=$5,
                campaign_id=$6, campaign_name=$7, thumbnail_url=$8, status=$9, last_synced_at=NOW()
            WHERE ad_id=$10
          `, [creativeId, creativeName, adName, adsetId, adsetName, campaignId, campName, thumbUrl, adStatus, adId]);
          updated++;
        } else {
          await pool.query(`
            INSERT INTO ai_creative_attribution
              (creative_id, creative_name, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, thumbnail_url, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `, [creativeId, creativeName, adId, adName, adsetId, adsetName, campaignId, campName, thumbUrl, adStatus]);
          inserted++;
        }
      }

      console.log(`[CreativeAttribution] sync — inserted=${inserted} updated=${updated} skipped=${skipped}`);
      res.json({ ok: true, adsFound: result.data.length, inserted, updated, skipped });
    } catch (err: any) {
      console.error("[CreativeAttribution] sync error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/attribution-backfill — safe backfill from lead_import_queue (admin only)
  // Reads: lead_import_queue (read-only), crm_leads (read-only)
  // Writes: ai_campaign_attribution (insert missing records only)
  // Idempotent — safe to run multiple times. No Meta calls. No CRM changes.
  app.get("/api/admin/ai-marketing/attribution-backfill", isAdmin, async (_req, res) => {
    try {
      // Fetch all queue rows that have crm_lead_id + ad_id + campaign_id
      const candidates = await pool.query(`
        SELECT liq.crm_lead_id, liq.ad_id, liq.campaign_id,
               COALESCE(liq.processed_at::timestamptz, liq.created_at::timestamptz, NOW()) AS attributed_at,
               cl.campaign_name, cl.adset_name, cl.ad_name, cl.lead_source
        FROM lead_import_queue liq
        JOIN crm_leads cl ON cl.id = liq.crm_lead_id
        WHERE liq.crm_lead_id IS NOT NULL
          AND liq.ad_id IS NOT NULL AND liq.ad_id <> ''
          AND liq.campaign_id IS NOT NULL AND liq.campaign_id <> ''
      `);

      let scanned = 0, inserted = 0, skipped = 0;

      for (const row of candidates.rows) {
        scanned++;
        // Check if this crm_lead_id + ad_id combination already exists
        const exists = await pool.query(
          `SELECT 1 FROM ai_campaign_attribution WHERE crm_lead_id = $1 AND ad_id = $2 LIMIT 1`,
          [row.crm_lead_id, row.ad_id]
        );
        if (exists.rows.length > 0) { skipped++; continue; }

        await pool.query(`
          INSERT INTO ai_campaign_attribution
            (crm_lead_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, lead_source, attributed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
          row.crm_lead_id,
          row.campaign_id,
          row.campaign_name ?? null,
          null,               // adset_id — not available in queue
          row.adset_name ?? null,
          row.ad_id,
          row.ad_name ?? null,
          row.lead_source ?? null,
          row.attributed_at,
        ]);
        inserted++;
      }

      console.log(`[AttributionBackfill] scanned=${scanned} inserted=${inserted} skipped=${skipped}`);
      res.json({ ok: true, scanned, inserted, skipped });
    } catch (err: any) {
      console.error("[AttributionBackfill] error:", err.message);
      res.status(500).json({ ok: false, error: err.message, scanned: 0, inserted: 0, skipped: 0 });
    }
  });

  // GET /api/admin/ai-marketing/creative-intelligence — quality scoring, ranking, trends (read-only, admin only)
  // Reads: ai_creative_attribution → ai_campaign_attribution → crm_leads
  // Writes: nothing — intelligence only, zero Meta calls, Railway compatible
  app.get("/api/admin/ai-marketing/creative-intelligence", isAdmin, async (_req, res) => {
    try {
      const NA = `('no_answer_1','no_answer_2','no_answer_3','no_answer_4',
                   'after_3_no_answer_whatsapp_contacted','new_fresh_after_3_no_answer','no_answer_converted')`;

      const result = await pool.query(`
        SELECT
          ca.id, ca.creative_id, ca.creative_name, ca.ad_id, ca.ad_name,
          ca.adset_id, ca.adset_name, ca.campaign_id, ca.campaign_name,
          ca.thumbnail_url, ca.status,
          COUNT(DISTINCT cl.id)                                                                                            AS total_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score = 'hot')                                                       AS hot_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score = 'warm')                                                      AS warm_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score = 'cold')                                                      AS cold_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.status IN ${NA})                                                          AS no_answer_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE aca.attributed_at >= NOW()-INTERVAL '7 days')                                AS leads_7d,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='hot' AND aca.attributed_at >= NOW()-INTERVAL '7 days')        AS hot_7d,
          COUNT(DISTINCT cl.id) FILTER(WHERE aca.attributed_at BETWEEN NOW()-INTERVAL '14 days' AND NOW()-INTERVAL '7 days') AS leads_prev7d,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='hot' AND aca.attributed_at BETWEEN NOW()-INTERVAL '14 days' AND NOW()-INTERVAL '7 days') AS hot_prev7d,
          COUNT(DISTINCT cl.id) FILTER(WHERE aca.attributed_at >= NOW()-INTERVAL '30 days')                               AS leads_30d,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='hot' AND aca.attributed_at >= NOW()-INTERVAL '30 days')       AS hot_30d,
          COUNT(DISTINCT cl.id) FILTER(WHERE aca.attributed_at BETWEEN NOW()-INTERVAL '60 days' AND NOW()-INTERVAL '30 days') AS leads_prev30d,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='hot' AND aca.attributed_at BETWEEN NOW()-INTERVAL '60 days' AND NOW()-INTERVAL '30 days') AS hot_prev30d,
          COUNT(DISTINCT cl.id) FILTER(WHERE aca.attributed_at >= NOW()-INTERVAL '90 days')                               AS leads_90d,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='hot' AND aca.attributed_at >= NOW()-INTERVAL '90 days')       AS hot_90d
        FROM ai_creative_attribution ca
        LEFT JOIN ai_campaign_attribution aca ON aca.ad_id = ca.ad_id
        LEFT JOIN crm_leads cl              ON cl.id = aca.crm_lead_id
        GROUP BY ca.id
        ORDER BY total_leads DESC, ca.ad_name
        LIMIT 100
      `);

      const computeTrend = (cL: number, cH: number, pL: number, pH: number): "improving" | "declining" | "stable" => {
        if (cL < 2) return "stable";
        const curr = cL > 0 ? cH / cL : 0;
        const prev = pL > 1 ? pH / pL : null;
        if (prev === null) return "stable";
        const d = curr - prev;
        return d > 0.05 ? "improving" : d < -0.05 ? "declining" : "stable";
      };

      const creatives = result.rows.map((r: any) => {
        const total = Number(r.total_leads), hot = Number(r.hot_leads),
              warm  = Number(r.warm_leads),  cold = Number(r.cold_leads),
              na    = Number(r.no_answer_leads);
        const raw    = (hot * 3) + (warm * 1) + (cold * -1) + (na * -2);
        const norm   = total > 0 ? Math.round((raw / total) * 100) / 100 : 0;
        const hotPct = total > 0 ? Math.round((hot / total) * 1000) / 10 : 0;
        const naPct  = total > 0 ? Math.round((na  / total) * 1000) / 10 : 0;
        const conf: "low" | "medium" | "high" = total < 5 ? "low" : total < 20 ? "medium" : "high";
        const l7 = Number(r.leads_7d), h7 = Number(r.hot_7d),
              p7 = Number(r.leads_prev7d), ph7 = Number(r.hot_prev7d);
        const l30 = Number(r.leads_30d), h30 = Number(r.hot_30d),
              p30 = Number(r.leads_prev30d), ph30 = Number(r.hot_prev30d);
        const l90 = Number(r.leads_90d), h90 = Number(r.hot_90d);
        return {
          id: r.id, creativeId: r.creative_id, creativeName: r.creative_name,
          adId: r.ad_id, adName: r.ad_name, adsetName: r.adset_name,
          campaignName: r.campaign_name, thumbnailUrl: r.thumbnail_url, status: r.status,
          totalLeads: total, hotLeads: hot, warmLeads: warm, coldLeads: cold, noAnswerLeads: na,
          qualityScore: raw, qualityScoreNorm: norm, hotRate: hotPct, noAnswerRate: naPct, confidence: conf,
          leads7d: l7, hot7d: h7, leads30d: l30, hot30d: h30, leads90d: l90, hot90d: h90,
          trend7d:  computeTrend(l7,  h7,  p7,  ph7),
          trend30d: computeTrend(l30, h30, p30, ph30),
          trend90d: computeTrend(l90, h90, 0,   0),
        };
      });

      const withData = creatives.filter((c: any) => c.totalLeads >= 3);
      const mkI = (type: string, title: string, c: any, mLabel: string, mVal: string) => ({
        type, title, metricLabel: mLabel, metricValue: mVal,
        creativeName: c.creativeName ?? c.adName ?? c.adId,
        campaignName: c.campaignName ?? "—",
        totalLeads: c.totalLeads, hotLeads: c.hotLeads, warmLeads: c.warmLeads,
        coldLeads: c.coldLeads, noAnswerLeads: c.noAnswerLeads,
        qualityScore: c.qualityScore, qualityScoreNorm: c.qualityScoreNorm,
        hotRate: c.hotRate, noAnswerRate: c.noAnswerRate, confidence: c.confidence,
        evidence: `${c.totalLeads} leads — HOT: ${c.hotLeads}, WARM: ${c.warmLeads}, COLD: ${c.coldLeads}, No Answer: ${c.noAnswerLeads}`,
      });

      const insights: any[] = [];
      const byScore = [...withData].sort((a: any, b: any) => b.qualityScoreNorm - a.qualityScoreNorm);
      const byHot   = [...withData].sort((a: any, b: any) => b.hotRate - a.hotRate);
      const byNA    = [...withData].sort((a: any, b: any) => b.noAnswerRate - a.noAnswerRate);

      if (byScore.length > 0) insights.push(mkI("best_quality",     "Best Quality Score",     byScore[0],                  "Score / Lead", `${byScore[0].qualityScoreNorm}`));
      if (byScore.length > 1) insights.push(mkI("worst_quality",    "Worst Quality Score",    byScore[byScore.length - 1], "Score / Lead", `${byScore[byScore.length-1].qualityScoreNorm}`));
      if (byHot.length   > 0) insights.push(mkI("highest_hot_rate", "Highest HOT Lead Rate",  byHot[0],                    "HOT Rate",     `${byHot[0].hotRate}%`));
      if (byHot.length   > 1) insights.push(mkI("lowest_hot_rate",  "Lowest HOT Lead Rate",   byHot[byHot.length - 1],     "HOT Rate",     `${byHot[byHot.length-1].hotRate}%`));
      if (byNA.length    > 0) insights.push(mkI("highest_no_answer","Highest No Answer Rate", byNA[0],                     "No Ans. Rate", `${byNA[0].noAnswerRate}%`));

      const multiPeriod = creatives.filter((c: any) => c.leads7d > 0 && c.leads30d > 0 && c.leads90d > 0);
      if (multiPeriod.length > 0) {
        const ranked = multiPeriod.map((c: any) => {
          const rates = [
            c.leads7d  > 0 ? c.hot7d  / c.leads7d  : 0,
            c.leads30d > 0 ? c.hot30d / c.leads30d : 0,
            c.leads90d > 0 ? c.hot90d / c.leads90d : 0,
          ];
          return { ...c, rateRange: Math.max(...rates) - Math.min(...rates) };
        }).sort((a: any, b: any) => a.rateRange - b.rateRange);
        insights.push(mkI("most_consistent", "Most Consistent Creative", ranked[0], "Rate Range", `${(ranked[0].rateRange * 100).toFixed(1)}%`));
      }

      res.json({
        insufficient: creatives.length === 0,
        creatives, insights,
        formula: {
          hot: 3, warm: 1, cold: -1, noAnswer: -2,
          description: "Quality Score = (HOT × 3) + (WARM × 1) + (COLD × −1) + (No Answer × −2)",
          normalized:  "Normalized Score = Raw Score ÷ Total Leads",
          confidence:  "Low: < 5 leads | Medium: 5–20 leads | High: 20+ leads",
        },
        headline: null, copy: null, cta: null,
      });
    } catch (err: any) {
      console.error("[CreativeIntelligence] error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/strategy-insights — pattern analysis from historical data
  // Read-only. Admin only. No Meta writes. Railway compatible.
  app.get("/api/admin/ai-marketing/strategy-insights", isAdmin, async (_req, res) => {
    try {
      const NA = `('no_answer_1','no_answer_2','no_answer_3','no_answer_4',
                   'after_3_no_answer_whatsapp_contacted','new_fresh_after_3_no_answer','no_answer_converted')`;

      const [byCamp, byAdset, history, t7, t30, t90] = await Promise.all([
        pool.query(`
          SELECT campaign_name AS name, COUNT(*) AS total,
            COUNT(*) FILTER(WHERE lead_score='hot')        AS hot,
            COUNT(*) FILTER(WHERE lead_score='warm')       AS warm,
            COUNT(*) FILTER(WHERE lead_score='cold')       AS cold,
            COUNT(*) FILTER(WHERE status IN ${NA})         AS no_answer
          FROM crm_leads
          WHERE campaign_name IS NOT NULL AND campaign_name <> ''
          GROUP BY campaign_name ORDER BY total DESC LIMIT 30
        `),
        pool.query(`
          SELECT adset_name AS name, COUNT(*) AS total,
            COUNT(*) FILTER(WHERE lead_score='hot')        AS hot,
            COUNT(*) FILTER(WHERE lead_score='warm')       AS warm,
            COUNT(*) FILTER(WHERE lead_score='cold')       AS cold
          FROM crm_leads
          WHERE adset_name IS NOT NULL AND adset_name <> ''
          GROUP BY adset_name ORDER BY total DESC LIMIT 30
        `),
        pool.query(`
          SELECT entity_type, entity_name, leads_count, hot_count, warm_count, cold_count,
                 no_answer_count, spend, quality_score, cpl, cost_per_hot_lead
          FROM ai_marketing_learning_history WHERE leads_count > 0
          ORDER BY updated_at DESC LIMIT 100
        `),
        pool.query(`
          SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE lead_score='hot') AS hot
          FROM crm_leads
          WHERE created_at >= NOW() - INTERVAL '7 days'
            AND campaign_name IS NOT NULL AND campaign_name <> ''
        `),
        pool.query(`
          SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE lead_score='hot') AS hot
          FROM crm_leads
          WHERE created_at >= NOW() - INTERVAL '30 days'
            AND campaign_name IS NOT NULL AND campaign_name <> ''
        `),
        pool.query(`
          SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE lead_score='hot') AS hot
          FROM crm_leads
          WHERE created_at >= NOW() - INTERVAL '90 days'
            AND campaign_name IS NOT NULL AND campaign_name <> ''
        `),
      ]);

      // ── Helpers ───────────────────────────────────────────────────────────────
      const conf = (n: number) => n < 5 ? "low" : n < 20 ? "medium" : "high";

      type Trend = "improving" | "declining" | "stable";
      const trendDir = (recent: number, baseline: number): Trend => {
        if (baseline === 0) return "stable";
        const diff = recent - baseline;
        if (diff >  0.05) return "improving";
        if (diff < -0.05) return "declining";
        return "stable";
      };

      // ── Trend rates ───────────────────────────────────────────────────────────
      const mk = (row: any) => ({ total: Number(row?.total ?? 0), hot: Number(row?.hot ?? 0) });
      const r7 = mk(t7.rows[0]),  r30 = mk(t30.rows[0]), r90 = mk(t90.rows[0]);
      const rate7  = r7.total  > 0 ? r7.hot  / r7.total  : 0;
      const rate30 = r30.total > 0 ? r30.hot / r30.total : 0;
      const rate90 = r90.total > 0 ? r90.hot / r90.total : 0;

      // ── Build insight cards ───────────────────────────────────────────────────
      type Insight = { type: string; title: string; description: string; evidence: string; confidence: string; dataPoints: number };
      const insights: Insight[] = [];

      const campRows = byCamp.rows
        .map((r: any) => ({ name: r.name as string, total: Number(r.total), hot: Number(r.hot), warm: Number(r.warm), cold: Number(r.cold), noAns: Number(r.no_answer) }))
        .filter(r => r.total >= 3);

      if (campRows.length > 0) {
        const byHotRate = [...campRows].sort((a, b) => (b.hot/b.total) - (a.hot/a.total));
        const best = byHotRate[0], worst = byHotRate[byHotRate.length - 1];

        insights.push({
          type: "best_campaign",
          title: "Best Performing Campaign",
          description: `"${best.name}" leads with the highest HOT lead rate among all campaigns.`,
          evidence: `${best.total} total leads · ${best.hot} HOT (${Math.round((best.hot/best.total)*100)}%) · ${best.warm} WARM · ${best.cold} COLD.`,
          confidence: conf(best.total), dataPoints: best.total,
        });

        if (worst.name !== best.name) {
          insights.push({
            type: "worst_campaign",
            title: "Lowest Performing Campaign",
            description: `"${worst.name}" has the lowest HOT rate. Consider reviewing creative and audience.`,
            evidence: `${worst.total} total leads · only ${worst.hot} HOT (${Math.round((worst.hot/worst.total)*100)}%) · ${worst.noAns} no-answer.`,
            confidence: conf(worst.total), dataPoints: worst.total,
          });
        }

        const highNoAns = [...campRows].filter(r => r.noAns > 0).sort((a, b) => (b.noAns/b.total) - (a.noAns/a.total))[0];
        if (highNoAns && highNoAns.noAns / highNoAns.total > 0.3) {
          insights.push({
            type: "highest_no_answer",
            title: "Highest No-Answer Source",
            description: `"${highNoAns.name}" has an unusually high no-answer rate — contacts may not be reachable.`,
            evidence: `${highNoAns.noAns} of ${highNoAns.total} leads (${Math.round((highNoAns.noAns/highNoAns.total)*100)}%) are not answering.`,
            confidence: conf(highNoAns.total), dataPoints: highNoAns.total,
          });
        }
      }

      const adsetRows = byAdset.rows
        .map((r: any) => ({ name: r.name as string, total: Number(r.total), hot: Number(r.hot), warm: Number(r.warm) }))
        .filter(r => r.total >= 3);

      if (adsetRows.length > 0) {
        const bestAdset = [...adsetRows].sort((a, b) => (b.hot/b.total) - (a.hot/a.total))[0];
        insights.push({
          type: "best_audience",
          title: "Best Performing Audience",
          description: `Ad set "${bestAdset.name}" produces the highest HOT lead rate — this audience shows strong intent.`,
          evidence: `${bestAdset.total} leads · ${bestAdset.hot} HOT (${Math.round((bestAdset.hot/bestAdset.total)*100)}%) · ${bestAdset.warm} WARM.`,
          confidence: conf(bestAdset.total), dataPoints: bestAdset.total,
        });
      }

      const histRows = history.rows
        .map((r: any) => ({
          type: r.entity_type as string, name: r.entity_name as string,
          leads: Number(r.leads_count), hot: Number(r.hot_count), warm: Number(r.warm_count),
          cold: Number(r.cold_count), noAns: Number(r.no_answer_count),
          spend: Number(r.spend), qs: Number(r.quality_score),
          cpl: Number(r.cpl), cphl: Number(r.cost_per_hot_lead),
        }))
        .filter(r => r.leads >= 3);

      const projects = histRows.filter(r => r.type === "project");
      if (projects.length > 0) {
        const bestProj = [...projects].sort((a, b) => (b.hot/b.leads) - (a.hot/a.leads))[0];
        insights.push({
          type: "best_project",
          title: "Best Performing Project",
          description: `Project "${bestProj.name}" generates the highest HOT lead rate among tracked projects.`,
          evidence: `${bestProj.leads} leads · ${bestProj.hot} HOT (${Math.round((bestProj.hot/bestProj.leads)*100)}%) · Quality Score: ${bestProj.qs > 0 ? bestProj.qs.toFixed(1) : "N/A"}.`,
          confidence: conf(bestProj.leads), dataPoints: bestProj.leads,
        });
      }

      const withCphl = histRows.filter(r => r.cphl > 0 && r.hot > 0);
      if (withCphl.length > 0) {
        const bestCost = [...withCphl].sort((a, b) => a.cphl - b.cphl)[0];
        insights.push({
          type: "best_cost_efficiency",
          title: "Best Cost Efficiency",
          description: `"${bestCost.name}" (${bestCost.type}) achieves the lowest cost per HOT lead.`,
          evidence: `Cost per HOT Lead: $${bestCost.cphl.toFixed(2)} · CPL: ${bestCost.cpl > 0 ? `$${bestCost.cpl.toFixed(2)}` : "N/A"} · ${bestCost.hot} HOT leads from ${bestCost.leads} total.`,
          confidence: conf(bestCost.leads), dataPoints: bestCost.leads,
        });
      }

      const withQs = histRows.filter(r => r.qs > 0);
      if (withQs.length > 0) {
        const bestQs = [...withQs].sort((a, b) => b.qs - a.qs)[0];
        insights.push({
          type: "best_quality_score",
          title: "Highest Lead Quality Score",
          description: `"${bestQs.name}" (${bestQs.type}) has the best overall lead quality score.`,
          evidence: `Quality Score: ${bestQs.qs.toFixed(1)} · ${bestQs.hot} HOT · ${bestQs.warm} WARM · ${bestQs.cold} COLD · from ${bestQs.leads} leads.`,
          confidence: conf(bestQs.leads), dataPoints: bestQs.leads,
        });
      }

      if (insights.length === 0) return res.json({ insufficient: true, insights: [], trends: null });

      res.json({
        insufficient: false,
        insights,
        trends: {
          last7d:  { hotRate: rate7,  leadsCount: r7.total,  trend: trendDir(rate7, rate30)  },
          last30d: { hotRate: rate30, leadsCount: r30.total, trend: trendDir(rate30, rate90) },
          last90d: { hotRate: rate90, leadsCount: r90.total, trend: "stable" as Trend },
        },
      });
    } catch (err: any) {
      console.error("[StrategyInsights] error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 12 — Project Marketing Knowledge Base helper (read-only, no side effects)
  // Called by both Creative Draft and Campaign Draft generators.
  // Returns "" on any error — never breaks draft generation.
  // ─────────────────────────────────────────────────────────────────────────────
  async function getProjectKnowledge(projectName: string): Promise<string> {
    if (!projectName) return "";
    try {
      const profileRes = await pool.query(
        `SELECT * FROM project_marketing_profiles
         WHERE status = 'active'
           AND (LOWER(internal_project_name) = LOWER($1) OR LOWER(marketing_alias) = LOWER($1))
         LIMIT 1`,
        [projectName]
      );
      if (!profileRes.rows[0]) return "";
      const p = profileRes.rows[0];
      const [angles, markets, claims] = await Promise.all([
        pool.query(`SELECT angle_name FROM project_marketing_angles WHERE profile_id=$1 AND enabled=true ORDER BY priority DESC, id ASC`, [p.id]),
        pool.query(`SELECT market_name, language FROM project_target_markets WHERE profile_id=$1 ORDER BY id ASC`, [p.id]),
        pool.query(`SELECT claim_text FROM project_forbidden_claims WHERE profile_id=$1 ORDER BY id ASC`, [p.id]),
      ]);
      const displayName = p.use_real_project_name
        ? p.internal_project_name
        : (p.marketing_alias || p.internal_project_name);
      let ctx = `\n--- Project Knowledge: ${displayName} ---\n`;
      if (p.project_type)                ctx += `Type: ${p.project_type}\n`;
      if (p.location)                    ctx += `Location: ${p.location}\n`;
      if (p.luxury_level)                ctx += `Luxury Level: ${p.luxury_level}\n`;
      if (p.short_marketing_description) ctx += `Description: ${p.short_marketing_description}\n`;
      if (p.target_investor_type)        ctx += `Target Investor: ${p.target_investor_type}\n`;
      if (p.target_buyer_type)           ctx += `Target Buyer: ${p.target_buyer_type}\n`;
      if (angles.rows.length > 0)
        ctx += `Approved Angles: ${angles.rows.map((r: any) => r.angle_name).join(', ')}\n`;
      if (markets.rows.length > 0)
        ctx += `Target Markets: ${markets.rows.map((r: any) => `${r.market_name}${r.language ? ` (${r.language})` : ''}`).join(', ')}\n`;
      if (claims.rows.length > 0) {
        ctx += `FORBIDDEN — never use:\n`;
        claims.rows.forEach((r: any) => { ctx += `  • ${r.claim_text}\n`; });
      }
      if (!p.use_real_project_name && p.marketing_alias)
        ctx += `NAME RULE: Use "${p.marketing_alias}" as the project name. NEVER expose "${p.internal_project_name}".\n`;
      ctx += `--- End Knowledge ---\n`;
      return ctx;
    } catch {
      return "";
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 10 — AI Creative Draft Generator
  // Admin-only. Internal drafts only. Zero Meta write actions. Railway compatible.
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /api/admin/ai-marketing/creative-drafts/generate
  // Generates AI creative drafts from historical intelligence. Nothing is saved until admin saves.
  app.post("/api/admin/ai-marketing/creative-drafts/generate", isAdmin, async (req, res) => {
    try {
      const {
        project_name = "", target_market = "", language = "Arabic",
        goal = "more_hot_leads", draft_types = [] as string[],
      } = req.body as { project_name?: string; target_market?: string; language?: string; goal?: string; draft_types?: string[] };

      const NA = `('no_answer_1','no_answer_2','no_answer_3','no_answer_4','after_3_no_answer_whatsapp_contacted','new_fresh_after_3_no_answer','no_answer_converted')`;

      const topCreatives = await pool.query(`
        SELECT ca.ad_name, ca.campaign_name,
          COUNT(DISTINCT cl.id) AS total_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='hot')  AS hot_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='warm') AS warm_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='cold') AS cold_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.status IN ${NA})   AS no_answer_leads,
          (COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='hot')*3
           + COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='warm')
           - COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='cold')
           - COUNT(DISTINCT cl.id) FILTER(WHERE cl.status IN ${NA})*2) AS quality_score
        FROM ai_creative_attribution ca
        LEFT JOIN ai_campaign_attribution aca ON aca.ad_id = ca.ad_id
        LEFT JOIN crm_leads cl ON cl.id = aca.crm_lead_id
        GROUP BY ca.id, ca.ad_name, ca.campaign_name
        HAVING COUNT(DISTINCT cl.id) > 0
        ORDER BY quality_score DESC
        LIMIT 5
      `);

      const leadsStats = await pool.query(`
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER(WHERE lead_score='hot')     AS hot,
          COUNT(*) FILTER(WHERE lead_score='warm')    AS warm,
          COUNT(*) FILTER(WHERE status IN ${NA})      AS no_answer
        FROM crm_leads
        WHERE created_at >= NOW() - INTERVAL '90 days'
      `);
      const stats = leadsStats.rows[0];
      const hotRate = Number(stats.total) > 0 ? Math.round((Number(stats.hot) / Number(stats.total)) * 100) : 0;
      const hasIntelligence = topCreatives.rows.length > 0;
      const confidenceLabel = hasIntelligence ? (Number(topCreatives.rows[0]?.total_leads) >= 20 ? "high" : "medium") : "low";

      const topCreativesContext = topCreatives.rows.map((r: any, i: number) =>
        `${i+1}. Ad: "${r.ad_name || 'Unknown'}" | Campaign: "${r.campaign_name || 'Unknown'}" | ${r.hot_leads} HOT / ${r.warm_leads} WARM / ${r.no_answer_leads} No Answer | Quality Score: ${r.quality_score}`
      ).join('\n');

      const goalLabel: Record<string, string> = {
        more_hot_leads:   "increase HOT lead conversion rate",
        lower_no_answer:  "reduce No Answer rate and improve engagement",
        more_appointments:"drive appointment bookings",
        test_new_angle:   "test a fresh creative angle to reach new audiences",
      };

      const types = (draft_types as string[]).length > 0 ? (draft_types as string[]) : ["headline", "primary_text", "cta", "hook"];
      const knowledgeCtx = await getProjectKnowledge(project_name);
      const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;

      let drafts: any[] = [];

      if (!apiKey) {
        drafts = types.flatMap((t: string) => [
          {
            draft_type: t,
            draft_text: language === "Arabic"
              ? `[${t}] مسودة عامة — بيانات محدودة`
              : language === "Hebrew" ? `[${t}] טיוטה כללית — נתונים מוגבלים`
              : language === "Turkish" ? `[${t}] Genel taslak — sınırlı veri`
              : `[${t}] Generic draft — limited data`,
            inspiration_source: "AI not available — fallback draft",
            quality_reason: "Low confidence — AI service not configured.",
            confidence_level: "low",
          },
          {
            draft_type: t,
            draft_text: language === "Arabic"
              ? `[${t}] استثمر في عقارات فاخرة مع Kinglike`
              : language === "Hebrew" ? `[${t}] השקיעו בנדל"ן יוקרתי עם Kinglike`
              : language === "Turkish" ? `[${t}] Kinglike ile lüks gayrimenkule yatırım yapın`
              : `[${t}] Invest in luxury real estate with Kinglike`,
            inspiration_source: "Generic brand template",
            quality_reason: "Low confidence — generic template, no AI context.",
            confidence_level: "low",
          },
        ]);
      } else {
        const { default: OpenAI } = await import("openai");
        const openaiClient = new OpenAI({ apiKey });

        const systemPrompt = `You are an expert luxury real estate advertising copywriter for Meta (Facebook/Instagram) campaigns.
You write for Kinglike Luxury Real Estate — a premium brand with properties in Georgia, Turkey, UAE, and North Cyprus.
Brand tone: Premium, trustworthy, investment-focused. NOT pushy. NOT salesy.
Arabic drafts use modern Gulf-standard Arabic (فصحى معاصرة). Never translated English.
Return ONLY a valid JSON object with a "drafts" array. No markdown. No explanation.`;

        const userPrompt = `Generate ad creative drafts for a Meta campaign.
Project: ${project_name || 'Luxury Real Estate'}
Target Market: ${target_market || 'Arab investors'}
Language: ${language}
Goal: ${goalLabel[goal] || goal}
Draft types needed: ${types.join(', ')} (2 variations each)

${hasIntelligence
  ? `Historical Performance (last 90 days):
Overall HOT rate: ${hotRate}% from ${stats.total} leads
Top Performing Ads:
${topCreativesContext}
Use this to inspire tone. Do NOT quote specific numbers in ad copy.`
  : `No historical data — generate conservative generic drafts.`}

${knowledgeCtx}Rules:
- Never promise ROI or guaranteed returns
- No misleading investment claims
- For image_concept / video_concept: describe the visual direction in ${language}
- All text in ${language}

Return JSON: { "drafts": [ { "draft_type": "...", "draft_text": "...", "inspiration_source": "...", "quality_reason": "...", "confidence_level": "low|medium|high" } ] }`;

        const completion = await openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt   },
          ],
          max_tokens: 3000,
          temperature: 0.75,
          response_format: { type: "json_object" },
        });

        try {
          const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
          drafts = Array.isArray(parsed) ? parsed : (parsed.drafts || parsed.items || parsed.data || []);
        } catch {
          drafts = [];
        }
      }

      const safe = drafts.map((d: any) => ({
        draft_type:         String(d.draft_type || "headline"),
        draft_text:         String(d.draft_text || ""),
        inspiration_source: String(d.inspiration_source || "AI generated"),
        quality_reason:     String(d.quality_reason || ""),
        confidence_level:   ["low","medium","high"].includes(d.confidence_level) ? d.confidence_level : "low",
        project_name, target_market, language, goal,
      }));

      console.log(`[CreativeDraftGen] Generated ${safe.length} drafts — "${project_name}" ${language} ${goal} intelligence=${hasIntelligence}`);
      res.json({ ok: true, drafts: safe, intelligence_used: hasIntelligence, confidence: confidenceLabel });
    } catch (err: any) {
      console.error("[CreativeDraftGen] error:", err.message);
      res.status(500).json({ ok: false, error: err.message, drafts: [] });
    }
  });

  // POST /api/admin/ai-marketing/creative-drafts — save a single draft to DB
  app.post("/api/admin/ai-marketing/creative-drafts", isAdmin, async (req, res) => {
    try {
      const { draft_type, project_name, target_market, language, draft_text,
              inspiration_source, related_campaign_id, related_creative_id,
              quality_reason, goal, confidence_level } = req.body;
      if (!draft_text) return res.status(400).json({ error: "draft_text is required" });
      const r = await pool.query(`
        INSERT INTO ai_creative_drafts
          (draft_type, project_name, target_market, language, draft_text, inspiration_source,
           related_campaign_id, related_creative_id, quality_reason, goal, confidence_level,
           status, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft','admin')
        RETURNING *
      `, [draft_type||'headline', project_name||null, target_market||null, language||null,
          draft_text, inspiration_source||null, related_campaign_id||null, related_creative_id||null,
          quality_reason||null, goal||null, confidence_level||'low']);
      res.json({ ok: true, draft: r.rows[0] });
    } catch (err: any) {
      console.error("[CreativeDrafts] save error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/creative-drafts — list all saved drafts
  app.get("/api/admin/ai-marketing/creative-drafts", isAdmin, async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM ai_creative_drafts ORDER BY created_at DESC LIMIT 200`);
      res.json({ ok: true, drafts: r.rows });
    } catch (err: any) {
      console.error("[CreativeDrafts] list error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/admin/ai-marketing/creative-drafts/:id — update status
  app.patch("/api/admin/ai-marketing/creative-drafts/:id", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      const allowed = ["draft", "reviewed", "approved_internally", "archived"];
      if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
      const r = await pool.query(
        `UPDATE ai_creative_drafts SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
        [status, id]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: "Draft not found" });
      res.json({ ok: true, draft: r.rows[0] });
    } catch (err: any) {
      console.error("[CreativeDrafts] patch error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/ai-marketing/creative-drafts/:id
  app.delete("/api/admin/ai-marketing/creative-drafts/:id", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await pool.query(`DELETE FROM ai_creative_drafts WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[CreativeDrafts] delete error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 11 — Campaign Draft Builder
  // Admin-only. Internal drafts only. Zero Meta write actions. Railway compatible.
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /api/admin/ai-marketing/campaign-drafts/generate
  // Generates a full campaign draft using AI. Nothing is saved to DB until admin saves.
  app.post("/api/admin/ai-marketing/campaign-drafts/generate", isAdmin, async (req, res) => {
    try {
      const {
        project_name = "", target_market = "", language = "Arabic",
        goal = "more_hot_leads", daily_budget_amount = "", daily_budget_currency = "USD",
        country = "", city_region = "", age_min = "25", age_max = "55", audience_notes = "",
      } = req.body as Record<string, string>;

      const NA = `('no_answer_1','no_answer_2','no_answer_3','no_answer_4','after_3_no_answer_whatsapp_contacted','new_fresh_after_3_no_answer','no_answer_converted')`;

      // Pull creative intelligence for context
      const topCreatives = await pool.query(`
        SELECT ca.ad_name, ca.campaign_name,
          COUNT(DISTINCT cl.id) AS total_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='hot')  AS hot_leads,
          COUNT(DISTINCT cl.id) FILTER(WHERE cl.status IN ${NA})   AS no_answer_leads,
          (COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='hot')*3
           + COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='warm')
           - COUNT(DISTINCT cl.id) FILTER(WHERE cl.lead_score='cold')
           - COUNT(DISTINCT cl.id) FILTER(WHERE cl.status IN ${NA})*2) AS quality_score
        FROM ai_creative_attribution ca
        LEFT JOIN ai_campaign_attribution aca ON aca.ad_id = ca.ad_id
        LEFT JOIN crm_leads cl ON cl.id = aca.crm_lead_id
        GROUP BY ca.id, ca.ad_name, ca.campaign_name
        HAVING COUNT(DISTINCT cl.id) > 0
        ORDER BY quality_score DESC LIMIT 3
      `);

      const leadsStats = await pool.query(`
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER(WHERE lead_score='hot') AS hot,
          COUNT(*) FILTER(WHERE status IN ${NA})  AS no_answer
        FROM crm_leads WHERE created_at >= NOW() - INTERVAL '90 days'
      `);
      const stats = leadsStats.rows[0];
      const hotRate = Number(stats.total) > 0 ? Math.round((Number(stats.hot) / Number(stats.total)) * 100) : 0;
      const hasIntelligence = topCreatives.rows.length > 0;

      const goalLabel: Record<string, string> = {
        more_hot_leads:    "increase HOT lead conversion rate",
        lower_no_answer:   "reduce No Answer rate",
        more_appointments: "drive appointment bookings",
        test_new_angle:    "test a fresh creative angle",
      };

      const intelligenceCtx = hasIntelligence
        ? `Historical 90d data: Overall HOT rate ${hotRate}% from ${stats.total} leads.\nTop creatives: ${
            topCreatives.rows.map((r: any, i: number) =>
              `${i+1}. "${r.ad_name || 'Unknown'}" | ${r.hot_leads} HOT / ${r.no_answer_leads} No Answer`
            ).join('; ')
          }`
        : "No historical campaign data available — generate conservative generic draft.";

      const knowledgeCtx = await getProjectKnowledge(project_name);
      const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
      let result: any = null;

      if (!apiKey) {
        // Fallback: structured generic draft without AI
        result = {
          campaign_name:     `${project_name || 'Kinglike'} — ${language} Lead Campaign`,
          strategy_reason:   "Low confidence — AI service not configured. Generic draft template.",
          confidence_level:  "low",
          safety_warnings:   ["Low confidence — limited data. Review all copy before use."],
          adset: {
            adset_name:       `${target_market || 'Audience'} — ${country || 'General'} ${age_min}-${age_max}`,
            interests:        ["Real estate", "Property investment", "Luxury homes"],
            exclusions:       ["Existing customers"],
            placement_notes:  "Facebook and Instagram feeds recommended.",
            budget_notes:     `Daily budget: ${daily_budget_amount || 'TBD'} ${daily_budget_currency}.`,
          },
          audience: {
            audience_name:  `${target_market || 'Target Audience'}`,
            age_range:      `${age_min}–${age_max}`,
            interests:      ["Real estate", "Investment", "Luxury living"],
            exclusions:     [],
            quality_reason: "Generic audience — refine based on historical data.",
          },
          lead_form: {
            form_name:          `${project_name || 'Property'} Interest Form`,
            intro_text:         language === "Arabic" ? "أخبرنا عن اهتمامك بالاستثمار العقاري" : "Tell us about your property investment interest",
            questions:          [
              { text: language === "Arabic" ? "ما هي ميزانيتك التقريبية؟" : "What is your approximate budget?", type: "multiple_choice" },
              { text: language === "Arabic" ? "متى تخطط للشراء؟" : "When are you planning to purchase?", type: "multiple_choice" },
              { text: language === "Arabic" ? "ما هو هدفك من الاستثمار؟" : "What is your investment goal?", type: "multiple_choice" },
              { text: language === "Arabic" ? "ما هي المدينة المفضلة لديك؟" : "Which city do you prefer?", type: "multiple_choice" },
              { text: language === "Arabic" ? "كيف تفضل أن نتواصل معك؟" : "How do you prefer to be contacted?", type: "multiple_choice" },
            ],
            privacy_note:       language === "Arabic" ? "بياناتك محمية ولن تُشارك مع أطراف ثالثة." : "Your data is protected and will not be shared with third parties.",
            qualification_goal: goalLabel[goal] || goal,
          },
        };
      } else {
        const { default: OpenAI } = await import("openai");
        const openaiClient = new OpenAI({ apiKey });

        const systemPrompt = `You are an expert Meta advertising strategist for luxury real estate. You generate internal campaign planning drafts (not for publishing).
Brand: Kinglike Luxury Real Estate — properties in Georgia, Turkey, UAE, North Cyprus.
Return ONLY valid JSON. No markdown. No explanation.`;

        const userPrompt = `Generate a complete Meta Lead Form campaign draft for internal planning.

Project: ${project_name || 'Luxury Real Estate'}
Target Market: ${target_market || 'Arab investors'}
Language: ${language}
Goal: ${goalLabel[goal] || goal}
Daily Budget: ${daily_budget_amount || 'TBD'} ${daily_budget_currency}
Country: ${country || 'General'}
City/Region: ${city_region || 'General'}
Age Range: ${age_min}–${age_max}
Audience Notes: ${audience_notes || 'None'}

${intelligenceCtx}
${knowledgeCtx}
Return this exact JSON structure:
{
  "campaign_name": "descriptive campaign name",
  "strategy_reason": "why this strategy makes sense based on available data",
  "confidence_level": "low|medium|high",
  "safety_warnings": ["warning if any — empty array if none"],
  "adset": {
    "adset_name": "...",
    "interests": ["interest1", "interest2"],
    "exclusions": ["exclusion1"],
    "placement_notes": "placement recommendation",
    "budget_notes": "budget allocation notes"
  },
  "audience": {
    "audience_name": "...",
    "age_range": "${age_min}–${age_max}",
    "interests": ["interest1", "interest2"],
    "exclusions": ["exclusion1"],
    "quality_reason": "why this audience targets quality leads"
  },
  "lead_form": {
    "form_name": "...",
    "intro_text": "compelling intro in ${language}",
    "questions": [
      {"text": "question in ${language}", "type": "multiple_choice|short_answer|number"}
    ],
    "privacy_note": "privacy reassurance in ${language}",
    "qualification_goal": "what this form is designed to qualify"
  }
}

Rules:
- NEVER promise ROI or guaranteed returns
- NEVER include misleading investment claims
- Lead form questions must NOT ask for sensitive personal data (no ID numbers, no income proof, no bank details)
- Lead form questions must NOT be discriminatory
- Max 5 lead form questions
- All user-facing text (intro, questions, privacy note) must be in ${language}
- campaign_name, strategy_reason, adset/audience notes can be in English`;

        const completion = await openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          max_tokens: 2500,
          temperature: 0.7,
          response_format: { type: "json_object" },
        });

        try {
          result = JSON.parse(completion.choices[0]?.message?.content || "{}");
        } catch {
          result = null;
        }
      }

      if (!result) return res.status(500).json({ ok: false, error: "Failed to parse AI response", result: null });

      // Auto safety checks
      const allText = JSON.stringify(result).toLowerCase();
      const safetyChecks = {
        no_roi_promise:      !/(guaranteed?\s+return|100%\s+profit|roi\s+guarantee|assured\s+profit)/.test(allText),
        no_guaranteed_return:!/(guaranteed?\s+return|sure\s+profit|certain\s+gain)/.test(allText),
        no_fake_price:       true,
        no_discriminatory:   !/(race|religion|ethnic|gender\s+discrimination|national\s+origin)/.test(allText),
        no_sensitive_data:   !/(passport\s+number|national\s+id|ssn|income\s+proof|bank\s+statement|tax\s+return)/.test(allText),
        draft_only:          true,
      };

      console.log(`[CampaignDraftGen] Generated — "${result.campaign_name}" ${language} confidence=${result.confidence_level} intelligence=${hasIntelligence}`);
      res.json({
        ok: true,
        result: { ...result, project_name, target_market, language, goal, daily_budget_amount, daily_budget_currency, country, city_region, age_min, age_max },
        safety_checks: safetyChecks,
        intelligence_used: hasIntelligence,
      });
    } catch (err: any) {
      console.error("[CampaignDraftGen] error:", err.message);
      res.status(500).json({ ok: false, error: err.message, result: null });
    }
  });

  // POST /api/admin/ai-marketing/campaign-drafts — save full campaign draft (transactional)
  app.post("/api/admin/ai-marketing/campaign-drafts", isAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const { campaign, adset, audience, lead_form, creatives = [] } = req.body as {
        campaign: any; adset: any; audience: any; lead_form: any; creatives?: any[];
      };
      if (!campaign?.campaign_name) return res.status(400).json({ error: "campaign_name is required" });

      await client.query("BEGIN");

      const cRow = await client.query(`
        INSERT INTO ai_campaign_drafts
          (campaign_name, project_name, target_market, language, objective, daily_budget_amount,
           daily_budget_currency, goal, strategy_reason, confidence_level, safety_warnings, status, created_by)
        VALUES ($1,$2,$3,$4,'lead_form',$5,$6,$7,$8,$9,$10,'draft','admin') RETURNING id
      `, [campaign.campaign_name, campaign.project_name||null, campaign.target_market||null,
          campaign.language||null, campaign.daily_budget_amount||null, campaign.daily_budget_currency||'USD',
          campaign.goal||null, campaign.strategy_reason||null, campaign.confidence_level||'low',
          JSON.stringify(campaign.safety_warnings||[])]);
      const campId = cRow.rows[0].id;

      if (adset) await client.query(`
        INSERT INTO ai_adset_drafts (campaign_draft_id,adset_name,country,city_region,language,age_min,age_max,interests,exclusions,placement_notes,budget_notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [campId, adset.adset_name||null, adset.country||null, adset.city_region||null, adset.language||null,
          parseInt(adset.age_min)||18, parseInt(adset.age_max)||65,
          JSON.stringify(adset.interests||[]), JSON.stringify(adset.exclusions||[]),
          adset.placement_notes||null, adset.budget_notes||null]);

      if (audience) await client.query(`
        INSERT INTO ai_audience_drafts (campaign_draft_id,audience_name,market,country,language,age_range,interests,exclusions,quality_reason,confidence_level)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [campId, audience.audience_name||null, audience.market||null, audience.country||null,
          audience.language||null, audience.age_range||null,
          JSON.stringify(audience.interests||[]), JSON.stringify(audience.exclusions||[]),
          audience.quality_reason||null, audience.confidence_level||'low']);

      if (lead_form) await client.query(`
        INSERT INTO ai_lead_form_drafts (campaign_draft_id,form_name,intro_text,questions_json,privacy_note,qualification_goal)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [campId, lead_form.form_name||null, lead_form.intro_text||null,
          JSON.stringify(lead_form.questions||[]), lead_form.privacy_note||null, lead_form.qualification_goal||null]);

      for (const c of (creatives as any[])) {
        await client.query(`
          INSERT INTO ai_campaign_draft_creatives (campaign_draft_id,creative_draft_id,draft_type,draft_text,reason_selected)
          VALUES ($1,$2,$3,$4,$5)
        `, [campId, c.creative_draft_id||null, c.draft_type||null, c.draft_text||null, c.reason_selected||null]);
      }

      await client.query("COMMIT");
      console.log(`[CampaignDrafts] Saved campaign draft id=${campId} "${campaign.campaign_name}"`);
      res.json({ ok: true, campaign_draft_id: campId });
    } catch (err: any) {
      await client.query("ROLLBACK");
      console.error("[CampaignDrafts] save error:", err.message);
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // GET /api/admin/ai-marketing/campaign-drafts — list all drafts
  app.get("/api/admin/ai-marketing/campaign-drafts", isAdmin, async (_req, res) => {
    try {
      const r = await pool.query(`SELECT * FROM ai_campaign_drafts ORDER BY created_at DESC LIMIT 100`);
      res.json({ ok: true, drafts: r.rows });
    } catch (err: any) {
      console.error("[CampaignDrafts] list error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/campaign-drafts/:id — get one draft with all sub-records
  app.get("/api/admin/ai-marketing/campaign-drafts/:id", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [camp, adsets, audiences, forms, creatives] = await Promise.all([
        pool.query(`SELECT * FROM ai_campaign_drafts WHERE id=$1`, [id]),
        pool.query(`SELECT * FROM ai_adset_drafts WHERE campaign_draft_id=$1`, [id]),
        pool.query(`SELECT * FROM ai_audience_drafts WHERE campaign_draft_id=$1`, [id]),
        pool.query(`SELECT * FROM ai_lead_form_drafts WHERE campaign_draft_id=$1`, [id]),
        pool.query(`SELECT * FROM ai_campaign_draft_creatives WHERE campaign_draft_id=$1`, [id]),
      ]);
      if (camp.rowCount === 0) return res.status(404).json({ error: "Draft not found" });
      res.json({
        ok: true,
        campaign: camp.rows[0],
        adset: adsets.rows[0] || null,
        audience: audiences.rows[0] || null,
        lead_form: forms.rows[0] || null,
        creatives: creatives.rows,
      });
    } catch (err: any) {
      console.error("[CampaignDrafts] get error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/admin/ai-marketing/campaign-drafts/:id — update status
  app.patch("/api/admin/ai-marketing/campaign-drafts/:id", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      const allowed = ["draft", "reviewed", "approved_internally", "archived"];
      if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
      const r = await pool.query(
        `UPDATE ai_campaign_drafts SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
        [status, id]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: "Draft not found" });
      res.json({ ok: true, draft: r.rows[0] });
    } catch (err: any) {
      console.error("[CampaignDrafts] patch error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/ai-marketing/campaign-drafts/:id — cascades to all sub-records
  app.delete("/api/admin/ai-marketing/campaign-drafts/:id", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await pool.query(`DELETE FROM ai_campaign_drafts WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[CampaignDrafts] delete error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 14 — Performance Learning Engine
  // Admin-only. Read-only analysis of real historical data. Zero Meta write actions.
  // Sources: crm_leads, ai_campaign_performance, ai_marketing_learning_history
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /api/admin/ai-marketing/learning/compute
  // Runs SQL analysis on real historical data, discovers patterns, stores snapshot.
  // No fabrication — "Insufficient historical data" returned when sample < 3.
  app.post("/api/admin/ai-marketing/learning/compute", isAdmin, async (_req, res) => {
    try {
      // Helper: confidence by sample size
      const conf = (n: number) => n >= 100 ? "high" : n >= 20 ? "medium" : "low";
      const rate = (hot: number, total: number) => total > 0 ? parseFloat((hot / total * 100).toFixed(1)) : 0;
      const toInt = (v: any) => parseInt(v) || 0;

      // 1 — CRM overview (all leads)
      const ovRes = await pool.query(`
        SELECT
          COUNT(*)                                                 AS total_leads,
          COUNT(CASE WHEN lead_score = 'hot'     THEN 1 END)      AS hot_count,
          COUNT(CASE WHEN lead_score = 'warm'    THEN 1 END)      AS warm_count,
          COUNT(CASE WHEN lead_score = 'cold'    THEN 1 END)      AS cold_count,
          COUNT(CASE WHEN status    = 'no_answer' THEN 1 END)     AS no_answer_count
        FROM crm_leads
      `);
      const ov = ovRes.rows[0];
      const totalLeads = toInt(ov.total_leads);
      const hotCount   = toInt(ov.hot_count);

      // 2 — Helper query builder for segment analysis
      const segQuery = (groupCol: string, whereClause = "") => pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(${groupCol}), ''), 'Unknown') AS segment,
          COUNT(*)                                            AS total,
          COUNT(CASE WHEN lead_score = 'hot'      THEN 1 END) AS hot,
          COUNT(CASE WHEN lead_score = 'warm'     THEN 1 END) AS warm,
          COUNT(CASE WHEN lead_score = 'cold'     THEN 1 END) AS cold,
          COUNT(CASE WHEN status    = 'no_answer' THEN 1 END) AS no_ans
        FROM crm_leads
        ${whereClause}
        GROUP BY 1
        HAVING COUNT(*) >= 3
        ORDER BY COUNT(CASE WHEN lead_score='hot' THEN 1 END) DESC NULLS LAST,
                 COUNT(*) DESC
        LIMIT 20
      `);

      const toPerf = (rows: any[]) => rows.map(r => ({
        segment:    r.segment,
        total:      toInt(r.total),
        hot:        toInt(r.hot),
        warm:       toInt(r.warm),
        cold:       toInt(r.cold),
        no_ans:     toInt(r.no_ans),
        hot_rate:   rate(toInt(r.hot), toInt(r.total)),
        confidence: conf(toInt(r.total)),
      }));

      const [marketRes, campaignRes, sourceRes, projectRes] = await Promise.all([
        segQuery("country"),
        segQuery("campaign_name"),
        segQuery("lead_source"),
        segQuery("project_interest", "WHERE project_interest IS NOT NULL AND TRIM(project_interest) != ''"),
      ]);

      const marketData   = toPerf(marketRes.rows);
      const campaignData = toPerf(campaignRes.rows);
      const sourceData   = toPerf(sourceRes.rows);
      const projectData  = toPerf(projectRes.rows);

      // 3 — Cross-dimension patterns (country × campaign_name, minimum 5 leads)
      const patRes = await pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(country),''),'Unknown') || ' × ' ||
          COALESCE(NULLIF(TRIM(campaign_name),''),'Unknown') AS pattern,
          'market_campaign'                                   AS pattern_type,
          COUNT(*)                                            AS sample_size,
          COUNT(CASE WHEN lead_score='hot' THEN 1 END)        AS hot_count
        FROM crm_leads
        WHERE country IS NOT NULL AND TRIM(country) != ''
          AND campaign_name IS NOT NULL AND TRIM(campaign_name) != ''
        GROUP BY country, campaign_name
        HAVING COUNT(*) >= 5
        ORDER BY COUNT(CASE WHEN lead_score='hot' THEN 1 END)::float /
                 NULLIF(COUNT(*), 0) DESC NULLS LAST
        LIMIT 15
      `);

      const patterns = patRes.rows.map((r: any) => {
        const sz   = toInt(r.sample_size);
        const hot  = toInt(r.hot_count);
        const hr   = rate(hot, sz);
        return {
          pattern:        r.pattern,
          type:           r.pattern_type,
          sample_size:    sz,
          hot_count:      hot,
          hot_rate:       hr,
          confidence:     conf(sz),
          recommendation: hr >= 15
            ? `Prioritize ${r.pattern} — HOT rate ${hr}% from ${sz} leads`
            : hr < 5
            ? `Review ${r.pattern} spend — HOT rate only ${hr}% from ${sz} leads`
            : `Monitor ${r.pattern} — HOT rate ${hr}% from ${sz} leads`,
        };
      });

      // 4 — Also merge ai_campaign_performance (pre-aggregated) for richer data
      const cpRes = await pool.query(
        `SELECT entity_type, entity_name, leads_count, hot_leads, warm_leads, cold_leads, no_answer_count
         FROM ai_campaign_performance WHERE leads_count >= 3
         ORDER BY hot_leads DESC NULLS LAST LIMIT 20`
      ).catch(() => ({ rows: [] as any[] }));

      // 5 — Pull ai_marketing_learning_history for manually logged data
      const histRes = await pool.query(
        `SELECT entity_type, entity_name, leads_count, hot_count, warm_count, cold_count, no_answer_count
         FROM ai_marketing_learning_history WHERE leads_count >= 5
         ORDER BY hot_count DESC NULLS LAST LIMIT 30`
      ).catch(() => ({ rows: [] as any[] }));

      // 6 — Build evidence-backed recommendations (only when data supports)
      const recs: any[] = [];

      const addRec = (
        type: string, seg: string, hr: number, hot: number, total: number, c: string, prefix = ""
      ) => {
        if (total >= 10 && hr >= 15) {
          recs.push({
            type,
            recommendation: `${prefix}${seg} — HOT rate ${hr}% (${hot}/${total} leads)`,
            reason:         `${seg} shows above-average lead quality based on ${total} real leads`,
            confidence: c, hot_rate: hr, sample_size: total,
          });
        } else if (total >= 10 && hr < 5) {
          recs.push({
            type: type + "_warning",
            recommendation: `Review ${seg} spend — HOT rate ${hr}% from ${total} leads`,
            reason:         `Below-average quality — consider reallocating budget`,
            confidence: c, hot_rate: hr, sample_size: total,
          });
        }
      };

      marketData.slice(0, 5).forEach(m   => addRec("market",   m.segment,  m.hot_rate, m.hot, m.total, m.confidence, "Prioritize "));
      campaignData.slice(0, 5).forEach(c => addRec("campaign", c.segment, c.hot_rate, c.hot, c.total, c.confidence, "Scale "));
      sourceData.slice(0, 3).forEach(s   => addRec("source",   s.segment,  s.hot_rate, s.hot, s.total, s.confidence));

      histRes.rows.forEach((h: any) => {
        const t  = toInt(h.leads_count);
        const ht = toInt(h.hot_count);
        if (t >= 20 && ht > 0) {
          const hr = rate(ht, t);
          if (hr >= 15) recs.push({
            type: "historical",
            recommendation: `${h.entity_name} (${h.entity_type}) — HOT rate ${hr}% from ${t} leads`,
            reason: "From manual learning history data",
            confidence: conf(t), hot_rate: hr, sample_size: t,
          });
        }
      });

      // 7 — Store snapshot
      const snapRes = await pool.query(
        `INSERT INTO ai_learning_snapshots
           (total_leads, hot_count, market_data, campaign_data, source_data, project_data, pattern_data, recommendations)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, computed_at`,
        [
          totalLeads, hotCount,
          JSON.stringify(marketData), JSON.stringify(campaignData),
          JSON.stringify(sourceData),  JSON.stringify(projectData),
          JSON.stringify(patterns),    JSON.stringify(recs),
        ]
      );
      const snapId = snapRes.rows[0].id;

      // 8 — Store individual patterns
      for (const p of patterns) {
        await pool.query(
          `INSERT INTO ai_learning_patterns
             (snapshot_id, pattern_type, pattern_name, sample_size, hot_count, hot_rate, confidence, recommendation)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [snapId, p.type, p.pattern, p.sample_size, p.hot_count, p.hot_rate, p.confidence, p.recommendation]
        );
      }

      console.log(`[LearningEngine] Snapshot #${snapId} — ${totalLeads} leads | ${patterns.length} patterns | ${recs.length} recs`);
      res.json({
        ok: true, snapshot_id: snapId,
        computed_at: snapRes.rows[0].computed_at,
        total_leads: totalLeads, patterns_found: patterns.length, recs_found: recs.length,
      });
    } catch (err: any) {
      console.error("[LearningEngine] compute error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/learning/engine — latest snapshot + patterns
  app.get("/api/admin/ai-marketing/learning/engine", isAdmin, async (_req, res) => {
    try {
      const snapRes = await pool.query(
        `SELECT * FROM ai_learning_snapshots ORDER BY computed_at DESC LIMIT 1`
      ).catch(() => ({ rows: [] as any[] }));

      if (!snapRes.rows.length) {
        return res.json({ ok: true, has_data: false, snapshot: null, patterns: [] });
      }
      const s = snapRes.rows[0];
      const patRes = await pool.query(
        `SELECT * FROM ai_learning_patterns WHERE snapshot_id=$1 ORDER BY hot_rate DESC`,
        [s.id]
      ).catch(() => ({ rows: [] as any[] }));

      res.json({
        ok: true, has_data: true,
        snapshot: {
          id: s.id, computed_at: s.computed_at,
          total_leads:     s.total_leads,
          hot_count:       s.hot_count,
          market_data:     s.market_data     || [],
          campaign_data:   s.campaign_data   || [],
          source_data:     s.source_data     || [],
          project_data:    s.project_data    || [],
          pattern_data:    s.pattern_data    || [],
          recommendations: s.recommendations || [],
        },
        patterns: patRes.rows,
      });
    } catch (err: any) {
      console.error("[LearningEngine] get error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/learning/engine/export — JSON download
  app.get("/api/admin/ai-marketing/learning/engine/export", isAdmin, async (_req, res) => {
    try {
      const snapRes = await pool.query(
        `SELECT * FROM ai_learning_snapshots ORDER BY computed_at DESC LIMIT 1`
      );
      if (!snapRes.rows.length) return res.status(404).json({ ok: false, error: "No learning data yet" });
      const s = snapRes.rows[0];
      res.setHeader("Content-Disposition", "attachment; filename=kinglike-learning-report.json");
      res.setHeader("Content-Type", "application/json");
      res.json({
        report:              "Kinglike Luxury Performance Learning Report",
        computed_at:         s.computed_at,
        total_leads:         s.total_leads,
        hot_count:           s.hot_count,
        market_performance:  s.market_data,
        campaign_performance:s.campaign_data,
        lead_source_performance: s.source_data,
        project_performance: s.project_data,
        patterns:            s.pattern_data,
        recommendations:     s.recommendations,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 14.5 — Data Quality Audit Engine (STRICT READ-ONLY)
  // Admin-only. Zero writes. Zero modifications. Aggregate stats only.
  // Sources read: crm_leads, ai_campaign_attribution, ai_creative_attribution
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/admin/ai-marketing/learning/data-quality
  // Read-only audit of coverage across CRM fields and attribution tables.
  app.get("/api/admin/ai-marketing/learning/data-quality", isAdmin, async (_req, res) => {
    try {
      const toInt = (v: any) => parseInt(v) || 0;
      const pct   = (have: number, total: number) => total > 0 ? parseFloat((have / total * 100).toFixed(1)) : 0;

      // ── 1. CRM field coverage (crm_leads) ──────────────────────────────────
      const crmRes = await pool.query(`
        SELECT
          COUNT(*)                                                                    AS total,
          COUNT(NULLIF(TRIM(COALESCE(campaign_name,'')),  ''))                       AS has_campaign_name,
          COUNT(NULLIF(TRIM(COALESCE(campaign_id::text,'')), ''))                    AS has_campaign_id,
          COUNT(NULLIF(TRIM(COALESCE(adset_name,'')),     ''))                       AS has_adset_name,
          COUNT(NULLIF(TRIM(COALESCE(adset_id::text,'')), ''))                       AS has_adset_id,
          COUNT(NULLIF(TRIM(COALESCE(ad_name,'')),        ''))                       AS has_ad_name,
          COUNT(NULLIF(TRIM(COALESCE(ad_id::text,'')),    ''))                       AS has_ad_id,
          COUNT(NULLIF(TRIM(COALESCE(country,'')),        ''))                       AS has_country,
          COUNT(NULLIF(TRIM(COALESCE(project_interest,'')), ''))                     AS has_project_interest,
          COUNT(NULLIF(TRIM(COALESCE(lead_source,'')),    ''))                       AS has_lead_source,
          COUNT(NULLIF(TRIM(COALESCE(status,'')),         ''))                       AS has_status,
          COUNT(assigned_to)                                                          AS has_assigned_user,
          COUNT(created_at)                                                           AS has_created_at
        FROM crm_leads
      `);
      const cr = crmRes.rows[0];
      const total = toInt(cr.total);

      const crmFields = [
        { field: "campaign_name",    populated: toInt(cr.has_campaign_name),    total },
        { field: "campaign_id",      populated: toInt(cr.has_campaign_id),      total },
        { field: "adset_name",       populated: toInt(cr.has_adset_name),       total },
        { field: "adset_id",         populated: toInt(cr.has_adset_id),         total },
        { field: "ad_name",          populated: toInt(cr.has_ad_name),          total },
        { field: "ad_id",            populated: toInt(cr.has_ad_id),            total },
        { field: "country",          populated: toInt(cr.has_country),          total },
        { field: "project_interest", populated: toInt(cr.has_project_interest), total },
        { field: "lead_source",      populated: toInt(cr.has_lead_source),      total },
        { field: "status",           populated: toInt(cr.has_status),           total },
        { field: "assigned_user",    populated: toInt(cr.has_assigned_user),    total },
        { field: "created_at",       populated: toInt(cr.has_created_at),       total },
      ].map(f => ({
        ...f,
        missing:  f.total - f.populated,
        coverage: pct(f.populated, f.total),
      }));

      // ── 2. Attribution coverage (ai_campaign_attribution) ──────────────────
      const attrCampRes = await pool.query(`
        SELECT
          COUNT(*)                                                   AS total,
          COUNT(NULLIF(TRIM(COALESCE(campaign_id::text,'')), ''))    AS has_campaign_id,
          COUNT(NULLIF(TRIM(COALESCE(adset_id::text,'')),   ''))     AS has_adset_id,
          COUNT(NULLIF(TRIM(COALESCE(ad_id::text,'')),      ''))     AS has_ad_id
        FROM ai_campaign_attribution
      `).catch(() => ({ rows: [{ total: 0, has_campaign_id: 0, has_adset_id: 0, has_ad_id: 0 }] }));
      const ac = attrCampRes.rows[0];
      const attrTotal = toInt(ac.total);
      const campaignAttr = {
        total: attrTotal,
        with_campaign_id: toInt(ac.has_campaign_id),
        with_adset_id:    toInt(ac.has_adset_id),
        with_ad_id:       toInt(ac.has_ad_id),
        campaign_id_pct:  pct(toInt(ac.has_campaign_id), attrTotal),
        adset_id_pct:     pct(toInt(ac.has_adset_id),    attrTotal),
        ad_id_pct:        pct(toInt(ac.has_ad_id),        attrTotal),
      };

      // ── 3. Creative attribution coverage (ai_creative_attribution) ──────────
      const attrCreRes = await pool.query(`
        SELECT
          COUNT(*)                                                     AS total,
          COUNT(NULLIF(TRIM(COALESCE(lead_id::text,'')), ''))          AS linked
        FROM ai_creative_attribution
      `).catch(() => ({ rows: [{ total: 0, linked: 0 }] }));
      const ae = attrCreRes.rows[0];
      const creativeAttrTotal  = toInt(ae.total);
      const creativeAttrLinked = toInt(ae.linked);
      const creativeAttr = {
        total:    creativeAttrTotal,
        linked:   creativeAttrLinked,
        unlinked: creativeAttrTotal - creativeAttrLinked,
        coverage: pct(creativeAttrLinked, creativeAttrTotal),
      };

      // ── 4. Learning blockers (evidence-based only) ─────────────────────────
      const blockers: { severity: string; message: string; evidence: string }[] = [];

      const findCov = (f: string) => crmFields.find(x => x.field === f)?.coverage ?? 0;
      const findPop = (f: string) => crmFields.find(x => x.field === f)?.populated ?? 0;

      const campaignNameCov = findCov("campaign_name");
      const campaignIdCov   = findCov("campaign_id");
      const adsetNameCov    = findCov("adset_name");
      const adsetIdCov      = findCov("adset_id");
      const adNameCov       = findCov("ad_name");
      const adIdCov         = findCov("ad_id");
      const countryCov      = findCov("country");
      const projIntCov      = findCov("project_interest");
      const leadSrcCov      = findCov("lead_source");
      const statusCov       = findCov("status");
      const assignedCov     = findCov("assigned_user");

      if (campaignNameCov < 50)
        blockers.push({ severity: "critical", message: `Patterns cannot be generated because campaign_name coverage is only ${campaignNameCov}%.`, evidence: `${findPop("campaign_name")} of ${total} leads have campaign_name populated.` });
      if (campaignIdCov < 50)
        blockers.push({ severity: "critical", message: `Campaign-level performance learning is blocked — campaign_id coverage is only ${campaignIdCov}%.`, evidence: `${findPop("campaign_id")} of ${total} leads have campaign_id populated.` });
      if (adsetNameCov < 30)
        blockers.push({ severity: "high", message: `Ad set analysis unavailable — adset_name coverage is ${adsetNameCov}%.`, evidence: `${findPop("adset_name")} of ${total} leads have adset_name.` });
      if (adsetIdCov < 30)
        blockers.push({ severity: "high", message: `Ad set attribution blocked — adset_id coverage is ${adsetIdCov}%.`, evidence: `${findPop("adset_id")} of ${total} leads have adset_id.` });
      if (adNameCov < 30)
        blockers.push({ severity: "high", message: `Ad-level creative performance analysis unavailable — ad_name coverage is ${adNameCov}%.`, evidence: `${findPop("ad_name")} of ${total} leads have ad_name.` });
      if (adIdCov < 30)
        blockers.push({ severity: "high", message: `Ad attribution blocked — ad_id coverage is ${adIdCov}%.`, evidence: `${findPop("ad_id")} of ${total} leads have ad_id.` });
      if (countryCov < 50)
        blockers.push({ severity: "high", message: `Market performance analysis limited — country coverage is only ${countryCov}%.`, evidence: `${findPop("country")} of ${total} leads have country set.` });
      if (projIntCov < 30)
        blockers.push({ severity: "medium", message: `Project learning unavailable — project_interest is missing on ${(100 - projIntCov).toFixed(1)}% of leads.`, evidence: `Only ${findPop("project_interest")} of ${total} leads have project_interest.` });
      if (leadSrcCov < 30)
        blockers.push({ severity: "medium", message: `Lead source analysis limited — lead_source coverage is ${leadSrcCov}%.`, evidence: `${findPop("lead_source")} of ${total} leads have lead_source.` });
      if (statusCov < 70)
        blockers.push({ severity: "medium", message: `Status-based filtering unreliable — status coverage is ${statusCov}%.`, evidence: `${findPop("status")} of ${total} leads have status set.` });
      if (assignedCov < 50)
        blockers.push({ severity: "low", message: `Lead assignment tracking incomplete — assigned_user coverage is ${assignedCov}%.`, evidence: `${findPop("assigned_user")} of ${total} leads have assigned_user.` });
      if (creativeAttr.coverage < 30)
        blockers.push({ severity: "high", message: `Creative learning limited — creative attribution coverage is only ${creativeAttr.coverage}%.`, evidence: `${creativeAttr.linked} of ${creativeAttr.total} creative records are linked to leads.` });
      if (campaignAttr.campaign_id_pct < 50)
        blockers.push({ severity: "high", message: `Attribution intelligence limited — campaign_id coverage in attribution table is ${campaignAttr.campaign_id_pct}%.`, evidence: `${campaignAttr.with_campaign_id} of ${campaignAttr.total} attribution records have campaign_id.` });

      // ── 5. Data Health Score ────────────────────────────────────────────────
      const crmScore = parseFloat((
        (campaignNameCov + countryCov + leadSrcCov + statusCov + projIntCov) / 5
      ).toFixed(1));
      const attrScore = parseFloat((
        (campaignAttr.campaign_id_pct + campaignAttr.adset_id_pct + campaignAttr.ad_id_pct) / 3
      ).toFixed(1));
      const learnScore = parseFloat((
        (Math.min(campaignNameCov, 100) + Math.min(countryCov, 100) + Math.min(leadSrcCov, 100)) / 3
      ).toFixed(1));
      const campaignIntelScore = parseFloat((
        (campaignNameCov + campaignIdCov + adsetNameCov + adIdCov) / 4
      ).toFixed(1));
      const overallScore = parseFloat(((crmScore + attrScore + learnScore + campaignIntelScore) / 4).toFixed(1));

      const healthLabel = (s: number) => s >= 90 ? "Excellent" : s >= 75 ? "Good" : s >= 50 ? "Fair" : "Poor";

      // ── 6. Repair recommendations (reference audit findings only) ───────────
      const recommendations: { priority: string; action: string; reason: string }[] = [];

      if (campaignNameCov < 80) recommendations.push({ priority: "critical", action: "Populate campaign_name during lead ingestion from Meta webhook payload.", reason: `campaign_name is missing on ${total - findPop("campaign_name")} leads — this is the primary blocker for pattern generation.` });
      if (campaignIdCov < 80)   recommendations.push({ priority: "critical", action: "Store campaign_id from Meta lead webhook (field: campaign_id).", reason: `campaign_id missing on ${total - findPop("campaign_id")} leads — required for attribution matching.` });
      if (adsetNameCov < 50)    recommendations.push({ priority: "high",     action: "Store adset_name from Meta webhook payload during lead capture.", reason: `adset_name missing on ${total - findPop("adset_name")} leads.` });
      if (adsetIdCov < 50)      recommendations.push({ priority: "high",     action: "Store adset_id from Meta webhook payload.", reason: `adset_id missing on ${total - findPop("adset_id")} leads.` });
      if (adNameCov < 50)       recommendations.push({ priority: "high",     action: "Store ad_name from Meta webhook payload.", reason: `ad_name missing on ${total - findPop("ad_name")} leads.` });
      if (adIdCov < 50)         recommendations.push({ priority: "high",     action: "Store ad_id from Meta webhook payload.", reason: `ad_id missing on ${total - findPop("ad_id")} leads.` });
      if (projIntCov < 50)      recommendations.push({ priority: "medium",   action: "Increase project_interest coverage by requiring it in lead intake forms.", reason: `project_interest missing on ${total - findPop("project_interest")} leads — blocks project-level learning.` });
      if (leadSrcCov < 60)      recommendations.push({ priority: "medium",   action: "Tag lead_source consistently during lead creation (webhook, manual, import).", reason: `lead_source missing on ${total - findPop("lead_source")} leads.` });
      if (statusCov < 80)       recommendations.push({ priority: "medium",   action: "Ensure lead status is always set on create and updated after each agent interaction.", reason: `status missing on ${total - findPop("status")} leads — affects no_answer filtering.` });
      if (countryCov < 70)      recommendations.push({ priority: "medium",   action: "Extract country from Meta lead form data or phone number prefix.", reason: `country missing on ${total - findPop("country")} leads — limits geographic learning.` });

      res.json({
        ok: true,
        generated_at:   new Date().toISOString(),
        total_leads:    total,
        crm_fields:     crmFields,
        campaign_attribution:  campaignAttr,
        creative_attribution:  creativeAttr,
        blockers,
        health: {
          overall:               overallScore,
          overall_label:         healthLabel(overallScore),
          crm_data_health:       crmScore,
          crm_label:             healthLabel(crmScore),
          attribution_health:    attrScore,
          attribution_label:     healthLabel(attrScore),
          learning_readiness:    learnScore,
          learning_label:        healthLabel(learnScore),
          campaign_intelligence: campaignIntelScore,
          campaign_label:        healthLabel(campaignIntelScore),
        },
        recommendations,
      });
    } catch (err: any) {
      console.error("[DataQuality] audit error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/learning/data-quality/export — JSON download
  app.get("/api/admin/ai-marketing/learning/data-quality/export", isAdmin, async (_req, res) => {
    try {
      // Re-run same audit logic inline for export
      const toInt = (v: any) => parseInt(v) || 0;
      const pct   = (have: number, total: number) => total > 0 ? parseFloat((have / total * 100).toFixed(1)) : 0;

      const crmRes = await pool.query(`
        SELECT COUNT(*) AS total,
          COUNT(NULLIF(TRIM(COALESCE(campaign_name,'')),   '')) AS has_campaign_name,
          COUNT(NULLIF(TRIM(COALESCE(campaign_id::text,'')),  '')) AS has_campaign_id,
          COUNT(NULLIF(TRIM(COALESCE(adset_name,'')),      '')) AS has_adset_name,
          COUNT(NULLIF(TRIM(COALESCE(adset_id::text,'')),  '')) AS has_adset_id,
          COUNT(NULLIF(TRIM(COALESCE(ad_name,'')),         '')) AS has_ad_name,
          COUNT(NULLIF(TRIM(COALESCE(ad_id::text,'')),     '')) AS has_ad_id,
          COUNT(NULLIF(TRIM(COALESCE(country,'')),         '')) AS has_country,
          COUNT(NULLIF(TRIM(COALESCE(project_interest,'')), '')) AS has_project_interest,
          COUNT(NULLIF(TRIM(COALESCE(lead_source,'')),     '')) AS has_lead_source,
          COUNT(NULLIF(TRIM(COALESCE(status,'')),          '')) AS has_status,
          COUNT(assigned_to) AS has_assigned_user,
          COUNT(created_at)  AS has_created_at
        FROM crm_leads
      `);
      const cr    = crmRes.rows[0];
      const total = toInt(cr.total);

      const fields = ["campaign_name","campaign_id","adset_name","adset_id","ad_name","ad_id","country","project_interest","lead_source","status","assigned_user","created_at"];
      const hasKeys = ["has_campaign_name","has_campaign_id","has_adset_name","has_adset_id","has_ad_name","has_ad_id","has_country","has_project_interest","has_lead_source","has_status","has_assigned_user","has_created_at"];

      const crmFields = fields.map((f, i) => {
        const pop = toInt(cr[hasKeys[i]]);
        return { field: f, total, populated: pop, missing: total - pop, coverage: pct(pop, total) };
      });

      res.setHeader("Content-Disposition", "attachment; filename=kinglike-data-quality-audit.json");
      res.setHeader("Content-Type", "application/json");
      res.json({
        report:       "Kinglike Luxury Data Quality Audit Report",
        generated_at: new Date().toISOString(),
        note:         "Read-only audit. No data was modified. No repairs were performed.",
        total_leads:  total,
        crm_fields:   crmFields,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 13 — AI Market Intelligence
  // Admin-only. Recommendation layer only. Zero Meta write actions.
  // ─────────────────────────────────────────────────────────────────────────────

  // POST /api/admin/ai-marketing/marketing-knowledge/generate-intelligence
  // Generates AI marketing suggestions (investor types, buyer types, angles, markets, exclusions, lead form questions).
  // Read-only output. No Meta publishing. No campaign creation. No automation.
  app.post("/api/admin/ai-marketing/marketing-knowledge/generate-intelligence", isAdmin, async (req, res) => {
    try {
      const { project_name = "", project_type = "", location = "", luxury_level = "" } = req.body as Record<string, string>;
      const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;

      const fallback = {
        investor_types: [
          { text: "Arab 48 Investors",        confidence: "high",   reason: "Strong real estate investment activity in Georgia and Turkey" },
          { text: "High Net Worth Investors",  confidence: "high",   reason: "Luxury level matches HNWI investment appetite" },
          { text: "Passive Income Investors",  confidence: "medium", reason: "Properties with rental management attract passive income seekers" },
          { text: "Capital Growth Investors",  confidence: "medium", reason: "Emerging markets show strong appreciation potential" },
          { text: "Diaspora Investors",        confidence: "medium", reason: "Arab diaspora communities invest in homeland-proximate markets" },
        ],
        buyer_types: [
          { text: "Families",              confidence: "high",   reason: "Family buyers prioritise space, amenities, and school proximity" },
          { text: "Second Home Buyers",    confidence: "high",   reason: "Luxury buyers often purchase second homes in resort or coastal markets" },
          { text: "Retirement Buyers",     confidence: "medium", reason: "Retirees seek comfortable living with manageable upkeep" },
          { text: "Holiday Home Buyers",   confidence: "medium", reason: "Tourism-driven markets attract seasonal buyers" },
          { text: "Young Professionals",   confidence: "low",    reason: "Premium locations attract high-earning young professionals" },
        ],
        marketing_angles: [
          { text: "Luxury Lifestyle",     confidence: "high",   reason: "Core appeal for premium buyers" },
          { text: "Investment Opportunity", confidence: "high", reason: "ROI-focused messaging resonates with investor audiences" },
          { text: "Branded Residence",    confidence: "medium", reason: "Hotel-branded residences command premium positioning" },
          { text: "Family Living",        confidence: "medium", reason: "Family-focused messaging broadens the buyer pool" },
          { text: "Limited Inventory",    confidence: "medium", reason: "Scarcity creates urgency" },
          { text: "Sea View / Waterfront", confidence: "low",   reason: "View-based angle if applicable to the location" },
        ],
        target_markets: [
          { text: "Arab 48",      confidence: "high",   reason: "High property investment activity from Arab 48 communities" },
          { text: "UAE",          confidence: "high",   reason: "Strong buying power and overseas real estate appetite" },
          { text: "Saudi Arabia", confidence: "high",   reason: "Large investor pool with capital for luxury overseas properties" },
          { text: "Kuwait",       confidence: "medium", reason: "Active real estate investment market" },
          { text: "Qatar",        confidence: "medium", reason: "Growing overseas property investment appetite" },
          { text: "Europe",       confidence: "low",    reason: "European diaspora and lifestyle buyers" },
        ],
        audience_exclusions: [
          { text: "Students",              confidence: "high",   reason: "Not target demographic for luxury real estate", meta_note: "Requires Meta audience validation before use" },
          { text: "Job Seekers",           confidence: "high",   reason: "Low purchase intent and budget", meta_note: "Requires Meta audience validation before use" },
          { text: "Rental Seekers",        confidence: "medium", reason: "Different intent from buyers", meta_note: "Requires Meta audience validation before use" },
          { text: "Low Budget Segments",   confidence: "medium", reason: "Price mismatch with luxury offering", meta_note: "Requires Meta audience validation before use" },
        ],
        lead_form_questions: [
          { text: "What is your approximate budget?",              type: "multiple_choice", reason: "Qualifies financial capacity immediately" },
          { text: "When are you planning to purchase?",            type: "multiple_choice", reason: "Identifies purchase timeline and urgency" },
          { text: "What is your primary investment goal?",         type: "multiple_choice", reason: "Segments lifestyle vs investment buyers" },
          { text: "Which unit type interests you most?",           type: "multiple_choice", reason: "Helps sales team prepare relevant materials" },
          { text: "How would you prefer to be contacted?",         type: "multiple_choice", reason: "Respects communication preferences, improves contact rate" },
        ],
      };

      if (!apiKey) {
        return res.json({ ok: true, suggestions: fallback, ai_used: false });
      }

      const { default: OpenAI } = await import("openai");
      const openaiClient = new OpenAI({ apiKey });

      const systemPrompt = `You are a luxury real estate marketing strategist for Kinglike Luxury Real Estate.
Generate data-driven marketing intelligence based on project details.
IMPORTANT: Do NOT invent fake Meta advertising interest names. These are strategic suggestions only, not Meta Ads Manager configurations.
Return ONLY valid JSON. No markdown. No explanation.`;

      const userPrompt = `Generate comprehensive marketing intelligence for this luxury real estate project.

Project Name: ${project_name || 'Luxury Real Estate Project'}
Project Type: ${project_type || 'Residential'}
Location: ${location || 'Not specified'}
Luxury Level: ${luxury_level || 'Luxury'}

Return this exact JSON:
{
  "investor_types": [{ "text":"...", "confidence":"high|medium|low", "reason":"1-sentence reason" }],
  "buyer_types":    [{ "text":"...", "confidence":"high|medium|low", "reason":"1-sentence reason" }],
  "marketing_angles":[{ "text":"...", "confidence":"high|medium|low", "reason":"1-sentence reason" }],
  "target_markets": [{ "text":"...", "confidence":"high|medium|low", "reason":"1-sentence reason" }],
  "audience_exclusions":[{ "text":"...", "confidence":"high|medium|low", "reason":"1-sentence reason", "meta_note":"Requires Meta audience validation before use" }],
  "lead_form_questions":[{ "text":"Full question?", "type":"multiple_choice|short_answer", "reason":"1-sentence reason" }]
}

Rules:
- investor_types: 5-7 realistic investor profiles for this project type and location
- buyer_types: 5-7 specific buyer personas
- marketing_angles: 6-8 distinct USPs relevant to this property type and location
- target_markets: 5-7 geographic or demographic markets
- audience_exclusions: 4-6 audience segments to exclude (no fake Meta interest names)
- lead_form_questions: 5-6 practical lead qualification questions`;

      let parsed: any = fallback;
      try {
        const completion = await openaiClient.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          max_tokens: 2500,
          temperature: 0.7,
          response_format: { type: "json_object" },
        });
        parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
      } catch {
        parsed = fallback;
      }

      console.log(`[MarketIntelligence] Generated for "${project_name}" ${project_type} ${location}`);
      res.json({ ok: true, suggestions: parsed, ai_used: true });
    } catch (err: any) {
      console.error("[MarketIntelligence] error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 12 — Project Marketing Knowledge Base CRUD
  // Admin-only. Read-only AI integration. Zero Meta write actions.
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /api/admin/ai-marketing/marketing-knowledge — list all profiles with counts
  app.get("/api/admin/ai-marketing/marketing-knowledge", isAdmin, async (_req, res) => {
    try {
      const r = await pool.query(`
        SELECT p.*,
          (SELECT COUNT(*) FROM project_marketing_angles  WHERE profile_id=p.id AND enabled=true) AS angles_count,
          (SELECT COUNT(*) FROM project_target_markets    WHERE profile_id=p.id)                  AS markets_count,
          (SELECT COUNT(*) FROM project_forbidden_claims  WHERE profile_id=p.id)                  AS claims_count
        FROM project_marketing_profiles p
        ORDER BY p.created_at DESC
      `);
      res.json({ ok: true, profiles: r.rows });
    } catch (err: any) {
      console.error("[KnowledgeBase] list error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/ai-marketing/marketing-knowledge/:id — profile + all sub-records
  app.get("/api/admin/ai-marketing/marketing-knowledge/:id", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [profile, angles, markets, claims] = await Promise.all([
        pool.query(`SELECT * FROM project_marketing_profiles WHERE id=$1`, [id]),
        pool.query(`SELECT * FROM project_marketing_angles WHERE profile_id=$1 ORDER BY priority DESC, id ASC`, [id]),
        pool.query(`SELECT * FROM project_target_markets WHERE profile_id=$1 ORDER BY id ASC`, [id]),
        pool.query(`SELECT * FROM project_forbidden_claims WHERE profile_id=$1 ORDER BY id ASC`, [id]),
      ]);
      if (!profile.rows[0]) return res.status(404).json({ error: "Profile not found" });
      res.json({ ok: true, profile: profile.rows[0], angles: angles.rows, markets: markets.rows, claims: claims.rows });
    } catch (err: any) {
      console.error("[KnowledgeBase] get error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/ai-marketing/marketing-knowledge — create profile
  app.post("/api/admin/ai-marketing/marketing-knowledge", isAdmin, async (req, res) => {
    try {
      const {
        project_id, internal_project_name, marketing_alias, use_real_project_name = false,
        project_type, location, short_marketing_description, long_marketing_description,
        luxury_level, target_investor_type, target_buyer_type, confidence_notes,
      } = req.body;
      if (!internal_project_name) return res.status(400).json({ error: "internal_project_name is required" });
      const r = await pool.query(`
        INSERT INTO project_marketing_profiles
          (project_id, internal_project_name, marketing_alias, use_real_project_name,
           project_type, location, short_marketing_description, long_marketing_description,
           luxury_level, target_investor_type, target_buyer_type, confidence_notes, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active') RETURNING *
      `, [project_id||null, internal_project_name, marketing_alias||null, !!use_real_project_name,
          project_type||null, location||null, short_marketing_description||null,
          long_marketing_description||null, luxury_level||null,
          target_investor_type||null, target_buyer_type||null, confidence_notes||null]);
      console.log(`[KnowledgeBase] Created profile id=${r.rows[0].id} "${internal_project_name}"`);
      res.json({ ok: true, profile: r.rows[0] });
    } catch (err: any) {
      console.error("[KnowledgeBase] create error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/admin/ai-marketing/marketing-knowledge/:id — update profile
  app.put("/api/admin/ai-marketing/marketing-knowledge/:id", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const {
        internal_project_name, marketing_alias, use_real_project_name,
        project_type, location, short_marketing_description, long_marketing_description,
        luxury_level, target_investor_type, target_buyer_type, confidence_notes, status,
      } = req.body;
      if (!internal_project_name) return res.status(400).json({ error: "internal_project_name is required" });
      const r = await pool.query(`
        UPDATE project_marketing_profiles SET
          internal_project_name=$1, marketing_alias=$2, use_real_project_name=$3,
          project_type=$4, location=$5, short_marketing_description=$6,
          long_marketing_description=$7, luxury_level=$8, target_investor_type=$9,
          target_buyer_type=$10, confidence_notes=$11, status=$12, updated_at=NOW()
        WHERE id=$13 RETURNING *
      `, [internal_project_name, marketing_alias||null, !!use_real_project_name,
          project_type||null, location||null, short_marketing_description||null,
          long_marketing_description||null, luxury_level||null,
          target_investor_type||null, target_buyer_type||null,
          confidence_notes||null, status||'active', id]);
      if (!r.rows[0]) return res.status(404).json({ error: "Profile not found" });
      res.json({ ok: true, profile: r.rows[0] });
    } catch (err: any) {
      console.error("[KnowledgeBase] update error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/ai-marketing/marketing-knowledge/:id — delete (cascade)
  app.delete("/api/admin/ai-marketing/marketing-knowledge/:id", isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await pool.query(`DELETE FROM project_marketing_profiles WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[KnowledgeBase] delete error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/ai-marketing/marketing-knowledge/:id/angles
  app.post("/api/admin/ai-marketing/marketing-knowledge/:id/angles", isAdmin, async (req, res) => {
    try {
      const profileId = parseInt(req.params.id);
      const { angle_name, angle_description, priority = 0 } = req.body;
      if (!angle_name) return res.status(400).json({ error: "angle_name required" });
      const r = await pool.query(
        `INSERT INTO project_marketing_angles (profile_id,angle_name,angle_description,priority,enabled)
         VALUES ($1,$2,$3,$4,true) RETURNING *`,
        [profileId, angle_name, angle_description||null, parseInt(priority)||0]
      );
      res.json({ ok: true, angle: r.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/admin/ai-marketing/marketing-knowledge/:id/angles/:angleId — toggle enabled
  app.patch("/api/admin/ai-marketing/marketing-knowledge/:id/angles/:angleId", isAdmin, async (req, res) => {
    try {
      const angleId = parseInt(req.params.angleId);
      const { enabled } = req.body;
      const r = await pool.query(
        `UPDATE project_marketing_angles SET enabled=$1 WHERE id=$2 RETURNING *`,
        [!!enabled, angleId]
      );
      if (!r.rows[0]) return res.status(404).json({ error: "Angle not found" });
      res.json({ ok: true, angle: r.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/ai-marketing/marketing-knowledge/:id/angles/:angleId
  app.delete("/api/admin/ai-marketing/marketing-knowledge/:id/angles/:angleId", isAdmin, async (req, res) => {
    try {
      const angleId = parseInt(req.params.angleId);
      await pool.query(`DELETE FROM project_marketing_angles WHERE id=$1`, [angleId]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/ai-marketing/marketing-knowledge/:id/markets
  app.post("/api/admin/ai-marketing/marketing-knowledge/:id/markets", isAdmin, async (req, res) => {
    try {
      const profileId = parseInt(req.params.id);
      const { market_name, language, notes } = req.body;
      if (!market_name) return res.status(400).json({ error: "market_name required" });
      const r = await pool.query(
        `INSERT INTO project_target_markets (profile_id,market_name,language,notes) VALUES ($1,$2,$3,$4) RETURNING *`,
        [profileId, market_name, language||null, notes||null]
      );
      res.json({ ok: true, market: r.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/ai-marketing/marketing-knowledge/:id/markets/:marketId
  app.delete("/api/admin/ai-marketing/marketing-knowledge/:id/markets/:marketId", isAdmin, async (req, res) => {
    try {
      const marketId = parseInt(req.params.marketId);
      await pool.query(`DELETE FROM project_target_markets WHERE id=$1`, [marketId]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/ai-marketing/marketing-knowledge/:id/claims
  app.post("/api/admin/ai-marketing/marketing-knowledge/:id/claims", isAdmin, async (req, res) => {
    try {
      const profileId = parseInt(req.params.id);
      const { claim_text } = req.body;
      if (!claim_text) return res.status(400).json({ error: "claim_text required" });
      const r = await pool.query(
        `INSERT INTO project_forbidden_claims (profile_id,claim_text) VALUES ($1,$2) RETURNING *`,
        [profileId, claim_text]
      );
      res.json({ ok: true, claim: r.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/ai-marketing/marketing-knowledge/:id/claims/:claimId
  app.delete("/api/admin/ai-marketing/marketing-knowledge/:id/claims/:claimId", isAdmin, async (req, res) => {
    try {
      const claimId = parseInt(req.params.claimId);
      await pool.query(`DELETE FROM project_forbidden_claims WHERE id=$1`, [claimId]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return httpServer;
}
