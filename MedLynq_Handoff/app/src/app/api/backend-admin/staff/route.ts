// GET  /api/backend-admin/staff  — every internal (SUPERADMIN) login
// POST /api/backend-admin/staff  — create a new internal login
//
// The hospital-scoped .../hospitals/[id]/users route deliberately refuses to
// create SUPERADMIN accounts — this is the only place that's allowed to,
// since internal staff aren't tied to any one hospital.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { listUsersByRole, createUser } from "@/lib/auth/users";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const CreateStaffSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(120),
  designation: z.string().trim().max(120).default(""),
  password: z.string().min(8).max(200),
});

export async function GET() {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;
  const staff = await listUsersByRole("SUPERADMIN");
  return NextResponse.json({ ok: true, staff });
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `backend-admin-create-staff:${guard.session.user.id}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = CreateStaffSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid staff details", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const user = await createUser({
      ...parsed.data,
      role: "SUPERADMIN",
      hospital_id: "MEDLYNQ_HQ",
      hospital_name: "MedLynq HQ",
    });
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "internal_staff_created",
      hospital_id: "MEDLYNQ_HQ",
      detail: { email: user.email, name: user.name },
    });
    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
