// POST /api/prescription-decode
// Body: { text: "raw OCR text" }
// Returns the structured DoctorsPlan with drugs hydrated against drug_master.csv
// and package codes hydrated against package_master.csv.

import { NextRequest, NextResponse } from "next/server";
import { decodePrescription } from "@/lib/prescription";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = String(body.text ?? "");
    if (!text) return NextResponse.json({ ok: false, error: "missing text" }, { status: 400 });
    const plan = await decodePrescription(text);
    return NextResponse.json({ ok: true, plan });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
