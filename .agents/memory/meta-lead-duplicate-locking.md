---
name: Meta lead duplicate locking
description: Concurrency rule for preventing duplicate CRM rows across Meta webhook and pull-sync ingestion.
---

Meta ingestion must acquire a transaction-scoped lock for the Meta external lead ID before the normalized phone lock. The same transaction must retain those locks through duplicate lookup and, for a new lead, assignment and insertion. A duplicate path must return before assignment.

**Why:** Webhook and pull sync can receive the same Meta submission concurrently. Phone-only locking misses races when the phone is absent or differs between the two Meta responses, while releasing a lock before insertion reopens the create race.

**How to apply:** Preserve external-ID-then-phone lock ordering in every Meta ingestion path. Keep notifications outside the create decision, and never mutate an existing CRM lead or its notes when a duplicate is detected.