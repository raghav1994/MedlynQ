#!/usr/bin/env bash
# Azure App Service startup script for MedLynQ (Next.js + Python sidecar).
# App Service runs this as the container entrypoint after deployment.

set -euo pipefail

echo "[startup] Installing Python dependencies for sidecar..."
pip install --quiet \
  paddlepaddle \
  paddleocr \
  opencv-python-headless \
  pymupdf \
  numpy

echo "[startup] Python sidecar dependencies ready."
echo "[startup] Starting Next.js..."

# PORT is set by App Service (default 8080)
exec node_modules/.bin/next start --port "${PORT:-8080}"
