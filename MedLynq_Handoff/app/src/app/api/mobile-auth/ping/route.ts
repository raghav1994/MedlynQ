import { NextRequest, NextResponse } from "next/server";
import { pingSession } from "@/lib/mobileStaff";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token } = body;
    
    if (!token) {
      return NextResponse.json({ ok: false, error: "token parameter missing" }, { status: 400 });
    }
    
    const result = pingSession(token);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
