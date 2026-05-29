import { storage } from "./storage";
import { slugToUrlPath } from "./slugUtils";

/**
 * All supported SEO languages — kept in sync with SEO_LANGS in routes.ts.
 * Primary SEO languages (ar, en, tr, he, ru) are listed first.
 */
const SEO_LANGS = [
  "ar", "en", "tr", "he", "ru",
  "ka", "az", "fa", "zh", "pl",
  "it", "nl", "de", "sv", "fr",
];

const BASE_URL = "https://www.kinglikeluxury.app";

const STATIC_URLS = [
  { loc: BASE_URL,                     priority: "1.0", changefreq: "daily"   },
  { loc: `${BASE_URL}/blog`,           priority: "0.9", changefreq: "daily"   },
  { loc: `${BASE_URL}/properties`,     priority: "0.8", changefreq: "weekly"  },
  { loc: `${BASE_URL}/projects`,       priority: "0.8", changefreq: "weekly"  },
  { loc: `${BASE_URL}/map`,            priority: "0.6", changefreq: "monthly" },
  { loc: `${BASE_URL}/privacy-policy`, priority: "0.3", changefreq: "yearly"  },
  { loc: `${BASE_URL}/terms`,          priority: "0.3", changefreq: "yearly"  },
];

/** Build one <url> block for a static page. */
function staticUrlBlock(u: { loc: string; priority: string; changefreq: string }, lastmod: string): string {
  return [
    "  <url>",
    `    <loc>${u.loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${u.changefreq}</changefreq>`,
    `    <priority>${u.priority}</priority>`,
    "  </url>",
  ].join("\n");
}

/**
 * Get the slug to use for a given post + language.
 * Prefers the language-specific translated slug; falls back to the base English slug.
 */
function getLangSlug(post: any, lang: string): string {
  return post.translations?.[lang]?.slug || post.slug;
}

/**
 * Build one <url> block for a single language version of a blog post.
 * Each language now uses its own translated slug in <loc> and in hreflang hrefs.
 */
function blogUrlBlock(
  post: any,
  lang: string,
  lastmod: string,
): string {
  const langSlug = getLangSlug(post, lang);
  const loc = `${BASE_URL}/${lang}/blog/${slugToUrlPath(langSlug)}`;

  const hreflangs = SEO_LANGS.map((l) => {
    const lSlug = getLangSlug(post, l);
    return `    <xhtml:link rel="alternate" hreflang="${l}" href="${BASE_URL}/${l}/blog/${slugToUrlPath(lSlug)}"/>`;
  }).join("\n");

  const enSlug = getLangSlug(post, "en");
  const xDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE_URL}/en/blog/${slugToUrlPath(enSlug)}"/>`;

  return [
    "  <url>",
    `    <loc>${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    "    <changefreq>monthly</changefreq>",
    "    <priority>0.8</priority>",
    hreflangs,
    xDefault,
    "  </url>",
  ].join("\n");
}

/**
 * Generates the sitemap XML string dynamically from the database.
 *
 * Each published blog post generates one URL block per supported language.
 * Every language version uses its own translated slug (Arabic, Hebrew, Russian, etc.)
 * so Google indexes each language independently.
 * hreflang alternates cross-link all language versions using their respective slugs.
 */
export async function generateSitemapXml(): Promise<string> {
  const today = new Date().toISOString().split("T")[0];

  // ── Static pages ──────────────────────────────────────────────────────────
  const staticBlocks = STATIC_URLS.map((u) => staticUrlBlock(u, today));

  // ── Blog posts (one block per language per post) ──────────────────────────
  const blogBlocks: string[] = [];
  try {
    const posts = await storage.getBlogPosts({ published: true });
    for (const post of posts) {
      const lastmod = (post as any).updatedAt || (post as any).createdAt
        ? new Date(((post as any).updatedAt || (post as any).createdAt)).toISOString().split("T")[0]
        : today;
      for (const lang of SEO_LANGS) {
        blogBlocks.push(blogUrlBlock(post, lang, lastmod));
      }
    }
  } catch (err) {
    console.error("[Sitemap] Error fetching blog posts:", err);
  }

  // ── Assemble ──────────────────────────────────────────────────────────────
  const allBlocks = [...staticBlocks, ...blogBlocks];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    "",
    allBlocks.join("\n\n"),
    "",
    "</urlset>",
    "",
  ].join("\n");
}
