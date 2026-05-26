/**
 * Direct database-to-database copy.
 * SOURCE: NEON_DATABASE_URL  (ep-winter-paper — live production, READ ONLY)
 * TARGET: DATABASE_URL       (ep-young-forest — new empty database)
 *
 * Reads every row from source and inserts into target.
 * Uses ON CONFLICT DO NOTHING for idempotency.
 * Does NOT modify the source at all.
 */
import pg from 'pg';
const { Client } = pg;

const srcUrl = process.env.NEON_DATABASE_URL;
const dstUrl = process.env.DATABASE_URL;

if (!srcUrl) { console.error('NEON_DATABASE_URL not set'); process.exit(1); }
if (!dstUrl) { console.error('DATABASE_URL not set'); process.exit(1); }

const srcHost = new URL(srcUrl).hostname;
const dstHost = new URL(dstUrl).hostname;
console.log('SOURCE :', srcHost, '(READ ONLY — will not be modified)');
console.log('TARGET :', dstHost);
console.log('');

const src = new Client({ connectionString: srcUrl, ssl: { rejectUnauthorized: false } });
const dst = new Client({ connectionString: dstUrl, ssl: { rejectUnauthorized: false } });

await src.connect();
await dst.connect();
console.log('✓ Both connections established\n');

// Tables in dependency order (respect foreign keys)
const TABLES = [
  'users',
  'properties',
  'projects',
  'blog_posts',
  'verification_codes',
  'contact_logs',
  'payments',
  'notification_templates',
  'notification_logs',
  'session',
  'consultation_time_slots',
  'consultation_bookings',
  'user_notifications',
  'push_subscriptions',
  'ai_conversations',
  'ai_messages',
  'investor_profiles',
  'ai_lead_scores',
];

// Get list of tables that actually exist in source
const srcTablesRes = await src.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
`);
const srcTables = new Set(srcTablesRes.rows.map(r => r.table_name));

// Get list of tables that actually exist in target
const dstTablesRes = await dst.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
`);
const dstTables = new Set(dstTablesRes.rows.map(r => r.table_name));

// Only copy tables that exist in both source and target
const toCopy = TABLES.filter(t => srcTables.has(t) && dstTables.has(t));

// Add any source tables not in the explicit list
for (const t of srcTables) {
  if (!toCopy.includes(t) && dstTables.has(t)) toCopy.push(t);
}

console.log(`Tables to copy: ${toCopy.join(', ')}\n`);

let totalRows = 0;

for (const table of toCopy) {
  // Read all rows from source
  const { rows, fields } = await src.query(`SELECT * FROM public."${table}"`);
  if (rows.length === 0) {
    console.log(`  ${table.padEnd(32)} 0 rows — skipped`);
    continue;
  }

  const cols = fields.map(f => `"${f.name}"`).join(', ');

  // Build parameterised INSERT
  let inserted = 0;
  let skipped  = 0;

  for (const row of rows) {
    const vals  = fields.map((_, i) => `$${i + 1}`).join(', ');
    const params = fields.map(f => row[f.name]);
    try {
      await dst.query(
        `INSERT INTO public."${table}" (${cols}) VALUES (${vals}) ON CONFLICT DO NOTHING`,
        params
      );
      inserted++;
    } catch (e) {
      // Try without ON CONFLICT (for tables without PK)
      try {
        await dst.query(
          `INSERT INTO public."${table}" (${cols}) VALUES (${vals})`,
          params
        );
        inserted++;
      } catch (e2) {
        skipped++;
        if (skipped <= 2) {
          console.warn(`    WARN ${table}: ${e2.message.split('\n')[0]}`);
        }
      }
    }
  }

  console.log(`  ${table.padEnd(32)} ${inserted} inserted, ${skipped} skipped`);
  totalRows += inserted;
}

// Reset sequences to match source max IDs
console.log('\n── Resetting sequences ──');
const seqRes = await src.query(`
  SELECT sequence_name FROM information_schema.sequences
  WHERE sequence_schema = 'public'
`);
for (const { sequence_name: sn } of seqRes.rows) {
  const tbl = sn.replace(/_id_seq$/, '');
  if (srcTables.has(tbl)) {
    try {
      const r = await src.query(`SELECT MAX(id) FROM public."${tbl}"`);
      const maxId = r.rows[0].max;
      if (maxId !== null) {
        await dst.query(`SELECT setval('public."${sn}"', $1, true)`, [maxId]);
        console.log(`  ${sn.padEnd(40)} → ${maxId}`);
      }
    } catch (_) {}
  }
}

console.log(`\n✓ Migration complete — ${totalRows} total rows copied\n`);

// ── Final count verification ──────────────────────────────────────────────
console.log('── Verification (TARGET) ────────────────');
for (const tbl of ['properties', 'projects', 'blog_posts', 'users']) {
  const r = await dst.query(`SELECT COUNT(*) FROM public."${tbl}"`);
  const count = r.rows[0].count;
  const expected = { properties: 55, projects: 19, blog_posts: 24, users: 8 }[tbl];
  const status = parseInt(count) === expected ? '✓' : '✗ MISMATCH (expected ' + expected + ')';
  console.log(`  ${tbl.padEnd(16)} ${count.toString().padStart(4)} rows  ${status}`);
}

await src.end();
await dst.end();
