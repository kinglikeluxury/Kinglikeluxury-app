# Isolated WhatsApp proof DB — Railway Staging, never production

## Observed Staging resources (9 November 2026)

- Railway project: `Kinglike-Web-Staging`, ID `8386a5b5-4964-4b37-b2fa-e7177d78111e`.
- Existing app DB: `Postgres`, ID `14dbfb91-108a-4245-8a2e-452581bbce82`.
- NEW, completely separate proof DB: `Postgres-3cCz`, ID `3991af5c-76a5-4739-926f-60c11f5cfd68`.
- Its separate `kinglike_whatsapp` schema was migrated and verified in a private, one-time Railway Function. Two empty tables, `whatsapp_onboarding_flows` and `whatsapp_onboarding_proofs`.
- A real SQL acceptance test with synthetic values checked wrong-state rejection, replay rejection, and transaction rollback; afterwards the tables still contained ZERO rows.

## This code change

- Removes unsafe fallback to the application Staging PostgreSQL `pool` for staff Meta signup proofs.
- The WhatsApp signup endpoints stay disabled unless a separately configured dedicated
  proof DB connection succeeds; otherwise they return 404, even if Meta flags are set.
- Verifies exact Railway service ID, private hostname and database name.
  Explicitly rejects the app/Neon/production database host or wrong identity.
- Requires a non-superuser, non-owner, limited runtime PostgreSQL role.
- Requires exact `kinglike_whatsapp` tables and independent SELECT/INSERT/UPDATE
  grants for both. No automatic schema migration or silent permission widening.
- All SQL writes use the dedicated, schema-qualified tables.
- No real employee conversation, message, authorization code, or Meta account is
  fetched or saved. The existing Connect button remains hard-disabled.

## Configuration **for a future approved pilot only**

Reference the dedicated Railway Postgres service in the separate Staging **app**
service (never production):
- `WHATSAPP_STAGING_PROOF_SERVICE_ID`: exact approved isolated database service ID.
- `WHATSAPP_STAGING_PROOF_DATABASE_URL`: connection URL of a limited-purpose
  database login (NOT the Postgres template owner/superuser DATABASE_URL).
- `WHATSAPP_STAGING_PROOF_EXPECTED_HOST`: private `.railway.internal` host.
- `WHATSAPP_STAGING_PROOF_EXPECTED_NAME`: selected isolated database name.

A runtime login with least-privilege grants is **not** yet created. Do not
substitute the default `Postgres-3cCz.DATABASE_URL` because it belongs to the
database owner. Create a dedicated, sealed runtime credential and review roles
before enabling any real Meta signup.

`WHATSAPP_STAGING_VERIFIED_SIGNUP_ENABLED`,
`WHATSAPP_STAGING_META_GRAPH_VERIFIER_ENABLED`, and
`WHATSAPP_STAGING_GRAPH_PILOT_OWNER_APPROVED` must all remain unset or false.

The dedicated schema currently exists on a separate Staging database, but that
alone is not permission to connect Samer or process customer chats.

## Required next acceptance

Provision a least-privilege Staging PostgreSQL login via an approved, auditable
migration, verify it cannot create or drop tables, and test signed Meta TEST WABA
delivery to a consent-free, synthetic event pipeline. This pilot must not ingest
actual employee or historical chats.
