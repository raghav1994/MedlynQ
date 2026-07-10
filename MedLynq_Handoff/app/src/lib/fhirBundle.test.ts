// Tests for the NHCX FHIR bundle builder + signer.
//
// These tests are the *contract* with NHA. If they fail, NHCX will reject claims.
// Update the tests intentionally — they should never be loosened to make a build green.

import { describe, it, expect } from "vitest";
import { buildFhirBundle, signBundle, hashIdentifier, type BuildBundleInput } from "./fhirBundle";
import type { Case, Patient } from "./types";

// ---------- Fixtures ----------

const patientFixture: Patient = {
  id: "P0001",
  mrn: "PYZBP2Z4P",
  name: "Chinta Devi",
  age: 62,
  gender: "F",
  state: "Delhi",
  district: "West Delhi",
  department: "Oncology",
  hospital_id: "HOSP-BLR-49",
};

const baseCase: Case = {
  id: "APR-2026-0301",
  patient_id: "P0001",
  registration_id: "APR-2026-0301",
  scheme: "PMJAY",
  scheme_variant: "SHA_DELHI" as any,
  payer: "NHA / SHA Delhi",
  procedure_code: "MO001F",
  procedure_name: "Trastuzumab cycle 1",
  diagnosis: "C50.9 Breast malignant neoplasm",
  treatment_type: "chemo" as any,
  admission_date: "2026-03-01",
  discharge_date: "2026-03-01",
  status: "submitted" as any,
  claimed_amount: 42500,
  approved_amount: null,
  tat_days: 0,
  age_days: 1,
  missing_docs: 0,
  open_queries: 0,
  hospital_id: "HOSP-BLR-49",
};

function input(overrides: Partial<BuildBundleInput> = {}): BuildBundleInput {
  return {
    caseRecord: baseCase,
    patient: patientFixture,
    hospital: { id: "HOSP-BLR-49", name: "Action Cancer Hospital" },
    treating_doctor: "Dr. J B Sharma",
    doc_synopses: [],
    ...overrides,
  };
}

// ---------- hashIdentifier ----------

describe("hashIdentifier", () => {
  it("returns 16-hex deterministic hash for the same input", async () => {
    const a = await hashIdentifier("12345678901234567890");
    const b = await hashIdentifier("12345678901234567890");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns different hash for different input", async () => {
    const a = await hashIdentifier("12345678901234567890");
    const b = await hashIdentifier("12345678901234567899");
    expect(a).not.toBe(b);
  });
});

// ---------- buildFhirBundle ----------

describe("buildFhirBundle", () => {
  it("builds a Bundle with all 6 required resource types", async () => {
    const b = await buildFhirBundle(input());
    expect(b.resourceType).toBe("Bundle");
    expect(b.type).toBe("document");
    expect(b.id).toBeTruthy();
    expect(b.timestamp).toBeTruthy();

    const types = b.entry.map((e) => e.resource.resourceType);
    expect(types).toContain("Patient");
    expect(types).toContain("Coverage");
    expect(types).toContain("Practitioner");
    expect(types).toContain("Organization");
    expect(types).toContain("Claim");
    // Two organizations: sender (hospital) + receiver (insurer)
    expect(types.filter((t) => t === "Organization").length).toBe(2);
  });

  it("uses claim.use='preauthorization' when status is preauth_pending", async () => {
    const b = await buildFhirBundle(input({ caseRecord: { ...baseCase, status: "preauth_pending" as any } }));
    const claim = b.entry.find((e) => e.resource.resourceType === "Claim")?.resource;
    expect(claim.use).toBe("preauthorization");
  });

  it("uses claim.use='preauthorization' when status is awaiting_approval", async () => {
    const b = await buildFhirBundle(input({ caseRecord: { ...baseCase, status: "awaiting_approval" as any } }));
    const claim = b.entry.find((e) => e.resource.resourceType === "Claim")?.resource;
    expect(claim.use).toBe("preauthorization");
  });

  it("uses claim.use='claim' for submitted/approved/paid", async () => {
    for (const status of ["submitted", "approved", "paid"]) {
      const b = await buildFhirBundle(input({ caseRecord: { ...baseCase, status: status as any } }));
      const claim = b.entry.find((e) => e.resource.resourceType === "Claim")?.resource;
      expect(claim.use).toBe("claim");
    }
  });

  it("NEVER includes the raw patient name or raw Aadhaar in any resource", async () => {
    const b = await buildFhirBundle(input());
    const serialized = JSON.stringify(b);
    expect(serialized).not.toContain("Chinta Devi");        // DPDP: name is in MedLynq DB only
    // patient identifier should be a hashed value, not raw MRN/Aadhaar
    const patient = b.entry.find((e) => e.resource.resourceType === "Patient")?.resource;
    expect(patient.identifier?.[0]?.value).not.toBe("PYZBP2Z4P");
    expect(patient.identifier?.[0]?.value).toMatch(/^[0-9a-f]+$/);
  });

  it("maps PMJAY scheme to the NHA-PMJAY payer code", async () => {
    const b = await buildFhirBundle(input());
    const coverage = b.entry.find((e) => e.resource.resourceType === "Coverage")?.resource;
    expect(coverage.payor).toBeTruthy();
    // Insurer organization carries the payer code
    const insurer = b.entry
      .map((e) => e.resource)
      .find((r) => r.resourceType === "Organization" && r.type?.[0]?.coding?.[0]?.code === "ins");
    expect(insurer).toBeTruthy();
    expect(JSON.stringify(insurer)).toMatch(/PMJAY|NHA/i);
  });

  it("includes one DocumentReference per supplied doc_synopsis", async () => {
    const b = await buildFhirBundle(input({
      doc_synopses: [
        { doc_id: "doc1", doc_type: "hpe_report", label: "Histopathology", file_sha256: "abc" },
        { doc_id: "doc2", doc_type: "bill",       label: "Bill",           file_sha256: "def" },
        { doc_id: "doc3", doc_type: "lab_report", label: "Lab",            file_sha256: "ghi" },
      ],
    }));
    const docRefs = b.entry.filter((e) => e.resource.resourceType === "DocumentReference");
    expect(docRefs.length).toBe(3);
  });

  it("encodes the claimed amount as Claim.total", async () => {
    const b = await buildFhirBundle(input({ caseRecord: { ...baseCase, claimed_amount: 42500 } }));
    const claim = b.entry.find((e) => e.resource.resourceType === "Claim")?.resource;
    expect(Number(claim.total?.value)).toBe(42500);
  });
});

// ---------- signBundle ----------

describe("signBundle", () => {
  it("produces a 64-char hex SHA-256 hash", async () => {
    const b = await buildFhirBundle(input());
    const hash = await signBundle(b);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same bundle", async () => {
    const b = await buildFhirBundle(input());
    const h1 = await signBundle(b);
    const h2 = await signBundle(b);
    expect(h1).toBe(h2);
  });

  it("ignores JSON key order — semantically identical bundle → same hash", async () => {
    const b = await buildFhirBundle(input());
    // Deep-clone and rebuild top-level entries with keys in REVERSE insertion order.
    // Object.fromEntries preserves the order it's given, so this materially reorders keys.
    const reorder = (o: any): any => {
      if (Array.isArray(o)) return o.map(reorder);
      if (o && typeof o === "object") {
        return Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, reorder(v)]));
      }
      return o;
    };
    const shuffled = reorder(b);
    // Sanity: the serialized strings differ — confirms keys actually moved
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(shuffled));
    const h1 = await signBundle(b);
    const h2 = await signBundle(shuffled);
    expect(h1).toBe(h2);
  });

  it("changes when the claim amount changes", async () => {
    const a = await buildFhirBundle(input({ caseRecord: { ...baseCase, claimed_amount: 42500 } }));
    const b = await buildFhirBundle(input({ caseRecord: { ...baseCase, claimed_amount: 42501 } }));
    const ha = await signBundle(a);
    const hb = await signBundle(b);
    expect(ha).not.toBe(hb);
  });
});
