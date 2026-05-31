#!/bin/bash
set -e

echo "[build-prod] Building frontend..."
node_modules/.bin/vite build

echo "[build-prod] Building server (fully bundled, no external npm packages except canvas)..."
node scripts/build-prod.mjs

echo "[build-prod] Done. dist/index.js is self-contained."
