---
name: Kay call anti-spam atomicity
description: Concurrency and replay rules for Kay internal-call eligibility.
---

Kay call anti-spam evaluation and call-session insertion must execute under one employee-scoped transaction lock. Idempotent replays must return the existing session before eligibility checks and must never repeat signaling, invitations, push notifications, or ephemeral connection binding.

**Why:** Separate history checks and insertion allow concurrent requests to pass the same daily limit. Treating an existing idempotency key as a fresh creation can re-ring an old or finished session.

**How to apply:** Any future call-creation path must use the same transaction boundary, canonical reason code, and side-effect-free replay rule. Never replace the transaction lock with a pooled session advisory lock.