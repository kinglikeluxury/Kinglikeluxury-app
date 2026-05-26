================================================================
KINGLIKE LUXURY REAL ESTATE — Production Backup
Date:     2026-05-26
Database: ep-young-forest-aq74bptf-pooler.c-8.us-east-1.aws.neon.tech
Host:     www.kinglikeluxury.app
================================================================

CONTENTS
--------
kinglike-production-2026-05-26.sql   Full PostgreSQL dump (schema + data)
kinglike-project-2026-05-26.zip      Full source code (excl. node_modules / dist / .git)
.env.example                         Environment variables template
README.txt                           This file

DATABASE RECORD COUNTS (verified at time of backup)
----------------------------------------------------
  properties   : 55 rows
  projects     : 19 rows
  blog_posts   : 24 rows
  users        :  8 rows
  Total tables : 18

HOW TO RESTORE THE DATABASE
----------------------------
1. Create a new Neon (or any PostgreSQL 16) database.
2. Run:
     psql "<YOUR_NEW_CONNECTION_STRING>" \
       -f kinglike-production-2026-05-26.sql

HOW TO RESTORE THE PROJECT
---------------------------
1. Unzip kinglike-project-2026-05-26.zip into a new directory.
2. Run:  npm install
3. Copy .env.example to .env and fill in all secrets.
4. Run:  npm run build
5. Start: NODE_ENV=production node dist/index.js

PRODUCTION DEPLOYMENT (Replit)
-------------------------------
Run command : sh -c "NODE_ENV=production node dist/index.js"
Build command: npm run build
Deployment   : Autoscale

PRODUCTION ENVIRONMENT NOTES
------------------------------
- Database uses NEON_DATABASE_URL exclusively (ignores DATABASE_URL, PG* vars)
- Session cookies: httpOnly=true, secure=true (prod), sameSite=none (prod)
- Cloudinary used for all media uploads (photos, videos, audio, blog)
- Supported languages: en, ar, he, ru, ka, az, tr, zh, pl
- AR/mobile app: separate React Native project in kinglike-mobile/

================================================================
