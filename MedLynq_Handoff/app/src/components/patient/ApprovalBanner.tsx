"use client";

// Big banner that sits above the patient header.
//   - awaiting_approval → amber, shows hour countdown + "Mark Rejected" escape hatch
//   - approval_received → green, shows "Call patient · admit before validity expiry"
//                          + auto-admit hint when first mid-way doc lands
//   - rejected → red, opens RejectionModal (cash / scheme switch / appeal)

import { useState } from "react";
import type { Case } from "@/lib/types";
import { approvalStateFor } from "@/lib/approval";
import ApprovalCountdown from "@/components/ApprovalCountdown";
import RejectionModal from "@/components/RejectionModal";
import type { RejectionOutcome } from "@/components/RejectionModal";

export default function ApprovalBanner({
  c, patientName,
}: { c: Case; patientName: string }) {
  const state = approvalStateFor(c);
  const [showReject, setShowReject] = useState(false);

  const handleReject = (outcome: RejectionOutcome) => {
    // In production: POST /api/cases/:id/reject with outcome — for now log + alert.
    console.log("rejection outcome:", outcome);
    alert(`Outcome recorded: ${outcome.action}\n(In production this updates case.scheme_history and routes the case.)`);
  };

  if (c.status === "rejected") {
    return (
      <>
        <div className="bg-bad-soft border border-bad/40 rounded-lg p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-bold text-bad">✗ {c.scheme} rejected this case</div>
            <div className="text-xs text-ink-200 mt-0.5">
              Pick the next step. Most rejections can be overturned by appeal — ~30–40% success.
            </div>
          </div>
          <button onClick={() => setShowReject(true)}
            className="text-xs font-semibold px-4 py-2 bg-bad text-white rounded hover:opacity-90">
            Pick rejection path →
          </button>
        </div>
        <RejectionModal
          open={showReject} onClose={() => setShowReject(false)}
          caseCode={c.registration_id} patientName={patientName}
          currentScheme={c.scheme} currentVariant={c.scheme_variant}
          amountAtStake={c.claimed_amount}
          rejectionRound={c.rejection_rounds ?? 1}
          onSubmit={handleReject}
        />
      </>
    );
  }

  if (state.mode === "awaiting_approval") {
    return (
      <>
        <div className="bg-warn-soft border border-warn/40 rounded-lg p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm font-bold text-warn">⏳ Awaiting {c.scheme} approval — patient is at home</div>
              <div className="text-xs text-ink-200 mt-0.5">
                Pre-approval bundle sent. Patient will be called when approval letter lands.
              </div>
            </div>
            <button onClick={() => setShowReject(true)}
              className="text-xs px-3 py-1.5 border border-bad/40 text-bad rounded hover:bg-bad-soft">
              Mark rejected
            </button>
          </div>
          <ApprovalCountdown
            mode="awaiting_approval"
            hoursElapsed={state.hoursElapsed}
            expectedHours={state.expectedHours}
            caseLabel={`Case ${c.registration_id} · ₹${c.claimed_amount.toLocaleString("en-IN")} at stake`}
          />
        </div>
        <RejectionModal
          open={showReject} onClose={() => setShowReject(false)}
          caseCode={c.registration_id} patientName={patientName}
          currentScheme={c.scheme} currentVariant={c.scheme_variant}
          amountAtStake={c.claimed_amount}
          rejectionRound={c.rejection_rounds ?? 1}
          onSubmit={handleReject}
        />
      </>
    );
  }

  if (state.mode === "approval_received") {
    return (
      <div className="bg-good-soft border border-good/40 rounded-lg p-4 mb-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm font-bold text-good">✅ Approval received — call patient + admit</div>
            <div className="text-xs text-ink-200 mt-0.5">
              {c.approval_amount_inr ? `Sanctioned ₹${c.approval_amount_inr.toLocaleString("en-IN")} · ` : ""}
              valid till <strong>{c.approval_valid_till}</strong>.
              Case auto-moves to <em>Admitted</em> when first treatment doc is uploaded.
            </div>
          </div>
          <a href="/intake" className="text-xs font-semibold px-3 py-1.5 bg-accent text-white rounded">
            Upload admission doc →
          </a>
        </div>
        <ApprovalCountdown
          mode="approval_received"
          hoursElapsed={state.hoursElapsed}
          expectedHours={state.expectedHours}
          caseLabel="Admission window — once expired, scheme must re-approve"
        />
      </div>
    );
  }

  return null;
}
