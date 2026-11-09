# Dedicated WhatsApp verification database — Staging preparation

## Railway infrastructure created

An additional PostgreSQL service, `Postgres-3cCz` (service ID
`3991af5c-76a5-4739-926f-60c11f5cfd68`), was provisioned in the
**separate** `Kinglike-Web-Staging` project
(`8386a5b5-4964-4b37-b2fa-e7177d78111e`).
Its first deployment reported SUCCESS and it has a dedicated persistent
volume. This does NOT mean the WhatsApp proof tables exist in it.

**Do not confuse the Railway environment name `production` with the
Kinglike Luxury production project**. This project's environment is named
`production` by Railway, but belongs to a separate Staging project.

The running Staging application `reliable-art` remains attached to its
existing database and its previous WhatsApp TEST WABA branch. No database
connection variables, service source, app deployment, production data,
webhooks, employee phones, or feature flags have been altered.

## How the proof schema is tested safely

The GitHub Actions workflow `whatsapp-isolated-postgres-migration-ci.yml`
boots a fresh ephemeral PostgreSQL 16 with a synthetic database and no Meta
secrets, executes the existing `whatsappMetaOnboardingHttp.integration.test.ts`
which applies `docs/sql/2026-11-08-whatsapp-onboarding-proof.sql.txt`
in an isolated per-run schema, and verifies:

- Real PostgreSQL write and atomic state consumption.
- Session fixation protections, admin/user boundaries, CSRF and origin.
- Duplicate/replay rejection and no credential storage.
- The staging-only verified signup routes remain disabled unless explicitly
  provided a reviewed verifier, allowlist, notice and DB separation.
- Application build with all employee integration flags disabled.

This is a reproducible *synthetic* database validation, not a read or write to
Railway or Neon databases.

## Required before applying proof SQL to Railway

1. Independently confirm that `Postgres-3cCz` is isolated from existing
   company data and has a unique database name and host.
2. Review schema migrations and runtime PostgreSQL privileges, including
   separation of migration owner and restricted application role.
3. Plan and execute the proof migration against ONLY the newly created
   dedicated Staging DB. Do not run migrations against the current Staging app
   database or production Neon.
4. Connect via private Railway service references; never copy any password,
   connection URL or token into chat, GitHub, logs or screenshots.
5. Confirm database name from `SELECT current_database()`, prove app
   start/readiness with fail-closed controls, and keep Meta onboarding OFF until
   separate privacy and real-phone verification approval.

Status: Railway isolated DB service created; connection not configured;
proof schema not applied to Railway; CI runs against ephemeral PostgreSQL only.
