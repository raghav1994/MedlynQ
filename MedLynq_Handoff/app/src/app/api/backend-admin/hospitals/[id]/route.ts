// GET   /api/backend-admin/hospitals/[id]  — one hospital's full config
// PATCH /api/backend-admin/hospitals/[id]  — branding, schemes, specialties

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, requireOwner } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { listAllTenants, updateTenant } from "@/lib/tenant/admin";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const PatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  short_name: z.string().trim().min(1).max(40).optional(),
  primary_color: z.string().trim().max(20).optional(),
  accent_color: z.string().trim().max(20).optional(),
  logo_initial: z.string().trim().max(3).optional(),
  tagline: z.string().trim().max(200).optional(),
  state: z.string().trim().max(60).optional(),
  city: z.string().trim().max(60).optional(),
  district: z.string().trim().max(60).optional(),
  npi: z.string().trim().max(40).optional(),
  schemes_enabled: z.array(z.string()).optional(),
  specialties_enabled: z.array(z.string()).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  vocabulary: z.record(z.string(), z.string()).optional(),
  his_webhook_secret: z.string().trim().min(16).max(200).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;
  const all = await listAllTenants();
  const hospital = all.find((h) => h.hospital_id === params.id);
  if (!hospital) return NextResponse.json({ ok: false, error: "Hospital not found" }, { status: 404 });
  // Non-owner staff can see and edit everything else about a hospital, but
  // not this credential — mirror the owner-only write gate below on read too.
  if (!guard.session.user.is_owner) {
    const { his_webhook_secret, ...rest } = hospital;
    return NextResponse.json({ ok: true, hospital: { ...rest, his_webhook_secret: his_webhook_secret ? "••••••••" : undefined } });
  }
  return NextResponse.json({ ok: true, hospital });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const raw = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid patch", details: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ ok: false, error: "No editable fields provided" }, { status: 400 });
  }

  // his_webhook_secret is a credential (authenticates a hospital's HIS
  // integration) — hold it to the same owner-only bar as every other secret
  // in Backend Admin, even though the rest of this route is open to any
  // internal SUPERADMIN.
  const guard = "his_webhook_secret" in parsed.data ? await requireOwner() : await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `backend-admin-edit-hospital:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  try {
    const updated = await updateTenant(params.id, parsed.data);
    // Never write the plaintext secret into the audit log, which any
    // SUPERADMIN can read via the Audit log tab — just note that it rotated.
    const { his_webhook_secret, ...auditablePatch } = parsed.data;
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "hospital_updated",
      hospital_id: params.id,
      detail: { patch: his_webhook_secret ? { ...auditablePatch, his_webhook_secret: "(rotated)" } : auditablePatch },
    });
    return NextResponse.json({ ok: true, hospital: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
