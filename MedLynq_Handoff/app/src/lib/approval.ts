// Approval-flow helpers.
//
// Two clocks:
//   1. PRE-APPROVAL clock (Ayushman + FCI): started when MEDCO sent the
//      pre-approval bundle. Default SLA = 24h to receive the letter.
//   2. APPROVAL-VALIDITY clock: started when the approval letter arrived.
//      Default validity = 14 days to get the patient admitted.

import type { Case, Scheme } from "./types";
import {
  authModeFor,
  APPROVAL_VALIDITY_DAYS,
  PRE_APPROVAL_SLA_HOURS as SCHEME_PRE_APPROVAL_HOURS,
  PRE_APPROVAL_SLA_BY_VARIANT,
} from "./types";

// Re-export for any callers that still import from here.
export const PRE_APPROVAL_SLA_HOURS = SCHEME_PRE_APPROVAL_HOURS;

export type ApprovalState = {
  mode: "awaiting_approval" | "approval_received" | "not_applicable";
  hoursElapsed: number;
  expectedHours: number;
  // pretty-fied label for tiles
  summary: string;
};

function hoursSince(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, ms / 3600_000);
}

// Per (scheme + variant) lookup with variant override.
function preApprovalSlaFor(c: Case): number {
  if (c.scheme_variant && PRE_APPROVAL_SLA_BY_VARIANT[c.scheme_variant] !== undefined) {
    return PRE_APPROVAL_SLA_BY_VARIANT[c.scheme_variant]!;
  }
  return SCHEME_PRE_APPROVAL_HOURS[c.scheme] ?? 24;
}

export function approvalStateFor(c: Case): ApprovalState {
  const authMode = c.auth_mode ?? authModeFor(c.scheme, c.scheme_variant);
  if (authMode !== "pre_approval") {
    return { mode: "not_applicable", hoursElapsed: 0, expectedHours: 0, summary: "" };
  }
  if (c.status === "approval_received" && c.approval_received_at) {
    const validityDays = APPROVAL_VALIDITY_DAYS[c.scheme] ?? 14;
    const expectedHours = validityDays * 24;
    const hoursElapsed = hoursSince(c.approval_received_at);
    return {
      mode: "approval_received",
      hoursElapsed,
      expectedHours,
      summary: `Approval valid · ${Math.max(0, Math.round(expectedHours - hoursElapsed))}h to admit`,
    };
  }
  if (c.status === "awaiting_approval" && c.approval_clock_started_at) {
    const expectedHours = preApprovalSlaFor(c);
    const hoursElapsed = hoursSince(c.approval_clock_started_at);
    return {
      mode: "awaiting_approval",
      hoursElapsed,
      expectedHours,
      summary: `${Math.round(hoursElapsed)}h waiting · SLA ${expectedHours}h`,
    };
  }
  return { mode: "not_applicable", hoursElapsed: 0, expectedHours: 0, summary: "" };
}

// Find all open approval cases for the dashboard tile.
export function approvalCasesFromList(cases: Case[]) {
  const awaiting: Array<{ case: Case; state: ApprovalState }> = [];
  const received: Array<{ case: Case; state: ApprovalState }> = [];
  for (const c of cases) {
    const s = approvalStateFor(c);
    if (s.mode === "awaiting_approval") awaiting.push({ case: c, state: s });
    else if (s.mode === "approval_received") received.push({ case: c, state: s });
  }
  // Sort by remaining time (most urgent first)
  awaiting.sort((a, b) => (a.state.expectedHours - a.state.hoursElapsed) - (b.state.expectedHours - b.state.hoursElapsed));
  received.sort((a, b) => (a.state.expectedHours - a.state.hoursElapsed) - (b.state.expectedHours - b.state.hoursElapsed));
  return { awaiting, received };
}

// Auto-admit detector: any uploaded doc with stage=mid_way auto-promotes
// a case from awaiting/approval-received → admitted.
import type { CaseDocument } from "./mockDocuments";
const MID_WAY_DOC_TYPES = new Set([
  "Chemo Chart", "OT Notes", "Anaesthesia Note", "Stent / Implant Invoice",
  "Cath Lab Note", "Implant Sticker / Barcode", "Ortho OT Notes",
  "Ventilator / Vitals Chart", "ICU Admission Note", "NICU Chart",
  "Delivery Note", "Daily Progress Notes", "Cardiac OT Notes",
  "Dialysis Frequency Log", "Drug Pouch / Wrapper Photo",
]);

export function shouldAutoAdmit(c: Case, uploaded: CaseDocument[]): boolean {
  if (c.status !== "awaiting_approval" && c.status !== "approval_received"
   && c.status !== "preauth_pending") return false;
  return uploaded.some((d) => MID_WAY_DOC_TYPES.has(d.doc_type));
}
