/**
 * PRODUCTION DATABASE BACKUP SCRIPT
 * Exports critical production data to JSON for safe keeping.
 * Safe to run — READ ONLY, never modifies data.
 *
 * Usage: npx tsx server/backup.ts
 */
import { db } from './db';
import { properties, projects, users, blogPosts } from '../shared/schema';
import { desc } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

async function backup() {
  console.log('[Backup] Starting production data backup...');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), 'backups');

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupData: Record<string, any[]> = {};

  const [allProperties, allProjects, allUsers, allBlogPosts] = await Promise.all([
    db.select().from(properties).orderBy(desc(properties.createdAt)),
    db.select().from(projects).orderBy(desc(projects.createdAt)),
    db.select().from(users).orderBy(users.id),
    db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt)),
  ]);

  backupData.properties = allProperties;
  backupData.projects = allProjects;
  backupData.users = allUsers.map(u => ({ ...u, password: '[REDACTED]' }));
  backupData.blog_posts = allBlogPosts;

  const summary = {
    backup_time: new Date().toISOString(),
    database: process.env.DATABASE_URL?.includes('rlwy.net') ? 'Railway (PRODUCTION)' : 'Development',
    counts: {
      properties: allProperties.length,
      projects: allProjects.length,
      users: allUsers.length,
      blog_posts: allBlogPosts.length,
    },
    data: backupData,
  };

  const filename = path.join(backupDir, `backup_${timestamp}.json`);
  fs.writeFileSync(filename, JSON.stringify(summary, null, 2));

  console.log('[Backup] Summary:');
  console.log(`  Properties : ${allProperties.length}`);
  console.log(`  Projects   : ${allProjects.length}`);
  console.log(`  Users      : ${allUsers.length}`);
  console.log(`  Blog posts : ${allBlogPosts.length}`);
  console.log(`[Backup] Saved to: ${filename}`);

  return summary;
}

backup()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[Backup] Failed:', err);
    process.exit(1);
  });

export default backup;
