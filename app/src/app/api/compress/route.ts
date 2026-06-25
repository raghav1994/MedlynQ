// POST /api/compress
// Uploads file → extractor.py (compress + classify) → redact.py (PII burn) → Azure Blob.
// LOCAL_ONLY doc types (Aadhaar, PAN, etc.) skip Azure entirely and are served from local /public.
// Accepts optional `mrn` form field for correct Blob path organisation.

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import {
  isAzureConfigured,
  isLocalOnly,
  uploadDocToAzure,
} from "@/lib/azure-blob";

export const runtime = "nodejs";

const PYTHON           = process.env.MEDLYNQ_PYTHON   || "python3";
const EXTRACTOR_SCRIPT = path.join(process.cwd(), "python", "extractor.py");
const REDACT_SCRIPT    = path.join(process.cwd(), "python", "redact.py");

// ─── python helpers ───────────────────────────────────────────────────────────

type Extracted = {
  ok: boolean;
  input_size?: number;
  output_size?: number;
  reduction_pct?: number;
  page_count?: number;
  extracted_text?: string;
  fields?: Record<string, string>;
  doc_type?: string;
  doc_type_confidence?: number;
  doc_type_source?: string;
  original_filename?: string;
  ai_filename?: string | null;
  error?: string;
};

type Redacted = {
  ok?: boolean;
  burned_count?: number;
  boxes?: unknown[];
  error?: string;
};

function spawnPython<T>(args: string[]): Promise<T> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error",  (err) => resolve({ ok: false, error: err.message } as T));
    child.on("close",  ()    => {
      const last = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      try { resolve(JSON.parse(last)); }
      catch { resolve({ ok: false, error: stderr || stdout || "no output" } as T); }
    });
  });
}

// ─── content type helper ──────────────────────────────────────────────────────

function contentType(ext: string): string {
  return { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" }[ext]
    ?? "application/octet-stream";
}

// ─── route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "missing 'file' field" }, { status: 400 });
    }

    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext     = path.extname(file.name).toLowerCase();
    if (!allowed.includes(ext)) {
      return NextResponse.json({ ok: false, error: `unsupported ext: ${ext}` }, { status: 400 });
    }

    // Optional MRN — used for Azure Blob path organisation
    const mrn   = (form.get("mrn") as string | null)?.trim() || "UNKNOWN";
    const jobId = crypto.randomBytes(8).toString("hex");

    const workDir = path.join(os.tmpdir(), "medlynq", jobId);
    await mkdir(workDir, { recursive: true });

    const inPath       = path.join(workDir, file.name);
    const compressedPath = path.join(workDir, "compressed" + ext);
    const redactedPath = path.join(workDir, "redacted" + ext);

    await writeFile(inPath, Buffer.from(await file.arrayBuffer()));

    // Step 1 — Extract + classify + compress
    const res = await spawnPython<Extracted>([EXTRACTOR_SCRIPT, inPath, compressedPath]);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
    }

    const docType    = res.doc_type ?? "unknown";
    const safeOrigin = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
    const aiName     = res.ai_filename || null;
    const downloadName = aiName ?? safeOrigin.replace(ext, "_compressed" + ext);

    // Step 2 — Route: LOCAL_ONLY → local disk only. Everything else → redact → Azure.
    const localOnly = isLocalOnly(docType);
    const useAzure  = !localOnly && isAzureConfigured();

    let downloadUrl:  string;
    let manifestUrl:  string | null = null;
    let burnLog:      Redacted | null = null;

    if (useAzure) {
      // 2a — Burn PII before leaving the machine
      burnLog = await spawnPython<Redacted>([REDACT_SCRIPT, compressedPath, redactedPath]);

      const uploadBuffer = await readFile(
        burnLog?.ok !== false ? redactedPath : compressedPath, // fallback if redact errored
      );

      const manifest = {
        mrn,
        job_id:       jobId,
        doc_type:     docType,
        ai_filename:  aiName,
        confidence:   res.doc_type_confidence,
        fields:       res.fields ?? {},
        burn_log:     burnLog,
        uploaded_at:  new Date().toISOString(),
      };

      const urls = await uploadDocToAzure({
        mrn,
        jobId,
        blobName:       downloadName,
        redactedBuffer: uploadBuffer,
        contentType:    contentType(ext),
        manifest,
      });

      downloadUrl = urls.redactedUrl;
      manifestUrl = urls.manifestUrl;
    } else {
      // 2b — LOCAL_ONLY or Azure not configured: serve from /public/_compressed
      const publicDir = path.join(process.cwd(), "public", "_compressed");
      await mkdir(publicDir, { recursive: true });
      const outName = `${jobId}_${downloadName}`;
      await writeFile(path.join(publicDir, outName), await readFile(compressedPath));
      downloadUrl = `/_compressed/${outName}`;
    }

    return NextResponse.json({
      ok:                   true,
      original_name:        file.name,
      ai_filename:          aiName,
      original_size:        res.input_size,
      compressed_size:      res.output_size,
      reduction_pct:        res.reduction_pct,
      doc_type:             docType,
      doc_type_confidence:  res.doc_type_confidence,
      doc_type_source:      res.doc_type_source,
      page_count:           res.page_count,
      fields:               res.fields ?? {},
      extracted_text:       res.extracted_text ?? "",
      download_url:         downloadUrl,
      manifest_url:         manifestUrl,
      storage:              useAzure ? "azure" : "local",
      local_only:           localOnly,
      renamed:              aiName !== null,
      burn_log:             burnLog ?? undefined,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
