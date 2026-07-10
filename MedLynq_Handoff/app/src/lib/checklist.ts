// Stage-aware + treatment-aware document checklist engine.
// Updated D-4: added oncology-specific docs (TBC, BIS, Discharge Photo, PET-CT, Chemo Chart).

import type { CaseDocument } from "./mockDocuments";
import type { Case, Treatment, Stage, Specialty } from "./types";

export type ChecklistRule = {
  doc_type: string;
  stage: Stage;
  for_treatments?: Treatment[];
  for_specialties?: Specialty[]; // omitted = applies to all (universal docs)
  // alt_group: items in the same group are alternatives — any one satisfies.
  // e.g. Histopath | Biopsy | PET-CT all in group "report" → only one needed.
  alt_group?: string;
};

export const RULES: ChecklistRule[] = [
  // ============ OPD ============
  // The doctor's prescription IS the OPD slip — merged per your direction.
  { doc_type: "Doctor's Prescription", stage: "opd" },

  // ============ PRE-AUTH ============
  // Universal across every scheme + specialty
  { doc_type: "Aadhaar",              stage: "pre_auth" },
  { doc_type: "Insurance / Scheme Card", stage: "pre_auth" },
  { doc_type: "Consent Form",         stage: "pre_auth" },
  // Report alt-group (any one satisfies the requirement) — oncology only
  { doc_type: "Histopathology Report", stage: "pre_auth", for_specialties: ["oncology"], alt_group: "report" },
  { doc_type: "Biopsy Report",         stage: "pre_auth", for_specialties: ["oncology"], alt_group: "report" },
  { doc_type: "PET-CT Report",         stage: "pre_auth", for_specialties: ["oncology"], alt_group: "report" },
  // Oncology specialty extras
  { doc_type: "Tumor Board Certificate", stage: "pre_auth", for_specialties: ["oncology"] }, // also gated by public-scheme rule at scheme master level
  { doc_type: "Prior Imaging (CT/MRI/X-ray)", stage: "pre_auth", for_treatments: ["surgery", "radiation"], for_specialties: ["oncology"] },
  // CBC/LFT/KFT now required at pre-auth for Ayushman + all SHAs (per your latest direction).
  // The scheme master CSV decides per-scheme; the checklist rule below stays for chemo legacy.
  { doc_type: "CBC / LFT / KFT Profile", stage: "pre_auth", for_treatments: ["chemo"] },

  // ===== Cardiac =====
  { doc_type: "ECHO Report",         stage: "pre_auth", for_specialties: ["cardiac"] },
  { doc_type: "ECG Report",          stage: "pre_auth", for_specialties: ["cardiac"] },
  { doc_type: "Coronary Angiography Report", stage: "pre_auth", for_specialties: ["cardiac"] },
  { doc_type: "Cardiac Pre-Op Workup", stage: "pre_auth", for_specialties: ["cardiac"] },

  // ===== Ortho =====
  { doc_type: "Pre-Op X-Ray",        stage: "pre_auth", for_specialties: ["ortho"] },
  { doc_type: "MRI / CT Joint Report", stage: "pre_auth", for_specialties: ["ortho"] },
  { doc_type: "Ortho Surgeon Note",  stage: "pre_auth", for_specialties: ["ortho"] },

  // ===== Dialysis =====
  { doc_type: "Renal Function Panel", stage: "pre_auth", for_specialties: ["dialysis"] },
  { doc_type: "AV Fistula / Access Note", stage: "pre_auth", for_specialties: ["dialysis"] },

  // ===== ICU =====
  { doc_type: "ICU Admission Note",  stage: "pre_auth", for_specialties: ["icu"] },
  { doc_type: "APACHE / SOFA Score Sheet", stage: "pre_auth", for_specialties: ["icu"] },

  // ===== Maternity =====
  { doc_type: "Antenatal Card",      stage: "pre_auth", for_specialties: ["maternity"] },
  { doc_type: "USG Reports",         stage: "pre_auth", for_specialties: ["maternity"] },
  { doc_type: "Maternal Blood Group / VDRL / HIV", stage: "pre_auth", for_specialties: ["maternity"] },

  // ============ MID-WAY ============
  // Chemo
  { doc_type: "Drug Pouch / Wrapper Photo", stage: "mid_way", for_treatments: ["chemo"] },
  { doc_type: "Chemo Chart",                stage: "mid_way", for_treatments: ["chemo"] },
  { doc_type: "IPD File (day care)",        stage: "mid_way", for_treatments: ["chemo"] },
  // Surgery
  { doc_type: "OT Notes",            stage: "mid_way", for_treatments: ["surgery"] },
  { doc_type: "OT Files",            stage: "mid_way", for_treatments: ["surgery"] },
  { doc_type: "Anaesthesia Note",    stage: "mid_way", for_treatments: ["surgery"] },
  { doc_type: "Post Surgery Photo",  stage: "mid_way", for_treatments: ["surgery"] },
  // Radiation
  { doc_type: "Radiation Files",     stage: "mid_way", for_treatments: ["radiation"] },
  { doc_type: "Radiation Chart",     stage: "mid_way", for_treatments: ["radiation"] },

  // ===== Cardiac mid-way =====
  { doc_type: "Stent / Implant Invoice", stage: "mid_way", for_specialties: ["cardiac"] },
  { doc_type: "Cath Lab Note",       stage: "mid_way", for_specialties: ["cardiac"] },
  { doc_type: "Cardiac OT Notes",    stage: "mid_way", for_specialties: ["cardiac"], for_treatments: ["surgery"] },

  // ===== Ortho mid-way =====
  { doc_type: "Implant Sticker / Barcode", stage: "mid_way", for_specialties: ["ortho"] },
  { doc_type: "Ortho OT Notes",      stage: "mid_way", for_specialties: ["ortho"] },
  { doc_type: "Post-Op X-Ray",       stage: "mid_way", for_specialties: ["ortho"] },

  // ===== Dialysis mid-way =====
  { doc_type: "Dialysis Frequency Log", stage: "mid_way", for_specialties: ["dialysis"] },
  { doc_type: "KT/V or URR Note",    stage: "mid_way", for_specialties: ["dialysis"] },

  // ===== ICU mid-way =====
  { doc_type: "Ventilator / Vitals Chart", stage: "mid_way", for_specialties: ["icu"] },
  { doc_type: "Daily Progress Notes", stage: "mid_way", for_specialties: ["icu"] },

  // ===== Maternity mid-way =====
  { doc_type: "Delivery Note",       stage: "mid_way", for_specialties: ["maternity"] },
  { doc_type: "NICU Chart",          stage: "mid_way", for_specialties: ["maternity"] },
  { doc_type: "Partograph",          stage: "mid_way", for_specialties: ["maternity"] },

  // ============ DISCHARGE ============
  // Per your direction, Registration Copy + IPD File moved here from pre-auth.
  { doc_type: "Feedback Form",       stage: "discharge" },
  { doc_type: "Discharge Summary",   stage: "discharge" },
  { doc_type: "Discharge Photo",     stage: "discharge", for_treatments: ["chemo", "surgery"] },
  { doc_type: "Hospital Bill",       stage: "discharge" },
  { doc_type: "Geotag Photo",        stage: "discharge", for_treatments: ["chemo", "surgery"] },
  { doc_type: "Registration Copy",   stage: "discharge" },          // moved from pre-auth
  { doc_type: "IPD File (admission)", stage: "discharge" },          // moved from pre-auth
  { doc_type: "Post-op Notes",       stage: "discharge", for_treatments: ["surgery"] },
  { doc_type: "Post-op HPE Report",  stage: "discharge", for_specialties: ["oncology"], for_treatments: ["surgery"] },
  { doc_type: "Clinical Vitals Log", stage: "discharge" },
];

export type ChecklistEntry = {
  doc_type: string;
  stage: Stage;
  status: "present" | "low_confidence" | "missing" | "alternative_present" | "skipped";
  source?: string;
  updated?: string;
  alt_group?: string;
  // The actual landed document matched to this slot, if any — lets the UI
  // render its thumbnail inline instead of just a present/missing dot.
  doc?: CaseDocument;
};

const DOC_TYPE_ALIASES: Record<string, string[]> = {
  "Doctor's Prescription":   ["Prescription", "OPD Slip", "Doctor Prescription", "Protocol", "Chemo Protocol", "Prescription / Protocol"],
  "Aadhaar":                  ["Patient ID", "Aadhar", "Aadhaar Card"],
  "Insurance / Scheme Card":  ["Insurance Card", "Scheme Card", "PMJAY Card", "CGHS Card", "ECHS Card", "Ayushman Card"],
  "Histopathology Report":    ["Histopath", "HPE", "Histopathology", "Latest Pathology (HPE)"],
  "Biopsy Report":            ["Biopsy"],
  "CBC / LFT / KFT Profile":  ["CBC Report", "LFT Report", "KFT Report", "Baseline Labs"],
  "IPD File (admission)":     ["IPD File"],
  "IPD File (day care)":      ["IPD File"],
  "Drug Pouch / Wrapper Photo": ["Drug Pouch Barcode", "Pouch Photo"],
  "Prior Imaging (CT/MRI/X-ray)": ["Prior Imaging"],
  "Discharge Photo":          ["DSP", "Dis Pic"],
  "Tumor Board Certificate":  ["TBC"],
  "PET-CT Report":            ["PET CT", "PETCT"],
  "Geotag Photo":             ["Geo Tag Photo", "Geo-tag Photo"],
  "Referral":                 ["Referral Letter", "Outside Hospital Referral"],
  "Apex Form":                ["ECHS Apex Form"],
  "Approval Letter":          ["Approval", "Pre-Approval Letter", "Sanction Letter"],
};

function matchDocument(uploaded: CaseDocument[], targetType: string): CaseDocument | undefined {
  const aliases = [targetType, ...(DOC_TYPE_ALIASES[targetType] ?? [])];
  for (const a of aliases) {
    const hit = uploaded.find((d) => d.doc_type.toLowerCase() === a.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

export function buildChecklist(
  uploaded: CaseDocument[],
  treatment: Treatment,
  specialty: Specialty = "oncology",
  skippedDocTypes: string[] = [],
): ChecklistEntry[] {
  const skipped = new Set(skippedDocTypes.map((s) => s.toLowerCase()));
  const applicable = RULES.filter((r) => {
    const treatOk = !r.for_treatments || r.for_treatments.includes(treatment);
    const specOk = !r.for_specialties || r.for_specialties.includes(specialty);
    return treatOk && specOk;
  });

  // First pass: resolve each rule independently.
  const raw = applicable.map((rule) => {
    const found = matchDocument(uploaded, rule.doc_type);
    const status: ChecklistEntry["status"] = !found
      ? (skipped.has(rule.doc_type.toLowerCase()) ? "skipped" : "missing")
      : found.confidence !== undefined && found.confidence < 0.7
      ? "low_confidence"
      : "present";
    return {
      doc_type: rule.doc_type,
      stage: rule.stage,
      status,
      source: found?.source,
      updated: found?.uploaded_at,
      alt_group: rule.alt_group,
      doc: found,
    } as ChecklistEntry & { alt_group?: string };
  });

  // Second pass: collapse alt-groups — if any sibling is present, the others
  // are no longer missing; they become "alternative".
  const groupHasPresent = new Map<string, boolean>();
  for (const r of raw) {
    if (r.alt_group && (r.status === "present" || r.status === "low_confidence")) {
      groupHasPresent.set(r.alt_group, true);
    }
  }
  return raw.map((r) => {
    if (r.alt_group && groupHasPresent.get(r.alt_group) && r.status === "missing") {
      return { ...r, status: "alternative_present" as ChecklistEntry["status"] };
    }
    return r;
  });
}

// Docs that landed but didn't match any checklist slot for this
// treatment/specialty — either genuinely unclassified ("Unknown Document")
// or a real doc_type that just isn't on this case's required list. Surfaced
// as an "Unsorted" tray so nothing silently disappears from the merged view.
export function unmatchedDocuments(uploaded: CaseDocument[], entries: ChecklistEntry[]): CaseDocument[] {
  const matchedIds = new Set(entries.map((e) => e.doc?.id).filter(Boolean));
  return uploaded.filter((d) => !matchedIds.has(d.id));
}

const COMPLIANT_STATUSES = new Set(["present", "alternative_present", "skipped"]);

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((100 * numerator) / denominator) : 100;
}

// Compliance Health panel, real half — the other two rows (Empanelment
// renewal, Audit trail completeness) have no backing data source anywhere in
// the app and stay hardcoded mock; don't extend this to fake those without a
// real signal to compute them from.
export function complianceHealth(
  cases: Case[],
  docsForCase: (case_id: string) => CaseDocument[],
): { consentFormPct: number; postOpImagingPct: number } {
  let consentApplicable = 0, consentPresent = 0;
  let postOpApplicable = 0, postOpPresent = 0;

  for (const c of cases) {
    const docs = docsForCase(c.id);
    const entries = buildChecklist(docs, c.treatment_type, c.specialty ?? "oncology");
    const consent = entries.find((e) => e.doc_type === "Consent Form");
    if (consent) {
      consentApplicable += 1;
      if (COMPLIANT_STATUSES.has(consent.status)) consentPresent += 1;
    }
    if (c.treatment_type === "surgery") {
      const postOp = entries.find((e) => e.doc_type === "Post Surgery Photo");
      if (postOp) {
        postOpApplicable += 1;
        if (COMPLIANT_STATUSES.has(postOp.status)) postOpPresent += 1;
      }
    }
  }

  return {
    consentFormPct: pct(consentPresent, consentApplicable),
    postOpImagingPct: pct(postOpPresent, postOpApplicable),
  };
}

export function summaryByStage(entries: ChecklistEntry[]) {
  const stages: Stage[] = ["opd", "pre_auth", "mid_way", "discharge"];
  return stages.map((s) => {
    const items = entries.filter((e) => e.stage === s);
    return {
      stage: s,
      total: items.length,
      present: items.filter((e) => e.status === "present" || e.status === "alternative_present" || e.status === "skipped").length,
      low_confidence: items.filter((e) => e.status === "low_confidence").length,
      missing: items.filter((e) => e.status === "missing").length,
    };
  });
}

// The MEDCO-facing "which stage is this file at" indicator should track real
// document completion, not just the case's business ClaimStatus — a stage's
// docs can be finished well before/after the case's formal status catches up
// (e.g. OPD docs done but MEDCO hasn't sent pre-auth paperwork yet). Walk the
// 4 stages in order and stop at the first one that isn't fully done; once
// every stage is complete, discharge is the resting point.
export function deriveCurrentStage(perStage: ReturnType<typeof summaryByStage>): Stage {
  for (const s of perStage) {
    if (s.total > 0 && s.missing > 0) return s.stage;
  }
  return perStage[perStage.length - 1]?.stage ?? "discharge";
}

export function requiredDocsByTreatment(
  treatment: Treatment,
  specialty: Specialty = "oncology",
) {
  const applicable = RULES.filter((r) => {
    const treatOk = !r.for_treatments || r.for_treatments.includes(treatment);
    const specOk = !r.for_specialties || r.for_specialties.includes(specialty);
    return treatOk && specOk;
  });
  const grouped: Record<Stage, string[]> = { opd: [], pre_auth: [], mid_way: [], discharge: [] };
  for (const r of applicable) grouped[r.stage].push(r.doc_type);
  return grouped;
}
