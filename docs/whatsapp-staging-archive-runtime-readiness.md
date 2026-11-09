# Kinglike employee WhatsApp — Staging runtime safety checkpoint

This is a **read-only, non-enrolling** checkpoint deployed only to the separate Kinglike-Web-Staging project. It does not replace the Meta verification or the employee-consent program.

## Current infrastructure inventory

At the November 9, 2026 Staging review:
- Kinglike-Web-Staging app: service reliable-art, isolated from main production.
- Staging app PostgreSQL: Postgres — for the application, NOT for the archive.
- Separate onboarding proof DB: Postgres-3cCz — ONLY for Meta signup proof, NOT for the archive.
- No third, dedicated employee conversation archive PostgreSQL service was found in that project's service inventory.

No additional database was provisioned and no migrations were run as part of this change. Never use APP_STAGING_DATABASE_URL, NEON_DATABASE_URL, DATABASE_URL, or WHATSAPP_STAGING_PROOF_DATABASE_URL as archive fallback.

## Code delivered

- server/whatsappEmployeeArchiveRuntimeGuard.ts contains a closed-by-default Staging-only database URL, identity, privilege and two-key validator.
- server/whatsappOperationsStatusRoutes.ts adds a protected GET /api/admin/staging/whatsapp-archive-readiness route. It uses the **existing server-side admin session** and returns *only status booleans/blocker codes*, never DB hostnames, usernames, credentials, keys, conversations or customer numbers.
- Only if **every** pre-existing privacy/Meta/history/media approval gate and independent DB identity gate succeeds, that GET endpoint explicitly attempts a short-lived, **read-only** connection to a private Railway archive DB and an independent insert-only audit role. The route does not migrate tables, insert rows, change roles or activate a webhook.
- client/src/pages/admin/whatsapp-employee-operations.tsx shows the signed-in admin a clear Arabic checklist with the actual blocked stages. The existing WhatsApp chat preview remains mock-only unless separately configured after a complete pilot.
- CI covers accidental Neon/app/proof DB selection, public database endpoints, missing audit writer, owner/superuser roles, unsafe UPDATE/DELETE grants, missing immutable audit trigger, missing policy assertions, and direct unauthenticated access.

## Staging configuration ONLY (future review, no values stored in repo)

A separate Railway private-network PostgreSQL service is required. On a **dedicated Staging archive worker** after schema/role provisioning and owner/security approval:

- WHATSAPP_EMPLOYEE_ARCHIVE_STAGING_RUNTIME_ENABLED
- WHATSAPP_EMPLOYEE_ARCHIVE_DATABASE_URL
- WHATSAPP_EMPLOYEE_ARCHIVE_AUDIT_DATABASE_URL
- WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_HOST
- WHATSAPP_EMPLOYEE_ARCHIVE_EXPECTED_NAME
- WHATSAPP_EMPLOYEE_INBOX_AES_KEY_B64
- WHATSAPP_EMPLOYEE_INBOX_HMAC_KEY_B64
- WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED
- WHATSAPP_EMPLOYEE_ARCHIVE_CUSTOMER_NOTICE_APPROVED
- WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_POLICY_APPROVED
- WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED
- WHATSAPP_EMPLOYEE_ARCHIVE_HISTORY_IMPORT_READY
- WHATSAPP_EMPLOYEE_ARCHIVE_PRIVATE_MEDIA_READY

**Do NOT set the runtime flag or mark any approval true yet**: the separate DB/schema/migration roles and private media store are not provisioned, official Meta employee phone eligibility is not verified, and the real history importer and streaming media downloader are not yet complete. True flags are explicit assertions requiring external human evidence, not a way to skip verification.

The archive runtime must be a non-owner, non-superuser database role with:
- inbox table: SELECT/INSERT/UPDATE, but no DELETE/TRUNCATE/schema CREATE;
- employee events: SELECT/INSERT only, never UPDATE/DELETE/TRUNCATE;
- separate audit connection: INSERT ONLY on the immutable access-audit table, never SELECT/UPDATE/DELETE/TRUNCATE.

The database must not share hostname, database name or credentials with the application, Neon production, or the Meta signup proof database.

## Remaining mandatory work before live Samer Coexistence

1. Provision a third independent private PostgreSQL service plus a separate private media object store, with documented backups, retention/erasure workflow, two scoped non-owner runtime roles, unique encryption/HMAC keys and audited access. Apply owner-reviewed manual SQL migrations to that service only.
2. Connect a secure live ingress and the encrypted durable worker to that dedicated service. The Staging external-integration guard continues to reject all real Meta webhooks for now; do not bypass that guard without the explicitly approved, correctly scoped pilot design.
3. Move the authorized archive reads from local test-only connections to the independent Staging service, with a source-of-truth identity check against Kinglike login and scope/consent grants; no blanket admin access. Add a separate audited media download/scan/storage path.
4. Implement full, idempotent, out-of-order history chunk import before the limited Meta history-sync window; test retries, date ordering, and reconciliation of original messages with verified revoke events.
5. Obtain explicit employee notice/consent and any required customer notification/legal basis, plus the policy for retaining revoked messages and lawful data deletion. Verify the exact business phone and Coexistence entitlement at Meta.
6. Start a single company-number pilot only after tests pass and explicit approval to connect that real number. Verify actual delivery latency, backlog, media availability and gaps; avoid claiming synchronization is instantaneous or that local handset deletion can be detected.

Production/main are intentionally unchanged at this checkpoint.
