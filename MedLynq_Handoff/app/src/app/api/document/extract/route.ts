// POST /api/document/extract  (multipart)
//
// Field: file (single) — PDF/JPG/PNG.
// Runs python/tools/extract_hints.py which returns {text, hints, method}.
//
// Response: { ok: true, filename, method, hints, text_snippet, cached }
//
// Errors: 400 for missing file, 413 too large, 415 unsupported type,
//         500 for extractor failure.

import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, unlink } from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import crypto from "crypto";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;   // 25 MB
const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const SCRIPT = path.join(process.cwd(), "python", "tools", "extract_hints.py");
const TMP_DIR = path.join(process.cwd(), "..", "PatientLog", "_tmp_extract");

async function runExtractor(filePath: string): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [SCRIPT, filePath, "--kind", "auto"], { windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ error: err.message }));
    child.on("close", () => {
      const last = stdout.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? stdout;
      try {
        resolve(JSON.parse(last));
      } catch {
        resolve({ error: stderr || stdout || "no output" });
      }
    });
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `doc-extract:${guard.session.user.id}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "File too large (max 25 MB)" }, { status: 413 });
  }
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ ok: false, error: `Unsupported extension ${ext}` }, { status: 415 });
  }

  // Save to a temp path (SHA-named so re-uploads hit cache path in the Python side)
  const buf = Buffer.from(await file.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  await mkdir(TMP_DIR, { recursive: true });
  const tmpPath = path.join(TMP_DIR, `${sha}${ext}`);
  await writeFile(tmpPath, buf);

  const result = await runExtractor(tmpPath);

  // Best-effort cleanup (Sarvam-cached results still persist their own SHA cache)
  unlink(tmpPath).catch(() => {});

  if (result?.error) {
    return NextResponse.json({ ok: false, error: String(result.error).slice(0, 300) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    filename: file.name,
    method: result.method ?? "unknown",
    cached: !!result.cached,
    hints: result.hints ?? {},
    text_snippet: (result.text ?? "").slice(0, 400),
    redact: result.redact ?? undefined,  // { burned_count, reasons, redacted_path }
  });
}
