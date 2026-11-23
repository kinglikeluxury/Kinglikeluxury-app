# KINGLIKE VIP — Stage 2 isolated launch and acceptance checklist

**Status:** NOT DEPLOYED. Feature branch only. This document is a runbook, not an authorization to change production.

## Release invariants

1. The current main site, WhatsApp staging branch, Kay/CRM business tables, customer accounts and production Neon database must not be modified during VIP testing.
2. Only a dedicated, isolated Railway project/service and empty/anonymized Neon test database may be used for customer-role checks. Do not clone production records.
3. Keep both flags OFF in production: server \`KINGLIKE_VIP_ENABLED\` and client \`VITE_KINGLIKE_VIP_ENABLED\`.
4. Staging must use unique isolated secrets. Never copy production SMTP, WhatsApp, payment, or CRM-write credentials to VIP staging. No secret values may pass via coding-assistant logs.
5. If Replit offers a coding/agent mode selector, choose **Free** only, as requested by the business owner; do not activate a paid mode without confirmation.
6. No customer-facing invitation, push notification, SMS, email, WhatsApp, or automated phone contact without explicit staged authorization and consent.
7. Do not force-merge or overwrite \`kinglike-wa-staging-20261122\`: its history has been observed as separate from \`main\`.

## Isolated staging topology

| Resource | Isolation requirement | Current implementation |
| --- | --- | --- |
| Git repository | \`feature/kinglike-vip-20261122\` only | Code committed and CI tested |
| Railway service | New dedicated VIP sandbox, never \`kinglikeluxury.app\` nor existing WA staging service | **Not provisioned** |
| Staging database | New empty/anonymized Postgres with synthetic users/roles | GitHub Actions temporary Postgres is used for automated QA; persistent staging **not provisioned** |
| Runtime flags | VIP enabled only in isolated sandbox; OFF in production | Feature flag implemented; live enablement not performed |
| Private file storage | Separate private GCS bucket, uniform bucket-level access + public access prevention enforced | Adapter implemented; bucket/credentials **not configured** |
| CRM read-only source | Dedicated SELECT-only account; no \`NEON_DATABASE_URL\` or Kay fallback | Fail-closed connector prepared; **not configured** |
| RTSP.RUN camera | Written developer consent and a functioning HTTPS player URL, never raw RTSP credentials | Allowlisted viewer prepared; real live stream **not tested** |
| Customer invitation email | QA-only delivery domain, known test recipient, no customer bulk send | Invitation flow coded; real email **not tested** |
| Scheduling | Dedicated explicit cron for \`generateVipDueReminders\` | Generator idempotency tested; cron **not deployed** |

**Do not run** \`server/vip/migrations/001_vip_foundation.sql\` on production. That initial schema assumes an existing application \`users\` table. In staging, first provision the standard app schema, then run a reviewed VIP migration on an empty VIP namespace, and verify all constraints. Never run generic \`drizzle-kit push\` against production as part of this task.

## Technical acceptance matrix

- [ ] Generate staging test accounts: admin, independent finance approver, selling employee A, selling employee B, buyer A, buyer B.
- [ ] Buyer A sees only their own units, milestones, photos, files, finance, notifications, referrals and service requests.
- [ ] Buyer B receives 404/403 for every buyer A object, including direct URL guesses and receipt PDF downloads.
- [ ] Selling employee A sees only their explicitly assigned units, and cannot approve receipts, view commissions, modify offers, grant finance roles or reassign buyers.
- [ ] Seller A's access ends when assignment is revoked or buyer A ownership is revoked.
- [ ] Admin can create projects, units, offers, milestones and service updates; every change records a reliable audit event.
- [ ] Finance approver can verify a *different uploader's* receipt after reviewing bank evidence; upload alone never posts a payment.
- [ ] No commission or FX draft becomes approved by its own creator; commission estimates never appear to buyers.
- [ ] Official developer statement PDF only appears after a legitimate document is uploaded by admin; owner can download, stranger/seller cannot.
- [ ] Private GCS object names and credentials never appear in public URLs, browser logs or caches; uploaded file is scanned/validated per deployment policy.
- [ ] Browser service worker never caches \`/api/vip\`, \`/vip/*\`, \`/admin/vip\` or one-time invitation/referral links.
- [ ] RTSP.RUN HTTPS player opens and plays from at least one approved project on both Android and iOS; external public link confidentiality limitations are documented.
- [ ] Test customer refuses notification preference: no 2-day due alert created. Run cron twice to verify exactly-once behavior.
- [ ] Test referral link consent and status privacy, duplicate suppression, signed-sale verification, no automatic reward.
- [ ] Validate handover inspection, unresolved snag block, buyer acknowledgment, management key-reference confirmation and signed developer evidence.
- [ ] Test Arabic/Hebrew RTL and English/Turkish/Azerbaijani LTR on small, medium and desktop screens; mobile PWA install and re-login.
- [ ] Reconciliation of actual project progress/developer financial data and terms by management before publication.
- [ ] Review privacy notice, consent, data retention, audit retention, backup/restore and incident escalation procedures.
- [ ] Run a rollback drill: disable both feature flags, revoke staging tokens, verify public site remains unaffected.

## Evidence we DO have

- GitHub Actions creates a disposable \`postgres:16\` service with \`vipdb\` and validates SQL schema, data integrity and workflow invariants.
- CI verifies all named VIP TypeScript files, focused rule tests, and the app bundle build.
- Stage-2 HTTP integration tests exercise the real VIP Express route handlers on an in-process local server with synthetic users and a localhost-only database adapter. This is stronger than pure schema tests, but does not validate the real production session implementation.
- All live production/main and WhatsApp code are deliberately left unchanged.

## Launch criteria and outstanding dependencies

A successful static build or green CI **does not mean the customer-facing application is ready**. Launch requires an isolated running staging preview, actual customer-role E2E tests, safe storage credentials, a reliable legal/financial evidence workflow, backups and approved provider integrations. Do not make a blanket “zero bugs” guarantee. Record each validated test, discovered issue and fix.

The owner must explicitly approve any paid staging resources or release/merge activity before costs or production effects occur. If a provider tool does not expose the requested **Free** mode, do not silently choose paid mode.

## Recovery and rollback

- Leave \`main\` and the WhatsApp staging branch untouched.
- Stop/disable any isolated VIP cron, set both VIP flags to false and revoke only staging-generated credentials.
- Never delete financial audit evidence or approval history to hide a failed test.
- Keep the latest known-good CI commit and run a separate reviewed integration/merge plan with conflict reconciliation.
