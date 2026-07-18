// Stage-aware + treatment-aware document checklist engine.
// Updated D-4: added oncology-specific docs (TBC, BIS, Discharge Photo, PET-CT, Chemo Chart).

import type { CaseDocument } from "./mockDocuments";
import type { Case, Treatment, Stage, Specialty } from "./types";
import type { DocumentLibraryEntry, DocumentRequirement } from "./tenant/loader";

export type ChecklistRule = {
  doc_type: string;
  stage: Stage;
  for_treatments?: Treatment[];
  // string[], not Specialty[] — a hospital's tenant-config document_profiles
  // (see rulesFromDocumentProfiles below) can name a specialty that only
  // exists in that hospital's config, not (yet) in the Specialty union.
  // Omitted = applies to all (universal docs).
  for_specialties?: string[];
  // Which schemes require this doc — e.g. Ayushman needs 8 pre-auth docs,
  // private insurance needs 5, CGHS needs 9. Omitted/empty = universal
  // (required regardless of scheme), matching every rule's behavior before
  // schemes existed. Matching is automatic: a landed document's doc_type
  // either satisfies a scheme's requirement or it doesn't — the case's own
  // `scheme` field (set at intake) drives this, no manual per-document
  // tagging needed.
  for_schemes?: string[];
  // alt_group: items in the same group are alternatives — any one satisfies.
  // e.g. Histopath | Biopsy | PET-CT all in group "report" → only one needed.
  alt_group?: string;
};

// Converts a hospital's tenant-config document library + requirements into
// the same ChecklistRule shape the hardcoded RULES below use, so a brand-new
// specialty's document requirements come from JSON config instead of a code
// change here. Passed into buildChecklist() as extraRules. A requirement
// whose doc_type has no matching library entry is dropped rather than
// crashing the checklist (config self-heals from stray/orphaned edits
// instead of breaking the whole patient page).
export function rulesFromDocumentRequirements(
  library: DocumentLibraryEntry[] | undefined,
  requirements: DocumentRequirement[] | undefined,
): ChecklistRule[] {
  if (!requirements || requirements.length === 0) return [];
  const byDocType = new Map((library ?? []).map((l) => [l.doc_type, l]));
  const rules: ChecklistRule[] = [];
  for (const r of requirements) {
    const entry = byDocType.get(r.doc_type);
    if (!entry) continue;
    rules.push({
      doc_type: entry.label,
      stage: r.stage,
      for_treatments: r.for_treatments as Treatment[] | undefined,
      for_specialties: [r.specialty],
      for_schemes: r.schemes,
      alt_group: r.alt_group,
    });
  }
  return rules;
}

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
  // Any FURTHER documents that also matched this same slot (e.g. a
  // multi-page consent form uploaded as separate files, or several docs
  // that all carry the same label) — `doc` above stays the primary/first
  // one so existing single-doc consumers (QueryBoard, etc.) don't need to
  // change; the UI shows a "+N more" stack when this is non-empty.
  extraDocs?: CaseDocument[];
};

export const DOC_TYPE_ALIASES: Record<string, string[]> = {
  "Doctor's Prescription":   ["Prescription", "OPD Slip", "Doctor Prescription", "Protocol", "Chemo Protocol", "Prescription / Protocol"],
  "Aadhaar":                  ["Patient ID", "Aadhar", "Aadhaar Card"],
  "Insurance / Scheme Card":  ["Insurance Card", "Scheme Card", "PMJAY Card", "CGHS Card", "ECHS Card", "Ayushman Card"],
  "Histopathology Report":    ["Histopath", "HPE", "Histopathology", "Latest Pathology (HPE)"],
  "Biopsy Report":            ["Biopsy"],
  "CBC / LFT / KFT Profile":  ["CBC Report", "LFT Report", "KFT Report", "Baseline Labs"],
  // Deliberately NOT aliasing the classifier's generic "Lab Report" fallback
  // here — a document only proven to contain a CBC panel shouldn't silently
  // satisfy LFT/KFT too just because the classifier couldn't tell them
  // apart (false-positive compliance risk). Panel-specific detection
  // (content_classifier.py) is what should emit the correct specific
  // label(s) — see satisfied_labels on CaseDocument for the case where one
  // combined report genuinely covers more than one panel.
  "CBC Report":               ["CBC", "Blood Report", "Complete Blood Count"],
  "LFT Report":               ["LFT", "Liver Function Test"],
  "KFT Report":               ["KFT", "Kidney Function Test", "RFT Report", "RFT"],
  "IPD File (admission)":     ["IPD File"],
  "IPD File (day care)":      ["IPD File"],
  "Drug Pouch / Wrapper Photo": ["Drug Pouch Barcode", "Pouch Photo", "Drug Pouch"],
  "Prior Imaging (CT/MRI/X-ray)": ["Prior Imaging"],
  "Discharge Photo":          ["DSP", "Dis Pic"],
  "Tumor Board Certificate":  ["TBC"],
  "PET-CT Report":            ["PET CT", "PETCT"],
  "Geotag Photo":             ["Geo Tag Photo", "Geo-tag Photo"],
  "Referral":                 ["Referral Letter", "Outside Hospital Referral"],
  "Apex Form":                ["ECHS Apex Form"],
  "Approval Letter":          ["Approval", "Pre-Approval Letter", "Sanction Letter"],
};

// Strips separators/punctuation down to bare words for the fuzzy tier below.
function normalizeLabel(s: string): string[] {
  return s.toLowerCase().replace(/[/\\,()]/g, " ").split(/\s+/).filter(Boolean);
}

// Returns EVERY uploaded doc that matches this slot, in upload order —
// callers take [0] as the primary/thumbnail doc and the rest as extraDocs
// (e.g. a multi-page document uploaded as separate files, or two lab
// reports for different dates that both satisfy the same requirement).
function matchDocuments(uploaded: CaseDocument[], targetType: string): CaseDocument[] {
  const aliases = [targetType, ...(DOC_TYPE_ALIASES[targetType] ?? [])];
  const aliasSet = new Set(aliases.map((a) => a.toLowerCase()));

  // Tier 1: exact label match (existing behavior) — also checks a combined
  // document's satisfied_labels, so a single report that genuinely covers
  // several panels (e.g. a "CBC / LFT / KFT Profile" upload) can flip more
  // than one slot without needing 3 separate files.
  const exact = uploaded.filter(
    (d) => aliasSet.has(d.doc_type.toLowerCase()) || d.satisfied_labels?.some((s) => aliasSet.has(s.toLowerCase()))
  );
  if (exact.length > 0) return exact;

  // Tier 2: deterministic word-containment fallback — catches a short-form
  // label a classifier emits (e.g. "Drug Pouch") against a longer
  // configured slot name ("Drug Pouch / Wrapper Photo") without needing a
  // hand-typed alias for every possible short form. Kept intentionally
  // narrow (every word of the shorter label must appear in the longer one,
  // and only fires when exactly one uploaded doc qualifies) rather than a
  // fuzzy/similarity score, so a low-confidence guess never silently
  // misfiles a document into the wrong slot — ambiguous cases fall through
  // to Unsorted for a human to assign instead.
  const targetWords = new Set(normalizeLabel(targetType));
  const candidates = uploaded.filter((d) => {
    const docWords = normalizeLabel(d.doc_type);
    return docWords.length > 0 && docWords.length < targetWords.size && docWords.every((w) => targetWords.has(w));
  });
  return candidates.length === 1 ? candidates : [];
}

export function buildChecklist(
  uploaded: CaseDocument[],
  treatment: Treatment,
  specialty: Specialty | string = "oncology",
  skippedDocTypes: string[] = [],
  extraRules: ChecklistRule[] = [],
  scheme?: string,
): ChecklistEntry[] {
  const skipped = new Set(skippedDocTypes.map((s) => s.toLowerCase()));
  // Config replaces built-ins per specialty, it doesn't stack on them: once
  // a hospital has ANY config-driven requirement for this case's specialty,
  // that config is the complete checklist for the specialty and the
  // hardcoded RULES are skipped entirely. Merging instead would duplicate
  // every doc the config re-declares (built-in "Aadhaar" + config "Aadhaar")
  // and clash on stages (built-in Chemo Chart is mid-way; a hospital's flow
  // may collect it at discharge). Built-ins remain the fallback for
  // hospitals/specialties with no config yet.
  const configCoversSpecialty = extraRules.some((r) => r.for_specialties?.includes(specialty));
  const allRules = configCoversSpecialty
    ? extraRules
    : extraRules.length > 0 ? [...RULES, ...extraRules] : RULES;
  const applicable = allRules.filter((r) => {
    const treatOk = !r.for_treatments || r.for_treatments.includes(treatment);
    const specOk = !r.for_specialties || r.for_specialties.includes(specialty);
    // Universal (no for_schemes) always applies. Otherwise the case's own
    // scheme must be in the rule's list — an Ayushman-only requirement
    // never shows as "missing" on a private-insurance case, and vice versa.
    const schemeOk = !r.for_schemes || r.for_schemes.length === 0 || (scheme != null && r.for_schemes.includes(scheme));
    return treatOk && specOk && schemeOk;
  });

  // First pass: resolve each rule independently.
  const raw = applicable.map((rule) => {
    const matches = matchDocuments(uploaded, rule.doc_type);
    const found = matches[0];
    const extraDocs = matches.length > 1 ? matches.slice(1) : undefined;
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
      extraDocs,
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
  const matchedIds = new Set<string>();
  for (const e of entries) {
    if (e.doc) matchedIds.add(e.doc.id);
    e.extraDocs?.forEach((d) => matchedIds.add(d.id));
  }
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
