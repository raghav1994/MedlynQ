// GET   /api/backend-admin/settings  — masked view of global API settings
// PATCH /api/backend-admin/settings  — update one or more values
//
// Owner-only, same lock as Internal Staff and the Document Catalog. Secrets
// are never sent back to the browser in plaintext — GET returns a masked
// hint (last 4 chars) so the owner can confirm which key is active without
// the full value ever leaving the server after it's saved.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { readApiSettings, writeApiSettings, maskForDisplay } from "@/lib/apiSettings";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const PatchSchema = z.object({
  sarvam_api_key: z.string().trim().max(200).optional(),
  sarvam_chat_model: z.string().trim().max(60).optional(),
  sarvam_doc_lang: z.string().trim().max(20).optional(),
  sarvam_doc_format: z.string().trim().max(20).optional(),
  nhcx_endpoint: z.string().trim().max(300).optional(),
  nhcx_internal_secret: z.string().trim().max(200).optional(),
});

export async function GET() {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;
  const settings = await readApiSettings();
  return NextResponse.json({ ok: true, settings: maskForDisplay(settings) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `api-settings:${guard.session.user.id}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid settings patch", details: parsed.error.flatten() }, { status: 400 });
  }
  const changedKeys = Object.entries(parsed.data).filter(([, v]) => v && v.trim() !== "").map(([k]) => k);
  if (changedKeys.length === 0) {
    return NextResponse.json({ ok: false, error: "No values provided" }, { status: 400 });
  }

  const next = await writeApiSettings(parsed.data);
  await appendAdminAudit({
    actor_id: guard.session.user.id,
    actor_name: guard.session.user.name,
    action: "api_settings_updated",
    hospital_id: "MEDLYNQ_HQ",
    // Never log secret values — just which fields changed.
    detail: { fields_changed: changedKeys },
  });
  return NextResponse.json({ ok: true, settings: maskForDisplay(next) });
}
