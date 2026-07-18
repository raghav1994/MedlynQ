// GET /api/icd10/search?q=diabetes
//
// Live type-ahead for the NHCX review screen's edit form — a MEDCO typing a
// diagnosis word or a partial code gets a short list of real WHO ICD-10
// matches to pick from. Backed entirely by data/icd10_who_full.csv (WHO's
// own catalog, crawled once — see scripts/fetch_who_icd10.mjs), so there's
// no live external call and no risk of surfacing a wrong-country code the
// way the earlier NIH-backed version could.
import { NextRequest, NextResponse } from "next/server";
import { searchWhoIcd10Suggestions } from "@/lib/icd10";
import { requireRole } from "@/lib/auth/guards";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";

  const suggestions = await searchWhoIcd10Suggestions(q);
  return NextResponse.json({ ok: true, suggestions });
}
