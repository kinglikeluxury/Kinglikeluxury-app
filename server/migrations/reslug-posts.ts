/**
 * Migration: re-generate blog slugs using the improved toEnglishSlug algorithm.
 * Old slugs are preserved in oldSlugs[] for 301 redirect continuity.
 *
 * Run with:  npx tsx server/migrations/reslug-posts.ts
 *
 * Pass --dry-run to preview changes without writing to the database.
 */

import { db } from "../db";
import { blogPosts } from "../../shared/schema";
import { toEnglishSlug } from "../slugUtils";
import { sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`\n=== Slug migration${DRY_RUN ? " (DRY RUN — no DB writes)" : ""} ===\n`);

  const posts = await db
    .select({
      id: blogPosts.id,
      title: blogPosts.title,
      slug: blogPosts.slug,
      oldSlugs: blogPosts.oldSlugs,
      translations: blogPosts.translations,
    })
    .from(blogPosts);

  let updated = 0;
  let skipped = 0;

  for (const post of posts) {
    const translations = post.translations as Record<string, { title?: string }> | null;
    const enTitle = translations?.en?.title ?? "";
    const source = enTitle || (!post.title.match(/[^\x00-\x7F]/) ? post.title : "");
    const newSlug = toEnglishSlug(source);

    if (!newSlug || newSlug === post.slug) {
      console.log(`  SKIP  id=${post.id}  (slug unchanged)\n         ${post.slug}`);
      skipped++;
      continue;
    }

    // Collect all old slugs (de-duplicate)
    const existingOld: string[] = post.oldSlugs ?? [];
    const allOld = Array.from(new Set([...existingOld, post.slug]));

    console.log(`  UPDATE id=${post.id}`);
    console.log(`    OLD: ${post.slug}`);
    console.log(`    NEW: ${newSlug}`);
    console.log(`    ARCHIVED: [${allOld.join(", ")}]\n`);

    if (!DRY_RUN) {
      // Build a literal postgres array string e.g. '{"a","b"}'
      const pgArray = "{" + allOld.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",") + "}";
      await db.execute(sql`
        UPDATE blog_posts
        SET   slug      = ${newSlug},
              old_slugs = ${pgArray}::text[]
        WHERE id        = ${post.id}
      `);
    }
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}  Skipped: ${skipped}`);
  if (DRY_RUN) console.log("(no changes written — remove --dry-run to apply)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
