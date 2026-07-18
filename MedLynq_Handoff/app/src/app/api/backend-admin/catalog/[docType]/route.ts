// PATCH  /api/backend-admin/catalog/[docType]  — edit a catalog entry (live-propagates)
// DELETE /api/backend-admin/catalog/[docType]   — remove a catalog entry (detaches hospitals)
//
// OWNER-only. Both propagate into every hospital's catalog_linked copies —
// PATCH re-syncs label/anchors (and renames the slug everywhere if changed),
// DELETE detaches linked copies so hospitals keep working locally.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { updateCatalogEntry, removeCatalogEntry } from "@/lib/catalog";
import { propagateCatalogUpsert, propagateCatalogDelete } from "@/lib/tenant/admin";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const EntrySchema = z.object({
  doc_type: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, underscores only"),
  label: z.string().trim().min(1).max(80),
  anchors: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  extraction_keys: z.array(z.string().trim().min(1).max(60)).optional(),
  category: z.string().trim().min(1).max(60),
});

export async function PATCH(req: NextRequest, { params }: { params: { docType: string } }) {
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
    const catalog = await updateCatalogEntry(params.docType, parsed.data);
    const affected = await propagateCatalogUpsert(params.docType, parsed.data);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "catalog_entry_edited",
      hospital_id: "MEDLYNQ_HQ",
      detail: { original: params.docType, doc_type: parsed.data.doc_type, hospitals_synced: affected },
    });
    return NextResponse.json({ ok: true, catalog, hospitals_synced: affected });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { docType: string } }) {
  const guard = await requireOwner();
  if (!guard.ok) return guard.response;

  try {
    const catalog = await removeCatalogEntry(params.docType);
    const affected = await propagateCatalogDelete(params.docType);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "catalog_entry_removed",
      hospital_id: "MEDLYNQ_HQ",
      detail: { doc_type: params.docType, hospitals_detached: affected },
    });
    return NextResponse.json({ ok: true, catalog, hospitals_detached: affected });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
