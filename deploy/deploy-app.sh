#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# MedLynQ — Deploy Next.js app to Azure App Service
# Run from repo root:  ./deploy/deploy-app.sh
#
# Requires: az CLI logged in + azure-setup.sh already run once.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RESOURCE_GROUP="medlynq-rg"
APP_NAME="medlynq-app"
APP_DIR="$(cd "$(dirname "$0")/../app" && pwd)"
ZIP_FILE="/tmp/medlynq-app.zip"

echo "▶  Building Next.js app..."
cd "$APP_DIR"
npm ci --omit=dev
npm run build

echo ""
echo "▶  Creating deployment zip..."
# Include: .next, public, node_modules, python sidecar, startup script
zip -r "$ZIP_FILE" \
  .next \
  public \
  node_modules \
  python \
  package.json \
  next.config.mjs \
  ../deploy/startup.sh \
  --exclude "*.map" \
  --exclude "node_modules/.cache/*" \
  -q

echo ""
echo "▶  Deploying to Azure App Service: $APP_NAME"
az webapp deployment source config-zip \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --src "$ZIP_FILE"

echo ""
echo "▶  Restarting app..."
az webapp restart \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Deployed: https://${APP_NAME}.azurewebsites.net"
echo "  Tail logs: az webapp log tail --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo "════════════════════════════════════════════════════════"

rm -f "$ZIP_FILE"
