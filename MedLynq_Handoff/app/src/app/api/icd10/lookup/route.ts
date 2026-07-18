// GET /api/icd10/lookup?code=C61
//
// Reverse lookup for the "🔍 auto-fill description" button on the NHCX
// review screen's edit form — a staff member who already knows the code
// (e.g. copying it off a discharge summary) shouldn't have to also type the
// official description by hand. CSV-first (free, instant), Sarvam as a
// last resort when the code isn't in the curated table yet.
import { NextRequest, NextResponse } from "next/server";
import { lookupDisplayForCode } from "@/lib/icd10";
import { requireRole } from "@/lib/auth/guards";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ ok: false, error: "code required" }, { status: 400 });
  }

  const display = await lookupDisplayForCode(code);
  return NextResponse.json({ ok: true, display });
}
