import { NextRequest, NextResponse } from "next/server";
import { getActiveSessions, createSession, approveSession, rejectSession, logoutSession, logoutStaffSession } from "@/lib/mobileStaff";
import { getTenant } from "@/lib/tenant/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const tenant = await getTenant();
    const hospitalId = req.nextUrl.searchParams.get("hospital_id") || tenant?.hospital_id;
    if (!hospitalId) {
      return NextResponse.json({ ok: false, error: "hospital_id parameter missing" }, { status: 400 });
    }
    
    const sessions = getActiveSessions(hospitalId);
    return NextResponse.json({ ok: true, sessions });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    
    if (!action) {
      return NextResponse.json({ ok: false, error: "action parameter missing" }, { status: 400 });
    }
    
    if (action === "create") {
      const { staff_id, device_id, login_type } = body;
      if (!staff_id || !device_id || !login_type) {
        return NextResponse.json({ ok: false, error: "missing parameters for action 'create'" }, { status: 400 });
      }
      
      const result = createSession(staff_id, device_id, login_type);
      if (!result) {
        return NextResponse.json({ ok: false, error: "Failed to create session. Staff member profile not found or inactive." }, { status: 401 });
      }
      
      return NextResponse.json({ ok: true, session: result.session, status: result.status });
    }
    
    if (action === "approve") {
      const { staff_id, hospital_id } = body;
      if (!staff_id || !hospital_id) {
        return NextResponse.json({ ok: false, error: "missing parameters for action 'approve'" }, { status: 400 });
      }
      const success = approveSession(staff_id, hospital_id);
      return NextResponse.json({ ok: success });
    }
    
    if (action === "reject") {
      const { staff_id, hospital_id } = body;
      if (!staff_id || !hospital_id) {
        return NextResponse.json({ ok: false, error: "missing parameters for action 'reject'" }, { status: 400 });
      }
      const success = rejectSession(staff_id, hospital_id);
      return NextResponse.json({ ok: success });
    }
    
    if (action === "logout") {
      const { token } = body;
      if (!token) {
        return NextResponse.json({ ok: false, error: "token missing for action 'logout'" }, { status: 400 });
      }
      const success = logoutSession(token);
      return NextResponse.json({ ok: success });
    }
    
    if (action === "logout-staff") {
      const { staff_id, hospital_id } = body;
      if (!staff_id || !hospital_id) {
        return NextResponse.json({ ok: false, error: "missing parameters for action 'logout-staff'" }, { status: 400 });
      }
      const success = logoutStaffSession(staff_id, hospital_id);
      return NextResponse.json({ ok: success });
    }
    
    return NextResponse.json({ ok: false, error: `unknown action '${action}'` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
