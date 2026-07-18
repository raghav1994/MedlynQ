// POST /api/document/local-ocr  (multipart)
//
// Field: file (single) — JPG/PNG screenshot of already-digital text (e.g. a
// payer-portal query pasted into the Query Board).
//
// Deliberately does NOT go through /api/document/extract's Sarvam pipeline:
// a query screenshot is UI text, not a patient document — there's nothing to
// redact, and no reason to pay for or wait on a cloud round-trip for clean
// computer-rendered text. Runs python/tools/local_text_ocr.py, which calls
// RapidOCR directly and never leaves the machine.
//
// Response: { ok: true, text, method, line_count }
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

const MAX_BYTES = 15 * 1024 * 1024;   // 15 MB — screenshots, not scanned PDFs
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png"]);
const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const SCRIPT = path.join(process.cwd(), "python", "tools", "local_text_ocr.py");
const TMP_DIR = path.join(process.cwd(), "..", "PatientLog", "_tmp_extract");

async function runLocalOcr(filePath: string): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [SCRIPT, filePath], { windowsHide: true });
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

  const rl = rateLimit({ key: `local-ocr:${guard.session.user.id}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "File too large (max 15 MB)" }, { status: 413 });
  }
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ ok: false, error: `Unsupported extension ${ext}` }, { status: 415 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
  await mkdir(TMP_DIR, { recursive: true });
  const tmpPath = path.join(TMP_DIR, `local_${sha}${ext}`);
  await writeFile(tmpPath, buf);

  const result = await runLocalOcr(tmpPath);
  unlink(tmpPath).catch(() => {});

  if (result?.error) {
    return NextResponse.json({ ok: false, error: String(result.error).slice(0, 300) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    text: result.text ?? "",
    method: result.method ?? "unknown",
    line_count: result.line_count ?? 0,
  });
}
