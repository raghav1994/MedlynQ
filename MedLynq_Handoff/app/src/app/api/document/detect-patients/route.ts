// POST /api/document/detect-patients  (multipart, files: file[])
//
// Given N dropped files:
//   - Text-readable PDFs → identity extracted locally via PyMuPDF (free, instant)
//   - Scanned PDFs / photos (NOT visual-only doc types) → identity extracted via
//     the SAME redact→Sarvam→SHA-cache pipeline used at commit time
//     (python/tools/land_document.py). This costs Sarvam credits per file, but
//     the result is cached — the later commit-time /land call for the SAME file
//     hits the cache and re-processes for free. No double-billing.
//   - Visual-only doc types (Aadhaar, scheme card, drug pouch, geotag/discharge
//     photos) → NEVER sent to Sarvam, at detect time or commit time.
//
// Group by identity (MRN preferred, else fuzzy name) and return:
//   { ok, groups: [{ identity, files: [{ filename, doc_type, hints }] }],
//     unassigned: [{ filename, doc_type, hints, needs_ocr }] }
//
// The UI shows this in a "N patients detected" popup. On user confirm, the
// second call runs the full pipeline (compress + route-apply + land), reusing
// the Sarvam cache primed here.

import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, unlink } from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import crypto from "crypto";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { landViaWorker } from "@/lib/pythonWorker";
import { classifyByFilename } from "@/lib/classifyByFilename";

export const runtime = "nodejs";

const MAX_FILES = 40;
const MAX_BYTES_PER_FILE = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const EXTRACT_SCRIPT = path.join(process.cwd(), "python", "tools", "extract_hints.py");
const TMP_DIR = path.join(process.cwd(), "..", "PatientLog", "_tmp_extract");

// Free, local, text-PDF-only pass (PyMuPDF). No Sarvam. This one stays a
// one-shot spawn — it never touches PaddleOCR, so there's no model to keep
// warm and no benefit from the persistent worker.
async function runExtractor(filePath: string): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [EXTRACT_SCRIPT, filePath, "--kind", "pdf"], { windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ error: err.message }));
    child.on("close", () => {
      const last = stdout.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? stdout;
      try { resolve(JSON.parse(last)); } catch { resolve({ error: stderr || stdout || "no output" }); }
    });
  });
}

// Full redact→Sarvam→cache pass (costs Sarvam credits, result is SHA-cached
// so the commit-time /land call for this exact file is free). Runs through
// the persistent worker (pythonWorker.ts) so PaddleOCR's model stays loaded
// across every file in the batch instead of reloading it each time.
async function runLander(filePath: string, docTypeHint: string): Promise<any> {
  return landViaWorker(filePath, docTypeHint);
}

// Visual-only doc types — MEDCO verifies these by eye. Never sent to Sarvam,
// which also means no Sarvam cost and no possibility of a PII leak via OCR.
// Mirrors python/cost_gate.py SKIP_DOC_TYPES.
const SKIP_OCR_DOC_TYPES = new Set([
  "Drug Pouch",
  "Discharge Photo",
  "Aadhaar",
  "Insurance / Scheme Card",
]);

type FileInfo = { filename: string; doc_type: string; hints: Record<string, any>; needs_ocr: boolean; ext: string; visual_only?: boolean; sarvam_done?: boolean; preview?: string };

function snippet(text?: string): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.length > 160 ? cleaned.slice(0, 160) + "…" : cleaned;
}

/** Group files by strongest identity signal. MRN wins; else fuzzy name. */
function groupByIdentity(files: FileInfo[]): {
  groups: Array<{ identity: any; files: FileInfo[] }>;
  unassigned: FileInfo[];
} {
  const groups: Array<{ identity: any; files: FileInfo[] }> = [];
  const unassigned: FileInfo[] = [];

  // Strip courtesy titles before comparing — Sarvam sometimes includes them
  // ("Mr. ARSHAD") and sometimes doesn't ("ARSHAD") depending on the exact
  // document layout, even for the same real person.
  function normalizeName(n?: string): string {
    return (n ?? "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/^(mr|mrs|ms|miss|dr|master|m\/s|baby of|b\/o)\.?\s+/, "")
      .replace(/\s+/g, " ");
  }
  // OCR occasionally drops leading digits off an MRN (e.g. "300157738" read
  // back as "157738"). Treat one as a match for the other if one is a
  // suffix of the other AND the shared suffix is long enough that a
  // coincidental collision with a different patient is very unlikely.
  function mrnMatches(a: string, b: string): boolean {
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    return shorter.length >= 6 && longer.endsWith(shorter);
  }
  function levenshtein(a: string, b: string): number {
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[b.length];
  }
  // Catches OCR misreads of the same real name ("ARSHAD" vs "ARSAD" — one
  // dropped letter). Only allowed when the lengths are close, so this can't
  // accidentally merge two genuinely different people who happen to share a
  // similar-length name.
  function namesLikelyMatch(a: string, b: string): boolean {
    if (a === b) return true;
    if (!a || !b || Math.abs(a.length - b.length) > 2) return false;
    const dist = levenshtein(a, b);
    return dist <= 1 || (dist <= 2 && Math.min(a.length, b.length) >= 8);
  }
  function findGroup(f: FileInfo): number {
    const mrn = f.hints.mrn as string | undefined;
    const name = normalizeName(f.hints.name);
    if (mrn) {
      const idx = groups.findIndex((g) => g.identity.mrn && mrnMatches(g.identity.mrn, mrn));
      if (idx >= 0) return idx;
    }
    // Name match is the fallback even when MRNs disagree — same real patient
    // showing up with two different department/lab MRN formats in one batch
    // is common (confirmed on a real case: one hospital UHID + a separate
    // diagnostic lab's own UHID for the same "Poonam"). There's no way to
    // tell that apart from two different people sharing a name using text
    // alone — no DOB or phone is reliably printed on these documents. So
    // merge by name, but flag the MRN conflict (see below) instead of
    // silently guessing either way.
    if (name) {
      const idx = groups.findIndex((g) => namesLikelyMatch(normalizeName(g.identity.name), name));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  for (const f of files) {
    const hasIdentity = f.hints.mrn || f.hints.name;
    if (!hasIdentity) {
      unassigned.push(f);
      continue;
    }
    const idx = findGroup(f);
    if (idx >= 0) {
      groups[idx].files.push(f);
      const g = groups[idx].identity;
      for (const k of ["name", "age", "gender"]) {
        if (!g[k] && f.hints[k]) g[k] = f.hints[k];
      }
      // MRN merge: never silently overwrite a clean MRN with a noisier one
      // just because it's a longer string — a lab report's own internal
      // reference suffix ("100096731 (25/69)") is not "more complete", it's
      // noise. Only replace when the new value is a genuine superset per
      // mrnMatches() (the "OCR dropped leading digits" case). When the two
      // MRNs plainly disagree, keep the first one as primary and record the
      // conflict so the MEDCO can see it and split the group if it's
      // actually two different patients — instead of us picking silently.
      if (f.hints.mrn && !g.mrn) {
        g.mrn = f.hints.mrn;
      } else if (f.hints.mrn && g.mrn && String(f.hints.mrn) !== String(g.mrn)) {
        if (mrnMatches(String(g.mrn), String(f.hints.mrn)) && String(f.hints.mrn).length > String(g.mrn).length) {
          g.mrn = f.hints.mrn;
        } else if (!mrnMatches(String(g.mrn), String(f.hints.mrn))) {
          g.mrnConflict = true;
          if (!g.altMrn && String(f.hints.mrn) !== String(g.altMrn)) g.altMrn = f.hints.mrn;
        }
      }
    } else {
      groups.push({ identity: { ...f.hints }, files: [f] });
    }
  }
  return { groups, unassigned };
}

// How many files to read at once. Each one is dispatched to the persistent
// worker POOL (pythonWorker.ts), not a fresh cold-spawned process — so this
// should match MEDLYNQ_WORKER_POOL_SIZE (default 3) to actually use every
// warm worker. Sending more files than there are workers just queues the
// extras; sending fewer never fully uses the pool. The old value of 2 here
// was a leftover from the pre-pool architecture, where each concurrent slot
// cold-loaded its own PaddleOCR model and higher concurrency risked crashes.
const CONCURRENCY = Number(process.env.MEDLYNQ_WORKER_POOL_SIZE) || 3;

async function processFile(file: File): Promise<FileInfo> {
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return { filename: file.name, doc_type: "Unsupported", hints: {}, needs_ocr: false, ext };
  }
  if (file.size > MAX_BYTES_PER_FILE) {
    return { filename: file.name, doc_type: "Too large", hints: {}, needs_ocr: false, ext };
  }
  const doc_type = classifyByFilename(file.name);
  const isVisualOnly = SKIP_OCR_DOC_TYPES.has(doc_type);

  // Visual-only docs (drug pouch, geotag, Aadhaar/scheme card photos) NEVER
  // go to Sarvam — at detect time or commit time. MEDCO verifies by eye.
  if (isVisualOnly) {
    return { filename: file.name, doc_type, hints: {}, needs_ocr: false, ext, visual_only: true };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  const tmp = path.join(TMP_DIR, `${sha}${ext}`);
  await writeFile(tmp, buf);

  if (ext === ".pdf") {
    // Try free local text extraction first.
    const extract = await runExtractor(tmp);
    if (!extract.error && extract.hints && Object.keys(extract.hints).length > 0) {
      unlink(tmp).catch(() => {});
      return { filename: file.name, doc_type, hints: extract.hints, needs_ocr: false, ext, preview: snippet(extract.text) };
    }
    // No text layer → scanned PDF. Fall through to the Sarvam pre-pass below.
  }

  // Sarvam pre-pass — redact locally, then OCR, then cache (SP1). This is
  // the ONLY place the pre-pass spends money; the commit-time /land call
  // for this same file hits the cache and costs nothing.
  let landed = await runLander(tmp, doc_type);
  if (landed.compressed_path) unlink(landed.compressed_path).catch(() => {});
  // A crashed/killed subprocess (e.g. several PaddleOCR loads exhausting
  // memory under concurrent load) shows up as a JSON-parse failure, not a
  // clean {error: "..."} — retry a couple times, since re-running the exact
  // same file standalone (no concurrent load) always succeeds, confirming
  // this is transient contention, not a problem with the file itself.
  for (let attempt = 0; attempt < 2 && landed.error && !landed.identity; attempt++) {
    const retry = await runLander(tmp, doc_type);
    if (retry.compressed_path) unlink(retry.compressed_path).catch(() => {});
    if (!retry.error) { landed = retry; break; }
    landed = retry;
  }
  unlink(tmp).catch(() => {});
  if (landed.error && !landed.identity) {
    // Log the real failure reason server-side (never surfaced to the browser
    // popup, which just shows a generic "will run Sarvam OCR on commit") so
    // repeat failures are diagnosable instead of guessed at.
    console.error(`[detect-patients] ${file.name} failed after retries:`, String(landed.error).slice(0, 2000));
  }
  if (landed.skipped_ocr) {
    // Content-detected visual-only (face-filled photo or an Aadhaar number
    // found in the image itself) — never went to Sarvam, regardless of
    // what the file was named.
    return { filename: file.name, doc_type: landed.doc_type ?? doc_type, hints: {}, needs_ocr: false, ext, visual_only: true };
  }
  if (landed.error || !landed.identity) {
    return { filename: file.name, doc_type, hints: {}, needs_ocr: true, ext, preview: snippet(landed.text) };
  }
  const hints: Record<string, any> = {};
  if (landed.identity.mrn) hints.mrn = landed.identity.mrn;
  if (landed.identity.patient_name) hints.name = landed.identity.patient_name;
  if (landed.identity.age) hints.age = landed.identity.age;
  if (landed.identity.gender) hints.gender = landed.identity.gender;
  const gotIdentity = Object.keys(hints).length > 0;
  return {
    filename: file.name,
    doc_type: landed.doc_type ?? doc_type,   // content classifier may refine this
    hints,
    needs_ocr: !gotIdentity,
    ext,
    sarvam_done: true,
    preview: snippet(landed.text),
  };
}

// Runs `files` through `worker` with at most `limit` in flight at once,
// calling `onDone` every time one finishes (regardless of order) so the
// caller can stream a live "N of total" count back to the browser.
async function runPool(
  files: File[],
  limit: number,
  onDone: (done: number, total: number, filename: string) => void
): Promise<FileInfo[]> {
  const results: FileInfo[] = new Array(files.length);
  let nextIndex = 0;
  let doneCount = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= files.length) return;
      results[i] = await processFile(files[i]);
      doneCount++;
      onDone(doneCount, files.length, files[i].name);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));
  return results;
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `doc-detect:${guard.session.user.id}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });

  const filesRaw = form.getAll("file").filter((x): x is File => x instanceof File);
  if (filesRaw.length === 0) {
    return NextResponse.json({ ok: false, error: "Attach at least one 'file'" }, { status: 400 });
  }
  if (filesRaw.length > MAX_FILES) {
    return NextResponse.json({ ok: false, error: `Too many files (max ${MAX_FILES})` }, { status: 400 });
  }

  await mkdir(TMP_DIR, { recursive: true });

  // Stream newline-delimited JSON: a "progress" line after every file
  // finishes, then one final "result" line with the full detection payload.
  // Lets the browser show "Reading document 4 of 10…" instead of a frozen
  // spinner, without waiting for the whole batch to complete.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (obj: any) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const results = await runPool(filesRaw, CONCURRENCY, (done, total) => {
          enqueue({ type: "progress", done, total });
        });

        const { groups, unassigned } = groupByIdentity(results);
        enqueue({
          type: "result",
          ok: true,
          total_files: results.length,
          detected_patient_count: groups.length,
          groups,
          unassigned,
          stats: {
            pdfs_with_identity: results.filter((r) => r.ext === ".pdf" && !r.needs_ocr && !r.sarvam_done).length,
            pdfs_needing_ocr: results.filter((r) => r.ext === ".pdf" && r.needs_ocr).length,
            images_needing_ocr: results.filter((r) => r.ext !== ".pdf" && r.needs_ocr).length,
            visual_only_skipped: results.filter((r) => r.visual_only).length,
            sarvam_processed_now: results.filter((r) => r.sarvam_done).length,
          },
        });
      } catch (e: any) {
        enqueue({ type: "result", ok: false, error: e?.message ?? "Detection failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
