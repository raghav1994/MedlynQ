// POST /api/document-requests — MEDCO/ADMIN flags a missing document and
// asks staff to capture it (with an optional note).
// GET  /api/document-requests?patient_id=  — full request history for one
//      patient (desktop checklist UI: which doc_types are requested + note).
// GET  /api/document-requests?hospital_id= — just the set of patient_ids
//      with a pending request (desktop Patient List + mobile card badges).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { createRequest, getForPatient, getPendingPatientIds } from "@/lib/documentRequests";
import { patients } from "@/lib/mockData";

export const runtime = "nodejs";

const BodySchema = z.object({
  patient_id: z.string().min(1),
  case_id: z.string().optional(),
  doc_type: z.string().min(1).max(200),
  note: z.string().max(500).optional().default(""),
});

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `doc-request:${guard.session.user.id}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const hospitalId = guard.session.user.hospital_id;

  const patient = patients.find((p) => p.id === body.patient_id && p.hospital_id === hospitalId);
  if (!patient) {
    return NextResponse.json({ ok: false, error: "Patient not found for this hospital" }, { status: 404 });
  }

  const request = await createRequest({
    hospital_id: hospitalId,
    patient_id: body.patient_id,
    case_id: body.case_id,
    doc_type: body.doc_type,
    note: body.note,
    requested_by: guard.session.user.name,
  });

  return NextResponse.json({ ok: true, request });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const patientId = url.searchParams.get("patient_id");
  const hospitalId = url.searchParams.get("hospital_id");

  if (patientId) {
    const requests = await getForPatient(patientId);
    return NextResponse.json({ ok: true, requests });
  }
  if (hospitalId) {
    const pendingPatientIds = await getPendingPatientIds(hospitalId);
    return NextResponse.json({ ok: true, pending_patient_ids: Array.from(pendingPatientIds) });
  }
  return NextResponse.json({ ok: false, error: "patient_id or hospital_id required" }, { status: 400 });
}
