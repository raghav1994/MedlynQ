// GET  /api/backend-admin/icd10?q=...  — search the merged WHO+overrides
//      catalog (for finding a code to edit/delete) + always returns the
//      full "Your changes" override list.
// POST /api/backend-admin/icd10        — add a new code or edit an existing
//      one's description (also un-deletes it if it was hidden).
//
// Owner-only, same lock as the Document Catalog — these codes feed every
// hospital's NHCX submissions, not just one tenant's.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { searchWhoIcd10Suggestions, findBaseWhoCode } from "@/lib/icd10";
import { listIcd10Overrides, upsertIcd10Code } from "@/lib/icd10Catalog";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const UpsertSchema = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9.\-]+$/, "Letters, numbers, dots, hyphens only"),
  display: z.string().trim().min(2).max(300),
});

export async function GET(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";

  const [search, overrides] = await Promise.all([
    q.trim().length >= 2 ? searchWhoIcd10Suggestions(q, 15) : Promise.resolve([]),
    listIcd10Overrides(),
  ]);

  return NextResponse.json({ ok: true, search, overrides });
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `icd10-catalog:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = UpsertSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid code entry", details: parsed.error.flatten() }, { status: 400 });
  }

  const { code, display } = parsed.data;
  const base = await findBaseWhoCode(code);
  await upsertIcd10Code(code, display);
  await appendAdminAudit({
    actor_id: guard.session.user.id,
    actor_name: guard.session.user.name,
    action: base ? "icd10_code_edited" : "icd10_code_added",
    hospital_id: "MEDLYNQ_HQ",
    detail: { code, display },
  });

  return NextResponse.json({ ok: true, overrides: await listIcd10Overrides() });
}
