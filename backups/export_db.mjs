import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("SET search_path TO public");
console.log('✓ Connected — search_path = public');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}`;
const filename = `backup-after-history-restore-${ts}.sql`;
const outPath = path.join('/home/runner/workspace/backups', filename);

const lines = [];
lines.push(`-- ============================================================`);
lines.push(`-- Kinglike Luxury Real Estate — Full Database Backup`);
lines.push(`-- Created: ${new Date().toISOString()}`);
lines.push(`-- PostgreSQL server version 17 (Neon)`);
lines.push(`-- Includes: schema + sequences + indexes + data`);
lines.push(`-- ============================================================`);
lines.push(``);
lines.push(`SET statement_timeout = 0;`);
lines.push(`SET lock_timeout = 0;`);
lines.push(`SET client_encoding = 'UTF8';`);
lines.push(`SET standard_conforming_strings = on;`);
lines.push(`SET check_function_bodies = false;`);
lines.push(`SET client_min_messages = warning;`);
lines.push(`SET row_security = off;`);
lines.push(`SET search_path TO public;`);
lines.push(``);

// Helper: escape SQL string value
function sqlVal(v, fieldType) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return `'${v.toISOString().replace('T', ' ').slice(0, 23)}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ── Sequences ──────────────────────────────────────────────────────────────
const seqRes = await client.query(`
  SELECT sequence_name FROM information_schema.sequences 
  WHERE sequence_schema = 'public' ORDER BY sequence_name`);
console.log(`✓ Sequences: ${seqRes.rows.length}`);

lines.push(`-- ── Sequences ─────────────────────────────────────────────────`);
for (const { sequence_name: sn } of seqRes.rows) {
  try {
    const sv = await client.query(`SELECT last_value, increment_by, is_called FROM public."${sn}"`);
    const { last_value, increment_by, is_called } = sv.rows[0];
    lines.push(`CREATE SEQUENCE IF NOT EXISTS public."${sn}" INCREMENT ${increment_by} START 1 MINVALUE 1 NO MAXVALUE CACHE 1;`);
    lines.push(`SELECT setval('public."${sn}"', ${last_value}, ${is_called});`);
  } catch (e) {
    lines.push(`-- Skipped sequence ${sn}: ${e.message}`);
  }
}
lines.push(``);

// ── Tables (schema) ────────────────────────────────────────────────────────
const tableRes = await client.query(`
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
const tables = tableRes.rows.map(r => r.table_name);
console.log(`✓ Tables (${tables.length}): ${tables.join(', ')}`);

lines.push(`-- ── Table Schemas ─────────────────────────────────────────────`);
for (const tbl of tables) {
  const colRes = await client.query(`
    SELECT column_name, data_type, udt_name, character_maximum_length,
           numeric_precision, numeric_scale, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position`, [tbl]);

  const pkRes = await client.query(`
    SELECT kcu.column_name FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position`, [tbl]);

  const colDefs = colRes.rows.map(c => {
    let type;
    switch (c.data_type) {
      case 'integer': type = 'integer'; break;
      case 'bigint': type = 'bigint'; break;
      case 'smallint': type = 'smallint'; break;
      case 'boolean': type = 'boolean'; break;
      case 'text': type = 'text'; break;
      case 'jsonb': type = 'jsonb'; break;
      case 'json': type = 'json'; break;
      case 'real': type = 'real'; break;
      case 'double precision': type = 'double precision'; break;
      case 'numeric': type = c.numeric_precision ? `numeric(${c.numeric_precision},${c.numeric_scale||0})` : 'numeric'; break;
      case 'character varying': type = c.character_maximum_length ? `varchar(${c.character_maximum_length})` : 'varchar'; break;
      case 'timestamp without time zone': type = 'timestamp'; break;
      case 'timestamp with time zone': type = 'timestamptz'; break;
      case 'date': type = 'date'; break;
      case 'uuid': type = 'uuid'; break;
      case 'ARRAY': type = `${c.udt_name.replace(/^_/, '')}[]`; break;
      case 'USER-DEFINED': type = c.udt_name; break;
      default: type = c.data_type;
    }
    let def = `  "${c.column_name}" ${type}`;
    if (c.column_default !== null) def += ` DEFAULT ${c.column_default}`;
    if (c.is_nullable === 'NO') def += ` NOT NULL`;
    return def;
  });

  if (pkRes.rows.length > 0) {
    const pks = pkRes.rows.map(r => `"${r.column_name}"`).join(', ');
    colDefs.push(`  PRIMARY KEY (${pks})`);
  }

  lines.push(`CREATE TABLE IF NOT EXISTS public."${tbl}" (`);
  lines.push(colDefs.join(',\n'));
  lines.push(`);`);
  lines.push(``);
}

// ── Unique constraints ─────────────────────────────────────────────────────
const ucRes = await client.query(`
  SELECT tc.constraint_name, tc.table_name,
    string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS cols
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
  GROUP BY tc.constraint_name, tc.table_name ORDER BY tc.table_name`);
if (ucRes.rows.length > 0) {
  lines.push(`-- ── Unique Constraints ─────────────────────────────────────────`);
  for (const row of ucRes.rows) {
    const cols = row.cols.split(', ').map(c => `"${c}"`).join(', ');
    lines.push(`DO $$ BEGIN ALTER TABLE public."${row.table_name}" ADD CONSTRAINT "${row.constraint_name}" UNIQUE (${cols}); EXCEPTION WHEN duplicate_table THEN NULL; END $$;`);
  }
  lines.push(``);
}

// ── Indexes ────────────────────────────────────────────────────────────────
const idxRes = await client.query(`
  SELECT indexname, indexdef FROM pg_indexes
  WHERE schemaname = 'public' AND indexname NOT LIKE '%_pkey'
  ORDER BY tablename, indexname`);
if (idxRes.rows.length > 0) {
  lines.push(`-- ── Indexes ────────────────────────────────────────────────────`);
  for (const row of idxRes.rows) {
    lines.push(`CREATE INDEX IF NOT EXISTS "${row.indexname}" ON ${row.indexdef.split(' ON ')[1]};`);
  }
  lines.push(``);
}

// ── Data ───────────────────────────────────────────────────────────────────
// Insert in dependency order to satisfy FK references
const dataOrder = [
  'users', 'properties', 'projects', 'blog_posts',
  'verification_codes', 'contact_logs', 'payments',
  'notification_logs', 'notification_templates', 'session',
  'consultation_time_slots', 'consultation_bookings',
  'user_notifications', 'push_subscriptions',
  'ai_conversations', 'ai_messages', 'investor_profiles', 'ai_lead_scores'
];
for (const t of tables) { if (!dataOrder.includes(t)) dataOrder.push(t); }

lines.push(`-- ── Data ──────────────────────────────────────────────────────`);
let totalRows = 0;
for (const tbl of dataOrder) {
  if (!tables.includes(tbl)) continue;
  const dataRes = await client.query(`SELECT * FROM public."${tbl}"`);
  totalRows += dataRes.rows.length;
  lines.push(`-- ${tbl}: ${dataRes.rows.length} rows`);
  if (dataRes.rows.length === 0) { lines.push(``); continue; }

  const cols = dataRes.fields.map(f => `"${f.name}"`).join(', ');
  const rowLines = dataRes.rows.map(row => {
    const vals = dataRes.fields.map(f => sqlVal(row[f.name], f.dataTypeID));
    return `  (${vals.join(', ')})`;
  });
  lines.push(`INSERT INTO public."${tbl}" (${cols}) VALUES`);
  lines.push(rowLines.join(',\n') + ';');
  lines.push(``);
}
console.log(`✓ Data: ${totalRows} total rows`);

lines.push(`-- ── Sequence Reset (after data import) ─────────────────────────`);
for (const { sequence_name: sn } of seqRes.rows) {
  const tbl = sn.replace(/_id_seq$/, '');
  if (tables.includes(tbl)) {
    lines.push(`SELECT setval('public."${sn}"', COALESCE((SELECT MAX(id) FROM public."${tbl}"), 1), true);`);
  }
}
lines.push(``);
lines.push(`-- ============================================================`);
lines.push(`-- End of backup — ${new Date().toISOString()}`);
lines.push(`-- Total tables: ${tables.length} | Total rows: ${totalRows}`);
lines.push(`-- ============================================================`);

fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
const stats = fs.statSync(outPath);
console.log(`✓ Saved: ${filename}`);
console.log(`✓ Size: ${(stats.size / 1024).toFixed(2)} KB | Lines: ${lines.length}`);
console.log(`FILENAME=${filename}`);

await client.end();
