// POST /api/admin/purge
// Body: { apply?: boolean, days?: number }
// Triggers python/tools/purge_redacted.py and returns its JSON summary.

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { requireRole } from "@/lib/auth/guards";

export const runtime = "nodejs";

const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const SCRIPT = path.join(process.cwd(), "python", "tools", "purge_redacted.py");

function runPurge(apply: boolean, days: number): Promise<{ ok: boolean; summary?: any; error?: string }> {
  return new Promise((resolve) => {
    const args = [SCRIPT, "--days", String(days)];
    if (apply) args.push("--apply");
    const child = spawn(PYTHON, args, { windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("close", () => {
      try {
        const last = stdout.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? stdout;
        const json = JSON.parse(last);
        resolve({ ok: true, summary: json });
      } catch {
        resolve({ ok: false, error: stderr || stdout || "no output" });
      }
    });
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;
  try {
    const body = await req.json().catch(() => ({}));
    const apply = Boolean(body.apply);
    const days = Number(body.days ?? process.env.MEDLYNQ_REDACTED_RETENTION_DAYS ?? 30);
    const result = await runPurge(apply, days);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true, ...result.summary });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
