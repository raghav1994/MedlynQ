import { NextRequest, NextResponse } from "next/server";
import { getStaffLogs } from "@/lib/mobileStaff";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const staffId = req.nextUrl.searchParams.get("staff_id");
    if (!staffId) {
      return NextResponse.json({ ok: false, error: "staff_id parameter missing" }, { status: 400 });
    }
    
    const logs = getStaffLogs(staffId);
    return NextResponse.json({ ok: true, logs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
