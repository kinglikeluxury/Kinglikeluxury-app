# WhatsApp monitoring combined review candidate

## Status: draft-only, not deployable

This isolated branch combines the reviewed source snapshots of PR #5, #10,
#11, and #12 on production `main` `8dcea013`. The original PR branches are
unchanged. The only merge conflict was the workspace-memory index; both
existing WhatsApp policy pointers were retained.

## Included components

- PR #5 review UI, signup preview, and explicit mock repository. Mock material
  remains distinct from actual employee archive records.
- PR #10 employee webhook, consent/assignment/RBAC archive routes, Coexistence
  echo/edit/revoke normalization, manual schema, and nullable expiry policy.
- PR #11 test-only Express-session onboarding harness, injectable Meta Graph
  verifier, and manual proof schema. Staging/production are not enabled.
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
  writer. A loopback PostgreSQL role test verifies the audit connection is
  non-owner and INSERT-only.
- There is no HTTP search/export route in this combined snapshot. No startup
  migration is added.

The current flags remain false unless explicitly set in a test process. Do not
enable any flag or connect real numbers until the blockers above are closed and
the isolated staging checks and human approvals are complete.

## Verification performed

- 30/30 synthetic tests passed, including real loopback PostgreSQL tests for
  webhook retry idempotency, immutable events, foreign keys, revocation
  serialization, HMAC, consent/RBAC, Coexistence echo, real express-session
  cookie binding/rotation, onboarding replay/concurrency/expiry, and mocked
  Meta Graph token/asset/Coexistence verification.
- Full application build passed.
- No application workflow, production database, Neon, Railway, Meta, real
  number, or customer conversation was used.
