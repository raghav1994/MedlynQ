#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# MedLynQ — Deploy medlynq-rx (Rx prescription decoder) to Azure App Service
# Run from repo root:  ./deploy/deploy-rx.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RESOURCE_GROUP="medlynq-rg"
RX_APP_NAME="medlynq-rx"
RX_DIR="$(cd "$(dirname "$0")/../medlynq-rx" && pwd)"
ZIP_FILE="/tmp/medlynq-rx.zip"

echo "▶  Installing medlynq-rx dependencies..."
cd "$RX_DIR"
npm ci --omit=dev

echo ""
echo "▶  Creating deployment zip..."
zip -r "$ZIP_FILE" \
  server.js \
  public \
  node_modules \
  package.json \
  -q

echo ""
echo "▶  Setting startup command for Rx app..."
az webapp config set \
  --name "$RX_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --startup-file "node server.js"

echo ""
echo "▶  Deploying to Azure App Service: $RX_APP_NAME"
az webapp deployment source config-zip \
  --name "$RX_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --src "$ZIP_FILE"

echo ""
echo "▶  Restarting Rx app..."
az webapp restart \
  --name "$RX_APP_NAME" \
  --resource-group "$RESOURCE_GROUP"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Deployed: https://${RX_APP_NAME}.azurewebsites.net"
echo "  Tail logs: az webapp log tail --name $RX_APP_NAME --resource-group $RESOURCE_GROUP"
echo "════════════════════════════════════════════════════════"

rm -f "$ZIP_FILE"
