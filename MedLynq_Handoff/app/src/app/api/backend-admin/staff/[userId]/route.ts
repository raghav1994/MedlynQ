// PATCH /api/backend-admin/staff/[userId]  { disabled: boolean }
// Soft-delete an internal login — see setUserDisabled's docstring for why
// this isn't a hard delete.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/guards";
import { setUserDisabled } from "@/lib/auth/users";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const PatchSchema = z.object({ disabled: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid patch" }, { status: 400 });
  }

  // Never let someone lock themselves out — they'd have no way back in
  // without another SUPERADMIN or direct db/users.json access.
  if (parsed.data.disabled && params.userId === guard.session.user.id) {
    return NextResponse.json({ ok: false, error: "You can't disable your own account" }, { status: 400 });
  }

  try {
    await setUserDisabled(params.userId, parsed.data.disabled);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: parsed.data.disabled ? "internal_staff_disabled" : "internal_staff_enabled",
      hospital_id: "MEDLYNQ_HQ",
      detail: { user_id: params.userId },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
