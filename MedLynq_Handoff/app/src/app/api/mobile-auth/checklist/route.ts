// GET /api/mobile-auth/checklist?hospital_id=&patient_id=
//
// Gives the mobile app the SAME real document checklist the desktop patient
// page computes (buildChecklist over the tenant's document requirements),
// instead of the phone guessing completeness from its own local upload
// records. Also folds in any pending "request from staff" for this patient
// so the phone can show the same red/note highlight desktop shows.
//
// No case_id from the caller — documents in this app live at the MRN/
// patient level on disk (docsForCase() just re-reads the same folder
// regardless of which case_id is asked), so the first case for this patient
// is picked the same way the desktop patient page defaults when no ?case=
// is given (pcases[0]).
import { NextRequest, NextResponse } from "next/server";
import { patients as mockPatients, cases as mockCases, loadDynamicData } from "@/lib/mockData";
import { docsForCase } from "@/lib/mockDocuments";
import { buildChecklist, rulesFromDocumentRequirements } from "@/lib/checklist";
import { getSkippedDocTypes } from "@/lib/checklistSkips";
import { loadTenantByHospitalId } from "@/lib/tenant/loader";
import { getForPatient } from "@/lib/documentRequests";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const hospitalId = url.searchParams.get("hospital_id");
    const patientId = url.searchParams.get("patient_id");
    if (!hospitalId || !patientId) {
      return NextResponse.json({ ok: false, error: "hospital_id and patient_id are required" }, { status: 400 });
    }

    loadDynamicData();
    const patient = mockPatients.find((p) => p.id === patientId && p.hospital_id === hospitalId);
    if (!patient) {
      return NextResponse.json({ ok: false, error: "Patient not found for this hospital" }, { status: 404 });
    }

    const pcases = mockCases.filter((c) => c.patient_id === patientId);
    const activeCase = pcases[0];
    if (!activeCase) {
      return NextResponse.json({ ok: true, checklist: [] });
    }

    const tenant = await loadTenantByHospitalId(hospitalId);
    const docs = docsForCase(activeCase.id);
    const skippedDocTypes = await getSkippedDocTypes(activeCase.id);
    const rules = tenant ? rulesFromDocumentRequirements(tenant.document_library, tenant.document_requirements) : [];
    const checklist = buildChecklist(docs, activeCase.treatment_type, activeCase.specialty ?? "oncology", skippedDocTypes, rules, activeCase.scheme);

    const requests = await getForPatient(patientId);
    const pendingByDocType = new Map(
      requests.filter((r) => r.status === "pending").map((r) => [r.doc_type.trim().toLowerCase(), r])
    );

    const result = checklist.map((item) => {
      const pending = pendingByDocType.get(item.doc_type.trim().toLowerCase());
      return {
        doc_type: item.doc_type,
        status: item.status, // "present" | "low_confidence" | "alternative_present" | "missing" | "skipped"
        requested: !!pending,
        note: pending?.note ?? "",
        requested_by: pending?.requested_by ?? "",
      };
    });

    return NextResponse.json({ ok: true, checklist: result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
