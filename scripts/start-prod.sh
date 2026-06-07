#!/usr/bin/env bash
# Production startup script.
# node_modules is included in the deployment artifact (node_modules/ removed
# from .replitignore). The build step runs:
#   npm install && npm run build && npm install --omit=dev --no-audit --no-fund
# so the artifact contains only production deps.
# If node_modules is present (normal path), skip install and start immediately.
# If missing for any reason (safety fallback), install before starting.
set -euo pipefail

if [ ! -f "dist/public/index.html" ]; then
  echo "[start-prod] dist/public/index.html not found — running vite build..."
  npx vite build
  echo "[start-prod] Frontend build complete."
else
  echo "[start-prod] dist/public/index.html found — skipping rebuild."
fi

if [ -d "node_modules" ]; then
  echo "[start-prod] node_modules present in artifact — skipping install."
else
  echo "[start-prod] node_modules missing — installing production dependencies..."
  npm install --omit=dev --no-audit --no-fund
  echo "[start-prod] Dependencies installed."
fi

export NODE_ENV=production
exec node dist/index.js
