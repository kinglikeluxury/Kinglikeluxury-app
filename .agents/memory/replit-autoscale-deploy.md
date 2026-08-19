---
name: Replit autoscale deployment
description: How to correctly configure build/run for Replit autoscale so node_modules are available and the port opens in time.
---

# Replit Autoscale Deployment

## The Rule
- The deployment build installs dependencies, creates `dist`, and prunes to production dependencies before promotion.
- Production startup must use that prepared artifact and open the application port immediately; do not run a full `npm install` or a frontend/server rebuild during startup.
- Port must be `parseInt(process.env.PORT || "5000", 10)`.

**Why:** Autoscale health checks begin as soon as the runtime command starts. A full install/build before launching the server can consume the entire startup window, so port 5000 never opens and promotion fails. The deployment artifact includes the already-built app and production dependencies.

**Critical:** Keep the start command limited to validating the supplied build artifact (with a missing-dependency fallback only if needed) and launching `dist/index.js`. Dependency installation and build work belong in the deployment build command.

**Correct production run sequence:**
```bash
exec node dist/index.js       # start the prepared server promptly
```

**Correct .replit:**
```toml
build = ["bash", "-c", "npm install && npm run build && npm install --omit=dev --no-audit --no-fund"]
run   = ["bash", "-c", "bash scripts/start-prod.sh"]
```
