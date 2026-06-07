#!/usr/bin/env bash
# Production startup script.
# node_modules are baked into the image by the build step (npm install && npm run build).
# Do NOT run npm install here — package-firewall.replit.local URLs in the lockfile
# are only reachable inside the Replit dev environment, not in the run container.
set -euo pipefail

if [ ! -f "dist/public/index.html" ]; then
  echo "[start-prod] dist/public/index.html not found — running vite build..."
  npx vite build
  echo "[start-prod] Frontend build complete."
else
  echo "[start-prod] dist/public/index.html found — skipping rebuild."
fi

export NODE_ENV=production
exec node dist/index.js
