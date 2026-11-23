# Safe integration manifest — Kinglike VIP vs. original Replit checkout

**Prepared:** 23 November 2026. **Status: Review only. Do not deploy.**

## Verified source state

- Railway live service `kinglikeluxury.app` tracks GitHub branch `main`.
- The original Replit checkout is on its locally advanced
  `release/auth-priority` branch (134 commits ahead, 1 behind
  `origin/main` when last inspected). It does NOT yet contain VIP.
  Read-only Git identity check on 2026-11-23 established current local
  **HEAD = `80ba567bbba36809af048259ce468c813366d379`** and tracked
  **`origin/main` = `b71f3755cfb9917c288562cbcc4ff137e454d6b5`**.
  Working tree is clean; upstream is `origin/main`. **Update, verified later
  on 2026-11-23:** a local matching backup was created as
  `backup/release-auth-priority-80ba567-20261123`, still pointing to the same
  SHA; the original remains unchanged. The separate local worktree
  `feature/kinglike-vip-merge` was subsequently created from this commit.
  This is a local Git reference, **not** a geographically independent backup.
- Draft GitHub PR #65 is based on `main`, not on that Replit checkout.
  It was **not merged** and must not be pushed or rebased over the original
  Replit working tree without preservation of existing work.
- The public GitHub repository contains Android signing-artifact paths.
  Do not push an unreviewed history/bundle of Replit's local branch to a
  publicly readable remote. Have a trusted owner assess signing-key rotation
  and secure backup first.

## Exact scope of VIP PR #65 (relative to GitHub main)

At preparation, GitHub comparison showed **141 changed files**:

| Category | Files | Integration rule |
| --- | ---: | --- |
| New VIP backend `server/vip/` | 76 | Review and copy as an additive module; never run QA-only migration on live DB |
| New VIP client `client/src/features/vip/` | 50 | Review/copy additive client module, both flags default OFF |
| Docs and CI workflow | 7 | May copy; CI local Postgres only; exclude isolated Railway deployment plan |
| Shared original application files | **8** | **Manual minimal-diff merge only; DO NOT replace with branch copies** |

The eight shared-file integration hotspots are:

1. `client/public/sw.js` — ensure VIP routes/responses are NEVER cached
2. `client/src/App.tsx` — register gated client/admin/seller routes
3. `client/src/components/layout/MobileDrawer.tsx` — entitlement-scoped mobile links
4. `client/src/components/layout/Navbar.tsx` — entitlement-scoped desktop links
5. `client/src/lib/adminNavItems.ts` — gated VIP administrator entry
6. `client/src/lib/auth.ts` — purge private cached VIP data when identity changes
7. `package.json` — feature/test scripts; **do not overwrite Replit dependencies or live scripts**
8. `server/index.ts` — register VIP only after existing sessions; redact private VIP responses

## Safe execution sequence

1. Record the **exact production deployment commit** on Railway and test an
   actionable rollback. Keep the current production branch unchanged.
2. Preserve a **private copy** of the current Replit checkout including its
   unpublished 134 commits. Audit history for Android signers/secrets before
   copying to any remote; do not force-push, use a public issue for keys,
   or overwrite Replit local files.
3. Create a **new integration worktree/branch from that preserved Replit
   checkout**, not from GitHub `main`, without altering published services.
4. Transfer the 126 new VIP source files *selectively*, not by merging the
   complete GitHub branch over the Replit checkout. Inspect import paths and
   ensure no duplicate feature flags/session routes. Keep the 8 shared files
   as hand-reviewed minimal diffs; preserve every unrelated Replit/Kay/CRM/
   WhatsApp authentication and package change.
5. Reconcile independent password-hardening draft PR #66 with Replit's
   current auth flow; do not assume that GitHub `main` auth code is current.
6. Test TypeScript, production bundle, disposable-Postgres VIP migration,
   invitation activation, all role/receipt/finance paths, cache isolation,
   multilingual/RTL layout, and existing CRM/WhatsApp/password-reset flows.
7. Run a controlled private-bucket interoperability smoke test against an
   explicitly approved Neon non-production branch and **synthetic** files.
   Verify bucket `access_level=private`, object read denial without credentials,
   S3 PUT/HEAD/GET/DELETE (including `If-None-Match: *` support), malware
   policy and retention. Code-only S3 tests are not enough.
8. Obtain owner approval before **any** production schema write, bucket
   creation, release branch merge, environment variable change, or client
   invite. Deploy code with both VIP feature flags OFF, validate the live
   app and rollback, then enable for only designated internal users.
9. Do not start another VIP Railway service or database; the intended
   architecture is the current app + current Neon project.

## Current integration state and release blockers (revised 2026-11-24)

The local Replit worktree `feature/kinglike-vip-merge` now contains the 126
new VIP files, and minimum-diff integrations for server routing, protected
client routes, desktop/mobile/admin navigation, client-side auth cache
clearing and service worker exclusions. The original Replit checkout was
rechecked clean and unchanged. The two VIP SQL migration files were staged
locally in the worktree but **never executed against production**.

Replit reported the following *isolated* results: client/server build passes;
43/43 local pure tests pass; four of four disposable PostgreSQL integration
suites pass; the merged worktree and untouched original each produce exactly
77 TypeScript diagnostics with zero new and zero resolved. None of these
results proves a live preview URL or actual external bucket interoperability.

**Outstanding:** the original application's real login handlers need dedicated
session regeneration and account-status regression tests. An isolated Replit
hardening task has been launched, but its completion has not been confirmed.
Neon private storage has not been provisioned/verified in a controlled QA
branch, and browser/user-device acceptance has not been run. No URL has been
confirmed for a safe owner-facing VIP preview. No production release has
occurred; draft PR #65 remains unmerged.

Practical QA release gates and evidence tracking are in
`docs/kinglike-vip/PRACTICAL_TEST_READINESS.md`. It is NOT a mandate to
activate the staged Railway QA patch or add paid resources.

**Do not interpret "no GitHub merge conflicts" as release approval.**
