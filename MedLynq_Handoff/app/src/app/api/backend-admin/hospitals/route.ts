// GET  /api/backend-admin/hospitals  — list every hospital (SUPERADMIN only)
// POST /api/backend-admin/hospitals  — create a new hospital tenant

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { listAllTenants, createTenant } from "@/lib/tenant/admin";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  short_name: z.string().trim().min(1).max(40),
  subdomain: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
  state: z.string().trim().max(60).optional(),
  city: z.string().trim().min(1).max(60),
  district: z.string().trim().min(1).max(60),
  primary_color: z.string().trim().max(20).optional(),
  accent_color: z.string().trim().max(20).optional(),
  logo_initial: z.string().trim().max(3).optional(),
  tagline: z.string().trim().max(200).optional(),
});

export async function GET() {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;
  const hospitals = await listAllTenants();
  return NextResponse.json({ ok: true, hospitals });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `backend-admin-create-hospital:${guard.session.user.id}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid hospital details", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const tenant = await createTenant(parsed.data);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "hospital_created",
      hospital_id: tenant.hospital_id,
      detail: { name: tenant.name, subdomain: tenant.subdomain },
    });
    return NextResponse.json({ ok: true, hospital: tenant });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
