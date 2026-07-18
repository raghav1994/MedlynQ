// GET /api/nhcx/preview?case_id=
//
// Builds the same plain facts that go into the FHIR bundle, but as a human-
// readable summary instead of raw FHIR JSON — the review step a MEDCO (not
// a FHIR expert) can actually read before a claim goes out to NHCX/TPA.
// No side effects: doesn't send anything, doesn't sign, doesn't log.
import { NextRequest, NextResponse } from "next/server";
import { scopedCase, scopedPatient } from "@/lib/dataScope";
import { loadTenantByHospitalId } from "@/lib/tenant/loader";
import { resolveIcd10Codes } from "@/lib/icd10";
import { requireRole } from "@/lib/auth/guards";
import { docsForCase } from "@/lib/mockDocuments";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const case_id = url.searchParams.get("case_id");
  if (!case_id) {
    return NextResponse.json({ ok: false, error: "case_id required" }, { status: 400 });
  }

  const c = await scopedCase(case_id);
  if (!c) {
    return NextResponse.json({ ok: false, error: "case not found" }, { status: 404 });
  }
  const p = await scopedPatient(c.patient_id);
  if (!p) {
    return NextResponse.json({ ok: false, error: "patient not found" }, { status: 404 });
  }
  const tenant = await loadTenantByHospitalId(c.hospital_id);
  const icd10Codes = await resolveIcd10Codes(c.diagnosis || "", c.icd10_codes_override);
  const docCount = docsForCase(c.id).length;

  const claim_use = ["preauth_pending", "awaiting_approval"].includes(c.status)
    ? "preauthorization"
    : "claim";

  return NextResponse.json({
    ok: true,
    case_id: c.id,
    patient_id: p.id,
    patient: { name: p.name, mrn: p.mrn, age: p.age, gender: p.gender },
    hospital: { name: tenant?.name ?? c.hospital_id },
    scheme: c.scheme_variant || c.scheme,
    payer: c.payer,
    claim_use,
    registration_id: c.registration_id,
    diagnosis_text: c.diagnosis || "(not recorded)",
    icd10_codes: icd10Codes.map((i) => ({ code: i.code, display: i.display, source: i.source, verified: i.verified })),
    procedure_name: c.procedure_name || "(not recorded)",
    procedure_code: c.procedure_code || "(not recorded)",
    claimed_amount: c.claimed_amount,
    doc_count: docCount,
  });
}
