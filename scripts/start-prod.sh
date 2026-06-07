#!/usr/bin/env bash
# Production startup script.
# The run container does not inherit node_modules from the build container.
# Install production deps here (--omit=dev skips the 28 dev packages whose
# lockfile URLs point to package-firewall.replit.local, which is unreachable
# outside the Replit dev environment).
set -euo pipefail

echo "[start-prod] Installing production dependencies..."
npm install --omit=dev
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
