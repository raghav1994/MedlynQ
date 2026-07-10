// POST /api/document/save-direct  (multipart)
//
// Fields: mrn (string), file (single upload), doc_type_hint (label to show)
//
// Saves a file straight into PatientLog/{MRN}/originals/ + a minimal manifest,
// WITHOUT running the OCR/redaction/Sarvam pipeline. For documents that don't
// need (re-)identity-extraction — chiefly a merged bundle of already-landed,
// already-OCR'd files (see DocumentsGrid's merge()). Re-running the full
// pipeline on a merge result was pure waste: the source files were each
// already OCR'd individually, so nothing new is being read for the first
// time, and confirmed to add ~85s of dead wait for no benefit.

import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const THUMB_SCRIPT = path.join(process.cwd(), "python", "tools", "gen_thumb.py");
const THUMBS_DIR = path.join(process.cwd(), "public", "_thumbs");

function generateThumbnail(pdfPath: string, filename: string) {
  const stem = path.basename(filename, path.extname(filename));
  const outPng = path.join(THUMBS_DIR, `${stem}.png`);
  try {
    const child = spawn(PYTHON, [THUMB_SCRIPT, pdfPath, outPng], { windowsHide: true });
    child.on("error", () => {});
  } catch {}
}

function safeMrn(mrn: string): string {
  return mrn.replace(/[^A-Za-z0-9_-]/g, "_");
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `doc-save-direct:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });

  const mrn = String(form.get("mrn") ?? "").trim();
  const docTypeHint = String(form.get("doc_type_hint") ?? "Document");
  const file = form.get("file");
  if (!mrn) return NextResponse.json({ ok: false, error: "mrn required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Missing 'file' field" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "File too large (max 25 MB)" }, { status: 413 });
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ ok: false, error: `Unsupported file type "${ext}" — only PDF, JPG, JPEG, PNG allowed` }, { status: 415 });
  }

  const mrnDir = safeMrn(mrn);
  const originalsDir = path.resolve(process.cwd(), "..", "PatientLog", mrnDir, "originals");
  const extractedDir = path.resolve(process.cwd(), "..", "PatientLog", mrnDir, "extracted");
  await mkdir(originalsDir, { recursive: true });
  await mkdir(extractedDir, { recursive: true });

  const buf = Buffer.from(await file.arrayBuffer());
  const landedPath = path.join(originalsDir, file.name);
  await writeFile(landedPath, buf);
  if (ext === ".pdf") generateThumbnail(landedPath, file.name);

  const manifest = {
    doc_type: docTypeHint,
    confidence: 1.0,
    processed_at: new Date().toISOString(),
    method: "saved_direct_no_ocr",
    skipped_ocr: true,
    fields: {},
    identity: {},
    redact: null,
    source: "Manual",
  };
  await writeFile(path.join(extractedDir, `${file.name}.json`), JSON.stringify(manifest, null, 2));

  return NextResponse.json({ ok: true, filename: file.name, doc_type: docTypeHint });
}
