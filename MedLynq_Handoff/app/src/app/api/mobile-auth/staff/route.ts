import { NextRequest, NextResponse } from "next/server";
import { getStaffList, addStaff, deactivateStaff, registerDevice } from "@/lib/mobileStaff";
import { getTenant } from "@/lib/tenant/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const tenant = await getTenant();
    const hospitalId = req.nextUrl.searchParams.get("hospital_id") || tenant?.hospital_id;
    if (!hospitalId) {
      return NextResponse.json({ ok: false, error: "hospital_id parameter missing" }, { status: 400 });
    }
    
    const staff = getStaffList(hospitalId);
    return NextResponse.json({ ok: true, staff });
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
    
    if (action === "add") {
      const { name, role, dept, pin, hospital_id } = body;
      if (!name || !role || !dept || !pin || !hospital_id) {
        return NextResponse.json({ ok: false, error: "missing parameters for action 'add'" }, { status: 400 });
      }
      const staff = addStaff(name, role, dept, pin, hospital_id);
      return NextResponse.json({ ok: true, staff });
    }
    
    if (action === "deactivate") {
      const { staff_id } = body;
      if (!staff_id) {
        return NextResponse.json({ ok: false, error: "staff_id missing for action 'deactivate'" }, { status: 400 });
      }
      const success = deactivateStaff(staff_id);
      return NextResponse.json({ ok: success });
    }
    
    if (action === "register") {
      const { staff_id, device_id, pin } = body;
      if (!staff_id || !device_id || !pin) {
        return NextResponse.json({ ok: false, error: "missing parameters for action 'register'" }, { status: 400 });
      }
      const staff = registerDevice(staff_id, device_id, pin);
      if (!staff) {
        return NextResponse.json({ ok: false, error: "Invalid PIN or inactive staff profile" }, { status: 401 });
      }
      return NextResponse.json({ ok: true, staff });
    }
    
    return NextResponse.json({ ok: false, error: `unknown action '${action}'` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
