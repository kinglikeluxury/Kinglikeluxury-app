import { storage } from "./storage";

const SEO_LANGS = ["en", "ar", "tr", "ru", "ka", "az", "he", "zh", "pl"];
const BASE_URL = "https://www.kinglikeluxury.app";

const STATIC_URLS = [
  { loc: BASE_URL,                    priority: "1.0", changefreq: "daily" },
  { loc: `${BASE_URL}/blog`,          priority: "0.9", changefreq: "daily" },
  { loc: `${BASE_URL}/properties`,    priority: "0.8", changefreq: "weekly" },
  { loc: `${BASE_URL}/projects`,      priority: "0.8", changefreq: "weekly" },
  { loc: `${BASE_URL}/map`,           priority: "0.6", changefreq: "monthly" },
  { loc: `${BASE_URL}/privacy-policy`,priority: "0.3", changefreq: "yearly" },
  { loc: `${BASE_URL}/terms`,         priority: "0.3", changefreq: "yearly" },
];

/**
 * Generates the sitemap XML string dynamically from the database.
 * This is called directly by the /sitemap.xml Express route in server/index.ts
 * (registered BEFORE any static-file middleware so it always wins).
 * We intentionally do NOT write a static sitemap.xml file — doing so would
 * cause Vite to copy it into dist/public/ and express.static could serve the
 * stale file instead of this live, DB-driven version.
 */
export async function generateSitemapXml(): Promise<string> {
  const today = new Date().toISOString().split("T")[0];

  const staticEntries = STATIC_URLS.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n");

  let blogEntries = "";
  try {
    const posts = await storage.getBlogPosts({ published: true });
    blogEntries = posts.flatMap((post: any) =>
      SEO_LANGS.map(lang => {
        const url = `${BASE_URL}/${lang}/blog/${post.slug}`;
        const lastmod = (post.updatedAt || post.createdAt)
          ? new Date(post.updatedAt || post.createdAt).toISOString().split("T")[0]
          : today;
        const hreflangs = SEO_LANGS.map(l =>
          `    <xhtml:link rel="alternate" hreflang="${l}" href="${BASE_URL}/${l}/blog/${post.slug}"/>`
        ).join("\n");
        return `  <url>
    <loc>${url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
${hreflangs}
    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE_URL}/en/blog/${post.slug}"/>
  </url>`;
      })
    ).join("\n");
  } catch (err) {
    console.error("[Sitemap] Error fetching blog posts:", err);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${staticEntries}
${blogEntries}
</urlset>`;
}
