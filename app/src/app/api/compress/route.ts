// POST /api/compress
// Uploads file → Python extractor.py compresses + extracts text + classifies doc type
// + generates a clean ai_filename when confident.
// Returns JSON with stats + extracted fields + doc_type + ai_filename + a download URL
// that uses the ai_filename when available.

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

export const runtime = "nodejs";

const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const EXTRACTOR_SCRIPT = path.join(process.cwd(), "python", "extractor.py");

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

function runPython(input: string, output: string): Promise<Extracted> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [EXTRACTOR_SCRIPT, input, output], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("close", () => {
      const last = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      try {
        resolve(JSON.parse(last));
      } catch {
        resolve({ ok: false, error: stderr || stdout || "no output" });
      }
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "missing 'file' field" }, { status: 400 });
    }

    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = path.extname(file.name).toLowerCase();
    if (!allowed.includes(ext)) {
      return NextResponse.json({ ok: false, error: `unsupported ext: ${ext}` }, { status: 400 });
    }

    const jobId = crypto.randomBytes(8).toString("hex");
    const workDir = path.join(os.tmpdir(), "medlynq", jobId);
    await mkdir(workDir, { recursive: true });

    const inPath = path.join(workDir, file.name);
    const outPath = path.join(workDir, "out" + ext);

    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(inPath, bytes);

    const res = await runPython(inPath, outPath);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
    }

    const publicDir = path.join(process.cwd(), "public", "_compressed");
    await mkdir(publicDir, { recursive: true });

    // Decide download filename: ai_filename if confident, else "{original}_compressed.{ext}"
    const safeOriginal = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
    const aiName = res.ai_filename || null;
    const downloadName = aiName
      ? aiName
      : safeOriginal.replace(ext, "_compressed" + ext);
    const outName = `${jobId}_${downloadName}`;
    const finalPath = path.join(publicDir, outName);
    await writeFile(finalPath, await readFile(outPath));

    return NextResponse.json({
      ok: true,
      original_name: file.name,
      ai_filename: aiName,
      original_size: res.input_size,
      compressed_size: res.output_size,
      reduction_pct: res.reduction_pct,
      doc_type: res.doc_type,
      doc_type_confidence: res.doc_type_confidence,
      doc_type_source: res.doc_type_source,
      page_count: res.page_count,
      fields: res.fields ?? {},
      extracted_text: res.extracted_text ?? "",
      download_url: `/_compressed/${outName}`,
      renamed: aiName !== null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
