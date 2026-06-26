// Doc-level + case-level synopsis types and mock data.
// In production these come from PatientLog/{MRN}/extracted/*.json
// (output of app/python/pipeline.py).

export type DocSynopsis = {
  doc_id: string;
  doc_type: string;
  label: string;
  fields: Record<string, string | number | null>;
  suggests: string[];
  confidence: number | null;
  flags: string[];
};

export type CaseSynopsis = {
  case_id: string;
  paragraph: string;
  drugs_mentioned: string[];
  procedures: string[];
  diagnosis: string | null;
  stage: string | null;
  alignment: { aligned_docs: number; total_docs: number; open_queries: number };
};

// Mock until pipeline.py output is wired
const MOCK_DOC_SYNOPSIS: Record<string, DocSynopsis> = {
  "HPE_Report_2026-05-19.pdf": {
    doc_id: "HPE_Report_2026-05-19.pdf",
    doc_type: "hpe_report",
    label: "Histopathology Report",
    fields: {
      diagnosis: "Invasive ductal carcinoma",
      primary_site: "Left breast",
      grade: "II",
      stage_t: "pT2",
      stage_n: "pN1",
      stage_m: "M0",
      margins_status: "Clear",
      margin_distance_mm: 5,
      lymph_nodes_examined: 14,
      lymph_nodes_positive: 2,
      receptor_er: "Positive",
      receptor_pr: "Positive",
      receptor_her2: "Negative",
      specimen_date: "2026-05-14",
      report_date: "2026-05-19",
      pathologist: "Dr. R. Iyer",
    },
    suggests: ["adjuvant_chemo_indicated"],
    confidence: 0.94,
    flags: [],
  },
  "Discharge_Summary_2026-05-17.pdf": {
    doc_id: "Discharge_Summary_2026-05-17.pdf",
    doc_type: "discharge_summary",
    label: "Discharge Summary",
    fields: {
      final_diagnosis: "Ca breast (L), s/p MRM + axillary clearance",
      procedures_done: "MRM left + SLNB",
      drugs_given: "Cefoperazone, Tramadol, Pantoprazole",
      admission_date: "2026-05-12",
      discharge_date: "2026-05-17",
      icu_days: 0,
      follow_up_plan: "Oncology OPD in 7 days for HPE review + chemo planning",
      complications: "None",
      condition_at_discharge: "Stable",
    },
    suggests: ["next_cycle_date"],
    confidence: 0.91,
    flags: [],
  },
  "Hospital_Bill_2026-05-17.pdf": {
    doc_id: "Hospital_Bill_2026-05-17.pdf",
    doc_type: "bill",
    label: "Final Bill",
    fields: {
      total_amount: 234500,
      package_rate: 230000,
      scheme_cap: 250000,
      bill_date: "2026-05-17",
      bill_no: "IPD/2026/04421",
      hospital_name: "Apex Hospital",
    },
    suggests: [],
    confidence: 0.96,
    flags: [],
  },
  "Chemo_Chart_2026-05-26.pdf": {
    doc_id: "Chemo_Chart_2026-05-26.pdf",
    doc_type: "chemo_chart",
    label: "Chemotherapy Chart",
    fields: {
      regimen: "TAC",
      cycle_no: 1,
      drugs: "Docetaxel, Doxorubicin, Cyclophosphamide",
      doses_mg: "Doc 135, Dox 90, Cyc 900",
      bsa_m2: 1.62,
      administration_date: "2026-05-26",
      premedications: "Dexamethasone, Ondansetron",
    },
    suggests: ["bsa_calculation_check"],
    confidence: 0.88,
    flags: [],
  },
};

export function synopsisFor(filename: string): DocSynopsis | null {
  return MOCK_DOC_SYNOPSIS[filename] ?? null;
}

// Server-side fetch: pulls real pipeline output for a given MRN.
// Falls back to mock case synopsis if no extracted JSON exists yet.
export async function fetchCaseSynopsisFromPipeline(
  mrn: string,
  baseUrl: string = ""
): Promise<{ case: CaseSynopsis | null; doc_synopses: DocSynopsis[]; source: "pipeline" | "mock" | "empty" }> {
  try {
    const url = `${baseUrl}/api/synopsis?mrn=${encodeURIComponent(mrn)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    if (json.ok && (json.doc_synopses?.length > 0 || json.case)) {
      return { case: json.case, doc_synopses: json.doc_synopses ?? [], source: "pipeline" };
    }
  } catch {
    // fall through to mock
  }
  return { case: null, doc_synopses: [], source: "empty" };
}

export function caseSynopsisFor(case_id: string): CaseSynopsis | null {
  if (case_id === "2026051410041450") {
    return {
      case_id,
      paragraph:
        "Patient came for left breast Ca → MRM done 14-May → HPE shows clear margins (5mm), pT2N1M0, ER/PR+ HER2− → adjuvant chemo (TAC × 4) planned, Cycle 1 done 26-May.",
      drugs_mentioned: ["Docetaxel", "Doxorubicin", "Cyclophosphamide", "Cefoperazone"],
      procedures: ["MRM (left)", "SLNB"],
      diagnosis: "Invasive ductal carcinoma, left breast",
      stage: "pT2N1M0",
      alignment: { aligned_docs: 4, total_docs: 5, open_queries: 1 },
    };
  }
  if (case_id === "2026051810066828") {
    return {
      case_id,
      paragraph:
        "Mohan Lal admitted for laryngeal Ca, total laryngectomy + neck dissection done. Post-op HPE pending (query open Day 8). All other docs aligned.",
      drugs_mentioned: ["Piperacillin-Tazobactam", "Tramadol"],
      procedures: ["Total Laryngectomy", "Modified Radical Neck Dissection"],
      diagnosis: "Squamous cell carcinoma, larynx",
      stage: "cT3N1M0",
      alignment: { aligned_docs: 5, total_docs: 6, open_queries: 1 },
    };
  }
  return null;
}
