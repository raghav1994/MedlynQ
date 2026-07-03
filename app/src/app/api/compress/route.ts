// POST /api/compress
//
// Orchestrates the DPDP-compliant pipeline:
//   1. Forward the upload to the OCR container (OCR_SERVICE_URL) which
//      compresses + classifies + extracts + BURNS PII (redaction).
//   2. Save the redacted+compressed copy locally so the dashboard can show it.
//   3. Upload the REDACTED copy (+ JSON manifest) to Azure Blob — UNLESS the
//      doc is an identity doc (isLocalOnly), which must never leave the server.
//
// The user is only ever shown / given the redacted+compressed copy.

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { isLocalOnly, isAzureConfigured, uploadDocToAzure } from "@/lib/azure-blob";

export const runtime = "nodejs";
export const maxDuration = 300;

const OCR_URL = process.env.OCR_SERVICE_URL; // e.g. https://medlynq-ocr.<region>.azurecontainerapps.io

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const mrn = (form.get("mrn") as string) || "UNKNOWN_MRN";

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "missing 'file' field" }, { status: 400 });
    }
    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.name).toLowerCase();
    if (!allowed.includes(ext)) {
      return NextResponse.json({ ok: false, error: `unsupported ext: ${ext}` }, { status: 400 });
    }
    if (!OCR_URL) {
      return NextResponse.json(
        { ok: false, error: "OCR_SERVICE_URL not configured — cannot compress/redact" },
        { status: 500 },
      );
    }

    // 1. Forward to the OCR/redact container
    const fwd = new FormData();
    fwd.append("file", file, file.name);
    let data: any;
    try {
      const ocrRes = await fetch(`${OCR_URL.replace(/\/$/, "")}/process`, {
        method: "POST",
        body: fwd,
      });
      const text = await ocrRes.text();
      try {
        data = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { ok: false, error: `OCR service returned non-JSON (${ocrRes.status})`, detail: text.slice(0, 300) },
          { status: 502 },
        );
      }
      if (!ocrRes.ok || !data?.ok) {
        return NextResponse.json(
          { ok: false, error: data?.error || `OCR service error (${ocrRes.status})` },
          { status: 502 },
        );
      }
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: `cannot reach OCR service: ${e?.message || String(e)}` },
        { status: 502 },
      );
    }

    const jobId = crypto.randomBytes(8).toString("hex");
    const docType: string = data.doc_type || "Unclassified";
    const redactionOk: boolean = data.redaction_ok !== false && Boolean(data.redacted_b64);
    const contentType: string = data.redacted_content_type || "image/jpeg";
    const outExt = contentType === "application/pdf" ? ".pdf" : ".jpg";

    // filename: AI name when confident, else "{original}_redacted.{ext}"
    const aiName: string | null = data.ai_filename || null;
    const safeOriginal = (file.name || "upload").replace(/[^A-Za-z0-9._-]/g, "_");
    const baseName = aiName || safeOriginal.replace(/\.[^.]+$/, "") + "_redacted" + outExt;
    const outName = `${jobId}_${baseName}`;

    // 2. Save the redacted+compressed copy locally for the dashboard to display
    let downloadUrl: string | null = null;
    let redactedBuffer: Buffer | null = null;
    if (redactionOk) {
      redactedBuffer = Buffer.from(data.redacted_b64, "base64");
      const publicDir = path.join(process.cwd(), "public", "_compressed");
      await mkdir(publicDir, { recursive: true });
      await writeFile(path.join(publicDir, outName), redactedBuffer);
      downloadUrl = `/_compressed/${outName}`;
    }

    // 3. DPDP: upload REDACTED copy to Azure unless it's an identity doc
    const localOnly = isLocalOnly(docType);
    let storage: "azure" | "local" | "local-azure-failed" = "local";
    let azureRedactedUrl: string | null = null;
    let manifestUrl: string | null = null;

    if (redactionOk && redactedBuffer && !localOnly && isAzureConfigured()) {
      const manifest = {
        mrn,
        jobId,
        doc_type: docType,
        doc_type_confidence: data.doc_type_confidence,
        fields: data.fields ?? {},
        ai_filename: aiName,
        original_filename: file.name,
        input_size: data.input_size,
        output_size: data.output_size,
        reduction_pct: data.reduction_pct,
        page_count: data.page_count,
        burned_count: data.burned_count,
        redacted_at: new Date().toISOString(),
      };
      try {
        const up = await uploadDocToAzure({
          mrn,
          jobId,
          blobName: baseName,
          redactedBuffer,
          contentType,
          manifest,
        });
        azureRedactedUrl = up.redactedUrl;
        manifestUrl = up.manifestUrl;
        storage = "azure";
      } catch (e) {
        storage = "local-azure-failed";
      }
    }

    return NextResponse.json({
      ok: true,
      original_name: file.name,
      ai_filename: aiName,
      renamed: aiName !== null,
      original_size: data.input_size,
      compressed_size: data.output_size,
      reduction_pct: data.reduction_pct,
      doc_type: docType,
      doc_type_confidence: data.doc_type_confidence,
      doc_type_source: data.doc_type_source,
      page_count: data.page_count,
      fields: data.fields ?? {},
      extracted_text: data.extracted_text ?? "",
      burned_count: data.burned_count ?? 0,
      redaction_ok: redactionOk,
      local_only: localOnly,
      storage,
      download_url: downloadUrl,
      azure_redacted_url: azureRedactedUrl,
      manifest_url: manifestUrl,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
