# WhatsApp monitoring combined review candidate

## Status: draft-only, not deployable

This isolated branch combines the reviewed source snapshots of PR #5, #10,
#11, and #12 on production `main` `8dcea013`. The original PR branches are
unchanged. The only merge conflict was the workspace-memory index; both
existing WhatsApp policy pointers were retained.

## Included components

- PR #5 review UI, signup preview, and explicit mock repository. Mock material
  remains distinct from actual employee archive records. The optional local
  archive review is separately gated, admin-only, and serves synthetic fixtures.
- PR #10 employee webhook, consent/assignment/RBAC archive routes, Coexistence
  echo/edit/revoke normalization, manual schema, and nullable expiry policy.
- PR #11 test-only Express-session onboarding harness, injectable Meta Graph
  verifier, PostgreSQL connect-pg-simple session harness, fixation rotation,
  and manual proof schema. Staging/production are not enabled.
- PR #12 append-only audit writer, manual ledger schema, and privilege checks.

## Blocking integration gaps

- PR #11 now has test-only HTTP start/finish routes and a durable atomic flow
  repository. There is still no production verifier, real Meta code exchange,
  or Graph confirmation; production is hard-disabled and the main app registers
  no verifier.
- PR #12 audit is now connected to both existing archive GET routes. Search and
  export routes do not exist yet and cannot be covered until they are added.
- HTTP coverage includes an admin without a grant, a different employee,
  revoked consent, an explicitly granted supervisor, and an unavailable audit
  writer. The local archive review also filters each conversation by its own
  phone consent and audits before response. A loopback PostgreSQL role test
  verifies the audit connection is non-owner and INSERT-only.
- A code-only Staging fail-closed guard is implemented. It blocks WhatsApp
  webhook/onboarding/activation and Meta/Twilio HTTP surfaces, disables the
  observed WhatsApp send helpers and notification senders, prevents known
  schedulers/workers/broadcast resume, and fails startup if the active DB URL
  is Neon, unidentified, or does not match the explicit staging host/name and
  distinct production host/name. Railway and DB configuration were not read or
  changed. No staging archive fixture provider was added.
- Verification proves the named send helpers do not reach fetch, the injected
  Graph verifier makes zero calls, the HTTP gate rejects the listed routes even
  with enable flags true, and the DB identity check rejects missing/Neon/
  colliding identities. Direct provider SDK paths (especially every Resend
  route and every scheduler entrypoint) have not each been run through a
  provider-injected integration test. Do not call the guard a complete
  organization-wide egress boundary; Staging remains NO-GO until those paths
  are individually verified and the isolated service/database identity is
  owner-confirmed.
- There is no HTTP search/export route in this combined snapshot. No startup
  migration is added.

The current flags remain false unless explicitly set in a test process. Do not
enable any flag or connect real numbers until the blockers above are closed and
the isolated staging checks and human approvals are complete.

## Verification performed

- 36/36 synthetic tests passed, including real loopback PostgreSQL tests for
  webhook retry idempotency, immutable events, foreign keys, revocation
  serialization, HMAC, consent/RBAC, Coexistence echo, real express-session
  connect-pg-simple cookie persistence/fixation rotation, onboarding
  replay/concurrency/expiry, synthetic archive consent/RBAC/audit ordering and
  outage, frontend server rendering, mocked Meta Graph verification, and
  Staging HTTP/outbound/DB guard checks.
- Full application build passed.
- `npm run check` still reports 87 TypeScript diagnostics, matching the prior
  baseline count; existing diagnostics remain outside the guard changes.
- No application workflow restart, production database, Neon connection,
  Railway, Meta, real
  number, or customer conversation was used.
