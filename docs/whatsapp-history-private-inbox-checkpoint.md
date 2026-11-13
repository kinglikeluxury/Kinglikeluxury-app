# Kinglike employee WhatsApp — isolated Coexistence history intake

**Checkpoint:** 10 November 2026. Target: private Kinglike-Web-Staging archive only. No real employee numbers, Meta token, customer details, CRM rows, or production/Neon changes.

## Why this is separate

Meta Coexistence uses distinct webhook fields: `history` for previous messages, `smb_app_state_sync` for contacts, and `smb_message_echoes` for ongoing app-originated messages. A one-time history sync may be restricted to a short onboarding window and may deliver several chunks out of order. The existing **ordinary messages** inbox deliberately rejects history/contact fields; a successful ACK into the wrong queue could lose the prior chat history.

## Delivered in this PR

- `docs/sql/2026-11-10-whatsapp-archive-05-private-history-inbox.sql.txt`: manual, isolated history-only encrypted table. The content/identity/phase/digest fields are immutable; permitted import-status fields may change through a separate, explicitly approved importer. DELETE and TRUNCATE are denied. A fresh `kinglike_wa_history_importer` role begins **NOLOGIN**.
- `server/whatsappHistoryDurableInbox.ts`: importable (but **not invoked**) signed-history intake service. Enforces Meta HMAC on raw bytes, company employee/WABA/number scope checks and authorization, separate 32-byte AES-GCM key, per-chunk AAD identity protection, byte/quantity bounds, duplicate/phase collision detection and atomic commit-or-rollback.
- Each encrypted row contains one history chunk, ciphertext and non-sensitive counters/progress. The worker role receives only INSERT and narrowly scoped duplicate-check SELECT privileges; it cannot read encrypted chunks or modify them. This preserves raw history **without** prematurely pretending that each message has been parsed and displayed.
- A `declined` history-sharing notice is recorded without suggesting that history was imported.
- CI tests verify HMAC rejects, wrong/mixed field rejection, duplicate/reordered chunks, conflicting phase/order, mid-flight authorization changes, rollback and PostgreSQL NOLOGIN grants.

## Deliberately not completed

- There is **no public receiver, phone enrollment, Meta subscription, history-request API call, background consumer, ciphertext decryption importer, CRM merge, media fetch or employee chat replay** in this PR.
- A successful durable history intake is **not yet a completed import**. The future importer must process the encrypted pending rows via a separately permissioned role, preserve original Meta message IDs and timestamps and route attachments to the private media vault. Media availability/history ranges are subject to Meta.
- `smb_app_state_sync` is **still rejected**, rather than silently misrouted; a separate contact handler will be required.
- The SQL 05 migration is manual only and must be verified on the standalone archive DB (not app/Neon), with zero live content before execution; roles remain NOLOGIN. Real employee/customer notices and Coexistence eligibility still require verification.
- ACK to Meta is prohibited until the actual signed receiver is wired to the durable private inbox and the relevant importer/monitoring is operational.

**Scope policy:** Company-owned authorized work numbers only; Samer remains under direct owner supervision, not Fadi's ungranted archive scope. Ordinary clients cannot access staff conversations, and app administrators need explicit read grants.
