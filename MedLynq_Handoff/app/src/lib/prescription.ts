// TS-side mirror of prescription_decoder.py — used at the edge / API layer.
// Same regex set as the Python sidecar so the answer is identical regardless
// of whether the call originated server-side or client-side.

import { matchDrug, type DrugEntry } from "./drugs";
import { findPackage, type Package } from "./packages";

export type ExtractedDrug = {
  name: string;
  dose: string;
  raw_match: string;
  // Hydrated from drug_master.csv
  master_match?: {
    generic: string;
    brand_names: string[];
    mrp_min: number | null;
    mrp_max: number | null;
    oncology: boolean;
    score: number;
    matched_on: "generic" | "brand";
  } | null;
};

export type ExtractedPackage = {
  code: string;
  master?: Package | null;
};

export type DoctorsPlan = {
  package_codes: string[];
  packages_hydrated: ExtractedPackage[];
  drugs: ExtractedDrug[];
  frequencies: string[];
  cycles: { current: number | null; total: number | null };
  procedure: string | null;
  course_summary: string | null;
};

const PACKAGE_CODE_RE = /\b([A-Z]{2,5})(\d{3,4})([A-Z])\b/g;

const DRUG_LINE_RE =
  /\b([A-Z][a-zA-Z\-]{3,30}(?:\s+[A-Z][a-zA-Z\-]{2,20})?)\s+(\d{1,4}(?:\.\d+)?)\s*(mg|mcg|gm|g|ml|units|mg\/m[²2]|mg\/kg|iu|iu\/kg)/gi;

const FREQ_PATTERNS: Record<string, RegExp> = {
  BD:       /\bBD\b|\bb\.?d\.?\b|twice\s*(?:a)?\s*day/i,
  TDS:      /\bTDS\b|\bt\.?d\.?s\.?\b|thrice\s*(?:a)?\s*day/i,
  QID:      /\bQID\b|\bq\.?i\.?d\.?\b|four\s*times/i,
  OD:       /\bOD\b|\bo\.?d\.?\b|once\s*(?:a)?\s*day|daily/i,
  HS:       /\bHS\b|\bh\.?s\.?\b|bedtime|at\s*night/i,
  SOS:      /\bSOS\b|\bs\.?o\.?s\.?\b|as\s*needed|prn/i,
  q3w:      /\bq3w\b|every\s*3\s*weeks|3-weekly/i,
  q4w:      /\bq4w\b|every\s*4\s*weeks|4-weekly|monthly/i,
  weekly:   /\bweekly\b|q1w|once\s*a\s*week/i,
  biweekly: /\bbiweekly\b|q2w|every\s*2\s*weeks|fortnightly/i,
};

const CYCLE_RE = /(?:cycle\s*(\d+)\s*(?:of\s*(\d+))?|x\s*(\d+)\s*(?:cycles?)?|(\d+)\s*cycles?)/i;

const PROCEDURE_WORDS = [
  "mastectomy", "cabg", "valve replacement", "angioplasty", "stent",
  "thr", "tkr", "knee replacement", "hip replacement",
  "dialysis", "haemodialysis", "fistula", "transplant",
  "laparotomy", "appendicectomy", "cholecystectomy", "hysterectomy",
  "craniotomy", "biopsy", "lscs", "delivery", "intubation",
];

const KNOWN_DRUG_TOKENS = new Set([
  "trastuzumab", "paclitaxel", "docetaxel", "doxorubicin", "cyclophosphamide",
  "carboplatin", "cisplatin", "oxaliplatin", "fluorouracil", "capecitabine",
  "gemcitabine", "irinotecan", "etoposide", "vincristine", "vinblastine",
  "methotrexate", "tamoxifen", "letrozole", "rituximab", "bevacizumab",
  "imatinib", "erlotinib", "gefitinib", "pembrolizumab", "nivolumab",
  "ondansetron", "granisetron", "palonosetron",
  "aspirin", "clopidogrel", "atorvastatin", "rosuvastatin", "metoprolol",
  "amlodipine", "ramipril", "telmisartan", "enoxaparin",
  "amoxicillin", "azithromycin", "ceftriaxone", "piperacillin", "tazobactam",
  "meropenem", "vancomycin", "linezolid", "cefoperazone", "sulbactam",
  "paracetamol", "tramadol", "morphine", "pantoprazole", "rabeprazole",
  "dexamethasone", "metformin", "glimepiride", "insulin",
]);

function extractCodes(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  PACKAGE_CODE_RE.lastIndex = 0;
  while ((m = PACKAGE_CODE_RE.exec(text)) !== null) {
    const code = (m[1] + m[2] + m[3]).toUpperCase();
    if (!seen.has(code)) { out.push(code); seen.add(code); }
  }
  return out;
}

function extractRawDrugs(text: string): ExtractedDrug[] {
  const out: ExtractedDrug[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  DRUG_LINE_RE.lastIndex = 0;
  while ((m = DRUG_LINE_RE.exec(text)) !== null) {
    const name = m[1].trim();
    const dose = `${m[2]}${m[3].toLowerCase()}`;
    const key = name.toLowerCase();
    const hasKnown = [...KNOWN_DRUG_TOKENS].some((tok) => key.includes(tok));
    if (!hasKnown) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, dose, raw_match: m[0] });
  }
  return out;
}

function extractFreqs(text: string): string[] {
  const out: string[] = [];
  for (const [label, re] of Object.entries(FREQ_PATTERNS)) {
    if (re.test(text)) out.push(label);
  }
  return out;
}

function extractCycles(text: string) {
  const m = text.match(CYCLE_RE);
  if (!m) return { current: null, total: null };
  return {
    current: m[1] ? parseInt(m[1], 10) : null,
    total:   m[2] ? parseInt(m[2], 10) : m[3] ? parseInt(m[3], 10) : m[4] ? parseInt(m[4], 10) : null,
  };
}

function extractProcedure(text: string): string | null {
  const low = text.toLowerCase();
  for (const word of PROCEDURE_WORDS) {
    const idx = low.indexOf(word);
    if (idx === -1) continue;
    const start = text.lastIndexOf(".", idx) + 1;
    let end = text.indexOf(".", idx);
    if (end === -1) end = Math.min(idx + 100, text.length);
    return text.slice(start, end).trim();
  }
  return null;
}

// Hydrate drugs against drug_master.csv and packages against package_master.csv.
async function hydrate(plan: DoctorsPlan): Promise<DoctorsPlan> {
  plan.drugs = await Promise.all(plan.drugs.map(async (d) => {
    try {
      const m = await matchDrug(d.name);
      if (m) {
        d.master_match = {
          generic: m.entry.generic,
          brand_names: m.entry.brand_names.slice(0, 8),
          mrp_min: m.entry.mrp_min,
          mrp_max: m.entry.mrp_max,
          oncology: m.entry.oncology,
          score: m.score,
          matched_on: m.matched_on,
        };
      }
    } catch {}
    return d;
  }));
  plan.packages_hydrated = await Promise.all(plan.package_codes.map(async (code) => {
    try { return { code, master: await findPackage(code) }; }
    catch { return { code, master: null }; }
  }));
  return plan;
}

export async function decodePrescription(text: string): Promise<DoctorsPlan> {
  const t = (text || "").trim();
  const package_codes = extractCodes(t);
  const drugs = extractRawDrugs(t);
  const frequencies = extractFreqs(t);
  const cycles = extractCycles(t);
  const procedure = extractProcedure(t);

  const parts: string[] = [];
  if (procedure) parts.push(`Procedure: ${procedure}`);
  if (drugs.length) parts.push(`Drugs: ${drugs.slice(0, 5).map((d) => `${d.name} ${d.dose}`).join(", ")}`);
  if (cycles.current || cycles.total) parts.push(`Cycles: ${cycles.current ?? "?"} of ${cycles.total ?? "?"}`);
  if (frequencies.length) parts.push(`Frequency: ${frequencies.slice(0, 3).join(", ")}`);

  const plan: DoctorsPlan = {
    package_codes,
    packages_hydrated: [],
    drugs,
    frequencies,
    cycles,
    procedure,
    course_summary: parts.length ? parts.join(" · ") : null,
  };
  return hydrate(plan);
}
