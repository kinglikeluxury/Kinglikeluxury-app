================================================================
 KINGLIKE LUXURY REAL ESTATE — FULL PROJECT BACKUP
================================================================

 Backup Date/Time : 2026-05-27  (UTC)
 Project Version  : Live — Production Ready
 Status           : All features operational; live camera integration
                    complete (project_live_cameras table active)

----------------------------------------------------------------
 DATABASE INFORMATION
----------------------------------------------------------------

 Provider   : Neon PostgreSQL (Serverless)
 Version    : PostgreSQL 17.10
 Host       : ep-young-forest-aq74bptf-pooler.c-8.us-east-1.aws.neon.tech
 Database   : neondb
 Schema     : public

 TABLE COUNTS AT BACKUP TIME:
 ┌─────────────────────────┬────────┐
 │ Table                   │  Rows  │
 ├─────────────────────────┼────────┤
 │ properties              │    55  │
 │ projects                │    19  │
 │ blog_posts              │    24  │
 │ users                   │     8  │
 │ project_live_cameras    │     1  │
 │ consultation_bookings   │     1  │
 │ consultation_time_slots │    40  │
 │ contact_logs            │    11  │
 │ verification_codes      │     6  │
 │ user_notifications      │     1  │
 │ notification_templates  │     6  │
 │ notification_logs       │    26  │
 │ ai_conversations        │     9  │
 │ ai_messages             │    67  │
 │ session                 │     8  │
 │ payments                │     0  │
 │ push_subscriptions      │     0  │
 │ ai_lead_scores          │     0  │
 │ investor_profiles       │     0  │
 └─────────────────────────┴────────┘

----------------------------------------------------------------
 BACKUP CONTENTS
----------------------------------------------------------------

 kinglike-source-2026-05-27.zip
   Full project source code (React + TypeScript + Express)
   Excludes: node_modules, dist, .git, .cache, logs

 kinglike-db-dump-2026-05-27.sql
   Complete PostgreSQL INSERT dump of all 19 tables
   Format: Plain SQL with ON CONFLICT DO NOTHING safety
   Generated via: Node.js pg client (read-only, no data modified)

 .env.example
   All required environment variable names (no real values)

----------------------------------------------------------------
 PROJECT ARCHITECTURE SUMMARY
----------------------------------------------------------------

 Frontend  : React 18 + TypeScript + Vite + TailwindCSS + Shadcn UI
 Backend   : Express.js + Drizzle ORM
 Database  : Neon PostgreSQL (cloud-hosted)
 Auth      : Session-based (express-session + connect-pg-simple)
 Media     : Cloudinary (photos, videos, audio, blog)
 AI        : OpenAI GPT-4 (AI Advisor feature)
 i18n      : 9 languages (EN, AR, HE, RU, KA, AZ, TR, ZH, PL)
 Mobile    : React Native (Expo) with AR via ViroReact

 Key recent changes:
   - Live Construction Camera system (project_live_cameras table)
   - Cascading country → city → project filters on Live Projects page
   - Live camera section on individual project detail pages
   - Admin cascading selectors for linking cameras to projects

----------------------------------------------------------------
 RESTORE STEPS
----------------------------------------------------------------

 1. RESTORE SOURCE CODE:
    unzip kinglike-source-2026-05-27.zip -d kinglike-luxury/
    cd kinglike-luxury/
    npm install
    cp .env.example .env
    # Fill in all secret values in .env

 2. RESTORE DATABASE:
    # Option A — psql (requires PostgreSQL 17 client):
    psql "$DATABASE_URL" < kinglike-db-dump-2026-05-27.sql

    # Option B — Neon Console:
    # Paste the SQL file contents into the Neon SQL Editor

    # Option C — If restoring to a fresh DB, run migrations first:
    npm run db:push
    # Then run the SQL dump to restore data

 3. RUN DATABASE MIGRATIONS (if fresh DB):
    npm run db:push

 4. START THE APPLICATION:
    npm run dev        # Development
    npm run build      # Production build
    npm start          # Production server

----------------------------------------------------------------
 IMPORTANT NOTES
----------------------------------------------------------------

 - This is a READ-ONLY backup. No production data was modified.
 - Neon connection, auth, payments, and deployment settings
   were NOT changed during this backup process.
 - All media files (images, videos) are stored on Cloudinary
   and are NOT included in this backup — they remain live at
   cloudinary.com under the 'kinglike' folder.
 - Session data in the 'session' table will be invalid after
   restore — users will need to log in again.
 - The .env.example lists all required environment variables.
   Contact the system administrator for actual secret values.

================================================================
 END OF BACKUP README
================================================================
