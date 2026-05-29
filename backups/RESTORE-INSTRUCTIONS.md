# Kinglike Luxury Real Estate — Restore Instructions

**Backup Date:** 2026-05-29 10:51 UTC  
**Git commit at backup:** `3c5199a` (HEAD → main)

---

## Backup Files

| File | Size | Contents |
|------|------|----------|
| `code-backup-2026-05-29-1051.zip` | 3.2 MB | Full source code (frontend, backend, mobile, config) |
| `database-backup-2026-05-29.sql` | 2.1 MB | All 19 tables, schema + data (412 rows) |

---

## Database Statistics at Backup Time

| Table | Rows |
|-------|------|
| users | 9 |
| properties | 61 |
| projects | 22 |
| blog_posts | 27 |
| consultation_bookings | 3 |
| consultation_time_slots | 80 |
| contact_logs | 11 |
| ai_conversations | 22 |
| ai_messages | 106 |
| notification_logs | 46 |
| notification_templates | 6 |
| project_live_cameras | 3 |
| user_notifications | 4 |
| verification_codes | 10 |
| session | 2 |
| payments | 0 |
| ai_lead_scores | 0 |
| investor_profiles | 0 |
| push_subscriptions | 0 |
| **TOTAL** | **412** |

**Live database size:** ~10 MB (Neon PostgreSQL)

---

## Part 1 — Restore Source Code

### Option A: Unzip into a fresh directory

```bash
mkdir kinglike-restored
cd kinglike-restored
unzip /path/to/backups/code-backup-2026-05-29-1051.zip
```

### Option B: Restore over existing project (overwrite)

```bash
cd /home/runner/workspace
unzip -o backups/code-backup-2026-05-29-1051.zip
```

### After unzipping — reinstall dependencies

```bash
npm install
```

### Start the application

```bash
npm run dev
```

---

## Part 2 — Restore Database

### Required environment variables

The following secrets must be set before restoring:

| Variable | Purpose |
|----------|---------|
| `NEON_DATABASE_URL` | Primary database connection (used by app) |
| `DATABASE_URL` | Secondary reference (same Neon DB) |

Connection string format:
```
postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require&channel_binding=require
```

### Option A: Restore to Neon using psql

```bash
psql "$NEON_DATABASE_URL" -f backups/database-backup-2026-05-29.sql
```

> **Note:** The local `pg_dump` (v16) is incompatible with the Neon server (v17).
> Use `psql` for restore — it has no version restriction.

### Option B: Restore to a new PostgreSQL database

```bash
# Create the target database first
createdb kinglike_restore

# Restore
psql "postgresql://localhost/kinglike_restore" -f backups/database-backup-2026-05-29.sql
```

### Option C: Restore via Node.js (if psql unavailable)

```bash
cd /home/runner/workspace
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync('backups/database-backup-2026-05-29.sql', 'utf8');
const statements = sql.split(';').filter(s => s.trim() && !s.trim().startsWith('--'));
(async () => {
  for (const stmt of statements) {
    try { await pool.query(stmt); } catch(e) { console.warn('SKIP:', e.message.slice(0,80)); }
  }
  console.log('Done');
  await pool.end();
})();
"
```

### Verify restore

```bash
psql "$NEON_DATABASE_URL" -c "SELECT table_name, (SELECT COUNT(*) FROM information_schema.columns WHERE table_name=t.table_name) FROM information_schema.tables t WHERE table_schema='public' ORDER BY table_name;"
```

Expected: 19 tables returned.

---

## Part 3 — Full Environment Restore (fresh Replit project)

1. Unzip `code-backup-2026-05-29-1051.zip` into the new Replit project
2. Set all required secrets (see list below)
3. Run `npm install`
4. Run database restore: `psql "$NEON_DATABASE_URL" -f backups/database-backup-2026-05-29.sql`
5. Start app: `npm run dev`

### Required secrets / environment variables

| Secret | Description |
|--------|-------------|
| `NEON_DATABASE_URL` | Neon PostgreSQL connection string |
| `DATABASE_URL` | Same as NEON_DATABASE_URL |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name for media uploads |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `RESEND_API_KEY` | Email delivery (Resend) |
| `OPENAI_API_KEY` | AI advisor feature |
| `TWILIO_ACCOUNT_SID` | SMS/WhatsApp verification |
| `TWILIO_AUTH_TOKEN` | SMS/WhatsApp verification |
| `TWILIO_PHONE_NUMBER` | Twilio sending number |
| `VAPID_PUBLIC_KEY` | Web push notifications |
| `VAPID_PRIVATE_KEY` | Web push notifications |
| `SESSION_SECRET` | Express session encryption |

---

## Part 4 — Rollback via Git

The project was tagged at backup time. To roll back to this exact state:

```bash
git checkout pre-backup-2026-05-29
```

> **Note:** Git tag `pre-backup-2026-05-29` was requested but requires a background task
> due to Replit's git safety restrictions. Use the Replit checkpoint system instead:
> **Checkpoint commit:** `3c5199a` — "Published your App" (2026-05-29)

To restore via Replit checkpoint: open the Checkpoints panel and revert to commit `3c5199a`.

---

## Notes

- **Do NOT restore** directly over a live production database without first taking a fresh backup
- The SQL dump uses `DROP TABLE IF EXISTS ... CASCADE` — all existing data in restored tables will be replaced
- Sessions table restore will log out all active users (expected behavior)
- Cloudinary media files (photos, videos) are stored externally and are NOT included in the database backup — they remain on Cloudinary regardless of database restores
