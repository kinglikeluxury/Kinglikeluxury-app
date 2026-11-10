# Dedicated WhatsApp employee archive DB — activation checklist (9 Nov 2026)

## Infrastructure activated in isolated Staging (9 Nov 2026)

- Project: **Kinglike-Web-Staging** (not the separate production Kinglike project).
- Proposed Railway database: **Postgres-92tK**; service ID
  \`9d6724d9-8353-427b-9c78-9fac8e2e9068\`.
- PostgreSQL template \`postgres\` (Railway Templates; Postgres SSL image v18),
  dedicated persistent volume, \`POSTGRES_DB=kinglike_whatsapp_archive\`.
- The owner explicitly approved the potential Railway service/storage charges.
  The staged patch was committed on 9 Nov 2026. Railway confirmed **SUCCESS**
  for deployment `a4846d2f-7ab5-4d02-8ee0-fbecdc259cf6`;
  PostgreSQL is **online**, one running replica, zero crashes/warnings.
- The service has **no public service domains or TCP proxies** as verified after
  deployment. Its dedicated persistent volume is attached, with Railway
  reporting a 50,000 MB volume. Consumption and costs may now accrue.
- **DATABASE SCHEMA IS NOT MIGRATED**: no employee records, message archives,
  privileges or user identities were copied or activated. Do not infer table
  readiness from service health.
- No public TCP proxy must be added. Private Railway networking only.

## Private media bucket staged, not active

- Proposed Railway object-storage bucket: **kinglike-whatsapp-employee-media-staging**;
  bucket ID `0ff155e9-2cc4-4eb5-b44a-b0a7b70852ae`, region `sjc`.
- Bucket is **LIVE** in the isolated Staging environment after the same
  approved patch was committed; it is **not connected to the app**. No access
  keys were placed in GitHub or configured on the app and no file has been
  uploaded by this workflow.
- Before activation, require a private-only access-policy review, strict
  employee/conversation-scoped object names, malware checks, MIME/size and
  digest validation, encrypted object persistence, retention/legal deletion,
  credential rotation and audited authorized retrieval. Do not use public
  media URLs or Cloudinary for employee archives.

## Verified schema deployment — 10 November 2026

- Owner's continuation authorized applying the reviewed schema to the separate
  Staging archive service **Postgres-92tK** only.
- A one-off private Railway Function, `whatsapp-archive-bootstrap-once`, ran four
  pinned SQL artifacts inside a **single PostgreSQL transaction** with an
  advisory lock and refused non-Staging/Neon/app/proof identity mismatches.
- Railway migration deployment `4cad4aad-198f-4830-a3ea-b143d5efd70a`
  concluded `SUCCESS`, with explicit marker
  `ARCHIVE_MIGRATION_SUCCESS`. The script verified the empty identity,
  phone, message and inbox tables; exactly four `NOLOGIN` non-superuser
  roles; append-only event/access-audit triggers; and denial of event
  UPDATE/DELETE privileges to the worker.
- The temporary migration Function was **deleted** after success so it no
  longer stores a superuser connection reference. No application service
  was redeployed as part of this migration.
- Independent Railway health check: archive PostgreSQL and Staging application
  both `Online`, one replica each, zero errors/warnings; media bucket `Live`.
  No public database endpoint was created.
- **Live employee numbers remain unconnected and all archive data tables
  remain empty.** Roles are still `NOLOGIN`, with no employee identity
  synchronization or real Meta event ingress configured. No history/media
  content has been imported.

## Existing schema mismatch addressed

The prior canonical schema contains \`REFERENCES users(id)\`, and archive API
checks \`users.is_active\` / \`users.is_admin\` / \`users.role\`. A separately
provisioned archive DB has no main-app \`users\` table. Running the old
migration unchanged would fail.

A new **minimal principal mirror** is therefore required before the existing
schema. It stores *only* integer ID, active flag, admin flag, role and
last verification timestamp, no names/emails/phones/passwords or CRM records.
It starts EMPTY. It is not an authentication source or permission to browse
employee chats. Future integration must verify the currently logged-in user
from the live application auth store **for every request** as well as the
current employee consent and explicit supervisor grant in the archive DB.
A separately credentialed, auditable sync must handle deactivations quickly;
until then live reads and writes remain OFF.

## Operator-reviewed migration order (ONLY on new isolated DB)

1. Verify Railway project ID, exact independent service ID, DB name,
   internal host, superuser identity; verify they differ from app Staging,
   Neon, main production and Meta proof DB. Export a backup/snapshot plan.
2. Review and execute \`docs/sql/2026-11-09-whatsapp-archive-00-isolated-principals.sql.txt\`.
3. Review and execute the **existing**
   \`docs/sql/2026-11-07-whatsapp-employee-unified.sql.txt\`.
4. Review and execute the **existing**
   \`docs/sql/2026-11-09-whatsapp-employee-durable-inbox.sql.txt\`.
5. Review and execute
   \`docs/sql/2026-11-09-whatsapp-archive-03-roles.sql.txt\`.
   All four scoped roles start **NOLOGIN**. Do not expose secrets in SQL files,
   chat, GitHub Actions or shared Railway variables. Verify public access and
   ownership are restricted.
6. Assign distinct credentials securely and enable role logins **only once
   isolation, backup, retention and customer/employee notice are approved**.
   Verify worker, reader, identity synchronizer and audit writer separately.
   No role may own messages or audit tables. Check no member-of-owner grants.
7. Run read-only privilege checks from
   \`server/whatsappEmployeeArchiveRuntimeGuard.ts\` on the dedicated database
   and audit-writer connection; verify a reader has only SELECT and an
   identity mirror starts empty. Prove UPDATE/DELETE/TRUNCATE fail on events.
8. Connect the server-side runtime to this DB with four scoped connections
   (archive reader, event worker, audit writer, verified principal sync).
   Test authenticated access and revocation. No fallback to Neon or app DB.
9. Only then add secure media object storage, history importer, verified Meta
   Coexistence identity and consent/retention compliance. Test genuine signed
   webhook receipts in a single-number authorized pilot.

## No-go conditions

- Neither \`POSTGRES_PASSWORD\` nor role logins may be put into source files,
  GitHub pull requests, or browser storage.
- Do not apply existing archive SQL to the main app database just to satisfy
  its foreign keys. Never copy the full users table to the archive.
- Do not map an app user automatically to an active principal without
  current, server-verified authentication.
- Do not mark \`WHATSAPP_EMPLOYEE_ARCHIVE_*_APPROVED=true\` to force a green
  readiness status. The flags are assertions of separate real evidence.
- Do not start a live Meta webhook, connect Samer or begin retaining customer
  content before the recipient notices/consents and retention/deletion policy.
- Live media file storage, chunked history sync and backlog alerts remain
  separate explicit readiness gates. An encrypted queue alone is not enough.

**Current state: separate database and media bucket LIVE on the Staging project;
migration NOT APPLIED; all employee numbers NOT CONNECTED; no changes to
the main Kinglike production service.**
