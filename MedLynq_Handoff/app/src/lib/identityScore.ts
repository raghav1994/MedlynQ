// Multi-field identity scorer — the "no MRN" fallback for Drop-and-Go uploads.
//
// Real-world reality: when a MEDCO drops a folder of docs, half of them won't
// have the MRN printed clearly. We need to figure out "is this the same patient"
// from whatever fields ARE present.
//
// Rule: ≥2 matching fields out of { name, age (±2y), DOB, gender, scheme card # }
// → confident same-patient match. <2 → treat as new patient.

import type { Patient } from "./types";
import { patients } from "./mockData";

export type IdentityHints = {
  name?: string;
  age?: number | string;
  dob?: string;
  gender?: string;
  mrn?: string;
  scheme_card?: string;
};

export type IdentityMatch = {
  patient: Patient | null;
  confidence: number;        // 0..1
  matched_fields: string[];  // which fields contributed
  total_fields: number;      // out of how many we could check
  reason: string;
};

function norm(s: string | undefined | null): string {
  return (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");
}

function ageNum(a: number | string | undefined): number | null {
  if (a === undefined || a === null || a === "") return null;
  const n = typeof a === "number" ? a : parseInt(String(a), 10);
  return Number.isFinite(n) ? n : null;
}

function fuzzyName(a: string, b: string): boolean {
  if (!a || !b) return false;
  const an = norm(a), bn = norm(b);
  if (an === bn) return true;
  // Token overlap — at least one shared token of length ≥3 (catches first/last name swap)
  const aTok = new Set(an.split(" ").filter((t) => t.length >= 3));
  for (const t of bn.split(" ")) {
    if (t.length >= 3 && aTok.has(t)) return true;
  }
  return false;
}

export function scoreIdentity(hints: IdentityHints, p: Patient): IdentityMatch {
  const matched: string[] = [];
  let total = 0;

  // MRN match (when present) is worth a lot
  if (hints.mrn) {
    total++;
    if (norm(hints.mrn) === norm(p.mrn)) matched.push("mrn");
  }

  // Name (fuzzy token match)
  if (hints.name) {
    total++;
    if (fuzzyName(hints.name, p.name)) matched.push("name");
  }

  // Age (within ±2 years)
  const aN = ageNum(hints.age);
  if (aN !== null) {
    total++;
    if (Math.abs(aN - p.age) <= 2) matched.push("age");
  }

  // Gender — single letter normalised
  if (hints.gender) {
    total++;
    const h = norm(hints.gender);
    const want = h.startsWith("f") ? "F" : h.startsWith("m") ? "M" : "";
    if (want && p.gender === want) matched.push("gender");
  }

  // DOB — exact match (after normalisation)
  if (hints.dob) {
    total++;
    // patient.dob isn't on Patient yet — skip until added
  }

  // Scheme card # — not on Patient model today; skip until we add it
  if (hints.scheme_card) {
    total++;
  }

  const confidence = total === 0 ? 0 : matched.length / total;

  // Auto-match threshold: ≥2 matched fields wins
  // OR exact MRN match alone (worth full confidence)
  const isMrnExact = matched.includes("mrn");
  const auto = isMrnExact || matched.length >= 2;

  return {
    patient: auto ? p : null,
    confidence: isMrnExact ? 1.0 : confidence,
    matched_fields: matched,
    total_fields: total,
    reason: isMrnExact
      ? "Exact MRN"
      : matched.length >= 2
      ? `${matched.length} fields match`
      : `Only ${matched.length} field${matched.length === 1 ? "" : "s"} matched — below threshold`,
  };
}

export type IdentityResolveResult = {
  match: Patient | null;
  candidates: Array<{ patient: Patient; score: number; matched_fields: string[] }>;
  decision: "auto_match" | "ambiguous" | "create_new";
};

export function resolveIdentity(hints: IdentityHints): IdentityResolveResult {
  const candidates = patients
    .map((p) => {
      const s = scoreIdentity(hints, p);
      return { patient: p, score: s.confidence, matched_fields: s.matched_fields, auto: s.patient !== null };
    })
    .filter((c) => c.matched_fields.length > 0)
    .sort((a, b) => b.score - a.score);

  const top = candidates[0];
  if (top && top.auto) {
    return {
      match: top.patient,
      candidates: candidates.slice(0, 5).map(({ patient, score, matched_fields }) => ({ patient, score, matched_fields })),
      decision: "auto_match",
    };
  }
  if (top && top.matched_fields.length === 1) {
    return {
      match: null,
      candidates: candidates.slice(0, 5).map(({ patient, score, matched_fields }) => ({ patient, score, matched_fields })),
      decision: "ambiguous",
    };
  }
  return { match: null, candidates: [], decision: "create_new" };
}
