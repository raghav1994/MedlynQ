import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

function loadEnvLocal(key: string): string {
  try {
    const raw = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
    const m = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}
// The mock route itself reads process.env.MEDLYNQ_INTERNAL_SECRET (as its
// fallback below any db/api_settings.json override) — the test process
// doesn't auto-load .env.local into process.env the way Next's dev server
// does, so without this the request 401s before ever reaching the
// diagnosis logic this test exists to check.
process.env.MEDLYNQ_INTERNAL_SECRET = loadEnvLocal("MEDLYNQ_INTERNAL_SECRET");

import { NextRequest } from "next/server";
import { buildFhirBundle } from "@/lib/fhirBundle";
import type { Case, Patient } from "@/lib/types";
import { POST } from "./route";

const patient: Patient = {
  id: "P0001", mrn: "PYZBP2Z4P", name: "Chinta Devi", age: 62, gender: "F",
  state: "Delhi", district: "West Delhi", hospital_id: "HOSP-BLR-49",
};
const c: Case = {
  id: "VERIFY-DIAG-001", patient_id: "P0001", registration_id: "VERIFY-DIAG-001",
  scheme: "PMJAY", payer: "NHA / SHA Delhi", procedure_code: "MO001F",
  procedure_name: "Trastuzumab cycle 1", diagnosis: "C50.9 Breast malignant neoplasm",
  treatment_type: "chemo" as any, admission_date: "2026-03-01", discharge_date: "2026-03-01",
  status: "submitted" as any, claimed_amount: 5000, approved_amount: null,
  tat_days: 0, age_days: 1, missing_docs: 0, open_queries: 0, hospital_id: "HOSP-BLR-49",
};

describe("mock NHCX correctly reads a diagnosisReference-shaped Claim (real regression check)", () => {
  it("does NOT query for 'missing diagnosis' when the diagnosis is properly ICD-10-coded via Condition", async () => {
    const bundle = await buildFhirBundle({
      caseRecord: c, patient, hospital: { id: "HOSP-BLR-49", name: "Action Cancer Hospital" },
      doc_synopses: [],
    });
    // Sanity: this bundle really does use the new diagnosisReference shape,
    // not the old inline text — otherwise this test wouldn't be exercising
    // the regression at all.
    const claim = bundle.entry.find((e) => e.resource.resourceType === "Claim")!.resource as any;
    expect(claim.diagnosis[0].diagnosisReference).toBeTruthy();
    expect(claim.diagnosis[0].diagnosisCodeableConcept).toBeUndefined();

    const req = new NextRequest("http://localhost:3000/api/nhcx/mock", {
      method: "POST",
      headers: { "x-internal-secret": loadEnvLocal("MEDLYNQ_INTERNAL_SECRET") },
      body: JSON.stringify(bundle),
    });
    const res = await POST(req);
    const json = await res.json();
    // Structural/auth failures would silently make this test vacuous (no
    // "queried" outcome to check) — assert we actually got a real decision.
    expect(["approved", "queried", "rejected"]).toContain(json.outcome);
    if (json.outcome === "queried") {
      expect(JSON.stringify(json.note)).not.toMatch(/diagnosis missing/i);
    }
  });
});
