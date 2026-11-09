# Dedicated WhatsApp employee archive DB — activation checklist (9 Nov 2026)

## Infrastructure staged, not activated

- Project: **Kinglike-Web-Staging** (not the separate production Kinglike project).
- Proposed Railway database: **Postgres-92tK**; service ID
  \`9d6724d9-8353-427b-9c78-9fac8e2e9068\`.
- PostgreSQL template \`postgres\` (Railway Templates; Postgres SSL image v18),
  dedicated persistent volume, \`POSTGRES_DB=kinglike_whatsapp_archive\`.
- The entire proposed Railway change is in **STAGED** state. No service instance,
  network traffic, volume, invoice for its runtime, or DB tables are activated
  until the staged patch is committed. **Do not commit** before approving any
  recurring Railway database/storage costs and network/access review.
- No public TCP proxy must be added. Private Railway networking only.

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

**Current state: database STAGED only; migration NOT APPLIED; real numbers
NOT CONNECTED; no changes to production/main.**
