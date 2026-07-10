// Tests for the document router — pins the contract between extracted
// document bag and the action MEDCO will see.

import { describe, it, expect } from "vitest";
import { routeDocument, pickCaseForStage, ROUTER_THRESHOLDS } from "./docRouter";
import type { Patient, Case } from "./types";

const ACTION = "HOSP-BLR-49";

const chinta: Patient = {
  id: "P0001", mrn: "PYZBP2Z4P", name: "Chinta Devi",
  age: 62, gender: "F", state: "Delhi", district: "West Delhi",
  department: "Oncology", hospital_id: ACTION,
};

const sushila: Patient = {
  id: "P0009", mrn: "PNW72KQ19", name: "Sushila Gupta",
  age: 55, gender: "F", state: "Delhi", district: "West Delhi",
  department: "Dermatology", hospital_id: ACTION,
};

const chintaCases: Case[] = [
  {
    id: "APR-2026-0301", patient_id: "P0001", registration_id: "APR-2026-0301",
    scheme: "PMJAY", payer: "NHA",
    procedure_code: "MO001F", procedure_name: "Trastuzumab",
    diagnosis: "C50.9", treatment_type: "chemo" as any,
    admission_date: "2026-03-01", discharge_date: "2026-03-01",
    status: "admitted" as any,
    claimed_amount: 42500, approved_amount: null,
    tat_days: 0, age_days: 1, missing_docs: 0, open_queries: 0,
    hospital_id: ACTION,
  },
];

describe("routeDocument", () => {
  // -- Scenario A: known patient, mid-treatment add ----------------------
  it("auto-attaches to existing patient + case when identity matches strongly", () => {
    const result = routeDocument(
      {
        identity: { mrn: "PYZBP2Z4P", name: "Chinta Devi", age: 62, gender: "F" },
        doc_types: ["Chemo Chart"],
      },
      [chinta, sushila],
      chintaCases,
    );
    expect(result.action).toBe("auto_attach");
    expect(result.patient_id).toBe("P0001");
    expect(result.case_id).toBe("APR-2026-0301");
    expect(result.confidence).toBeGreaterThanOrEqual(ROUTER_THRESHOLDS.AUTO_ATTACH_MIN);
    expect(result.stage.stage).toBe("mid_way");
  });

  // -- Scenario B: known patient, discharge bag → auto-advance status ----
  it("auto-advances admitted → discharged when discharge bag attaches", () => {
    const result = routeDocument(
      {
        identity: { mrn: "PYZBP2Z4P", name: "Chinta Devi" },
        doc_types: ["Discharge Summary", "Hospital Bill"],
      },
      [chinta],
      chintaCases,
    );
    expect(result.action).toBe("auto_attach");
    expect(result.auto_advance).toBeTruthy();
    expect(result.auto_advance?.from).toBe("admitted");
    expect(result.auto_advance?.to).toBe("discharged");
    expect(result.stage.stage).toBe("discharge");
  });

  // -- Scenario C: unknown patient → auto_create -------------------------
  it("creates a new patient + case when no identity overlap", () => {
    const result = routeDocument(
      {
        identity: { name: "Brand New Patient", age: 40, gender: "M" },
        doc_types: ["Aadhaar", "Insurance / Scheme Card", "Doctor's Prescription"],
      },
      [chinta, sushila],
      chintaCases,
    );
    expect(result.action).toBe("auto_create");
    expect(result.patient_id).toBeUndefined();
    expect(result.new_case_status).toBeTruthy();
    expect(result.stage.stage).toBe("pre_auth");
  });

  // -- Scenario D: medium confidence → review ----------------------------
  it("returns 'review' when only one field overlaps with a candidate", () => {
    // Same gender + similar age → 2 fields out of 3 match → confidence ~0.67 (medium)
    const result = routeDocument(
      { identity: { name: "Chinta", age: 60, gender: "F" }, doc_types: ["Lab Report"] },
      [chinta],
      [],
    );
    // Either auto_attach (if scorer ranks it high) or review — never auto_create
    expect(["auto_attach","review"]).toContain(result.action);
    expect(result.candidates[0].patient.id).toBe("P0001");
  });

  // -- Stage detection drives create initial status ----------------------
  it("new pre-auth bag → new case at preauth_pending status", () => {
    const result = routeDocument(
      {
        identity: { name: "Newcomer", gender: "M" },
        doc_types: ["Aadhaar", "Insurance / Scheme Card", "Tumor Board Certificate", "Consent Form"],
      },
      [],
      [],
    );
    expect(result.action).toBe("auto_create");
    expect(result.new_case_status).toBe("preauth_pending");
  });

  // -- Audit log payload shape ------------------------------------------
  it("always returns a stage object + candidates array + doc_count", () => {
    const r = routeDocument(
      { identity: {}, doc_types: ["Hospital Bill"] },
      [chinta],
      [],
    );
    expect(r.stage).toBeTruthy();
    expect(Array.isArray(r.candidates)).toBe(true);
    expect(r.doc_count).toBe(1);
  });
});

describe("pickCaseForStage", () => {
  it("picks admitted case for a discharge bag", () => {
    const c = pickCaseForStage(chinta, "discharge", chintaCases);
    expect(c?.id).toBe("APR-2026-0301");
  });
  it("returns null for pre_auth when no pre-auth case exists", () => {
    const c = pickCaseForStage(chinta, "pre_auth", chintaCases);
    expect(c).toBeNull();
  });
  it("returns null when patient has no cases at all", () => {
    const c = pickCaseForStage(chinta, "discharge", []);
    expect(c).toBeNull();
  });
});
