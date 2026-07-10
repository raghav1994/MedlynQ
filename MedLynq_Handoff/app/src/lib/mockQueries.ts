// Multi-round query history per case + per-round deadline tracking.
//
// J1 update: queries can now be raised at any case stage, not just post-claim.
// stage = "pre_auth" | "approval" | "mid_way" | "discharge" | "claim"
//   pre_auth  — CGHS, ECHS, Railway, TPA send queries before admission
//   approval  — Ayushman, FCI send queries before granting approval letter
//   mid_way   — during treatment (rare)
//   discharge — at discharge bundle submission
//   claim     — after final claim submission (most common)
//
// QUERY DEADLINE DEFAULT = 15 days. Scheme-specific SLAs to be confirmed
// per MEDCO — TODO: replace with per-scheme value when user provides.

export type QueryStage = "pre_auth" | "approval" | "mid_way" | "discharge" | "claim";

export type QueryRound = {
  id: string;
  case_id: string;
  round: number;
  stage?: QueryStage;                     // J1: which case stage this query attaches to
  raw_text: string;
  raised_by: string;
  raised_on: string;
  query_type?: string;
  amount_at_stake: number;
  status: "open" | "responded" | "resolved" | "rejected"; // J4: "rejected" = scheme disapproved
  deadline_days_total?: number;
  days_since_raised?: number;
  awaiting_doc_type?: string;
  response?: {
    text: string;
    attached_doc_filenames: string[];
    sent_on: string;
    drafted_by?: string;
  };
};

// Vikram Singh — Round 3 is an open post-op HPE query with countdown
const VIKRAM_QUERIES: QueryRound[] = [
  {
    id: "q1", case_id: "2026051410041450", round: 1,
    raw_text: "PROVIDE POST OP HPE REPORT FOR ABOVE PROCEDURE",
    raised_by: "Railway UMID · TPA Cell",
    raised_on: "16 May 2026",
    query_type: "missing_doc",
    amount_at_stake: 42500,
    status: "resolved",
    response: {
      text: "Histopathology report and clinical notes attached.",
      attached_doc_filenames: ["HPE_Report.pdf", "Clinical_Vitals.pdf"],
      sent_on: "19 May 2026",
      drafted_by: "Priya V.",
    },
  },
  {
    id: "q2", case_id: "2026051410041450", round: 2,
    raw_text: "ATTACH DRUG POUCH BAR CODE / WRAPPER PHOTO FOR THIS CYCLE",
    raised_by: "Railway UMID · TPA Cell",
    raised_on: "24 May 2026",
    query_type: "missing_doc",
    amount_at_stake: 42500,
    status: "responded",
    response: {
      text: "Drug pouch backup attached from inventory record.",
      attached_doc_filenames: ["Inventory_Pouch_Backup.jpg"],
      sent_on: "27 May 2026",
      drafted_by: "Priya V.",
    },
  },
  {
    id: "q3", case_id: "2026051410041450", round: 3,
    raw_text: "PROVIDE POST OP HISTOPATHOLOGY REPORT WITH CLEAR MARGINS",
    raised_by: "Railway UMID · TPA Cell",
    raised_on: "31 May 2026",
    query_type: "post_op_hpe",
    amount_at_stake: 42500,
    status: "open",
    deadline_days_total: 15,
    days_since_raised: 14,
    awaiting_doc_type: "Post-op Pathology (HPE)",
  },
];

// Mohan Lal — surgery with code-mismatch query
const MOHAN_QUERIES: QueryRound[] = [
  {
    id: "q1", case_id: "2026051810066828", round: 1,
    raw_text: "ATTACH OT NOTES AND POST-OPERATIVE PHOTOS FOR SC061A",
    raised_by: "CGHS Central",
    raised_on: "23 May 2026",
    query_type: "missing_doc",
    amount_at_stake: 234500,
    status: "resolved",
    response: {
      text: "OT notes and post-op photographs attached.",
      attached_doc_filenames: ["OT_Notes.pdf", "PostOp_Photo.jpg"],
      sent_on: "26 May 2026",
      drafted_by: "Priya V.",
    },
  },
  {
    id: "q2", case_id: "2026051810066828", round: 2,
    raw_text: "PROVIDE POST OPERATIVE HISTOPATHOLOGY REPORT CONFIRMING TUMOR-FREE MARGINS",
    raised_by: "CGHS Central",
    raised_on: "30 May 2026",
    query_type: "post_op_hpe",
    amount_at_stake: 234500,
    status: "open",
    deadline_days_total: 15,
    days_since_raised: 8,
    awaiting_doc_type: "Post-op Pathology (HPE)",
  },
];

// Rajkumari — consent query
const RAJKUMARI_QUERIES: QueryRound[] = [
  {
    id: "q1", case_id: "2026051910005686", round: 1,
    raw_text: "PROVIDE CONSENT FORM WITH PATIENT SIGNATURE AND DATE FOR CHEMOTHERAPY",
    raised_by: "NHA / SHA Delhi",
    raised_on: "22 May 2026",
    query_type: "missing_doc",
    amount_at_stake: 31740,
    status: "open",
    deadline_days_total: 15,
    days_since_raised: 4,
    awaiting_doc_type: "Consent Form",
  },
];

// Anita Yadav — Ayushman SHA UP, approval-stage query (J2)
// The scheme asks for additional docs BEFORE granting the approval letter.
const ANITA_APPROVAL_QUERIES: QueryRound[] = [
  {
    id: "q1", case_id: "APR-2026-0301", round: 1,
    stage: "approval",
    raw_text: "ATTACH CBC / LFT / KFT BASELINE PROFILE BEFORE APPROVAL CAN BE PROCESSED",
    raised_by: "NHA / SHA UP · Pre-approval desk",
    raised_on: "26 Jun 2026",
    query_type: "missing_doc",
    amount_at_stake: 42500,
    status: "open",
    deadline_days_total: 15,
    days_since_raised: 1,
    awaiting_doc_type: "CBC / LFT / KFT Profile",
  },
];

// Sushila Gupta — CGHS pre-auth query (J2 example — pre_auth stage)
const SUSHILA_PREAUTH_QUERIES: QueryRound[] = [
  {
    id: "q1", case_id: "PRE-2026-0118", round: 1,
    stage: "pre_auth",
    raw_text: "GEOTAG PHOTO RESOLUTION TOO LOW — RESHARE CLEAR 2 MP+ IMAGE WITH GPS METADATA",
    raised_by: "NHA / SHA Delhi · Pre-auth desk",
    raised_on: "26 Jun 2026",
    query_type: "missing_doc",
    amount_at_stake: 134550,
    status: "open",
    deadline_days_total: 15,
    days_since_raised: 1,
    awaiting_doc_type: "Geotag Photo",
  },
];

export const QUERIES_BY_CASE: Record<string, QueryRound[]> = {
  "2026051410041450": VIKRAM_QUERIES,
  "2026051810066828": MOHAN_QUERIES,
  "PRE-2026-0118":    SUSHILA_PREAUTH_QUERIES,
};

// Real query-resolution overlay — same additive patch pattern as
// db/patient_overrides.json. Written by POST /api/query/resolve. Keyed by
// query round id, applied on top of the static fixture rounds above so a
// real "Resolve" click persists across reloads without needing a full
// database migration for query state.
function readQueryOverrides(): Record<string, Partial<QueryRound>> {
  if (typeof window !== "undefined") return {};
  try {
    const fs = require("fs");
    const path = require("path");
    const p = path.join(process.cwd(), "db", "query_overrides.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {}
  return {};
}

export function queriesForCase(case_id: string): QueryRound[] {
  const base = QUERIES_BY_CASE[case_id] ?? [];
  const overrides = readQueryOverrides();
  return base.map((r) => (overrides[r.id] ? { ...r, ...overrides[r.id] } : r));
}

// All open queries across cases with deadlines — for dashboard nudges
export function openQueriesWithDeadline(): QueryRound[] {
  const out: QueryRound[] = [];
  for (const rounds of Object.values(QUERIES_BY_CASE)) {
    for (const r of rounds) {
      if (r.status === "open" && r.deadline_days_total !== undefined) {
        out.push(r);
      }
    }
  }
  return out.sort((a, b) => (b.days_since_raised ?? 0) - (a.days_since_raised ?? 0));
}

// All open post-op HPE queries specifically — for the new dashboard tile
export function openPostOpHPEQueries(): QueryRound[] {
  return openQueriesWithDeadline().filter((q) => q.query_type === "post_op_hpe");
}
