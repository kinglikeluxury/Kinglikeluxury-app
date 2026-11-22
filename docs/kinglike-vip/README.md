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

## Next implementation slices (not yet completed)
1. Validate schema against the exact staging database and create migration review/tests.
2. VIP admin management for projects, units, owner invitation and secure activation.
3. Installments/partial payments, private S3 receipts and finance-only verification.
4. Developer statement requests once per unit/calendar month, admin request queue.
5. Progress updates, management photos and camera settings with signed/approved URLs.
6. Handover, digital VIP card, notifications and referral flows.
7. Automated tests of cross-account authorization, audit records and email idempotency, then controlled staging launch.

**Important:** Main and the WhatsApp staging branch did not share a common ancestor in the observed GitHub comparison. Do not merge by force or overwrite either branch. Reconcile changed files explicitly after WhatsApp work settles.
