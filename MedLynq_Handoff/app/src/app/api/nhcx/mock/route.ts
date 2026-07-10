// POST /api/nhcx/mock
//
// Local mock of the National Health Claims Exchange.
// Validates the incoming FHIR bundle structurally + returns a realistic response.
//
// Decision logic (deterministic, for demo):
//   - Bundle missing Patient / Coverage / Claim         → REJECTED (validation_error)
//   - Claim amount > package cap                        → QUERIED (over_cap)
//   - Claim has no diagnosis                            → QUERIED (missing_clinical)
//   - Scheme = Ayushman & no SupportingInfo (docs)      → QUERIED (missing_evidence)
//   - Random 10% chance for queried (real-world feel)
//   - Otherwise                                         → APPROVED
//
// Always returns within ~200ms so the bridge demo feels live.

import { NextRequest, NextResponse } from "next/server";
import { findPackage } from "@/lib/packages";

export const runtime = "nodejs";

type Outcome = "approved" | "queried" | "rejected";

function nhcxResponse(outcome: Outcome, opts: {
  bundle_id?: string;
  audit_hash?: string;
  query_text?: string;
  rejection_reason?: string;
  approval_code?: string;
  approved_amount?: number;
}) {
  return {
    resourceType: "ClaimResponse",
    id: `cr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    status: "active",
    type: { coding: [{ code: "institutional" }] },
    use: "claim",
    outcome,
    created: new Date().toISOString(),
    request: { reference: `Bundle/${opts.bundle_id ?? ""}` },
    medlynq_audit_in_hash: opts.audit_hash,
    note: outcome === "approved" ? [
      { text: `Approval code: ${opts.approval_code ?? "MOCK-OK-" + Date.now()}` },
      { text: `Approved amount: ₹${(opts.approved_amount ?? 0).toLocaleString("en-IN")}` },
    ] : outcome === "queried" ? [
      { text: `Query: ${opts.query_text ?? "Provide additional evidence"}` },
      { text: "Deadline: 15 days from issue" },
    ] : [
      { text: `Rejection: ${opts.rejection_reason ?? "Validation error"}` },
    ],
    // SLA simulation
    expected_response_by: outcome === "approved"
      ? null
      : new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString(),
  };
}

export async function POST(req: NextRequest) {
  // Public in middleware.ts (a real NHA/NHCX server can't carry our session
  // cookie either) — trust this shared secret instead, set only by our own
  // /api/nhcx/send when it's calling this local mock.
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.MEDLYNQ_INTERNAL_SECRET) {
    return NextResponse.json({ ok: false, error: "Invalid or missing internal secret" }, { status: 401 });
  }

  const audit_hash_in = req.headers.get("x-medlynq-audit-hash") ?? "";
  try {
    const bundle = await req.json();
    const bundle_id = bundle?.id;

    // 1. Structural validation
    const types = (bundle?.entry ?? []).map((e: any) => e.resource?.resourceType);
    const need = ["Patient", "Coverage", "Claim"];
    const missing = need.filter((t) => !types.includes(t));
    if (missing.length > 0) {
      return NextResponse.json(nhcxResponse("rejected", {
        bundle_id, audit_hash: audit_hash_in,
        rejection_reason: `Bundle missing required resources: ${missing.join(", ")}`,
      }), { status: 200 });
    }

    // 2. Clinical content checks
    const claim = bundle.entry.find((e: any) => e.resource?.resourceType === "Claim")?.resource;
    const supportingInfo = claim?.supportingInfo ?? [];
    const diagnosis = claim?.diagnosis?.[0]?.diagnosisCodeableConcept?.text;
    const procedureCode = claim?.item?.[0]?.productOrService?.coding?.[0]?.code;
    const claimAmount = Number(claim?.total?.value ?? 0);
    const insurer = bundle.entry.find((e: any) =>
      e.resource?.resourceType === "Organization"
      && e.resource?.type?.[0]?.coding?.[0]?.code === "ins"
    )?.resource?.name ?? "";

    // 3. Package master check
    if (procedureCode) {
      const pkg = await findPackage(procedureCode);
      if (pkg && claimAmount > pkg.cap_inr) {
        return NextResponse.json(nhcxResponse("queried", {
          bundle_id, audit_hash: audit_hash_in,
          query_text: `Claim ₹${claimAmount.toLocaleString("en-IN")} exceeds package ${procedureCode} cap of ₹${pkg.cap_inr.toLocaleString("en-IN")}. Provide justification or split claim.`,
        }), { status: 200 });
      }
      if (!pkg) {
        return NextResponse.json(nhcxResponse("queried", {
          bundle_id, audit_hash: audit_hash_in,
          query_text: `Procedure code ${procedureCode} not found in HBP master. Verify code.`,
        }), { status: 200 });
      }
    }

    // 4. Missing diagnosis
    if (!diagnosis) {
      return NextResponse.json(nhcxResponse("queried", {
        bundle_id, audit_hash: audit_hash_in,
        query_text: "Primary diagnosis missing from Claim resource.",
      }), { status: 200 });
    }

    // 5. Ayushman-specific evidence requirement
    if (/Ayushman|PMJAY/i.test(insurer) && supportingInfo.length < 3) {
      return NextResponse.json(nhcxResponse("queried", {
        bundle_id, audit_hash: audit_hash_in,
        query_text: `Insufficient supporting evidence. Ayushman expects ≥3 DocumentReferences; received ${supportingInfo.length}.`,
      }), { status: 200 });
    }

    // 6. Random 10% query (real-world feel — payer's mood)
    if (Math.random() < 0.10) {
      return NextResponse.json(nhcxResponse("queried", {
        bundle_id, audit_hash: audit_hash_in,
        query_text: "Geotag photo resolution below 2 MP — please reshare.",
      }), { status: 200 });
    }

    // 7. Otherwise approved (give back 95% of claimed)
    const approved = Math.round(claimAmount * 0.95);
    return NextResponse.json(nhcxResponse("approved", {
      bundle_id, audit_hash: audit_hash_in,
      approval_code: `${insurer.replace(/\s+/g, "").slice(0, 6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      approved_amount: approved,
    }), { status: 200 });
  } catch (e: any) {
    return NextResponse.json(nhcxResponse("rejected", {
      audit_hash: audit_hash_in,
      rejection_reason: `Bundle parse error: ${e?.message ?? String(e)}`,
    }), { status: 400 });
  }
}
