# KINGLIKE VIP — integration into the existing Kinglike Luxury app

**Architecture decision (23 November 2026):** KINGLIKE VIP is a protected module of
`www.kinglikeluxury.app`, **not** a second public application. This document
supersedes the *separate Railway VIP hosting recommendation* in the older QA
runbook. The isolated Railway draft is not a release prerequisite and must not
be committed merely to continue development. It can remain staged and unused.

## One application, one existing login, additive VIP tables

- Client route: `/vip`; employee who sold the unit: `/vip/sales`; Kinglike
  management: `/admin/vip`; invitations: `/vip/activate`.
- `server/index.ts` registers VIP routes **after** `registerRoutes(app)`,
  which establishes the current application session. No second login is
  needed; clients activate a verified entitlement after a sale.
- Existing `users` IDs and `req.session.userId` are the identity source.
  Each VIP read must additionally check active/verified account and current
  buyer/seller entitlement. A cached UI menu is *never* authorization.
- Both `KINGLIKE_VIP_ENABLED` (server) and
  `VITE_KINGLIKE_VIP_ENABLED` (Vite build) default OFF.
  A backend-only or UI-only enable is **not** a launch.
- Navigation uses actual owner/seller unit lists; administrators see a VIP
  shortcut inside the existing admin menu. Switching accounts clears VIP
  client-side query caches without clearing public website data.

## Database integration — **no production migration performed**

- Target the current application's Neon/PostgreSQL database with separate,
  additive `vip_*` tables and indexes only. Do not install a second
  `users` table, replace identities or automatically sync leads.
- `server/vip/migrations/000_qa_users_only.sql` is exclusively for a
  **throwaway** CI/QA database and must NEVER run on the real app database.
- `001_vip_foundation.sql` is a review candidate, **not** permission to run
  it. Validate SQL, table/index names and existing `users` column types
  against a read-only schema inventory and a disposable compatible copy.
  Record affected objects, migration/rollback plan and backup/restore test.
- Never use automatic schema sync or `drizzle-kit push` for the VIP release.
  No customers, existing leads, WhatsApp jobs, developer projects, payments or
  CRM ownership assignments are imported or changed without separately
  approved mapping and reconciliation.

## Private receipts, finance and messaging

- The existing public image upload/Cloudinary path is **not** approved for
  identity documents, transfer receipts or official developer statements.
  Keep private storage fail-closed until there is a verified non-public
  provider with suitable permissions, malware scanning, retention and
  restoration. Reusing an existing *private* provider may avoid another fee;
  cost-free private storage cannot be assumed.
- Uploading a receipt must never mark an installment paid. A separately
  authorized finance reviewer confirms the verified amount, auditable source
  and posting; duplicate/replayed postings are rejected.
- Developer official statements are only those actually received; client
  financial summaries must not be presented as developer-issued documents.
- CRM bridge remains **read-only** by default. No messaging, WhatsApp or
  bulk customer invites are activated by merging the VIP code.
- Two-day in-app reminder generator has no scheduler until explicitly approved.

## Approval gates for eventual launch

1. Free GitHub CI: check TypeScript, VIP unit tests, disposable PostgreSQL
   migration/authorization tests and production build, with both flags OFF.
2. Review the exact current app schema and storage/security setup with
   read-only access. Identify any unsupported production-user columns or
   database role differences before a migration.
3. Test existing app login, password reset, invitation activation, expired
   sessions, immediate revocation and role isolation with **synthetic**
   accounts; include desktop and Android/iOS RTL/LTR layouts.
4. Test real private file permissions, cancellation, audit, supported currency,
   bank evidence, signed handover and device camera integrations.
5. Review the deployment diff against current `main` and WhatsApp changes.
   Owner must expressly authorize a `main` merge and any production schema
   migration. Keep flags OFF on the initial code deployment.
6. After backup and owner approval, deliberately enable both flags and verify
   against a small designated internal test audience before inviting clients.
7. Rollback: turn BOTH flags OFF; do not delete audit/financial evidence.

**Current state:** code and tests on
`feature/kinglike-vip-20261122` only. No release, production database
migration, Railway VIP activation or customer data import is implied by
this document.
