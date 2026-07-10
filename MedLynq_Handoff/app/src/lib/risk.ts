// Rule-based query-risk scorer. No AI.
// Logic:
//   start at 25 (base risk for any submission)
//   +20 per missing pre-auth doc
//   +15 per missing mid-way doc
//   +10 per missing discharge doc
//   +12 if HPE has low confidence
//   capped at 95

import { RULES } from "./checklist";
import type { Treatment, Specialty } from "./types";

export type RiskInput = {
  treatment: Treatment;
  specialty?: Specialty;
  present_doc_types: string[];
  low_confidence_types?: string[];
};

export type RiskOutput = {
  score: number;             // 0..95
  band: "low" | "medium" | "high";
  missing: { stage: string; doc_type: string }[];
  strong: string[];          // doc types present at high confidence
  reasons: string[];         // top reasons driving the score
};

const WEIGHTS: Record<string, number> = {
  pre_auth: 20,
  mid_way: 15,
  discharge: 10,
};

export function scoreRisk({ treatment, specialty = "oncology", present_doc_types, low_confidence_types = [] }: RiskInput): RiskOutput {
  const present = new Set(present_doc_types.map((t) => t.toLowerCase()));
  const lowConf = new Set(low_confidence_types.map((t) => t.toLowerCase()));

  const applicable = RULES.filter((r) => {
    const treatOk = !r.for_treatments || r.for_treatments.includes(treatment);
    const specOk = !r.for_specialties || r.for_specialties.includes(specialty);
    return treatOk && specOk;
  });

  let score = 25;
  const missing: { stage: string; doc_type: string }[] = [];
  const reasons: string[] = [];

  for (const rule of applicable) {
    if (!present.has(rule.doc_type.toLowerCase())) {
      missing.push({ stage: rule.stage, doc_type: rule.doc_type });
      score += WEIGHTS[rule.stage] ?? 10;
    }
  }

  if (lowConf.size > 0) {
    score += 12;
    reasons.push(`${lowConf.size} doc${lowConf.size === 1 ? "" : "s"} has low OCR confidence`);
  }

  if (missing.length > 0) {
    const stages = new Set(missing.map((m) => m.stage));
    reasons.unshift(
      `${missing.length} required doc${missing.length === 1 ? "" : "s"} missing across ${stages.size} stage${stages.size === 1 ? "" : "s"}`
    );
  } else {
    reasons.unshift("All required docs present");
  }

  score = Math.min(score, 95);
  const band = score >= 60 ? "high" : score >= 40 ? "medium" : "low";

  const strong = present_doc_types.filter((t) => !lowConf.has(t.toLowerCase())).slice(0, 6);

  return { score, band, missing, strong, reasons };
}
