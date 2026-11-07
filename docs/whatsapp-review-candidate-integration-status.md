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
- Staging DB selection now uses only `APP_STAGING_DATABASE_URL` with the
  standard PostgreSQL driver. It requires the app's expected host/name,
  distinct production host/name, both existing confirmation markers, and a
  successful `current_database()` preflight before route registration or
  startup work. A matching `NEON_DATABASE_URL` is rejected rather than used as
  fallback. Staging skips schema/bootstrap SQL, the production Kay freeze, and
  automatic translation work. Production/development retain their existing
  Neon URL and driver. The separate Railway project's variables were not read
  or changed; its current suitability remains unverified.
- Local verification connected the selected Staging driver to an ephemeral
  loopback PostgreSQL database while a different synthetic production URL was
  present. The DB preflight rejects a missing URL/identity, mismatched or
  colliding production identity, failed query, and wrong returned database
  name. This exercises the DB module and preflight, not a full `server/index.ts`
  boot.
- HTTP/outbound checks prove named WhatsApp helper calls and mocked Graph
  verification make zero requests, the HTTP gate rejects listed webhook,
  onboarding, Twilio OTP and Meta endpoints even with flags enabled, and the
  central scheduler predicate is false in Staging. The 36-test run includes
  synthetic PostgreSQL/session/HTTP and verifier suites. However, not every
  direct Resend/Twilio/web-push SDK call, retry path, and scheduler/worker has
  been intercepted with an injected provider during an application-level
  startup test. Therefore this is not proven complete egress containment:
  staging remains NO-GO until provider call sites and background entrypoints
  are individually exercised and the isolated service/database identity is
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
