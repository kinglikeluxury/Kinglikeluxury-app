# PR #6 + PR #7 isolated integration review

This branch is a verification-only composition of PR #6 (`bb3a2ff`) and PR #7
(`b8ea02e`) on production `main` `8dcea013`. Neither source PR was modified or
merged, PR #5 is untouched, and this branch is not a production candidate yet.

## Reconciliation

- `server/index.ts` captures the raw body for the employee webhook and registers
  both webhook and archive routers. The test harness does not import `server/index`
  and does not start application schedulers.
- The two manual SQL drafts had overlapping table definitions. Their fields are
  reconciled into `docs/sql/2026-11-07-whatsapp-employee-unified.sql.txt`; it
  preserves PR #6 event identifiers, adds PR #7 consent/audit/grant fields, and
  adds the expiry/media-safe columns. It is never run by application startup.
- Ingestion and archive flags remain unset by default. Runtime DB access in both
  routers requires `NODE_ENV=test` and a loopback test-named database.
- Revocation locks the assigned number/consent state, sets the number inactive,
  and requires a second admin for any reactivation. Archive checks consent for
  the exact conversation number, not merely any number owned by that employee.

## Local verification

Synthetic HTTP tests mount only the two route modules in a small Express harness
with test-only session identities. They exercise GET challenge, wrong challenge,
good/bad HMAC, inbound text, status, Coexistence echo, retry dedupe, unconsented
and Coexistence-ineligible numbers, archive reads, supervisor access, employee
and ungranted-admin denials, revocation, and post-revocation denials.

The SQL integration test applies the unified schema in a temporary PostgreSQL
schema and checks foreign keys, unique event keys, and row-lock serialization of
an authorized read with revocation. The HTTP harness also uses a temporary schema
in a temporary local database. Temporary database processes and data are removed
after tests.

## Still required before any merge or live traffic

- Review company ownership evidence and consent language; admin attestations do
  not independently prove ownership.
- Test real route-level provisioning and role changes; Coexistence remains false
  and needs per-number Meta eligibility verification.
- Agree a retention/deletion policy. The current 90-day expiry is only a proposal;
  no purge process exists.
- Review DB grants/audit immutability, run staging-only migration review, and
  separately graduate the mock UI in PR #5 after APIs are approved.
- No real Meta requests, production/staging DBs, secrets, phone numbers, or
  conversations are used by this branch.
