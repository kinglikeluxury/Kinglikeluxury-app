---
name: Replit secrets, environment overrides, and stale instances
description: A stored Secret can be masked by an environment-scoped variable or remain absent from an already-running instance.
---

Replit Secrets are global (not environment-scoped), so `viewEnvVars` reporting a secret as present means it exists in the store — it does NOT mean every running instance's `process.env` has it.

An environment-scoped variable with the same key can also override the Secret. Prefer one authoritative source rather than keeping duplicate values at different configuration layers.

**Why:** Autoscale/VM containers load env vars at container start, while an environment override can continue supplying an older value even after the Secret is updated.

**How to apply:** Inspect both Secrets and environment-scoped variables for the key. Remove a duplicate override only with explicit authorization, restart once, and verify the effective runtime behavior rather than assuming storage presence equals activation.
