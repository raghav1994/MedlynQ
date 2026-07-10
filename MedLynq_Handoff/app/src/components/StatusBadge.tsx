import clsx from "clsx";
import type { ClaimStatus } from "@/lib/types";

const styles: Record<ClaimStatus, string> = {
  opd_done:         "bg-bone-300 text-ink-200 border-bone-300",
  preauth_pending:  "bg-accent-soft text-accent border-accent",
  awaiting_approval: "bg-warn-soft text-warn border-warn",
  approval_received: "bg-accent-soft text-accent border-accent",
  preauth_approved: "bg-good-soft text-good border-good",
  admitted:         "bg-warn-soft text-warn border-warn",
  discharged:       "bg-accent-soft text-accent border-accent",
  submitted:        "bg-bone-300 text-ink-200 border-bone-300",
  pending:          "bg-warn-soft text-warn border-warn",
  query:            "bg-bad-soft text-bad border-bad",
  responded:        "bg-warn-soft text-warn border-warn",
  approved:         "bg-good-soft text-good border-good",
  paid:             "bg-good-soft text-good border-good",
  rejected:         "bg-bad-soft text-bad border-bad",
  cash:             "bg-bone-300 text-ink-200 border-bone-300",
  auto_closed:      "bg-bone-300 text-ink-200 border-bone-300",
  successful:       "bg-good-soft text-good border-good",
};

const labels: Record<ClaimStatus, string> = {
  opd_done:         "OPD done",
  preauth_pending:  "Pre-auth pending",
  awaiting_approval: "Awaiting approval",
  approval_received: "Approval received",
  preauth_approved: "Pre-auth ok",
  admitted:         "Admitted",
  discharged:       "Discharged",
  submitted:        "Submitted",
  pending:          "Pending",
  query:            "Query",
  responded:        "Responded",
  approved:         "Approved",
  paid:             "Paid",
  rejected:         "Rejected",
  cash:             "Self-pay",
  auto_closed:      "Auto-closed",
  successful:       "Successful",
};

export default function StatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span className={clsx(
      "inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap",
      styles[status]
    )}>
      {labels[status]}
    </span>
  );
}
