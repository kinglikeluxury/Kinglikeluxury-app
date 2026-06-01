---
name: Replit autoscale deployment
description: How to correctly configure build/run for Replit autoscale so node_modules are available and the port opens in time.
---

# Replit Autoscale Deployment

## The Rule
- Production container starts with NO node_modules — only the workspace files are present.
- `npm install --omit=dev` must run in the **run** command (before starting node) so openai and other runtime deps are available.
- `npm install` (full, including dev) must also run in the **build** command so the TypeScript/Vite build succeeds.
- Port must be `parseInt(process.env.PORT || "5000", 10)` — Replit injects PORT; hardcoding 5000 also works since Replit maps to port 5000, but reading PORT is more portable.

**Why:** esbuild uses `--packages=external`, so ALL npm packages are bare runtime imports in dist/index.js. Without node_modules in the production container, every `import` fails with ERR_MODULE_NOT_FOUND.

**How to apply:**
```toml
[deployment]
deploymentTarget = "autoscale"
build = ["bash", "-c", "npm install && npm run build"]
run   = ["bash", "-c", "npm install --omit=dev && npm run start"]
```

## Port timeout caveat
Replit's health check times out after ~44 seconds waiting for the port. `npm install --omit=dev` can take 40+ seconds on a cold container, potentially causing a port timeout. If this happens, move `npm install --omit=dev` to the build step and keep run as just `npm run start`.
