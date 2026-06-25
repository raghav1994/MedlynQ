// Multi-round query history per case + 15-day post-op HPE deadline tracking.

export type QueryRound = {
  id: string;
  case_id: string;
  round: number;
  raw_text: string;
  raised_by: string;
  raised_on: string;
  query_type?: string;
  amount_at_stake: number;
  status: "open" | "responded" | "resolved";
  // NEW: deadline tracking for queries asking for slow-arriving docs (post-op HPE)
  deadline_days_total?: number;          // total days payer gives us to respond
  days_since_raised?: number;             // computed: days since query arrived
  awaiting_doc_type?: string;             // what doc the payer is waiting on
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

export const QUERIES_BY_CASE: Record<string, QueryRound[]> = {
  "2026051410041450": VIKRAM_QUERIES,
  "2026051810066828": MOHAN_QUERIES,
  "2026051910005686": RAJKUMARI_QUERIES,
};

export function queriesForCase(case_id: string): QueryRound[] {
  return QUERIES_BY_CASE[case_id] ?? [];
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
