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
- `qaRailwayBootstrap.ts` runs only as a Railway pre-deploy initializer. It
  requires the private Postgres service, a new empty `vipqa_*` database, and an
  explicit approval flag. It creates separate non-superuser migrator/runtime
  roles, applies the isolated SQL migrations in order, then calls the owner
  provisioner. It refuses an existing database or partial role/database state;
  it never drops or repairs data. Repeat runs only verify the existing marker
  and grants. The generated app launcher removes bootstrap and migration
  credentials before importing the server.
- A one-row `synthetic-only` identity marker in
  `vip_qa_environment_identity`, matching the configured environment UUID.

The initializer applies `000_qa_users_only.sql`, `001_vip_foundation.sql`,
`003_qa_sessions.sql`, and then `002_railway_qa_identity.sql` while the tables
are empty. The owner provisioner seeds four synthetic accounts (admin, buyer,
assigned seller, and non-admin finance reviewer), a synthetic project/unit,
one pending receipt stored as private database bytes, its identity marker, and
the least-privilege runtime ACL. It refuses unexpected relations, mismatched
database identity, existing business rows, or privileged runtime roles. The
receipt remains pending and creates no payment posting. Runtime repeats
identity checks for account/project/unit/receipt/file identifiers before
binding the listener.
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
they are not hosted Railway administration tools. The Railway initializer uses
a separate strict environment allowlist. Its migration, seed, grant, and
refusal behavior were exercised against a fresh loopback-only PostgreSQL
cluster. The Railway-private setup has not been run. Never leave the bootstrap
database URL or migration password in the long-running app environment.

## Network, auth, and files

The Railway-only network guard allows a PostgreSQL socket only to the exact
expected private Railway hostname and port 5432. `EXPECTED_DB_ADDRESS=auto`
pins the first DNS result only if it is exactly one private IPv4 address; the
database identity check requires the connected server to match that pin.
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

## Deployment gates

Railway source, build, runtime, pre-deploy, network and variable changes are
staged in the isolated `vip-qa` environment only; no service has been deployed
and no database has been initialized. Before first deployment:

1. Review the staged patch to confirm the web service follows only
   `feature/kinglike-vip-qa-clean` in `vip-qa`, with one replica in the same
   region as the separate Postgres service. Do not connect the live service or
   production environment to this branch.
2. The pre-deploy initializer creates the target database and roles only when
   the database and roles are absent. It refuses partially created state.
   Setup-only admin and migrator values must be cleared after it succeeds.
3. The runtime variables are staged; keep all mail, WhatsApp, CRM, push, and
   external-storage credentials absent. The launcher sets its QA runtime/start
   markers itself and drops bootstrap/login secrets before importing the app.
4. After pre-deploy succeeds, run authenticated HTTP and browser acceptance on
   the isolated QA service:
   health minimality, Basic Auth on every other path, all account roles,
   receipt review/download, upload-not-paid, session switching, private-file
   persistence after sleep/restart, and outbound-denial logs.
5. Remove the pre-deploy command and clear its setup-only admin URL, execution
   approvals, migration password, and legacy seed-password variables; then
   redeploy and verify the app still starts. Keep only the `KINGLIKE_VIP_QA_LOGIN_*`
   credentials in the secure variable store until testing is complete.
6. Confirm the documented Kay-audio limitation is acceptable. The
   application-level network guard is not OS-level egress isolation.

### One-shot bootstrap inputs

The Railway pre-deploy initializer requires names only here; values must not
be stored in this document. It accepts only a `*.railway.internal` host on port
5432, a single private IPv4 address, the synthetic `vipqa_demo` database,
distinct `vipqa_migrator`/`vipqa_runtime` roles, the reviewed environment UUID,
an explicit approval pair, and unique strong synthetic account passwords.

The isolated service uses `server/vip/railway-qa.toml` as its Railway config
file because the repository-root `railway.toml` selects the full application
build. The QA-only file installs the locked toolchain and runs only the VIP QA
build/start commands; the root config remains unchanged. The app launcher
removes build/bootstrap settings before starting the application.

- `KINGLIKE_VIP_QA_BOOTSTRAP_EXECUTE`,
  `KINGLIKE_VIP_QA_BOOTSTRAP_APPROVED`,
  `KINGLIKE_VIP_QA_BOOTSTRAP_ADMIN_DATABASE_URL`,
  `KINGLIKE_VIP_QA_PROVISION_MIGRATOR_PASSWORD`,
- `KINGLIKE_VIP_QA_LOGIN_ADMIN_PASSWORD`,
  `KINGLIKE_VIP_QA_LOGIN_BUYER_PASSWORD`,
  `KINGLIKE_VIP_QA_LOGIN_SELLER_PASSWORD`,
  `KINGLIKE_VIP_QA_LOGIN_FINANCE_PASSWORD`.

`KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD`, `_BUYER_PASSWORD`,
`_SELLER_PASSWORD`, and `_FINANCE_PASSWORD` must be empty. The bootstrap copies
the persistent `KINGLIKE_VIP_QA_LOGIN_*_PASSWORD` values into the synthetic
account hashes. The generated launcher removes all four login password
variables before the app server starts.

Rollback must affect only the isolated QA service: stop it, restore its prior
QA branch/build snapshot, then remove QA-only settings and the synthetic
database only after the owner confirms they are no longer needed. Never use
this rollback procedure on the live service. No service has been deployed and
no database has been initialized; only the isolated QA patch is staged.
