// PATCH /api/backend-admin/hospitals/[id]/users/[userId]  { disabled: boolean }
// Soft-delete a login — see setUserDisabled's docstring for why this isn't
// a hard delete.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { setUserDisabled } from "@/lib/auth/users";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const PatchSchema = z.object({ disabled: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string; userId: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid patch" }, { status: 400 });
  }

  try {
    await setUserDisabled(params.userId, parsed.data.disabled);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: parsed.data.disabled ? "user_disabled" : "user_enabled",
      hospital_id: params.id,
      detail: { user_id: params.userId },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
