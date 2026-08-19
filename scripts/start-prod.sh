#!/usr/bin/env bash
# Production startup script.
# Always rebuild from the current source because a pre-existing dist directory
# in the deployment artifact may belong to an older source snapshot.
set -euo pipefail

echo "[start-prod] Installing build dependencies..."
npm install --no-audit --no-fund

echo "[start-prod] Rebuilding from current source..."
npm run build
echo "[start-prod] Build complete."

echo "[start-prod] Pruning development dependencies..."
npm install --omit=dev --no-audit --no-fund
echo "[start-prod] Production dependencies ready."

export NODE_ENV=production
exec node dist/index.js
