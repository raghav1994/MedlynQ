// GET  /api/backend-admin/catalog  — the global document catalog
// POST /api/backend-admin/catalog  — add a catalog entry
//
// GET is readable by any internal staff (SUPERADMIN) — they need the catalog
// to pick documents when setting up a hospital. Writing the master catalog is
// OWNER-only, same lock as internal-staff management.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, requireOwner } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { listCatalog, addCatalogEntry } from "@/lib/catalog";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const EntrySchema = z.object({
  doc_type: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, underscores only"),
  label: z.string().trim().min(1).max(80),
  anchors: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  extraction_keys: z.array(z.string().trim().min(1).max(60)).optional(),
  category: z.string().trim().min(1).max(60),
});

export async function GET() {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, catalog: await listCatalog() });
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `catalog:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = EntrySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid catalog entry", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const catalog = await addCatalogEntry(parsed.data);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "catalog_entry_added",
      hospital_id: "MEDLYNQ_HQ",
      detail: { doc_type: parsed.data.doc_type, label: parsed.data.label, category: parsed.data.category },
    });
    return NextResponse.json({ ok: true, catalog });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
