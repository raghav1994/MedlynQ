// GET /api/compressed?name=<file>
// Serves a redacted+compressed file from public/_compressed. Used instead of a
// direct /_compressed/<file> static URL because Next's production static handler
// does not reliably serve files written to public/ at runtime.

import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const name = new URL(req.url).searchParams.get("name");
  // Reject path traversal / nested paths — only a bare filename is allowed.
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return new Response("bad name", { status: 400 });
  }

  const filePath = path.join(process.cwd(), "public", "_compressed", name);
  if (!fs.existsSync(filePath)) {
    return new Response("not found", { status: 404 });
  }

  const ext = path.extname(name).toLowerCase();
  const contentType =
    ext === ".pdf" ? "application/pdf" :
    ext === ".png" ? "image/png" :
    "image/jpeg";

  return new Response(fs.readFileSync(filePath), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
