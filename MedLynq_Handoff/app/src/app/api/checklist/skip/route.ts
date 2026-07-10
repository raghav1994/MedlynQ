// POST /api/checklist/skip  { case_id, doc_type, skip: boolean }
// Toggles a "not needed" override for a missing checklist item. Query-risk %
// recomputes treating the doc as satisfied.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { toggleSkippedDocType } from "@/lib/checklistSkips";

export const runtime = "nodejs";

const Schema = z.object({
  case_id: z.string().min(1).max(100),
  doc_type: z.string().min(1).max(120),
  skip: z.boolean(),
});

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }
  const { case_id, doc_type, skip } = parsed.data;
  const skipped = await toggleSkippedDocType(case_id, doc_type, skip);
  return NextResponse.json({ ok: true, skipped });
}
