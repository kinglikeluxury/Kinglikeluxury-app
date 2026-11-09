# Kinglike employee WhatsApp: continuity, deletion evidence and media/history preflight

## Owner-requested behavior

Once a permitted message is successfully received and stored, its original contents are not automatically overwritten or erased when a later WhatsApp revoke arrives. A separate immutable revoke event identifies the original in the same employee conversation and direction. The authenticated, audited archive read returns:

- deletion_status = meta_revoke_reported and deletion_observed_at only if a signed Meta deletion event was recorded.
- deletion_status = not_reported if no such verified event was received. This is NOT evidence that the message was not deleted on a phone.
- The original message_text (where originally captured), type and metadata remain in their own append-only event record. If a revoke arrives first, its event is retained and matched if the original arrives later.

Important limitation: WhatsApp's local Delete for me / clear chat on a handset does not have a guaranteed Cloud API webhook. No adapter may fabricate or imply an authoritative phone-local deletion flag. Verified delete for everyone or relevant Meta revoke events are distinct. Messages or media lost before first ingestion cannot be reconstructed by this mechanism.

## Event-time delivery expectations

- Future live path must subscribe to the eligible registered business number's messages and smb_message_echoes webhooks and authenticate raw-body HMAC, then acknowledge only after the envelope is durably accepted into an isolated, idempotent, encrypted queue.
- A private background worker must process business events in order within each conversation, retry transient failures with backoff, quarantine invalid identities and alert on queue lag or repeated failures; preserve both original and immutable revoke event. Do not ack and discard uncommitted messages.
- Use meta_event_key idempotency for retries, WABA + phone ID + employee ID binding for segregation, and a separate audited archive.read route with per-employee consent and permissions.
- The current proof webhook commits synchronously in isolated loopback tests only, with live Staging/production delivery disabled. Queue, retries, recovery/lag monitoring and real API subscriptions are not yet implemented. No guarantee of second-level provider delivery.
- Any archival retention, including what happens when a customer retracts a message, requires a lawful basis, proportionality, employee/customer notice, published retention and deletion/rights handling. A record marked deleted for everyone is not a license to keep personal data forever.

## Media and historical messages: non-deployed building blocks

- whatsappPrivateMediaVault.ts is a dependency-injected AES-256-GCM envelope and authorization/audit gate. It is not a storage service, media downloader or browser route. It restricts MIME/type and size, verifies SHA-256, binds ciphertext to the employee/conversation/event/phone scope, and fails closed. A future dedicated secret manager, encrypted private object store, malware scanning and scoped retrieval API are still needed.
- whatsappHistorySyncPreflight.ts is a metadata-only, one-time history window validator and verified-identity chunk summarizer. It does not request a provider sync, import message bodies or replay history into the real archive. History may arrive in different phases and out of order; progress=100 alone does not prove durable completion.
- The mock conversation workspace demonstrates the requested deletion badge with fictional fixture text. It is not yet connected to real employee archive data.
- A production/staging DB migration, independent roles, application integrations, Meta eligibility approval and one-number pilot are still separately gated.

## Manual review before any pilot

1. Approve privacy/employee consent, customer notice, storage retention, data rights and audit access policy; approve whether to retain deleted customer content.
2. Implement durable queue and encrypted storage using a dedicated least-privilege Staging database and object store; build explicit 403 denial and append-only audit tests.
3. Test simulated rapid message + revoke, retransmissions, out-of-order events, downtime, media digest mismatch, worker retry, archive UI status, and cross-employee denial.
4. Verify one employee phone's official Meta Coexistence eligibility, company authorization, webhook subscriptions and one-time history import readiness before connecting it.
5. Obtain new explicit owner approval for Meta number connection and live message ingestion. Keep current existing flags disabled until then.

No source changes in this branch should be interpreted as permission to connect a phone or record private conversations.
