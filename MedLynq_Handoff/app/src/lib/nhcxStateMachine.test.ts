// Tests for the NHCX → case state machine.
//
// These tests pin down what each NHCX outcome does to the case. If we change
// the meaning of a transition (e.g. "approved" → "paid"), update these tests
// intentionally.

import { describe, it, expect } from "vitest";
import { deriveTransition, applyTransition } from "./nhcxStateMachine";
import type { Case } from "./types";

const baseCase: Case = {
  id: "APR-2026-0301",
  patient_id: "P0001",
  registration_id: "APR-2026-0301",
  scheme: "PMJAY",
  scheme_variant: "SHA_DELHI" as any,
  payer: "NHA / SHA Delhi",
  procedure_code: "MO001F",
  procedure_name: "Trastuzumab cycle 1",
  diagnosis: "C50.9",
  treatment_type: "chemo" as any,
  admission_date: "2026-03-01",
  discharge_date: "2026-03-01",
  status: "awaiting_approval" as any,
  claimed_amount: 42500,
  approved_amount: null,
  tat_days: 0,
  age_days: 1,
  missing_docs: 0,
  open_queries: 0,
  hospital_id: "HOSP-BLR-49",
};

// ---------- deriveTransition ----------

describe("deriveTransition", () => {
  it("approved + preauth bundle → preauth_approved with approval clocks set", () => {
    const t = deriveTransition(
      baseCase,
      "approved",
      { note: [{ text: "Approval code: ABC123" }, { text: "Approved amount: ₹40,000" }] },
      "preauthorization"
    );
    expect(t).toBeTruthy();
    expect(t!.next_status).toBe("preauth_approved");
    expect(t!.approved_amount).toBe(40000);
    expect(t!.approval_received_at).toBeTruthy();
    expect(t!.approval_valid_till).toBeTruthy();
  });

  it("approved + claim bundle → approved with amount", () => {
    const t = deriveTransition(
      baseCase,
      "approved",
      { note: [{ text: "Approved amount: ₹40,000" }] },
      "claim"
    );
    expect(t!.next_status).toBe("approved");
    expect(t!.approved_amount).toBe(40000);
    // claim bundles don't set approval clocks
    expect(t!.approval_received_at).toBeUndefined();
  });

  it("approved without an explicit amount in notes → falls back to claimed_amount", () => {
    const t = deriveTransition(baseCase, "approved", { note: [] }, "claim");
    expect(t!.approved_amount).toBe(42500);
  });

  it("queried → status=query, open_queries +1", () => {
    const t = deriveTransition(
      baseCase,
      "queried",
      { note: [{ text: "Query: missing geotag" }] },
      "preauthorization"
    );
    expect(t!.next_status).toBe("query");
    expect(t!.open_queries_delta).toBe(1);
    expect(t!.reason).toContain("missing geotag");
  });

  it("rejected → status=rejected and appends scheme_history entry", () => {
    const t = deriveTransition(
      baseCase,
      "rejected",
      { note: [{ text: "Rejection: ineligible procedure" }] },
      "claim"
    );
    expect(t!.next_status).toBe("rejected");
    expect(t!.scheme_history_append).toBeTruthy();
    expect(t!.scheme_history_append?.outcome).toBe("rejected");
    expect(t!.scheme_history_append?.scheme).toBe("PMJAY");
  });

  it("transmission_failed → null (no state change)", () => {
    const t = deriveTransition(baseCase, "transmission_failed", {}, "claim");
    expect(t).toBeNull();
  });

  it("received (no outcome) → null", () => {
    const t = deriveTransition(baseCase, "received", {}, "claim");
    expect(t).toBeNull();
  });
});

// ---------- applyTransition ----------

describe("applyTransition", () => {
  it("patches status + approved_amount on approve", () => {
    const t = deriveTransition(baseCase, "approved", { note: [{ text: "Approved amount: ₹40,000" }] }, "claim")!;
    const patched = applyTransition(baseCase, t);
    expect(patched.status).toBe("approved");
    expect(patched.approved_amount).toBe(40000);
    // Original case is not mutated
    expect(baseCase.status).toBe("awaiting_approval");
    expect(baseCase.approved_amount).toBeNull();
  });

  it("increments open_queries on queried", () => {
    const c = { ...baseCase, open_queries: 2 };
    const t = deriveTransition(c, "queried", { note: [{ text: "X" }] }, "claim")!;
    const patched = applyTransition(c, t);
    expect(patched.open_queries).toBe(3);
  });

  it("appends to scheme_history on rejected (preserves prior history)", () => {
    const prior = {
      scheme: "CGHS" as any,
      attempted_at: "2026-02-01",
      outcome: "switched" as const,
    };
    const c = { ...baseCase, scheme_history: [prior] };
    const t = deriveTransition(c, "rejected", { note: [{ text: "no" }] }, "claim")!;
    const patched = applyTransition(c, t);
    expect(patched.scheme_history?.length).toBe(2);
    expect(patched.scheme_history?.[0]).toEqual(prior);
    expect(patched.scheme_history?.[1].outcome).toBe("rejected");
  });

  it("does not touch unrelated fields", () => {
    const t = deriveTransition(baseCase, "approved", { note: [] }, "claim")!;
    const patched = applyTransition(baseCase, t);
    expect(patched.id).toBe(baseCase.id);
    expect(patched.patient_id).toBe(baseCase.patient_id);
    expect(patched.procedure_code).toBe(baseCase.procedure_code);
    expect(patched.hospital_id).toBe(baseCase.hospital_id);
  });
});
