# KINGLIKE VIP — existing Neon schema compatibility (read-only inspection)

**Inspection date:** 2026-11-23  
**Target:** existing Neon project `Kinglike Luxury`, default branch `production`  
**Scope:** metadata only; no customer rows or secret values retrieved, no DDL or DML.

## Verified existing database facts

- Existing `public.users` is a real application table; `id` is an
  `integer` primary key. This matches the `INTEGER REFERENCES users(id)`
  identity references used in `001_vip_foundation.sql`.
- The table includes the required existing identity/authorization fields:
  `username`, `password`, `email`, `phone_number`, `auth_method`,
  `is_verified`, `is_active`, `is_admin`, `role`.
- The application already has `public.crm_leads` and other CRM structures.
  The VIP migration does not create or alter any of those tables.
- The inspected `production` schema currently has **no `vip_*` tables**.
  The production database was **not changed**.

## Automated database guard now running in free GitHub CI

`server/vip/tests/migrationSmoke.ts` runs in a disposable localhost-only
`vipdb`, never on the connected Neon production branch:

1. Provision a synthetic `users` table with the exact legacy account columns
   and relevant constraints, and a dummy pre-existing `crm_leads` table.
2. Snapshot the pre-existing tables' **columns, indexes and constraints**,
   and insert synthetic existing user and CRM rows.
3. Apply `001_vip_foundation.sql` and repeat it once.
4. Verify original table **columns, indexes, constraints and fixture rows**
   are unchanged; confirm every additional table has the `vip_` prefix.
   PostgreSQL necessarily attaches *internal referential-integrity triggers*
   to the existing `users` table when new `vip_*` tables reference its
   primary key. Assert there are **no new custom business triggers** on
   existing application tables and **no new triggers at all** on `crm_leads`.
   These internal FK checks also have a potential (normally small) write cost
   when modifying or deleting referenced user IDs; assess before production DDL.
5. Continue tests of ownership, seller revocation, receipt verification,
   multi-currency accounting and all other tested VIP schema restrictions.

A successful CI test is a *prerequisite*, not permission to update production.

## Exact release gate — no database writes approved yet

1. Confirm a fresh production backup/restore point and rollback procedure.
2. Review the complete intended DDL diff, lock behavior and schema name
   collisions against current Neon production immediately before release.
3. Obtain **specific owner approval** for the production DDL step. Do not
   infer permission from requests to continue coding or run tests.
4. Run the reviewed migration once with a controlled, single-purpose
   deployment/migration role using a **direct**, not pooled, connection.
5. Read-back-verify all new objects, existing table signatures, sample
   non-sensitive counts, and feature flags. Keep both VIP flags **OFF**.
6. Independently approve and test the private storage provider before
   accepting real payment receipts or developer statements.

## Explicit exclusions

- Do **NOT** run `000_qa_users_only.sql` against Neon; it is exclusively
  for an empty CI/QA database and must never replace existing user accounts.
- Do **NOT** run `drizzle-kit push`, overwrite production tables, import
  real CRM data or automatically create users during this review.
- No new Railway VIP app or database is required for the chosen architecture.
- No cost guarantee is made for storage, transaction volume or infrastructure
  usage; current hosting capacity and private storage remain to be checked.
