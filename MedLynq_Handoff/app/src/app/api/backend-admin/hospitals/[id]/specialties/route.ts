// POST   /api/backend-admin/hospitals/[id]/specialties  { name }              — add a department
// PATCH  /api/backend-admin/hospitals/[id]/specialties  { old_slug, new_name } — rename (cascades to document_profiles)
// DELETE /api/backend-admin/hospitals/[id]/specialties?slug=...              — delete (cascades to document_profiles)

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { addSpecialty, renameSpecialty, deleteSpecialty } from "@/lib/tenant/admin";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `backend-admin-specialty:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Department name required" }, { status: 400 });
  }

  try {
    const updated = await addSpecialty(params.id, parsed.data.name);
    await appendAdminAudit({
      actor_id: guard.session.user.id, actor_name: guard.session.user.name,
      action: "department_added", hospital_id: params.id, detail: { name: parsed.data.name },
    });
    return NextResponse.json({ ok: true, hospital: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `backend-admin-specialty:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = z.object({
    old_slug: z.string().trim().min(1).max(60),
    new_name: z.string().trim().min(1).max(60),
  }).safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "old_slug and new_name required" }, { status: 400 });
  }

  try {
    const updated = await renameSpecialty(params.id, parsed.data.old_slug, parsed.data.new_name);
    await appendAdminAudit({
      actor_id: guard.session.user.id, actor_name: guard.session.user.name,
      action: "department_renamed", hospital_id: params.id, detail: parsed.data,
    });
    return NextResponse.json({ ok: true, hospital: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ ok: false, error: "slug query param required" }, { status: 400 });
  }

  try {
    const updated = await deleteSpecialty(params.id, slug);
    await appendAdminAudit({
      actor_id: guard.session.user.id, actor_name: guard.session.user.name,
      action: "department_deleted", hospital_id: params.id, detail: { slug },
    });
    return NextResponse.json({ ok: true, hospital: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
