import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { registerAiIntelligenceRoutes } from "./ai-intelligence-routes";
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
  PROPERTY_STATUS
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
import { eq, and, desc } from "drizzle-orm";

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
      secret: process.env.SESSION_SECRET || "realestatepro-secret",
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

  // Temporary Twilio diagnostic endpoint
  app.get("/api/twilio-test", async (req, res) => {
    const sid = process.env.TWILIO_ACCOUNT_SID || "";
    const token = process.env.TWILIO_AUTH_TOKEN || "";
    const phone = process.env.TWILIO_PHONE_NUMBER || "";
    try {
      const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") }
      });
      const data = await resp.json() as any;
      res.json({ status: resp.status, accountSidPrefix: sid.slice(0, 8), phoneNumber: phone, twilioStatus: data.status || data.message || "unknown" });
    } catch (e: any) {
      res.json({ error: e.message });
    }
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

      // 1️⃣ Try WhatsApp first
      let method = "whatsapp";
      try {
        await twilioClient.messages.create({
          body: msgBody,
          from: `whatsapp:${fromNumber}`,
          to: `whatsapp:${phoneNumber}`,
        });
        console.log(`✅ WhatsApp OTP sent to ${phoneNumber}`);
      } catch (waError: any) {
        // WhatsApp failed — fallback to SMS
        console.warn(`⚠️ WhatsApp failed (${waError.code}), falling back to SMS...`);
        method = "sms";
        const smsBody = `Kinglike Luxury - رمز التحقق: ${code} (صالح 10 دقائق)`;
        // 2️⃣ Try messaging service SID first, then fall back to direct phone number
        try {
          if (msgSid) {
            await twilioClient.messages.create({ body: smsBody, to: phoneNumber, messagingServiceSid: msgSid });
          } else {
            throw new Error("No messaging service SID");
          }
        } catch {
          // 3️⃣ Final fallback: send directly from Twilio phone number
          await twilioClient.messages.create({ body: smsBody, to: phoneNumber, from: fromNumber });
        }
        console.log(`✅ SMS OTP sent to ${phoneNumber}`);
      }

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
          const msgSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
          const fromNumber = process.env.TWILIO_PHONE_NUMBER;
          try {
            // Try WhatsApp first
            await twilioClient.messages.create({ body: msgBody, from: `whatsapp:${fromNumber}`, to: `whatsapp:${phoneNumber}` });
            codeSent = true;
          } catch {
            // WhatsApp failed — try SMS
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
  app.get("/objects/:objectPath(*)", async (req, res) => {
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
  app.post("/api/admin/migrate-blog-slugs", async (req, res) => {
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
  app.post("/api/admin/retranslate-blogs", async (req, res) => {
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
  app.post("/api/admin/backfill-blog-seo", async (req, res) => {
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
  app.get("/api/admin/blog/:id/seo-status", async (req, res) => {
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
  app.get("/public-objects/:filePath(*)", async (req, res) => {
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
  app.get("/api/admin/notification-templates", async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
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
  app.put("/api/admin/notification-templates/:id", async (req, res) => {
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
  app.post("/api/admin/notifications/send", async (req, res) => {
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
  app.get("/api/admin/notification-logs", async (req, res) => {
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
  app.post("/api/admin/email-campaign", async (req, res) => {
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
  app.get("/api/admin/notification-status", async (req, res) => {
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
  app.get("/api/admin/consultation/slots", async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try {
      const slots = await storage.getConsultationTimeSlots();
      res.json(slots);
    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // POST create slot (admin)
  app.post("/api/admin/consultation/slots", async (req, res) => {
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
  app.post("/api/admin/consultation/slots/generate", async (req, res) => {
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
  app.patch("/api/admin/consultation/slots/:id/toggle", async (req, res) => {
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
  app.delete("/api/admin/consultation/slots/:id", async (req, res) => {
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
  app.get("/api/admin/consultation/bookings", async (req, res) => {
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
  app.patch("/api/admin/consultation/bookings/:id", async (req, res) => {
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

  app.post("/api/admin/test-notifications", async (req, res) => {
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
  app.get("/api/admin/ai-leads", async (req, res) => {
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
  app.get("/api/admin/projects-for-cameras", async (req: any, res) => {
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
  app.get("/api/admin/live-cameras", async (req: any, res) => {
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

  app.post("/api/admin/live-cameras", async (req: any, res) => {
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

  app.patch("/api/admin/live-cameras/:id", async (req: any, res) => {
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

  app.delete("/api/admin/live-cameras/:id", async (req: any, res) => {
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

  // ── Kinglike CRM Admin Endpoints ──────────────────────────────────────────

  // CRM access helpers
  const isCrmUser = (req: any) => req.session.isAdmin || req.session.role === "sub_agent";
  const canAccessLead = async (req: any, leadId: number): Promise<boolean> => {
    if (req.session.isAdmin) return true;
    const lead = await storage.getCrmLead(leadId);
    return lead?.assignedTo === req.session.userId;
  };

  /** GET /api/admin/crm/leads — paginated list with optional filters */
  app.get("/api/admin/crm/leads", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const { search, status, source, assignedTo, page, limit } = req.query as Record<string, string>;
      const pageNum  = Math.max(1, parseInt(page  ?? "1",  10) || 1);
      const limitNum = Math.min(50, Math.max(1, parseInt(limit ?? "50", 10) || 50));
      const offset   = (pageNum - 1) * limitNum;

      const filters: any = { limit: limitNum, offset };
      if (search) filters.search = search;
      if (status) filters.status = status;
      if (source) filters.source = source;
      if (!req.session.isAdmin && req.session.role === "sub_agent") {
        // Sub-agents can only see leads assigned to them — backend-enforced
        filters.assignedTo = req.session.userId;
      } else if (assignedTo === "unassigned") {
        filters.assignedTo = null;
      } else if (assignedTo) {
        filters.assignedTo = Number(assignedTo);
      }
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

      const lead = await storage.createCrmLead({
        fullName, firstName, lastName, phone, email, country, city,
        interestedCountry, projectInterest, budget, expectedPurchaseMonth, description,
        campaignName, adsetName, adName, formName, externalLeadId, notes,
        leadSource: leadSource || "manual",
        leadScore:  leadScore  || "cold",
        status:     status     || "new",
      });
      // Trigger welcome email if lead has an email address (fire-and-forget)
      if (lead.email?.trim()) {
        const { sendCrmWelcomeEmail } = await import("./emailService");
        sendCrmWelcomeEmail({ fullName: lead.fullName, firstName: lead.firstName, email: lead.email }).catch(() => {});
      }
      res.status(201).json(lead);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── CRM Project management ─────────────────────────────────────────────────

  /** GET /api/admin/crm/projects — list all projects */
  app.get("/api/admin/crm/projects", isAuthenticated, async (req: any, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ message: "Forbidden" });
    try { res.json(await storage.getCrmProjects()); }
    catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  /** POST /api/admin/crm/projects — create project */
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
      const task = await storage.updateCrmTask(Number(req.params.taskId), req.body);
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

  /** GET /api/admin/crm/leads/:id — lead detail with notes + assignee */
  app.get("/api/admin/crm/leads/:id", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    if (!await canAccessLead(req, Number(req.params.id))) return res.status(403).json({ message: "Access denied: lead not assigned to you" });
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
    if (!req.session.isAdmin && !await canAccessLead(req, Number(req.params.id)))
      return res.status(403).json({ message: "Access denied: lead not assigned to you" });
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

      // Sub-agents must provide a comment for every change
      if (!req.session.isAdmin && req.session.role === "sub_agent" && !_comment) {
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
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** POST /api/admin/crm/leads/:id/notes — add a note to a lead */
  app.post("/api/admin/crm/leads/:id/notes", isAuthenticated, async (req: any, res) => {
    if (!isCrmUser(req)) return res.status(403).json({ message: "Forbidden" });
    if (!req.session.isAdmin && !await canAccessLead(req, Number(req.params.id)))
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
  app.get("/api/admin/otp-logs", async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
    res.json({
      logs: [...otpLogs].reverse(), // newest first
      blockedIPs: Array.from(blockedIPs),
    });
  });

  /** POST /api/admin/otp-block — manually block an IP address */
  app.post("/api/admin/otp-block", async (req: any, res) => {
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
  app.delete("/api/admin/otp-block/:ip", async (req: any, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUser(req.session.userId);
    if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
    const target = decodeURIComponent(req.params.ip);
    blockedIPs.delete(target);
    console.log(`[OTP Security] Admin unblocked IP: ${target}`);
    res.json({ success: true, blockedIPs: Array.from(blockedIPs) });
  });

  return httpServer;
}
