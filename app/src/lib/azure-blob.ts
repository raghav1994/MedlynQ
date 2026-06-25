// Azure Blob Storage client for MedLynQ.
//
// DPDP rule enforced here: LOCAL_ONLY_DOC_TYPES are never uploaded to Azure.
// Only PII-burned (redacted) copies and JSON manifests leave the hospital server.
//
// Required env vars (set in .env.local or Azure App Service config):
//   AZURE_STORAGE_CONNECTION_STRING   — from Azure portal → Storage Account → Access Keys
//   AZURE_CONTAINER_REDACTED          — defaults to "medlynq-redacted"
//   AZURE_CONTAINER_EXTRACTED         — defaults to "medlynq-extracted"

import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} from "@azure/storage-blob";

// Doc types that must never leave the hospital server — no Azure upload
export const LOCAL_ONLY_DOC_TYPES = new Set([
  "aadhaar card",
  "pan card",
  "voter id",
  "ration card",
  "ayushman card",
  "family id",
  "health card",
  "patient id",
  "umid card",
  "esi card",
  "scheme card",
  "passport photo",
  "kyc form",
]);

export const CONTAINER_REDACTED  = process.env.AZURE_CONTAINER_REDACTED  || "medlynq-redacted";
export const CONTAINER_EXTRACTED = process.env.AZURE_CONTAINER_EXTRACTED || "medlynq-extracted";

function getClient(): BlobServiceClient {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING not set");
  return BlobServiceClient.fromConnectionString(conn);
}

export function isLocalOnly(docType: string): boolean {
  return LOCAL_ONLY_DOC_TYPES.has(docType.toLowerCase());
}

export function isAzureConfigured(): boolean {
  return Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING);
}

/** Upload a buffer to Blob Storage. Returns the blob URL (private). */
export async function uploadBlob(
  containerName: string,
  blobName: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const client = getClient();
  const container = client.getContainerClient(containerName);
  await container.createIfNotExists();
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.upload(data, data.length, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return blockBlob.url;
}

/**
 * Generate a SAS URL valid for `expiryHours` (default 24h).
 * Use this to serve blobs to the frontend without exposing the storage key.
 */
export async function getBlobSasUrl(
  containerName: string,
  blobName: string,
  expiryHours = 24,
): Promise<string> {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING not set");

  // Parse account name + key from connection string
  const accountNameMatch = conn.match(/AccountName=([^;]+)/);
  const accountKeyMatch  = conn.match(/AccountKey=([^;]+)/);
  if (!accountNameMatch || !accountKeyMatch) {
    throw new Error("Cannot parse storage account name/key from connection string");
  }
  const accountName = accountNameMatch[1];
  const accountKey  = accountKeyMatch[1];

  const sharedKey = new StorageSharedKeyCredential(accountName, accountKey);
  const expiresOn = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

  const sasQuery = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("r"),
      expiresOn,
    },
    sharedKey,
  ).toString();

  const endpoint = conn.match(/BlobEndpoint=([^;]+)/)?.[1]
    || `https://${accountName}.blob.core.windows.net`;

  return `${endpoint}/${containerName}/${blobName}?${sasQuery}`;
}

/** Upload redacted doc + manifest JSON in one call. Returns SAS download URL. */
export async function uploadDocToAzure(opts: {
  mrn: string;
  jobId: string;
  blobName: string;          // e.g. "P0008_discharge_summary_20260614.pdf"
  redactedBuffer: Buffer;
  contentType: string;
  manifest: Record<string, unknown>;
}): Promise<{ redactedUrl: string; manifestUrl: string }> {
  const { mrn, jobId, blobName, redactedBuffer, contentType, manifest } = opts;

  const redactedBlobPath  = `${mrn}/${jobId}/${blobName}`;
  const manifestBlobPath  = `${mrn}/${jobId}/manifest.json`;

  await uploadBlob(CONTAINER_REDACTED,  redactedBlobPath,  redactedBuffer, contentType);
  await uploadBlob(
    CONTAINER_EXTRACTED,
    manifestBlobPath,
    Buffer.from(JSON.stringify(manifest, null, 2)),
    "application/json",
  );

  const [redactedUrl, manifestUrl] = await Promise.all([
    getBlobSasUrl(CONTAINER_REDACTED,  redactedBlobPath),
    getBlobSasUrl(CONTAINER_EXTRACTED, manifestBlobPath),
  ]);

  return { redactedUrl, manifestUrl };
}
