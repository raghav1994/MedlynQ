// Stage auto-detection from a bag of uploaded docs.
//
// Logic: each doc_type belongs to one or more stages. Count how many docs
// match each stage. Highest count wins. Returns the detected stage + list
// of missing critical docs for that stage (so MEDCO sees gaps immediately).

import type { Stage } from "./types";
import { RULES } from "./checklist";

export type DetectedStage = {
  stage: Stage | "unknown";
  confidence: number;       // 0..1 — share of docs that landed in this stage
  doc_count_per_stage: Record<Stage, number>;
  missing_critical: string[]; // doc_types that should be present at this stage but weren't
  total_required_at_stage: number;
  present_at_stage: number;
};

// Critical / always-required docs per stage (subset of full checklist).
const CRITICAL_BY_STAGE: Partial<Record<Stage, string[]>> = {
  opd: ["Doctor's Prescription"],
  pre_auth: [
    "Aadhaar",
    "Insurance / Scheme Card",
    "Consent Form",
    "Tumor Board Certificate",
  ],
  mid_way: [
    "Chemo Chart",
    "OT Notes",
  ],
  discharge: [
    "Discharge Summary",
    "Hospital Bill",
  ],
};

// Build a doc_type → stages[] map from checklist rules
function buildDocStageMap(): Map<string, Stage[]> {
  const map = new Map<string, Stage[]>();
  for (const r of RULES) {
    const existing = map.get(r.doc_type) ?? [];
    if (!existing.includes(r.stage)) existing.push(r.stage);
    map.set(r.doc_type, existing);
  }
  return map;
}

const DOC_STAGE_MAP = buildDocStageMap();

function normalizeDocType(s: string): string {
  return s.toLowerCase().trim();
}

function lookupStages(docType: string): Stage[] {
  const norm = normalizeDocType(docType);
  for (const [key, stages] of DOC_STAGE_MAP.entries()) {
    if (normalizeDocType(key) === norm) return stages;
  }
  // Loose substring fallback
  for (const [key, stages] of DOC_STAGE_MAP.entries()) {
    if (normalizeDocType(key).includes(norm) || norm.includes(normalizeDocType(key))) {
      return stages;
    }
  }
  return [];
}

export function detectStage(uploadedDocTypes: string[]): DetectedStage {
  const counts: Record<Stage, number> = { opd: 0, pre_auth: 0, mid_way: 0, discharge: 0 };
  let totalMatched = 0;

  for (const t of uploadedDocTypes) {
    const stages = lookupStages(t);
    for (const s of stages) counts[s]++;
    if (stages.length > 0) totalMatched++;
  }

  // Highest stage present wins (so a discharge summary trumps a chemo chart)
  // — but only if it actually has at least 1 doc landing there.
  const stageOrder: Stage[] = ["discharge", "mid_way", "pre_auth", "opd"];
  const detected: Stage | undefined = stageOrder.find((s) => counts[s] > 0);

  if (!detected) {
    return {
      stage: "unknown",
      confidence: 0,
      doc_count_per_stage: counts,
      missing_critical: [],
      total_required_at_stage: 0,
      present_at_stage: 0,
    };
  }

  // Critical doc check at the detected stage
  const critical = CRITICAL_BY_STAGE[detected] ?? [];
  const present_at_stage = critical.filter((c) =>
    uploadedDocTypes.some((u) => normalizeDocType(u).includes(normalizeDocType(c).split(" ")[0]))
  ).length;
  const missing_critical = critical.filter((c) =>
    !uploadedDocTypes.some((u) => normalizeDocType(u).includes(normalizeDocType(c).split(" ")[0]))
  );

  return {
    stage: detected,
    confidence: totalMatched === 0 ? 0 : counts[detected] / totalMatched,
    doc_count_per_stage: counts,
    missing_critical,
    total_required_at_stage: critical.length,
    present_at_stage,
  };
}
