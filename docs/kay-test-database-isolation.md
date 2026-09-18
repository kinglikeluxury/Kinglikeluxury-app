# Kay test database isolation

Mutation-capable Kay suites require a
**separately provisioned Neon project named `kinglike-kay-testing`**, with the
database **`kay_testing`** and login **`kay_test_owner`**. The test project
must have its own cluster, database role, and credential (not a
production credential with a different URL or feature flag). The environment
must provide, without committing or printing secrets:

- `KAY_TEST_DATABASE_URL` and `KAY_TEST_DATABASE_USER`
- `KAY_TEST_NEON_PROJECT_ID` and `KAY_TEST_NEON_CLUSTER_ID`
- `KAY_TEST_DATABASE_CREDENTIAL_ID` (an operator-managed credential identity,
  not the credential value)
- `KAY_PRODUCTION_DATABASE_HOST`, `KAY_PRODUCTION_DATABASE_USER`,
  `NEON_PROJECT_ID`, and `NEON_CLUSTER_ID` as non-secret production identity
  metadata for comparison

`NEON_DATABASE_URL` must be absent from the E2E runtime. `server/db.ts` selects
`KAY_TEST_DATABASE_URL` directly under `NODE_ENV=test` and has no production
fallback. `KAY_E2_ALLOW_SHARED_DB_MUTATIONS` is deliberately rejected. Flags, database
names, and matching URLs alone are not authorization for destructive tests.
The centralized preflight also requires test-only database naming, `NODE_ENV`
`test`, and a run ID.

The SQL in `artifacts/kay-postgres-readonly-role.sql` is a reviewed template
for granting and revoking a PostgreSQL read-only role. It must be applied by
an operator to the isolated test project (or another explicitly approved
non-production database); this repository does not execute role DDL.

## Completing and checking the isolated schema

Run `npm run kay:test-schema` only from a sanitized test process with generic
database variables removed. The command independently verifies database
`kay_testing`, user `kay_test_owner`, and endpoint separation before DDL. It
inventories the exact Kay suite requirements, creates only missing objects,
and reports expected, missing, created, and remaining object counts.

The command is idempotent. A fully provisioned database reports zero missing
and zero created objects. Integration fixtures remain suite-owned, carry the
required test run marker, and clean up only their registered IDs.