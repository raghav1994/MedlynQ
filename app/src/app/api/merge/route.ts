// POST /api/merge
// Accepts multiple files in multipart/form-data field "file" (repeated).
// Calls Python merger.py to produce a single PDF.
// Returns JSON with download URL + page count.

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

export const runtime = "nodejs";

const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const MERGER_SCRIPT = path.join(process.cwd(), "python", "merger.py");

function runMerger(output: string, inputs: string[]): Promise<{ ok: boolean; data?: any; error?: string }> {
  return new Promise((resolve) => {
    const args = [MERGER_SCRIPT, output, ...inputs];
    const child = spawn(PYTHON, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("close", () => {
      const last = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
      try {
        const parsed = JSON.parse(last);
        resolve(parsed.ok ? { ok: true, data: parsed } : { ok: false, error: parsed.error || stderr });
      } catch {
        resolve({ ok: false, error: stderr || stdout || "no output" });
      }
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form.getAll("file");
    const valid = files.filter((f): f is File => f instanceof File);
    if (valid.length < 2) {
      return NextResponse.json({ ok: false, error: "need at least 2 files to merge" }, { status: 400 });
    }

    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    for (const f of valid) {
      const ext = path.extname(f.name).toLowerCase();
      if (!allowed.includes(ext)) {
        return NextResponse.json({ ok: false, error: `unsupported ext: ${ext} (${f.name})` }, { status: 400 });
      }
    }

    const jobId = crypto.randomBytes(8).toString("hex");
    const workDir = path.join(os.tmpdir(), "medlynq", "merge_" + jobId);
    await mkdir(workDir, { recursive: true });

    // Stash all inputs
    const inputPaths: string[] = [];
    for (let i = 0; i < valid.length; i++) {
      const f = valid[i];
      const ext = path.extname(f.name).toLowerCase();
      const safeName = `${String(i).padStart(2, "0")}_${f.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
      const p = path.join(workDir, safeName.endsWith(ext) ? safeName : safeName + ext);
      await writeFile(p, Buffer.from(await f.arrayBuffer()));
      inputPaths.push(p);
    }

    const outPath = path.join(workDir, "merged.pdf");

    const res = await runMerger(outPath, inputPaths);
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 500 });
    }

    const publicDir = path.join(process.cwd(), "public", "_merged");
    await mkdir(publicDir, { recursive: true });
    const outName = `${jobId}_merged.pdf`;
    const finalPath = path.join(publicDir, outName);
    await writeFile(finalPath, await readFile(outPath));

    return NextResponse.json({
      ok: true,
      input_count: res.data.input_count,
      page_count: res.data.page_count,
      output_size: res.data.output_size,
      download_url: `/_merged/${outName}`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
