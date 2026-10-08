---
name: Meta queue claim fencing
description: Durable concurrency rule for Meta lead queue claims and terminal state changes.
---

Rule: Keep the queue lease schema-free by using the database-issued `updated_at` value as the claim version. Preserve its exact microsecond representation; do not round-trip it through a JavaScript `Date`. Every later `completed`, `retry`, or `needs_review` update must compare the row ID, `status = 'processing'`, and the claimed timestamp. A zero-row update means ownership was lost and must not be retried without a new claim. Commit claim transactions before external work.

**Why:** Autoscaled workers may continue after another worker recovers a stale row. Exact compare-and-set ownership prevents an old worker from overwriting the newer claim, while avoiding a schema migration.

**How to apply:** Set `updated_at = NOW()` on every claim and return the same value at microsecond precision. Route terminal transitions, including stale-exhaustion recovery, through the claim-version fence.
