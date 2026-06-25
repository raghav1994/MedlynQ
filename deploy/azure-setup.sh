#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# MedLynQ — Azure resource provisioning
# Run once to create all required Azure resources.
#
# Prerequisites:
#   1. Install Azure CLI:  brew install azure-cli
#   2. Log in:             az login
#   3. Set your sub:       az account set --subscription "<subscription-id>"
#
# Usage:
#   chmod +x deploy/azure-setup.sh
#   ./deploy/azure-setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── CONFIG — edit these ───────────────────────────────────────────────────────
RESOURCE_GROUP="medlynq-rg"
LOCATION="centralindia"          # closest to Indian hospitals — change if needed
APP_NAME="medlynq-app"           # Next.js app  — will be: https://${APP_NAME}.azurewebsites.net
RX_APP_NAME="medlynq-rx"         # Rx decoder    — will be: https://${RX_APP_NAME}.azurewebsites.net
PLAN_NAME="medlynq-plan"
STORAGE_ACCOUNT="medlynqstorage" # must be 3-24 chars, lowercase letters + digits only
CONTAINER_REDACTED="medlynq-redacted"
CONTAINER_EXTRACTED="medlynq-extracted"
NODE_VERSION="22-lts"
PYTHON_VERSION="3.11"
# ─────────────────────────────────────────────────────────────────────────────

echo "▶  Creating resource group: $RESOURCE_GROUP ($LOCATION)"
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output table

echo ""
echo "▶  Creating App Service Plan (Linux B2): $PLAN_NAME"
az appservice plan create \
  --name "$PLAN_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --sku B2 \
  --is-linux \
  --output table

echo ""
echo "▶  Creating Next.js App Service: $APP_NAME"
az webapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$PLAN_NAME" \
  --runtime "NODE|$NODE_VERSION" \
  --output table

echo ""
echo "▶  Creating Rx decoder App Service: $RX_APP_NAME"
az webapp create \
  --name "$RX_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$PLAN_NAME" \
  --runtime "NODE|$NODE_VERSION" \
  --output table

echo ""
echo "▶  Creating Storage Account: $STORAGE_ACCOUNT"
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false \
  --output table

# Get storage connection string
STORAGE_CONN=$(az storage account show-connection-string \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query connectionString \
  --output tsv)

echo ""
echo "▶  Creating Blob containers"
az storage container create --name "$CONTAINER_REDACTED"  --connection-string "$STORAGE_CONN" --output table
az storage container create --name "$CONTAINER_EXTRACTED" --connection-string "$STORAGE_CONN" --output table

echo ""
echo "▶  Configuring App Service environment variables (main app)"
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    AZURE_STORAGE_CONNECTION_STRING="$STORAGE_CONN" \
    AZURE_CONTAINER_REDACTED="$CONTAINER_REDACTED" \
    AZURE_CONTAINER_EXTRACTED="$CONTAINER_EXTRACTED" \
    NODE_ENV="production" \
    MEDLYNQ_PYTHON="python3" \
    NEXT_TELEMETRY_DISABLED="1" \
  --output table

echo ""
echo "▶  Enabling always-on + setting startup command (main app)"
az webapp config set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --startup-file "deploy/startup.sh" \
  --always-on true \
  --output table

echo ""
echo "▶  Configuring Rx app environment variables"
az webapp config appsettings set \
  --name "$RX_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV="production" \
    PORT="8080" \
  --output table

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Setup complete."
echo ""
echo "  Main app URL : https://${APP_NAME}.azurewebsites.net"
echo "  Rx app URL   : https://${RX_APP_NAME}.azurewebsites.net"
echo ""
echo "  Storage conn string (save this → .env.local):"
echo "  AZURE_STORAGE_CONNECTION_STRING=\"$STORAGE_CONN\""
echo ""
echo "  Next: add SARVAM_API_KEY manually in Azure Portal:"
echo "  Portal → $APP_NAME → Configuration → Application settings"
echo "════════════════════════════════════════════════════════"
