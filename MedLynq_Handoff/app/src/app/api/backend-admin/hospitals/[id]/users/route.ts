// GET  /api/backend-admin/hospitals/[id]/users  — every login for this hospital
// POST /api/backend-admin/hospitals/[id]/users  — create a new login

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { listUsersForHospital, createUser } from "@/lib/auth/users";
import { listAllTenants } from "@/lib/tenant/admin";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const CreateUserSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(120),
  role: z.enum(["ADMIN", "MEDCO", "CFO", "DOCTOR"]), // SUPERADMIN is never created via this hospital-scoped route
  designation: z.string().trim().max(120).default(""),
  bis_enabled: z.boolean().optional(),
  password: z.string().min(8).max(200),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;
  const users = await listUsersForHospital(params.id);
  return NextResponse.json({ ok: true, users });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `backend-admin-create-user:${guard.session.user.id}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = CreateUserSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid user details", details: parsed.error.flatten() }, { status: 400 });
  }

  const tenants = await listAllTenants();
  const tenant = tenants.find((t) => t.hospital_id === params.id);
  if (!tenant) return NextResponse.json({ ok: false, error: "Hospital not found" }, { status: 404 });

  try {
    const user = await createUser({
      ...parsed.data,
      hospital_id: params.id,
      hospital_name: tenant.name,
    });
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "user_created",
      hospital_id: params.id,
      detail: { email: user.email, role: user.role },
    });
    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
