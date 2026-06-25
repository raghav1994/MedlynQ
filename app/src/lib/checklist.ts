// Stage-aware + treatment-aware + scheme-aware + TPA-aware document checklist engine.
// D-4: oncology docs (TBC, BIS, PET-CT, Chemo Chart, Discharge Photo)
// D-7: scheme identity docs, emergency waiver, Appex form (from field notes)
// D-7b: TPA type, "Private" scheme, per-TPA additional rules

import type { CaseDocument } from "./mockDocuments";
import type { Treatment, Stage, Scheme, TPA } from "./types";

export type ChecklistRule = {
  doc_type: string;
  stage: Stage;
  for_treatments?: Treatment[];
  for_schemes?: Scheme[];
  for_tpas?: TPA[];        // only shown when case.tpa matches one of these
  emergency_waivable?: boolean; // waived when case.is_emergency = true (CGHS/ECHS referral rule)
};

// PSU insurers need NEFT form + insist on original bills (not photocopies)
const PSU_INSURERS: TPA[] = ["New India", "United India", "Oriental", "National Insurance", "SBI General"];

export const RULES: ChecklistRule[] = [

  // ─────────────────────────────────────────────
  // PRE-AUTH — Universal (all schemes + private)
  // ─────────────────────────────────────────────
  { doc_type: "Prescription / Protocol",       stage: "pre_auth" },
  { doc_type: "Latest Pathology (HPE)",        stage: "pre_auth" },
  { doc_type: "OPD Slip",                      stage: "pre_auth" },
  { doc_type: "Consent Form",                  stage: "pre_auth" },
  { doc_type: "Registration Copy",             stage: "pre_auth" },
  { doc_type: "PET-CT Report",                 stage: "pre_auth" },
  { doc_type: "Tumor Board Certificate",       stage: "pre_auth" },
  { doc_type: "CBC / LFT / KFT Profile",       stage: "pre_auth", for_treatments: ["chemo"] },
  { doc_type: "IPD File (admission)",          stage: "pre_auth", for_treatments: ["chemo", "surgery"] },
  { doc_type: "Prior Imaging (CT/MRI/X-ray)", stage: "pre_auth", for_treatments: ["surgery", "radiation"] },

  // ─────────────────────────────────────────────
  // PRE-AUTH — Government schemes (public TPA)
  // ─────────────────────────────────────────────

  // PMJAY / SHA
  { doc_type: "Beneficiary Verification Slip", stage: "pre_auth", for_schemes: ["PMJAY", "SHA"] },
  { doc_type: "Ayushman Card",                 stage: "pre_auth", for_schemes: ["PMJAY", "SHA"] },
  { doc_type: "Aadhaar Card",                  stage: "pre_auth", for_schemes: ["PMJAY", "SHA"] },
  { doc_type: "Ration Card",                   stage: "pre_auth", for_schemes: ["PMJAY", "SHA"] }, // UP + several SHA states require it

  // CGHS / ECHS (referral-first; waived in emergency)
  { doc_type: "Referral Letter",               stage: "pre_auth", for_schemes: ["CGHS", "ECHS"], emergency_waivable: true },
  { doc_type: "Scheme Card",                   stage: "pre_auth", for_schemes: ["CGHS", "ECHS"] }, // CGHS/CAPF/ECHS card
  { doc_type: "Aadhaar Card",                  stage: "pre_auth", for_schemes: ["CGHS", "ECHS"] },
  { doc_type: "Geo-tag Photo",                 stage: "pre_auth", for_schemes: ["CGHS", "ECHS"] }, // required at intake for these schemes
  { doc_type: "Patient ID",                    stage: "pre_auth", for_schemes: ["CGHS", "ECHS"] },

  // Railway UMID
  { doc_type: "Aadhaar Card",                  stage: "pre_auth", for_schemes: ["Railway"] },
  { doc_type: "UMID Card",                     stage: "pre_auth", for_schemes: ["Railway"] },

  // ESI
  { doc_type: "Aadhaar Card",                  stage: "pre_auth", for_schemes: ["ESI"] },
  { doc_type: "ESI Card",                      stage: "pre_auth", for_schemes: ["ESI"] },
  { doc_type: "Employer IP Declaration",       stage: "pre_auth", for_schemes: ["ESI"] }, // wage/contribution verification

  // ─────────────────────────────────────────────
  // PRE-AUTH — Private insurance (scheme = "Private")
  // ─────────────────────────────────────────────

  { doc_type: "Aadhaar Card",                  stage: "pre_auth", for_schemes: ["Private"] },
  { doc_type: "PAN Card",                      stage: "pre_auth", for_schemes: ["Private"] },
  { doc_type: "Insurance Card",                stage: "pre_auth", for_schemes: ["Private"] },
  { doc_type: "Pre-auth Form",                 stage: "pre_auth", for_schemes: ["Private"] },
  { doc_type: "KYC Form",                      stage: "pre_auth", for_schemes: ["Private"] },
  { doc_type: "Passport Photo",                stage: "pre_auth", for_schemes: ["Private"] }, // main member

  // TPA-specific pre-auth additions
  { doc_type: "Treating Doctor Certificate",   stage: "pre_auth", for_schemes: ["Private"],
    for_tpas: ["Star Health", "ICICI Lombard", "Niva Bupa", "Manipal Cigna"] },

  { doc_type: "NEFT Mandate Form",             stage: "pre_auth", for_schemes: ["Private"],
    for_tpas: PSU_INSURERS },

  { doc_type: "Cashless Authorization Letter", stage: "pre_auth", for_schemes: ["Private"],
    for_tpas: ["HDFC ERGO"] },

  { doc_type: "TPA Claim Form",               stage: "pre_auth", for_schemes: ["Private"],
    for_tpas: ["ICICI Lombard", "Bajaj Allianz", "Tata AIG"] },

  { doc_type: "Case Summary Form",             stage: "pre_auth", for_schemes: ["Private"],
    for_tpas: ["Aditya Birla"] },

  // ─────────────────────────────────────────────
  // MID-WAY — Chemo
  // ─────────────────────────────────────────────
  { doc_type: "Drug Pouch / Wrapper Photo",    stage: "mid_way", for_treatments: ["chemo"] },
  { doc_type: "Chemo Chart",                   stage: "mid_way", for_treatments: ["chemo"] },
  { doc_type: "IPD File (day care)",           stage: "mid_way", for_treatments: ["chemo"] },

  // CGHS/ECHS need an Approval Form (Appex) at mid-way for chemo drug names + SEMO sign
  // Also covers unlisted procedures and implants
  { doc_type: "Approval Form (Appex)",         stage: "mid_way",
    for_schemes: ["CGHS", "ECHS"], for_treatments: ["chemo", "surgery"] },
  // Referral copy required again at mid-way for CGHS/ECHS
  { doc_type: "Referral Letter",               stage: "mid_way",
    for_schemes: ["CGHS", "ECHS"], emergency_waivable: true },

  // ─────────────────────────────────────────────
  // MID-WAY — Surgery
  // ─────────────────────────────────────────────
  { doc_type: "OT Notes",                      stage: "mid_way", for_treatments: ["surgery"] },
  { doc_type: "OT Files",                      stage: "mid_way", for_treatments: ["surgery"] },
  { doc_type: "Anaesthesia Note",              stage: "mid_way", for_treatments: ["surgery"] },
  { doc_type: "Post Surgery Photo",            stage: "mid_way", for_treatments: ["surgery"] },

  // ─────────────────────────────────────────────
  // MID-WAY — Radiation
  // ─────────────────────────────────────────────
  { doc_type: "Radiation Files",               stage: "mid_way", for_treatments: ["radiation"] },
  { doc_type: "Radiation Chart",               stage: "mid_way", for_treatments: ["radiation"] },

  // ─────────────────────────────────────────────
  // DISCHARGE — Universal
  // ─────────────────────────────────────────────
  { doc_type: "Discharge Summary",             stage: "discharge" },
  { doc_type: "Hospital Bill",                 stage: "discharge" },
  { doc_type: "Feedback Form",                 stage: "discharge" },
  { doc_type: "Clinical Vitals Log",           stage: "discharge" },
  { doc_type: "Discharge Photo",               stage: "discharge", for_treatments: ["chemo", "surgery"] },
  { doc_type: "Post-op Notes",                 stage: "discharge", for_treatments: ["surgery"] },

  // Geo-tag at discharge for govt schemes + private
  { doc_type: "Geo-tag Photo",                 stage: "discharge", for_treatments: ["chemo", "surgery"] },

  // CGHS/ECHS — Aadhaar again at discharge + emergency certificate (if emergency admission)
  { doc_type: "Aadhaar Card",                  stage: "discharge", for_schemes: ["CGHS", "ECHS"] },
  { doc_type: "Emergency Certificate",         stage: "discharge", for_schemes: ["CGHS", "ECHS"] },

  // Private — original bills required for PSU reimbursement
  { doc_type: "Original Bills (attested)",     stage: "discharge",
    for_schemes: ["Private"], for_tpas: PSU_INSURERS },
];

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ChecklistEntry = {
  doc_type: string;
  stage: Stage;
  status: "present" | "low_confidence" | "missing";
  source?: string;
  updated?: string;
};

// ─────────────────────────────────────────────
// Aliases — alternate names a clerk might use
// ─────────────────────────────────────────────

const DOC_TYPE_ALIASES: Record<string, string[]> = {
  "Prescription / Protocol":       ["Prescription", "Protocol", "Chemo Protocol", "Doctor Prescription"],
  "CBC / LFT / KFT Profile":       ["CBC Report", "LFT Report", "KFT Report"],
  "IPD File (admission)":          ["IPD File"],
  "IPD File (day care)":           ["IPD File"],
  "Latest Pathology (HPE)":        ["HPE", "Histopath", "Cancer Confirming Report", "Biopsy Report"],
  "Drug Pouch / Wrapper Photo":    ["Drug Pouch Barcode", "Pouch Photo"],
  "Prior Imaging (CT/MRI/X-ray)": ["Prior Imaging"],
  "Discharge Photo":               ["DSP", "Dis Pic"],
  "Beneficiary Verification Slip": ["BIS", "Approval Letter"],
  "Tumor Board Certificate":       ["TBC"],
  "PET-CT Report":                 ["PET CT", "PETCT"],
  "Referral Letter":               ["Referral", "Ref Letter"],
  "Aadhaar Card":                  ["Aadhar Card", "Aadhar", "Aadhaar"],
  "Scheme Card":                   ["CGHS Card", "CAPF Card", "ECHS Card", "Health Card"],
  "Ayushman Card":                 ["Ayushman Bharat Card", "AB Card", "PMJAY Card"],
  "UMID Card":                     ["Railway Card", "UMID"],
  "ESI Card":                      ["ESIC Card", "ESI"],
  "Ration Card":                   ["Ration"],
  "Geo-tag Photo":                 ["Geotag Photo", "Geotag", "Geo Tag"],
  "Approval Form (Appex)":         ["Appex Form", "Approval Form", "Appex", "SEMO Form"],
  "Emergency Certificate":         ["Emergency Cert"],
  "Passport Photo":                ["Passport Size Photo", "Photo (member)"],
  "Insurance Card":                ["TPA Card", "Insurance", "Policy Card"],
  "NEFT Mandate Form":             ["NEFT Form", "Bank Mandate"],
  "Cashless Authorization Letter": ["Cashless Auth", "Auth Letter"],
  "TPA Claim Form":                ["Claim Form", "TPA Form"],
  "Case Summary Form":             ["Case Summary"],
  "Treating Doctor Certificate":   ["Doctor Certificate", "Treating Doctor Cert"],
  "Original Bills (attested)":     ["Original Bills", "Attested Bills"],
  "Employer IP Declaration":       ["IP Declaration", "Employer Declaration"],
};

// ─────────────────────────────────────────────
// Core matching
// ─────────────────────────────────────────────

function matchDocument(uploaded: CaseDocument[], targetType: string): CaseDocument | undefined {
  const aliases = [targetType, ...(DOC_TYPE_ALIASES[targetType] ?? [])];
  for (const a of aliases) {
    const hit = uploaded.find((d) => d.doc_type.toLowerCase() === a.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

function ruleApplies(
  r: ChecklistRule,
  treatment: Treatment,
  scheme?: Scheme,
  tpa?: TPA,
  isEmergency?: boolean,
): boolean {
  if (r.for_treatments && !r.for_treatments.includes(treatment)) return false;
  if (r.for_schemes && !r.for_schemes.includes(scheme as Scheme)) return false;
  if (r.for_tpas && (!tpa || !r.for_tpas.includes(tpa))) return false;
  if (isEmergency && r.emergency_waivable) return false;
  return true;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export function buildChecklist(
  uploaded: CaseDocument[],
  treatment: Treatment,
  scheme?: Scheme,
  tpa?: TPA,
  isEmergency = false,
): ChecklistEntry[] {
  return RULES
    .filter((r) => ruleApplies(r, treatment, scheme, tpa, isEmergency))
    .map((rule) => {
      const found = matchDocument(uploaded, rule.doc_type);
      if (!found) return { doc_type: rule.doc_type, stage: rule.stage, status: "missing" as const };
      return {
        doc_type: rule.doc_type,
        stage: rule.stage,
        status: (found.confidence !== undefined && found.confidence < 0.7
          ? "low_confidence"
          : "present") as "present" | "low_confidence",
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

export function requiredDocsByStage(
  treatment: Treatment,
  scheme?: Scheme,
  tpa?: TPA,
): Record<Stage, string[]> {
  const grouped: Record<Stage, string[]> = { pre_auth: [], mid_way: [], discharge: [] };
  RULES
    .filter((r) => ruleApplies(r, treatment, scheme, tpa))
    .forEach((r) => grouped[r.stage].push(r.doc_type));
  return grouped;
}
