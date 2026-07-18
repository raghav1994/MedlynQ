// POST /api/backend-admin/icd10/[code]/restore — un-hide a deleted code,
// bringing back WHO's original wording (or removing it entirely if it was
// a purely admin-added code that's now gone).

import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { restoreIcd10Code, listIcd10Overrides } from "@/lib/icd10Catalog";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `icd10-catalog:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const code = decodeURIComponent(params.code);
  await restoreIcd10Code(code);
  await appendAdminAudit({
    actor_id: guard.session.user.id,
    actor_name: guard.session.user.name,
    action: "icd10_code_restored",
    hospital_id: "MEDLYNQ_HQ",
    detail: { code },
  });

  return NextResponse.json({ ok: true, overrides: await listIcd10Overrides() });
}
