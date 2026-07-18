// GET /api/backend-admin/audit?hospital_id=...  — every backend-admin change

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { readAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;
  const hospital_id = req.nextUrl.searchParams.get("hospital_id") ?? undefined;
  const entries = await readAdminAudit(hospital_id);
  return NextResponse.json({ ok: true, entries: entries.slice(0, 200) });
}
