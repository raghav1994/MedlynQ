// /api/drug-check?q=trastuzumab
// Or POST { drugs: ["...", "..."] } for batch.

import { NextRequest, NextResponse } from "next/server";
import { matchDrug, matchDrugs } from "@/lib/drugs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ ok: false, error: "missing q" }, { status: 400 });
  const m = await matchDrug(q);
  return NextResponse.json({ ok: true, query: q, match: m });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const drugs: string[] = Array.isArray(body.drugs) ? body.drugs : [];
    if (drugs.length === 0) return NextResponse.json({ ok: false, error: "no drugs" }, { status: 400 });
    const results = await matchDrugs(drugs);
    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
