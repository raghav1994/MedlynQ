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
import { explodeViaWorker, extractPageViaWorker, finishParallelViaWorker } from "@/lib/pythonWorker";
import { patients } from "@/lib/mockData";
import { fulfillMatching } from "@/lib/documentRequests";
import { norm, jaroWinkler } from "@/lib/patientMatch";

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

// The Sushila Gupta / ICU Justification Letter and Mohan Singh / "ms. XYZ"
// incidents were both real documents belonging to a different person than
// the patient record they landed under — a MEDCO has to notice a name buried
// in a checklist tile to catch that, and usually doesn't. This flags it right
// at land time, when the OCR identity is freshest and cheapest to compare.
// Best-effort only: any of these fields can be legitimately missing (visual-
// only docs have no OCR text at all), so absence is never itself a mismatch.
function stripTitle(name: string): string {
  return name.replace(/^\s*(mr|mrs|ms|miss|dr|master)\.?\s+/i, "");
}
function detectIdentityMismatch(
  identity: { patient_name?: string | null; mrn?: string | null } | undefined,
  patient: { name: string; mrn: string },
): { doc_name?: string; doc_mrn?: string; patient_name: string; patient_mrn: string; reason: string } | null {
  if (!identity) return null;
  const docMrn = identity.mrn ? String(identity.mrn).trim() : "";
  if (docMrn && norm(docMrn) !== norm(patient.mrn)) {
    return { doc_mrn: docMrn, doc_name: identity.patient_name ?? undefined, patient_name: patient.name, patient_mrn: patient.mrn, reason: "mrn" };
  }
  const docName = identity.patient_name ? stripTitle(String(identity.patient_name).trim()) : "";
  if (docName) {
    const score = jaroWinkler(norm(docName), norm(stripTitle(patient.name)));
    if (score < 0.75) {
      return { doc_name: docName, patient_name: patient.name, patient_mrn: patient.mrn, reason: "name" };
    }
  }
  return null;
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

// Runs through the persistent worker POOL (pythonWorker.ts) so PaddleOCR's
// model stays loaded across every landed file instead of reloading it each
// time. For a scanned multi-page PDF, explodeViaWorker() stops before OCR
// and hands back per-page image paths instead of processing them serially —
// those get fanned out across every worker in the pool via Promise.all
// (naturally bounded by pool size, since idle jobs just queue), then
// reassembled by finishParallelViaWorker(). Everything else (single page,
// text-PDF, image, visual-only) comes back already finished in one call.
async function runLander(filePath: string, docTypeHint: string, forceDocType?: string, hospitalId?: string): Promise<any> {
  const exploded = await explodeViaWorker(filePath, docTypeHint, forceDocType, hospitalId);
  if (exploded?.error || !exploded?.parallel) return exploded;

  const pagePaths: string[] = exploded.page_paths;
  const pageResults = await Promise.all(pagePaths.map((p) => extractPageViaWorker(p)));
  return finishParallelViaWorker(pageResults, pagePaths, exploded.compressed_path, docTypeHint, forceDocType, hospitalId);
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

  const result = await runLander(tmpPath, docTypeHint, forceDocType, guard.session.user.hospital_id);
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
    // hospital_id — lets the promote-to-regex-rules tool (see
    // python/tools/promote_rules.py) tally which doc types a given
    // hospital's specialty has been classifying via the slower LLM
    // fallback (method: "llm_fallback"), so a human can decide when
    // there's enough real volume to graduate a doc type to a compiled
    // regex rule in content_classifier.py.
    hospital_id: guard.session.user.hospital_id,
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
    // The full extracted text (up to land_document.py's own 12,000-char
    // cap) — from whichever engine actually ran: PyMuPDF's direct text
    // layer for already-text-readable PDFs, or Sarvam OCR for scans/photos.
    // Previously only the short text_snippet above was kept and this was
    // discarded after classification, which meant there was no real text to
    // train anything on later. Absent/empty for visual-only docs (Aadhaar,
    // geotag photos) — there's genuinely no text on those.
    full_text: result.text || undefined,
    // Present only for a combined multi-panel report (e.g. one file that
    // genuinely contains CBC + LFT + KFT) — see checklist.ts's matchDocument,
    // which flips every slot listed here in addition to doc_type's primary one.
    satisfied_labels: Array.isArray(result.satisfied_labels) && result.satisfied_labels.length > 0 ? result.satisfied_labels : undefined,
  };
  await writeFile(path.join(extractedDir, `${finalName}.json`), JSON.stringify(manifest, null, 2));

  const landedPatient = patients.find(
    (p) => p.hospital_id === guard.session.user.hospital_id && safeMrn(p.mrn) === mrnDir
  );
  if (landedPatient && result.doc_type) {
    fulfillMatching(landedPatient.id, String(result.doc_type)).catch(() => {});
  }
  const identity_mismatch = landedPatient ? detectIdentityMismatch(result.identity, landedPatient) : null;

  return NextResponse.json({
    ok: true,
    filename: finalName,
    doc_type: result.doc_type,
    confidence: result.confidence,
    method: result.method,
    redact: result.redact,
    fields: result.fields,
    identity_mismatch,
  });
}
