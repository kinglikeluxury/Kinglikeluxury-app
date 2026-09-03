---
name: Kay ordered shadow observations
description: Safety rules for observing exact CRM transitions and reconciling current Kay decisions under concurrency.
---

Kay observations that depend on exact CRM transition order must be captured in the same database ordering as the CRM write, while swallowing all observer failures so Kay can never reject the CRM mutation.

**Why:** Fire-and-forget application callbacks can complete out of order during rapid status flapping and accidentally reuse an old timer window.

**How to apply:** Use a database-local, exception-isolated observation boundary for exact transition times. Keep stable event idempotency, enforce one decision per event at the database level, and atomically upsert the current decision so blocker changes cannot leave stale ACTIVE recommendations.

Threshold or rule changes require immutable, fingerprinted evaluation snapshots. A new evaluation may change only the lifecycle state of the prior actionable recommendation to `STALE`; it must not replace the prior threshold, rule version, or settings snapshot.

**Why:** Reusing one mutable decision per status window erased which rule actually produced the historical recommendation.

**How to apply:** Include decision-relevant settings and observed blockers in an idempotent evaluation fingerprint, serialize per lead/status-entry window, preserve original evaluation fields, and expose no more than one current actionable recommendation.