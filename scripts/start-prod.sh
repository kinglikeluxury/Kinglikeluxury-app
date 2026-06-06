#!/usr/bin/env bash
# Production startup script.
# If dist/public/index.html is missing (e.g. vite build failed in build step),
# rebuild the frontend before starting the server.
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
