# Kinglike VIP isolated Railway QA

This is a separate QA entrypoint for the existing isolated QA service. It is
not the application entrypoint and must not replace `npm start` or
`railway.toml`. It has not been connected to Railway or started.

## Local code commands

- `npm run vip:qa:build` creates `.local/qa-vip-railway-build`; it uses an
  empty environment and does not start a server or apply migrations.
- `npm run vip:qa:start` starts only that generated QA entrypoint. It should
  be used only by the already-isolated QA service after its owner has reviewed
  the environment and database.
- `npm run vip:qa:network-smoke` tests outbound-denial paths without making a
  network request.

## Required isolated runtime configuration

The QA process accepts only the explicit VIP-QA variables and Railway platform
metadata. It rejects production `DATABASE_URL`, live email approval/enabling,
Cloudinary, Neon object-storage, messaging, WhatsApp, Meta, and signing-related
environment names. No values belong in this document.

The runtime requires these variable names (configure values only in the
existing isolated QA service, never in this file):

- `NODE_ENV`, `PORT`, `KINGLIKE_VIP_QA_PREVIEW`, `KINGLIKE_VIP_ENABLED`,
  `KINGLIKE_VIP_QA_RUNTIME`, and `KINGLIKE_VIP_QA_START`.
- `KINGLIKE_VIP_QA_DATABASE_URL`,
  `KINGLIKE_VIP_QA_EXPECTED_DB_HOST`,
  `KINGLIKE_VIP_QA_EXPECTED_DB_NAME`,
  `KINGLIKE_VIP_QA_EXPECTED_DB_ROLE`,
  `KINGLIKE_VIP_QA_EXPECTED_DB_ADDRESS`, and
  `KINGLIKE_VIP_QA_ENVIRONMENT_ID`.
- `KINGLIKE_VIP_QA_GATE_USER`, `KINGLIKE_VIP_QA_GATE_PASSWORD`, and
  `KINGLIKE_VIP_QA_SESSION_SECRET`.
- Optional static root override: `KINGLIKE_VIP_QA_STATIC_DIR`, only if it
  resolves inside the generated QA public directory.
- A dedicated non-superuser runtime role, not the database owner, with no
  public-schema `CREATE`, no owned public objects, and no database/role/
  replication/BYPASSRLS privileges, and no role memberships. It may not own
  public objects.
- The owner-only provisioner grants a fixed per-table policy: `users` and the
  identity marker are read-only; sessions use DML; file objects omit UPDATE;
  audit and payment-posting tables are append-only; finance permissions omit
  DELETE; other approved VIP business tables receive SELECT/INSERT/UPDATE but
  not DELETE. VIP-owned sequences
  receive only USAGE/SELECT. It revokes PUBLIC and runtime grants first, grants
  no schema CREATE, and verifies the resulting ACL before commit. Runtime
  startup rechecks every table/sequence grant and rejects public views,
  triggers, or functions; schema changes fail closed until the explicit grant
  plan is updated. Runtime startup never runs migrations or grants privileges.
- A one-row `synthetic-only` identity marker in
  `vip_qa_environment_identity`, matching the configured environment UUID.

Initialize only a separately provisioned empty database: apply
`000_qa_users_only.sql`, `001_vip_foundation.sql`, and `003_qa_sessions.sql`
as the migration owner; then apply `002_railway_qa_identity.sql` once while
every table is still empty. Run the separate `qaRailwayProvision.ts` owner
command only after reviewing the host, address, database, roles, and environment
UUID. In one transaction it seeds four synthetic accounts (admin, buyer,
assigned seller, and non-admin finance reviewer), a synthetic project/unit,
one pending receipt stored as private database bytes, its single-use identity
marker, and the least-privilege runtime ACL. It refuses any existing row,
unexpected relation, mismatched database identity, or privileged runtime role.
The receipt remains pending and creates no payment posting. Migration `002` refuses
unexpected tables, CRM/Kay tables, or any existing business rows; it is never
invoked by startup or the local QA migrator. Runtime repeats identity checks
for account/project/unit/receipt/file identifiers before binding the listener.
The marker is an owner attestation; the runtime does not prove that arbitrary
free-text fields in every VIP table contain synthetic text.

The dedicated QA app now stores sessions in `vip_qa_sessions`; it does not use
the live site's session table or Express's in-memory default. The app requires
the table and its four DML grants at startup. The local auth integration also
uses this table when testing session recovery in a fresh process. OTP-rate
limiting is a separate full-auth migration (`2026-11-27-auth-otp-rate-limit.sql`);
the current private QA login does not mount those OTP routes, so do not apply
that migration to the VIP-only database.
Keep this isolated service at one replica: the Basic-gate and QA login
attempt counters remain process-local even though signed sessions are stored
in PostgreSQL. Horizontal scaling requires a shared limiter before it is safe.

`qaMigrate.ts` and `qaBootstrapAccount.ts` remain local loopback-only helpers;
they are not hosted Railway administration tools. The separate provisioner has
an explicit one-shot approval flag and strict environment allowlist. Its local
mode was exercised against a newly created loopback cluster only; its Railway
mode has not been run. Never put its owner URL or seed password variables into
the runtime service environment.

## Network, auth, and files

The Railway-only network guard allows a PostgreSQL socket only to the exact
expected private Railway hostname, port 5432, and expected private IPv4 result.
It blocks HTTP(S), `fetch`, DNS lookups for other hosts, UDP, child processes,
and other socket destinations at the application layer. This is not operating
system network isolation.

Basic Auth covers every route, API, and static asset. The sole exception is
`GET /health`, which returns only `{"ok":true}` for the platform probe. No
session, database identity, user, or project detail is included in that body.

Email is a no-op; the QA build substitutes a read-only empty CRM bridge and
does not import the main application bootstrap. Private QA receipt, photo, and
statement bytes use a constrained table in the synthetic-only QA PostgreSQL
database so they survive sleep/restarts. No GCS, Cloudinary, Neon object-store,
or public file URL is used. This adds database storage usage, which must be
reviewed against the separate QA service's limits before activation.
The QA build strips audio files from its public output. The bundled UI retains
a reference to the omitted Kay notice asset, so that non-VIP notice will not
play in QA; its source content was not opened. Do not use the Kay screen as an
acceptance surface for this preview.

## Still required before an owner preview

The deployment has not been activated or runtime-tested. Before activation:

1. Confirm the existing QA service is separate from the live service and will
   use a fresh owner-approved snapshot of `feature/kinglike-vip-merge`; the
   current worktree is dirty, so do not deploy an ambiguous/stale branch tip.
2. Confirm current Railway quotas/pricing for the separate service, runtime,
   and PostgreSQL bytes. No cost estimate is asserted here.
  3. Provision a separate empty database (never a production clone), distinct
     migrator and runtime roles, then apply `000`, `001`, and `003`, followed
   by `002` while the schema has no rows. Review the target identity and run
   the owner-only provisioner to seed the marker and synthetic fixtures/grants.
   It requires the separate `KINGLIKE_VIP_QA_PROVISION_*` variable family listed
   below; those are one-shot inputs, not persistent runtime settings.
4. Configure only the variable names listed above using the existing QA
   service's secret/settings flow; keep all mail, WhatsApp, CRM, push, and
   external-storage credentials absent. The launcher sets its QA runtime/start
   markers itself. Do not change the live service or its start command.
5. Run authenticated HTTP and browser acceptance on the isolated QA service:
   health minimality, Basic Auth on every other path, all account roles,
   receipt review/download, upload-not-paid, session switching, private-file
   persistence after sleep/restart, and outbound-denial logs.
6. Confirm the documented Kay-audio limitation is acceptable. The
   application-level network guard is not OS-level egress isolation.

### Owner-only provisioner inputs

The separate setup command requires names only here; values must not be stored
in this document. For Railway mode it accepts only an exact `*.railway.internal`
host, port 5432, a matching private IPv4 address, a `vipqa_` database, distinct
`vipqa_` migrator/runtime roles, and an owner-reviewed environment UUID. It
requires an explicit provision approval flag and four unique strong synthetic
account passwords. Local test mode is restricted to a `/tmp/kinglike-vip-pg-*`
cluster with a verified loopback process.

- `KINGLIKE_VIP_QA_PROVISION_EXECUTE`,
  `KINGLIKE_VIP_QA_PROVISION_MODE`,
  `KINGLIKE_VIP_QA_PROVISION_APPROVED`.
- `KINGLIKE_VIP_QA_MIGRATION_DATABASE_URL`,
  `KINGLIKE_VIP_QA_PROVISION_HOST`,
  `KINGLIKE_VIP_QA_PROVISION_DATABASE`,
  `KINGLIKE_VIP_QA_PROVISION_MIGRATOR_ROLE`,
  `KINGLIKE_VIP_QA_PROVISION_RUNTIME_ROLE`,
  `KINGLIKE_VIP_QA_PROVISION_ADDRESS`,
  `KINGLIKE_VIP_QA_PROVISION_ENVIRONMENT_ID`.
- `KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD`,
  `KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD`,
  `KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD`,
  `KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD`.

Rollback must affect only the isolated QA service: stop it, restore its prior
QA branch/build snapshot, then remove QA-only settings and the synthetic
database only after the owner confirms they are no longer needed. Never use
this rollback procedure on the live service. No service, database, or setting
was changed during this code-preparation turn.
