import { storage } from "./storage";

const SEO_LANGS = ["en", "ar", "tr", "ru", "ka", "az", "he", "zh", "pl"];
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

/** Build one <url> block for a blog post language variant. */
function blogUrlBlock(
  slug: string,
  lang: string,
  lastmod: string,
): string {
  const loc = `${BASE_URL}/${lang}/blog/${slug}`;
  const hreflangs = SEO_LANGS.map(
    (l) =>
      `    <xhtml:link rel="alternate" hreflang="${l}" href="${BASE_URL}/${l}/blog/${slug}"/>`,
  ).join("\n");
  const xDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE_URL}/en/blog/${slug}"/>`;

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
 * This is called directly by the /sitemap.xml Express route registered at
 * the top of server/index.ts — before any static-file middleware — so it
 * always wins and never returns index.html by mistake.
 *
 * We intentionally do NOT write a static sitemap.xml to disk. Doing so
 * would let Vite copy it to dist/public/ and allow express.static to serve
 * a potentially stale file instead of this live, DB-driven version.
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
      const lastmod = post.updatedAt || post.createdAt
        ? new Date((post as any).updatedAt || (post as any).createdAt).toISOString().split("T")[0]
        : today;
      for (const lang of SEO_LANGS) {
        blogBlocks.push(blogUrlBlock(post.slug, lang, lastmod));
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
    "", // trailing newline
  ].join("\n");
}
