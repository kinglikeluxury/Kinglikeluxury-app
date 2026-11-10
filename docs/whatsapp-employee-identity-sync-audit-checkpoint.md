# Kinglike WhatsApp employee identity reconciliation — Staging checkpoint

**Date:** 10 November 2026. **Project:** Kinglike-Web-Staging, database Postgres-92tK, `kinglike_whatsapp_archive`. **No changes to production / Neon.**

## What is delivered

- A new minimal, append-only `whatsapp_employee_identity_sync_audit` table: only internal actor/employee numeric IDs, activation/deactivation and timestamp. No message content, phone numbers, names or account credentials.
- Four existing scoped archive roles remain **NOLOGIN**. Only `kinglike_wa_archive_identitysync` can INSERT into its new audit ledger; it cannot SELECT, UPDATE, DELETE or TRUNCATE it.
- `createAuditedIdentitySync` accepts a verified current Kinglike administrator and a verified, consented employee subject. It reconciles **one ID at a time**, never a bulk dump. Every operation re-checks the app's current authorization and the employee's consent.
- A real PostgreSQL transaction binds upsert/deactivation and ledger insertion together. If ledger writing fails, roll back all changes. An ordinary customer who has never had an archive identity produces no row in the archive or ledger.
- Unit tests and disposable PostgreSQL migration tests cover the role grant, immutable trigger, denied ledger read, consent revocation and transaction-failure rollback.

## What remains OFF

- The Staging app contains **no public refresh route or scheduler**. This module opens no database by itself.
- The Postgres-92tK archive role is **still NOLOGIN**; no credential is placed in GitHub, the app or this document.
- The actual consent registry and Meta Coexistence activation have not been verified for an employee number.
- The retained-data policy, customer notice, media ingestion and old chat history import are not yet approved/complete.
- No employee, customer or message is copied into the new archive by this change.

## Single-purpose manual SQL migration

Only after synthetic CI succeeds, apply `docs/sql/2026-11-10-whatsapp-archive-04-identity-audit.sql.txt` **once** to the already isolated archive DB. Verify exact Railway project/environment/service/database IDs, private host, zero unexpected table conflicts and immutable triggers before commit. Do not run it in Neon or the regular Staging application DB.

Do not enable LOGIN for any role until an approved, narrowly scoped, auditable runtime design and documented legal/employee notice are in place. If a future identity sync worker is approved, make it use a distinct dedicated role and secret, never the database owner.
