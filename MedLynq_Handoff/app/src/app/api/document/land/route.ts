// POST /api/document/land  (multipart)
//
// Fields: mrn (string), file (single upload), doc_type_hint (filename-based guess)
//
// This is the step that makes a dropped document actually show up correctly
// on the Patient page: it writes the original bytes to
//   PatientLog/{MRN}/originals/{filename}
// and a manifest to
//   PatientLog/{MRN}/extracted/{filename}.json
// with the shape { doc_type, confidence, processed_at, fields, text }.
//
// docsForCase() / ChecklistValidation / DocumentTile already read this exact
// folder structure — so once this lands, the checklist row flips from
// MISSING (red) to PRESENT (green) with a real thumbnail, automatically.
//
// Runs python/tools/land_document.py which:
//   - skips OCR entirely for visual-only docs (drug pouch, geotag, ID photos)
//   - redacts PII locally before any Sarvam call (DPDP)
//   - classifies doc_type from content (overrides the filename guess when confident)
//   - extracts rich fields (vitals, drug codes, bill total, diagnosis, dates...)

import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, unlink, readFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { landViaWorker } from "@/lib/pythonWorker";

export const runtime = "nodejs";

const TMP_DIR = path.join(process.cwd(), "..", "PatientLog", "_tmp_land");
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const THUMB_SCRIPT = path.join(process.cwd(), "python", "tools", "gen_thumb.py");
const THUMBS_DIR = path.join(process.cwd(), "public", "_thumbs");

// Every DocumentTile card requests /api/thumb for a page-1 preview — without
// this, every real (non-demo-corpus) upload 404s there and shows a broken
// image icon instead of falling back cleanly. Fire-and-forget: a missing
// thumbnail is cosmetic, never worth blocking or failing the upload over.
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

// Picks a preview snippet for the Unsorted tray. A page with a hospital
// letterhead/logo gets a leading sentence from Sarvam like "This image
// contains no text. It is a logo featuring..." BEFORE the real markdown
// content on that same page (verified directly — it's not a separate page,
// just the first paragraph) — technically accurate, but useless for a
// MEDCO trying to tell what the document is. Strip that leading paragraph
// (and any further "no text" logo paragraphs, and empty pages) before
// picking the first 200 chars of whatever real content is left.
const LOGO_PARAGRAPH_RE = /^this image (contains|appears to (contain|have)) no (readable )?text\b.*$/i;
function buildTextSnippet(fullText: string | undefined | null): string | undefined {
  if (!fullText) return undefined;
  const pages = fullText
    .split(/---\s*page\s*\d+\s*---\n?/gi)
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates = pages.length > 0 ? pages : [fullText.trim()];

  for (const page of candidates) {
    const cleaned = page
      .split(/\n{2,}/)
      .filter((para) => !LOGO_PARAGRAPH_RE.test(para.trim()))
      .join("\n\n")
      .trim();
    if (cleaned.length > 20) return cleaned.slice(0, 200);
  }
  // Every page was logo-only (or nothing survived stripping) — better to
  // show something than an empty snippet.
  return candidates[0]?.slice(0, 200) || undefined;
}

// Runs through the persistent worker (pythonWorker.ts) so PaddleOCR's model
// stays loaded across every landed file instead of reloading it each time.
async function runLander(filePath: string, docTypeHint: string, forceDocType?: string): Promise<any> {
  return landViaWorker(filePath, docTypeHint, forceDocType);
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `doc-land:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });

  const mrn = String(form.get("mrn") ?? "").trim();
  const docTypeHint = String(form.get("doc_type_hint") ?? "Unknown Document");
  // "MedCam" is reserved for the future mobile app (auto-captured photos).
  // Everything landed from this desktop upload flow is a manual upload.
  const source = String(form.get("source") ?? "Manual");
  // Set when the MEDCO uploaded straight into a specific checklist slot (the
  // merged Documents & Checklist view) rather than the generic bulk-drop
  // flow — their explicit choice always wins over the content classifier.
  const forceDocTypeRaw = form.get("force_doc_type");
  const forceDocType = forceDocTypeRaw ? String(forceDocTypeRaw) : undefined;
  const file = form.get("file");
  if (!mrn) return NextResponse.json({ ok: false, error: "mrn required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Missing 'file' field" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "File too large (max 25 MB)" }, { status: 413 });
  const uploadExt = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.has(uploadExt)) {
    return NextResponse.json({ ok: false, error: `Unsupported file type "${uploadExt}" — only PDF, JPG, JPEG, PNG allowed` }, { status: 415 });
  }

  const mrnDir = safeMrn(mrn);
  const originalsDir = path.resolve(process.cwd(), "..", "PatientLog", mrnDir, "originals");
  const extractedDir = path.resolve(process.cwd(), "..", "PatientLog", mrnDir, "extracted");
  await mkdir(originalsDir, { recursive: true });
  await mkdir(extractedDir, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });

  const buf = Buffer.from(await file.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
  const ext = path.extname(file.name).toLowerCase();
  const tmpPath = path.join(TMP_DIR, `${sha}${ext}`);
  await writeFile(tmpPath, buf);

  const result = await runLander(tmpPath, docTypeHint, forceDocType);
  unlink(tmpPath).catch(() => {});

  if (result?.error) {
    return NextResponse.json({ ok: false, error: String(result.error).slice(0, 400) }, { status: 500 });
  }

  // Write the COMPRESSED bytes into originals/ (never the redacted-for-Sarvam
  // copy — that stays server-side only). land_document.py compresses every
  // file up front, before OCR or the visual-only skip path, and reports the
  // compressed file's path back to us. Fall back to the raw upload if that
  // ever fails so a compression bug never blocks a document from landing.
  const finalName = file.name;
  let landedBuf = buf;
  if (result.compressed_path) {
    try {
      landedBuf = await readFile(result.compressed_path);
    } catch {
      landedBuf = buf;
    } finally {
      unlink(result.compressed_path).catch(() => {});
    }
  }
  const landedPath = path.join(originalsDir, finalName);
  await writeFile(landedPath, landedBuf);
  if (path.extname(finalName).toLowerCase() === ".pdf") {
    generateThumbnail(landedPath, finalName);
  }

  // Manifest — matches the shape loadDiskDocuments() already parses
  const manifest = {
    doc_type: result.doc_type,
    confidence: result.confidence,
    processed_at: new Date().toISOString(),
    method: result.method,
    skipped_ocr: result.skipped_ocr,
    fields: result.fields,
    identity: result.identity,
    redact: result.redact,
    source,
    // Present only when a MEDCO force-assigned this upload to a specific
    // checklist slot — captures what the classifier would have guessed, so
    // a mismatch is a labeled training signal instead of being discarded.
    content_guess: result.content_guess ?? undefined,
    content_guess_confidence: result.content_guess_confidence ?? undefined,
    // First ~200 chars of OCR/extracted text — shown under Unsorted tray
    // tiles so a MEDCO can often tell what a document is without opening
    // the full file. Visual-only docs (photos, Aadhaar) have no text; that's
    // expected and fine, the thumbnail alone is usually enough for those.
    text_snippet: buildTextSnippet(result.text),
  };
  await writeFile(path.join(extractedDir, `${finalName}.json`), JSON.stringify(manifest, null, 2));

  return NextResponse.json({
    ok: true,
    filename: finalName,
    doc_type: result.doc_type,
    confidence: result.confidence,
    method: result.method,
    redact: result.redact,
    fields: result.fields,
  });
}
