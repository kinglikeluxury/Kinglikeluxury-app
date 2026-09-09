---
name: Kay controlled auto-rescue safety
description: Durable activation and worker-safety rules for controlled automatic lead rescue.
---

Controlled automatic rescue reuses the same transactional ownership core as Assisted Rescue. Its isolated worker may act only for `no_answer_1` or `no_answer_2`, after the configured window and final warning.

**Why:** A scheduler can mutate real CRM ownership, so mode alone is not sufficient protection. Lease fencing, deterministic queue identity, transactional limits, uncertain-result reconciliation, and an emergency stop prevent stale or duplicate transfers.

**How to apply:** Require all four gates: CONTROLLED_AUTOMATION mode, applicable rule enabled, kill switch OFF, and Canary enabled with an explicit current-owner allowlist. Keep production at SHADOW, both rules disabled, kill switch ON, and an empty allowlist until the user explicitly approves activation.

Legacy baselines are observation clocks, not reconstructed historical status-entry times. They may support shadow readiness only after a full threshold has elapsed from observation, and must not enter warning, queue, mission, or worker paths without separate approval.

**Why:** Historical entry time cannot be inferred safely from CRM creation/update timestamps; treating a baseline as trusted history could trigger premature ownership changes.

**How to apply:** Store legacy observations in their own ledger, invalidate them atomically on status changes, prefer a matching latest trusted transition, and keep Admin-owner policy unresolved until explicitly decided.