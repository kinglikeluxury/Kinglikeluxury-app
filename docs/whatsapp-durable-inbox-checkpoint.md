# WhatsApp employee durable inbox — isolated development checkpoint

This additive code is based on the previously tested PR #31. It is part of the existing Kinglike Luxury repository, **not a production deployment**, and is not wired to live Meta subscriptions.

## Implemented (code + isolated tests)

- Verify Meta HMAC on raw webhook bytes and match signed WABA ID, business phone ID and display phone against the company-scoped identity before inserting.
- Require an independent current authorization/consent decision at enqueue time **and again** before processing.
- Derive a scope-bound HMAC delivery fingerprint with a separate key, and encrypt payload at receipt with AES-256-GCM and scope-bound AAD. Never store plaintext or message text in inbox columns.
- Insert atomically into an isolated PostgreSQL inbox with unique delivery identity. This provides a durable receipt boundary: a future HTTP route must acknowledge only after the insert is committed.
- Claim work with `FOR UPDATE SKIP LOCKED` and a lease token. Retry with bounded backoff when processing fails, reclaim an expired lease, and mark repeated failures `dead_letter` instead of silently dropping them.
- Clear encrypted raw payload and key material *from the inbox row* after successful archive processing; keep a minimal processed receipt for deduplication. This does not remove archived messages.
- Block worker processing if company-number authorization or employee consent is revoked after the message was queued.
- Existing immutable archive/revoke logic from PR #31 preserves an original message and marks Meta-confirmed deletions; no self-reported phone-local deletion event is inferred.

## Explicit boundaries and blockers

- **No HTTP endpoint or scheduler is connected to this inbox yet**. No production/Staging database migration or Meta change has occurred.
- Worker consumer is dependency-injected and must be backed by the existing **idempotent** archive event writer. The delivery is *at least once*, not exactly once: a crash between archive commit and inbox receipt update can cause redelivery.
- The SQL schema is manual/review-only. It must be deployed ONLY in an independently provisioned archive DB after least-privilege roles, separate key management, an append-only access audit, a retention/deletion policy and backup/restore tests are approved. It is NOT a change to the existing WhatsApp signup proof database or Neon.
- Message synchronization begins **only after** Meta delivers signed webhooks and our receiver durably commits them; provider timing is outside our control. No guarantee can be made that a message deleted before initial ingestion will be recoverable.
- Inbox payload size currently capped at 1 MiB. Historical history chunks and media bytes need **separate bounded encrypted pipelines**. The history preflight from PR #31 still does not import messages; the media vault still has no real object storage integration.
- Acknowledge a provider event only after *durable queue receipt*; retries on 5xx/timeout are a provider-dependent expectation to verify in the final live integration.
- Worker's dead letters and blocked events require an alerting and reviewed recovery procedure before a real employee pilot. They cannot be auto-activated by toggling a flag.

## Next steps before a real WhatsApp Coexistence pilot

1. Review the schema/worker with security and privacy owners; approve employee notice, customer notice, retention/data-rights, company-number evidence, and archive grant/audit policy.
2. Provision a **separate** least-privilege Staging inbox/archive DB, apply a reviewed migration, and run end-to-end synthetic HTTP receiver -> durable inbox -> archive tests with a fake Meta signer.
3. Add and test alerting for queue lag, dead letters, failed authorization and key rotation; require successful archive write before marking a delivery processed.
4. Integrate consent-audited media retrieval and verified one-time history import only after the storage and service boundaries pass.
5. Get explicit owner approval to connect a real employee number and enable Meta fields. Do not connect Samer/Fadi/Joanna or change production at this checkpoint.
