// /api/thumb?file=Discharge_Summary.pdf
// Returns the pre-rendered page-1 PNG from app/public/_thumbs/{stem}.png
// (built by python/tools/build_thumbs.py). 404s if no thumbnail exists —
// caller falls back to the static PDF glyph.

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file") || "";
  if (!file) return NextResponse.json({ ok: false, error: "missing file" }, { status: 400 });
  const stem = file.replace(/\.[^.]+$/, "");
  // Prevent path traversal
  const safe = path.basename(stem) + ".png";
  const thumbPath = path.join(process.cwd(), "public", "_thumbs", safe);
  try {
    const buf = await readFile(thumbPath);
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
