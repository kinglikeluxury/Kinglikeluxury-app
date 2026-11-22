# KINGLIKE VIP — isolated implementation branch

This is the first **code-backed foundation** for VIP, not a production-ready portal.

## Isolation invariants
- Production **main**, WhatsApp staging branch, Railway deployments, Neon production, and credentials remain unchanged.
- `KINGLIKE_VIP_ENABLED` defaults OFF; `VITE_KINGLIKE_VIP_ENABLED` defaults OFF. Both must be explicitly enabled in a **dedicated isolated test environment** only after reviewing its database.
- No automatic migration, startup schema creation, outbound email, private file upload, or external WhatsApp call is included in this first slice.
- The UI never assumes mock ownership data. The API only returns units after verifying the authenticated user ID and matching active owner-unit assignments.
- Admin overview requires BOTH a valid active user session and a fresh database check that the user is an admin.
- Never use the public image upload endpoint for receipts, contracts, or statements.

## Included
- New client route `/vip` and admin route `/admin/vip`, hidden unless Vite flag is enabled.
- New server routes `/api/vip/me` and `/api/admin/vip/overview`, disabled unless server flag is enabled.
- Postgres foundation migration in `server/vip/migrations/001_vip_foundation.sql`. Not executed.
- Responsive React/Tailwind entry screens, five-language headings, real-session gating, no fake financial data.

## Second implementation slice (code added, not deployed)
- Client can request an official developer statement once per unit per month, subject to active owner-unit authorization.
- Duplicate requests are blocked by a database unique constraint.
- Admin queue lists requests; admin may mark a new request as 'following up with developer' without issuing an inaccurate statement or sending a message.
- POST/PATCH reject non-JSON and cross-origin requests. No developer outreach, file upload, or emails occur.
- These routes remain disabled until a separate staging environment, database migration and both feature flags are reviewed.

## Third implementation slice (code added, not deployed)
- The admin project control panel can create projects, units, assign units to existing verified active user accounts, and publish or draft construction progress updates.
- The API limits client progress history to projects where they own an actively assigned unit; drafts remain hidden.
- Mutations are transacted with audit records. Assignment is serialized and only one current owner is allowed per unit.
- No invitation emails or new user creation: the invite/activation service remains a separate future phase.
- No storage or media upload endpoints in this slice.
- This migration has NOT been applied in any database and the branch has NOT been deployed or built.

## Fourth implementation slice (code added, not deployed)
- Authorized administrators can create contractual installment schedules for each VIP unit, with an amount, currency, due date, and sequence number.
- Owners can view installment due dates prominently, with verified paid and outstanding balances backed by financial posting records.
- Existing public-site `payments` is NOT used as the property installment ledger.
- Creating an installment does not mark it paid; no receipt upload or approval bypass is available.
- All admin writes are validated and audited in the same DB transaction; no migration, storage writes, emails or deployment have run.

## Fifth implementation slice (code added; not deployed or integration-tested)
- Customers can upload PDF/JPEG/PNG transfer receipts against their own installments; admins can upload for clients and record the original source.
- Uploads are limited to 10 MB, checked by signature, and sent server-side to a dedicated **private GCS bucket** via the existing SDK. Access fails closed when a dedicated bucket or credentials are missing. Bucket settings must enforce uniform access and public access prevention.
- Private receipts are downloaded through a permission-checked endpoint, never public object URLs.
- Uploads remain pending and **never automatically mark installments paid**.
- Dedicated finance grants are separate from admin status; reviewers cannot approve their own uploads. Amount verification and posting occur transactionally with a unique receipt constraint, locking and audit history.
- No migrations executed and no GCS credentials, deployments, or production variables changed.
- Production blockers: isolated staging tests; private storage IAM/CORS review, malware scanning, retention and backup, financial authority review, CSRF and session review, and safe integration with the active WhatsApp branch.

## Next implementation slices (not yet completed)
1. Validate schema against the exact staging database and create migration review/tests.
2. Secure invitation and activation for buyer accounts (existing-account assignments are now drafted).
3. Run isolated staging tests of private receipt uploads, downloads and finance verification; implementation exists but is not validated.
4. Developer statement requests once per unit/calendar month, admin request queue.
5. Management photo uploads and camera settings with signed/approved URLs (progress updates are drafted).
6. Handover, digital VIP card, notifications and referral flows.
7. Automated tests of cross-account authorization, audit records and email idempotency, then controlled staging launch.

**Important:** Main and the WhatsApp staging branch did not share a common ancestor in the observed GitHub comparison. Do not merge by force or overwrite either branch. Reconcile changed files explicitly after WhatsApp work settles.
