---
name: Kay controlled auto-rescue safety
description: Durable activation and worker-safety rules for controlled automatic lead rescue.
---

Controlled automatic rescue reuses the same transactional ownership core as Assisted Rescue. Its isolated worker may act only for `no_answer_1` or `no_answer_2`, after the configured window and final warning.

**Why:** A scheduler can mutate real CRM ownership, so mode alone is not sufficient protection. Lease fencing, deterministic queue identity, transactional limits, uncertain-result reconciliation, and an emergency stop prevent stale or duplicate transfers.

**How to apply:** Require all four gates: CONTROLLED_AUTOMATION mode, applicable rule enabled, kill switch OFF, and Canary enabled with an explicit current-owner allowlist. Keep production at SHADOW, both rules disabled, kill switch ON, and an empty allowlist until the user explicitly approves activation.