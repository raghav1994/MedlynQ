// POST   /api/backend-admin/hospitals/[id]/document-requirements  — pin a library doc to a dept+stage(+schemes)
// PATCH  /api/backend-admin/hospitals/[id]/document-requirements  — edit a requirement's dept/stage/schemes
// DELETE /api/backend-admin/hospitals/[id]/document-requirements?doc_type=...&specialty=...&stage=...
//
// The "which department needs it, at which stage, for which schemes" half of
// the scheme-first Documents redesign. A requirement's identity is the
// (doc_type, specialty, stage) triple, not doc_type alone — that's what lets
// the same library doc (e.g. "OT Notes") be required by multiple
// departments without being defined twice. See document-library/route.ts for
// the half that defines what a doc_type actually means (label/anchors).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { addDocumentRequirement, removeDocumentRequirement, updateDocumentRequirement } from "@/lib/tenant/admin";
import { appendAdminAudit } from "@/lib/auth/adminAudit";

export const runtime = "nodejs";

const RequirementSchema = z.object({
  doc_type: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, underscores only"),
  specialty: z.string().trim().min(1).max(60),
  stage: z.enum(["opd", "pre_auth", "mid_way", "discharge"]),
  for_treatments: z.array(z.string()).optional(),
  schemes: z.array(z.string()).optional(), // omitted/empty = universal, required for every scheme
  alt_group: z.string().trim().max(60).optional(),
  // Only used when doc_type isn't already in the library — defines it
  // inline so the UI stays a single form. Ignored (reuse wins) if the
  // doc_type already exists.
  label: z.string().trim().min(1).max(80).optional(),
  anchors: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  extraction_keys: z.array(z.string().trim().min(1).max(60)).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `backend-admin-doc-requirement:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = RequirementSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid requirement", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { label, anchors, extraction_keys, ...requirement } = parsed.data;
    const newEntry = label && anchors && anchors.length > 0 ? { label, anchors, extraction_keys } : undefined;
    const updated = await addDocumentRequirement(params.id, requirement, newEntry);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "document_requirement_added",
      hospital_id: params.id,
      detail: { doc_type: requirement.doc_type, specialty: requirement.specialty, stage: requirement.stage, schemes: requirement.schemes },
    });
    return NextResponse.json({ ok: true, hospital: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}

const UpdateSchema = RequirementSchema.extend({
  original: z.object({
    doc_type: z.string().trim().min(1).max(60),
    specialty: z.string().trim().min(1).max(60),
    stage: z.enum(["opd", "pre_auth", "mid_way", "discharge"]),
  }),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["SUPERADMIN"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `backend-admin-doc-requirement:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid requirement", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { original, label, anchors, extraction_keys, ...requirement } = parsed.data;
    const libraryEdit = label && anchors && anchors.length > 0 ? { label, anchors, extraction_keys } : undefined;
    const updated = await updateDocumentRequirement(params.id, original, requirement, libraryEdit);
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "document_requirement_edited",
      hospital_id: params.id,
      detail: { original, doc_type: requirement.doc_type, specialty: requirement.specialty, stage: requirement.stage },
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
  const specialty = req.nextUrl.searchParams.get("specialty");
  const stage = req.nextUrl.searchParams.get("stage");
  if (!doc_type || !specialty || !stage) {
    return NextResponse.json({ ok: false, error: "doc_type, specialty, and stage query params are required" }, { status: 400 });
  }

  try {
    const updated = await removeDocumentRequirement(params.id, { doc_type, specialty, stage });
    await appendAdminAudit({
      actor_id: guard.session.user.id,
      actor_name: guard.session.user.name,
      action: "document_requirement_removed",
      hospital_id: params.id,
      detail: { doc_type, specialty, stage },
    });
    return NextResponse.json({ ok: true, hospital: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 400 });
  }
}
