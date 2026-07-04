---
name: Replit secrets vs stale autoscale deploys
description: A secret being present in Replit Secrets does not mean the currently-running production instance has it in process.env.
---

Replit Secrets are global (not environment-scoped), so `viewEnvVars` reporting a secret as present means it exists in the store — it does NOT mean every running instance's `process.env` has it.

**Why:** Autoscale/VM containers load env vars at container start. If a secret is added or changed after the last successful deploy/build, already-running instances keep the old (or missing) value until the next deploy or restart.

**How to apply:** When a user reports "X env var is not set" in production but `viewEnvVars` shows it exists, don't assume the report is wrong — check the deployment build history (`listDeploymentBuilds`/`getDeploymentInfo`) for whether a build has run since the secret was added. Recommend a fresh publish/redeploy to pick it up, and validate the token/secret is actually functional with a live, read-only test call before declaring it fixed.
