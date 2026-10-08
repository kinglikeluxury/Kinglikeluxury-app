---
name: Meta queue claim fencing
description: Durable concurrency rule for Meta lead queue claims and terminal state changes.
---

Rule: Keep the Meta Webhook queue processor lease schema-free by using the database-issued `updated_at` value as the claim version. This rule does not apply to Meta Pull Sync. Preserve exact microseconds; do not round-trip the webhook queue token through a JavaScript `Date`. Every later `completed`, `retry`, or `needs_review` update for that processor must compare the row ID, `status = 'processing'`, and the claimed timestamp. A zero-row update means ownership was lost and must not be retried without a new claim. Commit claim transactions before external work.

**Why:** Autoscaled workers may continue after another worker recovers a stale row. Exact compare-and-set ownership prevents an old worker from overwriting the newer claim, while avoiding a schema migration.

**How to apply:** Set `updated_at = NOW()` on every Meta Webhook queue processor claim and return the same value at microsecond precision. Route its terminal transitions, including stale-exhaustion recovery, through the claim-version fence. Leave Pull Sync's claim and processing behavior unchanged.
