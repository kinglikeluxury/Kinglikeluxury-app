/**
 * Restores backups/live-production-final.sql into DATABASE_URL.
 * Handles multi-line statements and isolates each with SAVEPOINT.
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const parsed = new URL(url);
console.log('TARGET HOST :', parsed.hostname);
console.log('TARGET DB   :', parsed.pathname.replace('/', ''));

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('✓ Connected\n');

// ── Parse SQL into statements ────────────────────────────────────────────────
// Split on semicolons that are NOT inside single-quoted strings.
const sqlPath = path.join(__dirname, 'live-production-final.sql');
const raw = fs.readFileSync(sqlPath, 'utf8');

function splitStatements(sql) {
  const stmts = [];
  let current = '';
  let inString = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" && !inString) {
      inString = true; current += ch; i++;
    } else if (ch === "'" && inString) {
      // check for escaped quote ''
      if (sql[i + 1] === "'") { current += "''"; i += 2; }
      else { inString = false; current += ch; i++; }
    } else if (ch === '-' && sql[i + 1] === '-' && !inString) {
      // single-line comment — skip to end of line
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (ch === ';' && !inString) {
      const stmt = current.trim();
      if (stmt) stmts.push(stmt);
      current = '';
      i++;
    } else {
      current += ch; i++;
    }
  }
  const last = current.trim();
  if (last) stmts.push(last);
  return stmts;
}

const statements = splitStatements(raw);
console.log(`Parsed ${statements.length} statements\n`);

// ── Execute with per-statement savepoints ────────────────────────────────────
await client.query('BEGIN');

let ok = 0, skipped = 0, failed = 0;
for (let idx = 0; idx < statements.length; idx++) {
  const stmt = statements[idx];
  const preview = stmt.substring(0, 80).replace(/\n/g, ' ');
  try {
    await client.query(`SAVEPOINT s${idx}`);
    await client.query(stmt);
    await client.query(`RELEASE SAVEPOINT s${idx}`);
    ok++;
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT s${idx}`);
    await client.query(`RELEASE SAVEPOINT s${idx}`);
    const msg = e.message.split('\n')[0];
    const benign = ['already exists', 'duplicate key', 'unique_violation', 'does not exist'].some(s => msg.toLowerCase().includes(s));
    if (benign) {
      skipped++;
    } else {
      console.warn(`  FAIL [${idx + 1}]: ${msg}`);
      console.warn(`       ${preview}`);
      failed++;
    }
  }
}

await client.query('COMMIT');
console.log(`\n✓ Done — ${ok} ok · ${skipped} skipped (benign) · ${failed} failed\n`);

// ── Verify ───────────────────────────────────────────────────────────────────
console.log('── Counts ──────────────────────────────');
const tables = ['properties', 'projects', 'blog_posts', 'users',
                'contact_logs', 'notification_logs', 'notification_templates'];
for (const tbl of tables) {
  const r = await client.query(`SELECT COUNT(*) FROM public."${tbl}"`);
  console.log(`  ${tbl.padEnd(30)} ${r.rows[0].count}`);
}

await client.end();
