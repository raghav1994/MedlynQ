// Apply a NHCX ClaimResponse to a Case → returns the patched Case + a
// human-readable transition reason. Pure function (no I/O). Used by both the
// send route (to mutate live state) and loadDynamicData (to replay persisted
// overrides on server boot).
//
// Transitions:
//   approved (preauth Bundle)  → preauth_approved + approved_amount
//   approved (claim Bundle)    → approved + approved_amount
//   queried                    → query (open_queries += 1)
//   rejected                   → rejected + scheme_history append
//   transmission_failed        → no state change, just a flag

import type { Case, ClaimStatus } from "@/lib/types";

export type NhcxOutcome = "approved" | "queried" | "rejected" | "transmission_failed" | "received";

export type StateTransition = {
  case_id: string;
  prev_status: ClaimStatus;
  next_status: ClaimStatus;
  reason: string;
  approved_amount?: number | null;
  approval_received_at?: string;
  approval_valid_till?: string;
  open_queries_delta?: number;
  scheme_history_append?: Case["scheme_history"] extends Array<infer T> | undefined ? T : never;
};

export function deriveTransition(
  c: Case,
  outcome: NhcxOutcome,
  nhcxResponse: any,
  bundleUse: "preauthorization" | "claim",
): StateTransition | null {
  const now = new Date().toISOString();
  const notes: string[] = (nhcxResponse?.note ?? []).map((n: any) => n.text).filter(Boolean);
  const noteJoined = notes.join(" | ");

  if (outcome === "approved") {
    const approvedAmount = parseApprovedAmount(notes) ?? c.claimed_amount;
    if (bundleUse === "preauthorization") {
      const validTill = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      return {
        case_id: c.id,
        prev_status: c.status,
        next_status: "preauth_approved",
        reason: `NHCX approved pre-auth — ${noteJoined}`,
        approved_amount: approvedAmount,
        approval_received_at: now,
        approval_valid_till: validTill,
      };
    }
    return {
      case_id: c.id,
      prev_status: c.status,
      next_status: "approved",
      reason: `NHCX approved claim — ${noteJoined}`,
      approved_amount: approvedAmount,
    };
  }

  if (outcome === "queried") {
    return {
      case_id: c.id,
      prev_status: c.status,
      next_status: "query",
      reason: `NHCX query — ${noteJoined}`,
      open_queries_delta: 1,
    };
  }

  if (outcome === "rejected") {
    return {
      case_id: c.id,
      prev_status: c.status,
      next_status: "rejected",
      reason: `NHCX rejected — ${noteJoined}`,
      scheme_history_append: {
        scheme: c.scheme,
        scheme_variant: c.scheme_variant,
        attempted_at: now,
        outcome: "rejected" as const,
        rejection_reason: noteJoined.slice(0, 200),
      },
    };
  }

  return null;
}

export function applyTransition(c: Case, t: StateTransition): Case {
  return {
    ...c,
    status: t.next_status,
    approved_amount: t.approved_amount ?? c.approved_amount,
    approval_received_at: t.approval_received_at ?? c.approval_received_at,
    approval_valid_till: t.approval_valid_till ?? c.approval_valid_till,
    open_queries: c.open_queries + (t.open_queries_delta ?? 0),
    scheme_history: t.scheme_history_append
      ? [...(c.scheme_history ?? []), t.scheme_history_append]
      : c.scheme_history,
  };
}

function parseApprovedAmount(notes: string[]): number | null {
  for (const n of notes) {
    const m = n.match(/Approved amount:\s*₹\s*([\d,]+)/);
    if (m) return Number(m[1].replace(/,/g, ""));
  }
  return null;
}
