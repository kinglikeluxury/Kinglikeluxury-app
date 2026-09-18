---
name: Kay destructive test database isolation
description: Mandatory database-identity and run-ownership rules for every Kay integration suite capable of mutation.
---

Never run a mutation-capable Kay integration suite against a shared, development, or production database. Feature flags alone are not authorization: the suite must hard-fail unless the active connection exactly matches an explicitly configured dedicated test database whose database name is visibly test-only, with `NODE_ENV=test` and a unique test run ID.

**Why:** Shared-database E.2 runs exposed transient synthetic leads in the real CRM and allowed background schedulers to produce orphan internal artifacts referencing synthetic users, even though normal test cleanup later removed the fixture leads.

**How to apply:** Every current and future Kay DB-writing suite must call the centralized preflight before setup or schema mutation. Synthetic markers include the run ID; fixtures only INSERT new rows; every mutation and cleanup is constrained to IDs registered by that run plus its exact marker. Never repurpose an existing lead as a fixture.

Each suite must create every synthetic principal and lead it needs instead of selecting a row created by another suite. Cleanup must cover partial setup failures, and every imported pool or client must be closed from an unconditional suite-level teardown.

**Why:** Order-dependent fixtures made individually correct suites fail when run alone, and a setup failure before test-level cleanup left a PostgreSQL pool alive until the outer timeout.

The dedicated environment is a separate Neon project named
`kinglike-kay-testing`, with database `kay_testing` owned by `kay_test_owner`.
Keep production connection variables out of the test child process even when
both projects are administered through the same Neon organization.