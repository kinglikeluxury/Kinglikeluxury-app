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
- PR #11 inert onboarding verifier contract and manual proof schema.
- PR #12 append-only audit writer, manual ledger schema, and privilege checks.

## Blocking integration gaps

- PR #11 still has no HTTP onboarding start/finish route, durable one-time
  state/nonce repository, atomic replay protection, CSRF session binding, or
  concrete Meta code-exchange/Graph verifier. Its interface tests do not prove
  a real Meta relationship or Coexistence eligibility.
- PR #12 audit writer is not yet called by the archive routes. Therefore
  archive reads, search, and export are not currently guaranteed to be audited,
  and audit failure does not yet block archive responses.
- The archive route suite does not yet exercise audit-write failure, admin
  without an explicit grant, or all denial paths with an independently owned
  INSERT-only audit connection.
- There is no HTTP search/export route in this combined snapshot. No startup
  migration is added.

The current flags remain false unless explicitly set in a test process. Do not
enable any flag or connect real numbers until the blockers above are closed and
the isolated staging checks and human approvals are complete.

## Verification performed

- 26 synthetic tests passed, including real loopback PostgreSQL tests for
  webhook retry idempotency, immutable events, foreign keys, revocation
  serialization, HMAC, consent/RBAC, and Coexistence echo eligibility.
- Full application build passed.
- No application workflow, production database, Neon, Railway, Meta, real
  number, or customer conversation was used.
