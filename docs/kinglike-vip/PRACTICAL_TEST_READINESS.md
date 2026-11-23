# Kinglike VIP — Practical owner acceptance readiness (isolated only)

**Status on 2026-11-24: Not yet available to users for interactive browser testing. Do not present the existing live app or an unverified Replit deployment as the VIP preview.** This is a release-gate checklist, not permission to modify production.

## Exact current integration position

- The original Replit branch `release/auth-priority` is preserved at `80ba567bbba36809af048259ce468c813366d379`; a matching local backup branch exists. The original working tree was last confirmed clean.
- The additive VIP module is copied into the separate local worktree `feature/kinglike-vip-merge`. Its in-app server route registration, page routing, navigation, cache separation, and service worker exclusions have been integrated with minimal changes. The worktree is deliberately uncommitted and has not been pushed.
- Replit reported 43/43 pure/local checks passing, 4/4 disposable PostgreSQL integration test *groups* passing, successful client and server builds, and TypeScript diagnostics exactly matching the original checkout: 77 existing vs. 77 merged, **zero new**. Integration tests use QA fixture accounts and do not prove the original application's production login handler.
- On 2026-11-23, review of the actual app login found follow-up hardening needs: rotate express-session identifier on login, check current active/verified status and revoke stale admin entitlements. An isolated Replit remediation/test task was started, but **completion is not verified** in this document. Never mark these tests passing by inference.
- Draft GitHub PR #65 is not merged; live Railway service tracks GitHub `main`. No live VIP flags, production schema migrations, client invites, or production storage changes are approved.
- An isolated Railway QA project's services and database remain **staged only**, not deployed. Do not commit the staged patch merely to create a preview; resources may have costs.
- Live Neon production branch had **no object storage buckets** at last read-only inspection. Mock S3 tests do not prove real private-bucket permissions.

## Gates required before providing an owner/employee test URL

1. **Source identity:** Record the exact SHA of both Replit's integration worktree and the code used by the preview. No replacement of original branch `release/auth-priority`, no push of sensitive Replit history to a public repository.
2. **Free, private preview:** Use an isolated *non-production* preview with a verified synthetic database, not the public application server. Do not silently add paid hosting, a new live service, or a publicly writable test endpoint. Confirm that the preview URL actually loads from the owner's browser; never invent a URL.
3. **Actual app auth:** Test the real app login/logout/`/api/auth/me` handlers and cookie lifecycle, including session ID regeneration; invalid/disabled/unverified accounts; role revocation; buyer/seller/admin boundaries. A synthetic `/__qa/login` is not evidence for this gate.
4. **Storage:** Before testing real receipt/photo/PDF uploads, provision and approve a dedicated private non-production bucket, verify anonymous access denied and signed server-side file read access. A production bucket requires separate authorization. Until then, offer read-only demo data, not a misleading upload-success promise.
5. **Feature isolation:** Only the preview enables `KINGLIKE_VIP_ENABLED=true` and `VITE_KINGLIKE_VIP_ENABLED=true`. Live flags stay OFF. Confirm that closing the flags returns 404 and removes UI links. No production database migration, no CRM sync, no WhatsApp, SMS, email, push or web-notification delivery to customers.
6. **Cleanup:** If temporary PostgreSQL is used, verify PID shutdown, no leftover cluster files, and no TCP listener; save only redacted test evidence.

## Owner's live manual acceptance steps (synthetic accounts only)

| ID | Account / action in the *isolated* preview | Required result |
| --- | --- | --- |
| T01 | New test buyer logs in using the application's actual login screen | Buyer sees `/vip` only after entitlement; no other buyer's units or receipts |
| T02 | Test Kinglike admin visits `/admin/vip` | Can manage only approved VIP test records; has an audit trail |
| T03 | Assigned test salesperson visits `/vip/sales` | Only explicitly assigned test unit visible; cannot approve finance |
| T04 | Buyer opens another buyer's unit, receipts, account or statement URL | 403/404 without financial data, metadata or file bytes |
| T05 | Buyer uploads a synthetic transfer receipt (only with approved private QA storage) | Receipt remains **pending**; installment not marked paid |
| T06 | Separate finance approver verifies the mock bank evidence | Exactly one posting, correct amount/currency; cannot verify own upload |
| T07 | Revoke buyer ownership, demote seller or finance reviewer while still logged in | All affected access is denied immediately, including stale tabs/URLs |
| T08 | Test buyer logs out, then a second test buyer signs into the same device | Cached private VIP content does not cross accounts; old cookie unusable |
| T09 | View construction timeline, official statement, handover, card QR and referral | Only approved, authorized test data; no guaranteed ROI/reward claims |
| T10 | Android and desktop, Arabic RTL and English/Turkish/Hebrew/Azerbaijani | Navigation and financial labels readable; original CRM/WhatsApp menus unaffected |
| T11 | Unset either VIP feature flag in isolated preview | VIP route inaccessible; no customer messages or external side effects |

**Evidence required:** confirmed preview URL and test-only credentials supplied securely through a private channel, screenshot/report per test, authorization and audit logs redacted, exact commit/branch and rollback steps. Never put passwords, S3 secrets, customer documents, WhatsApp tokens, or signing keys in GitHub.

## Non-negotiable release rule

Owner testing is **not** production launch approval. A separate explicit approval is required before any Railway `main` merge, production migration or storage provisioning, prod feature flag activation, customer invitation, or external notification. The existing public application must not be disturbed.
