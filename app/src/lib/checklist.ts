// Stage-aware + treatment-aware document checklist engine.
// Updated D-4: added oncology-specific docs (TBC, BIS, Discharge Photo, PET-CT, Chemo Chart).

import type { CaseDocument } from "./mockDocuments";
import type { Treatment, Stage, Specialty } from "./types";

export type ChecklistRule = {
  doc_type: string;
  stage: Stage;
  for_treatments?: Treatment[];
  for_specialties?: Specialty[]; // omitted = applies to all (universal docs)
};

export const RULES: ChecklistRule[] = [
  // ============ PRE-AUTH ============
  { doc_type: "Patient ID",          stage: "pre_auth" },
  { doc_type: "Consent Form",        stage: "pre_auth" },
  { doc_type: "Referral",            stage: "pre_auth" },
  { doc_type: "Registration Copy",   stage: "pre_auth" },
  { doc_type: "Beneficiary Verification Slip", stage: "pre_auth" }, // NEW · BIS · govt portal verification
  { doc_type: "Latest Pathology (HPE)", stage: "pre_auth", for_specialties: ["oncology"] },
  { doc_type: "PET-CT Report",       stage: "pre_auth", for_specialties: ["oncology"] },
  { doc_type: "Tumor Board Certificate", stage: "pre_auth", for_specialties: ["oncology"] },
  { doc_type: "Prescription / Protocol", stage: "pre_auth" },
  { doc_type: "OPD Slip",            stage: "pre_auth" },
  { doc_type: "CBC / LFT / KFT Profile", stage: "pre_auth", for_treatments: ["chemo"], for_specialties: ["oncology"] },
  { doc_type: "IPD File (admission)",    stage: "pre_auth", for_treatments: ["chemo", "surgery"] },
  { doc_type: "Prior Imaging (CT/MRI/X-ray)", stage: "pre_auth", for_treatments: ["surgery", "radiation"], for_specialties: ["oncology"] },

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
  { doc_type: "Feedback Form",       stage: "discharge" },
  { doc_type: "Discharge Summary",   stage: "discharge" },
  { doc_type: "Discharge Photo",     stage: "discharge", for_treatments: ["chemo", "surgery"] }, // NEW · DSP
  { doc_type: "Hospital Bill",       stage: "discharge" },
  { doc_type: "Geotag Photo",        stage: "discharge", for_treatments: ["chemo", "surgery"] },
  { doc_type: "Post-op Notes",       stage: "discharge", for_treatments: ["surgery"] },
  { doc_type: "Clinical Vitals Log", stage: "discharge" },
];

export type ChecklistEntry = {
  doc_type: string;
  stage: Stage;
  status: "present" | "low_confidence" | "missing";
  source?: string;
  updated?: string;
};

const DOC_TYPE_ALIASES: Record<string, string[]> = {
  "Prescription / Protocol": ["Prescription", "Protocol", "Chemo Protocol"],
  "CBC / LFT / KFT Profile": ["CBC Report", "LFT Report", "KFT Report"],
  "IPD File (admission)":    ["IPD File"],
  "IPD File (day care)":     ["IPD File"],
  "Latest Pathology (HPE)":  ["HPE", "Histopath"],
  "Drug Pouch / Wrapper Photo": ["Drug Pouch Barcode", "Pouch Photo"],
  "Prior Imaging (CT/MRI/X-ray)": ["Prior Imaging"],
  "Discharge Photo":         ["DSP", "Dis Pic"],
  "Beneficiary Verification Slip": ["BIS"],
  "Tumor Board Certificate": ["TBC"],
  "PET-CT Report":           ["PET CT", "PETCT"],
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
): ChecklistEntry[] {
  const applicable = RULES.filter((r) => {
    const treatOk = !r.for_treatments || r.for_treatments.includes(treatment);
    const specOk = !r.for_specialties || r.for_specialties.includes(specialty);
    return treatOk && specOk;
  });

  return applicable.map((rule) => {
    const found = matchDocument(uploaded, rule.doc_type);
    if (!found) {
      return { doc_type: rule.doc_type, stage: rule.stage, status: "missing" };
    }
    return {
      doc_type: rule.doc_type,
      stage: rule.stage,
      status: found.confidence !== undefined && found.confidence < 0.7 ? "low_confidence" : "present",
      source: found.source,
      updated: found.uploaded_at,
    };
  });
}

export function summaryByStage(entries: ChecklistEntry[]) {
  const stages: Stage[] = ["pre_auth", "mid_way", "discharge"];
  return stages.map((s) => {
    const items = entries.filter((e) => e.stage === s);
    return {
      stage: s,
      total: items.length,
      present: items.filter((e) => e.status === "present").length,
      low_confidence: items.filter((e) => e.status === "low_confidence").length,
      missing: items.filter((e) => e.status === "missing").length,
    };
  });
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
  const grouped: Record<Stage, string[]> = { pre_auth: [], mid_way: [], discharge: [] };
  for (const r of applicable) grouped[r.stage].push(r.doc_type);
  return grouped;
}
