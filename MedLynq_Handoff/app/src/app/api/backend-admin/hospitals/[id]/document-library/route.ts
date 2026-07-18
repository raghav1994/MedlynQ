// POST   /api/backend-admin/hospitals/[id]/document-library  — define a document once
// PATCH  /api/backend-admin/hospitals/[id]/document-library  — edit label/anchors, cascades doc_type rename
// DELETE /api/backend-admin/hospitals/[id]/document-library?doc_type=...  — remove + cascade-delete requirements
//
// The "generic document" half of the scheme-first Documents redesign — one
// canonical (label, anchors, extraction_keys) per doc_type, reused by every
// department/scheme requirement that points at it. See document-requirements/
// route.ts for the half that actually pins a library entry to a department.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { addDocumentLibraryEntry, removeDocumentLibraryEntry, updateDocumentLibraryEntry } from "@/lib/tenant/admin";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const LibrarySchema = z.object({
  doc_type: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, underscores only"),
  label: z.string().trim().min(1).max(80),
  anchors: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  extraction_keys: z.array(z.string().trim().min(1).max(60)).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `backend-admin-doc-library:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = LibrarySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid document", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await addDocumentLibraryEntry(params.id, parsed.data);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "document_library_entry_added",
      hospital_id: params.id,
      detail: { doc_type: parsed.data.doc_type, label: parsed.data.label },
    });
    return NextResponse.json({ ok: true, hospital: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}

const UpdateSchema = LibrarySchema.extend({
  original_doc_type: z.string().trim().min(1).max(60),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `backend-admin-doc-library:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid document", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { original_doc_type, ...entry } = parsed.data;
    const updated = await updateDocumentLibraryEntry(params.id, original_doc_type, entry);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "document_library_entry_edited",
      hospital_id: params.id,
      detail: { original_doc_type, doc_type: entry.doc_type, label: entry.label },
    });
    return NextResponse.json({ ok: true, hospital: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const doc_type = req.nextUrl.searchParams.get("doc_type");
  if (!doc_type) {
    return NextResponse.json({ ok: false, error: "doc_type query param required" }, { status: 400 });
  }

  try {
    const updated = await removeDocumentLibraryEntry(params.id, doc_type);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "document_library_entry_removed",
      hospital_id: params.id,
      detail: { doc_type },
    });
    return NextResponse.json({ ok: true, hospital: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
