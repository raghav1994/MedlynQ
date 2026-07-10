// POST /api/zip-batch
// Body: { files: [{ url: "/_compressed/abc.pdf", name: "MRN_doc_type.pdf" }, ...] }
// Returns a single zip stream so the clerk gets one download instead of N.

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import JSZip from "jszip";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const files: Array<{ url: string; name: string }> = body.files ?? [];
    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: "no files" }, { status: 400 });
    }

    const zip = new JSZip();
    const usedNames = new Set<string>();

    for (const f of files) {
      // Only allow files we served from /_compressed
      const url = String(f.url || "");
      if (!url.startsWith("/_compressed/")) continue;
      const safe = path.basename(url);
      const onDisk = path.join(process.cwd(), "public", "_compressed", safe);
      try {
        const buf = await readFile(onDisk);
        let name = (f.name || safe).replace(/[/\\]+/g, "_");
        // dedupe inside zip
        let n = 1;
        const ext = path.extname(name);
        const base = name.slice(0, name.length - ext.length);
        while (usedNames.has(name)) {
          name = `${base}_${++n}${ext}`;
        }
        usedNames.add(name);
        zip.file(name, buf);
      } catch {
        // skip missing
      }
    }

    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return new NextResponse(zipBuf, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="medlynq_batch_${ts}.zip"`,
        "Content-Length": String(zipBuf.length),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
