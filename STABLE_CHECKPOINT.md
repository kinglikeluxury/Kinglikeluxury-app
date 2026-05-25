## stable-after-properties-restore

**Date:** 2026-05-25T17:18:42Z  
**Status:** STABLE — Properties restored from Neon PITR

### Database State (Neon — ep-winter-paper-a4q7e6vy)

| Table              | Records |
|--------------------|---------|
| properties         | 55      |
| projects           | 19      |
| users              | 8       |
| blog_posts         | 24      |
| contact_logs       | 11      |
| notification_logs  | 20      |
| payments           | 0       |
| verification_codes | 6       |

Properties ID range: 4 → 76  
Projects: 19 restored  

### Backup Files

| File | Format | Size |
|------|--------|------|
| `backups/neon_backup_2026-05-25T17-18-42Z.sql` | pg_dump SQL | 1.9 MB |
| `backups/neon_json_backup_2026-05-25T17-18-42Z.json` | JSON export | 2.0 MB |
| `backups/backup_2026-05-25T14-09-31-150Z.json` | JSON export (Railway) | 257 KB |

### Active Database
- **Host:** ep-winter-paper-a4q7e6vy.us-east-1.aws.neon.tech
- **Database:** neondb
- **User:** neondb_owner
- **DATABASE_URL:** Neon (restored from PITR)

### Safety Rules
- DO NOT run seed scripts on this database
- DO NOT run migrations that drop/truncate tables
- DO NOT delete properties or projects
