# Rollback-only Meta onboarding proof E2E in isolated Staging

This test **does not** call Meta or process any phone or customer message.
It is an optional, one-time app-to-PostgreSQL integration probe that exercises
the same flow repository and the same `acceptMetaOnboardingFinish` validation
as the future real employee enrollment route.

## Controlled process

1. Read-only check that the dedicated WhatsApp proof tables are empty.
2. BEGIN a PostgreSQL transaction using the already verified least-privilege
   `kinglike_wa_proof_runtime` connection.
3. Create a five-minute synthetic onboarding session with random state,
   CSRF, and fake actor identity in the dedicated `kinglike_whatsapp` schema.
4. Finish it with **an in-process fake verifier** returning a synthetic phone
   proof. No external HTTP/Graph/API calls.
5. Prove a repeat FINISH is rejected without calling the fake verifier again.
6. Count one flow and one pending proof inside the transaction.
7. **Unconditionally ROLLBACK**, even on failure, and verify the two tables
   still contain zero records.
8. Return only a non-sensitive success/failed boolean in Railway logs.

## Safety gates

The test refuses to run unless:
- `APP_DEPLOYMENT_MODE=staging` with isolated application DB.
- Separate Railway `Postgres-3cCz` proof connection preflight passed.
- `WHATSAPP_STAGING_PROOF_PREFLIGHT_ENABLED=true`.
- `WHATSAPP_STAGING_SYNTHETIC_PROOF_PROBE_ENABLED=true` (one-time flag).
- ALL of `WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED`,
  `WHATSAPP_STAGING_META_GRAPH_VERIFIER_ENABLED`,
  `WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED`, and
  `WHATSAPP_EMPLOYEE_MONITORING_ENABLED` remain false/unset.

Because this probe performs transactional synthetic inserts (then rolls back),
do not use it on a database containing any live proof rows. It expressly
requires both relevant tables to be empty before attempting a transaction.

After a successful one-time Staging startup, set
`WHATSAPP_STAGING_SYNTHETIC_PROOF_PROBE_ENABLED=false` without triggering
another deploy. Leave real staff flags false. The probe is not an authorization
to start employee Embedded Signup.

**Current boundaries:** there is still no live Meta account verification,
real employee onboarding, permissioned chat ingestion, archive or production
deployment. The previous Meta TEST WABA webhook receiver acknowledges only
isolated signed synthetic / test events and stores no message content.
