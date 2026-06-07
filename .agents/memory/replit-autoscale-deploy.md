---
name: Replit autoscale deployment
description: How to correctly configure build/run for Replit autoscale so node_modules are available and the port opens in time.
---

# Replit Autoscale Deployment

## The Rule
- Production run container starts with NO node_modules — only workspace files are present.
- `npm install --omit=dev` (no `--prefer-offline`) MUST run in `scripts/start-prod.sh` before `node dist/index.js`.
- `npm install` (full) must also run in the build step so the TypeScript/Vite build succeeds.
- Port must be `parseInt(process.env.PORT || "5000", 10)`.

**Why:** esbuild uses `--packages=external` — all npm packages are bare runtime imports in dist/index.js. Without node_modules in the run container every import fails with ERR_MODULE_NOT_FOUND.

**Critical: do NOT use `--prefer-offline`** — the run container's npm cache is empty; `--prefer-offline` causes npm to fall back to lockfile `resolved` URLs. This project's lockfile contains 28 dev packages with `package-firewall.replit.local` URLs (Replit Socket Security proxy, unreachable outside dev). With `--omit=dev` those 28 are skipped cleanly. Without `--prefer-offline` npm fetches production packages straight from registry.npmjs.org (all prod packages use real registry URLs — 0 firewall URLs in prod deps).

**Correct scripts/start-prod.sh run sequence:**
```bash
npm install --omit=dev        # install prod deps from real registry
exec node dist/index.js       # start server
```

**Correct .replit:**
```toml
build = ["bash", "-c", "npm install && npm run build"]
run   = ["bash", "-c", "bash scripts/start-prod.sh"]
```
