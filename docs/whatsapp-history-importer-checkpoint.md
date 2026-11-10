# Kinglike WhatsApp — private history importer (Staging only)

Checkpoint 10 November 2026. No real employee number, Meta event or customer data is connected by this PR.

The new `server/whatsappPrivateHistoryImporter.ts` is a manually invoked, dependency-injected importer. It does NOT auto-start, create an HTTP endpoint, open a database at import time, start a scheduler, or call Meta. The operator must supply a scoped connection to the dedicated archive database, the same separate AES-256-GCM history key and a verified current app/consent authorization function.

A pending encrypted history chunk is leased and AES-GCM-decrypted with scope-bound AAD. The content SHA-256 is revalidated. Each inbound or outbound historic message gets its real Meta message ID, original timestamp and correct direction. Existing conversation and event tables receive immutable INSERTs. Idempotency keys match the live stream's `message:<id>` or `echo:message:<id>`. Unsupported types fail closed. Media metadata is preserved if supplied, but actual media bytes are NOT downloaded or claimed to exist.

Message INSERTs, an append-only import audit and marking the chunk `imported` are one PostgreSQL transaction. Any failure rolls back all three; the chunk is retried/blocked/dead-lettered. One `progress=100` chunk is NOT sufficient evidence for complete history import. A declined sharing event produces no messages.

SQL 06 adds `history` to permitted event sources and grants minimum SELECT/INSERT to the separate NOLOGIN history importer. It cannot UPDATE, DELETE or TRUNCATE historic or existing messages, administer employees, or alter supervisory grants.

**Still OFF:** archive role LOGINs, real Meta Coexistence onboarding, webhook receiving, private history background processing, media downloading, contacts sync `smb_app_state_sync`, and production/Neon. Before using one real company number, the remaining customer notice/retention policy, per-number eligibility, role secrets, monitoring, history-import retry/dead-letter operations, and safe archive UI/media representation must be reviewed. Owner's employee-consent attestation does not itself fabricate a Meta consent/registration event.
