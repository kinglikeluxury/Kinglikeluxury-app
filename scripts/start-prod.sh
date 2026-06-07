#!/usr/bin/env bash
# Production startup script.
# The run container is separate from the build container — node_modules are not
# carried over. Install production deps here before starting the server.
set -euo pipefail

echo "[start-prod] Installing production dependencies..."
npm install --omit=dev --prefer-offline
echo "[start-prod] Dependencies installed."

if [ ! -f "dist/public/index.html" ]; then
  echo "[start-prod] dist/public/index.html not found — running vite build..."
  npx vite build
  echo "[start-prod] Frontend build complete."
else
  echo "[start-prod] dist/public/index.html found — skipping rebuild."
fi

export NODE_ENV=production
exec node dist/index.js
