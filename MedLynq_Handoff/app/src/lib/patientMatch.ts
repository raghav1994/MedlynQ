// Hybrid patient matcher.
// Strategy:
//   1. Exact MRN match (case-insensitive, trimmed) → confidence 1.0
//   2. Fuzzy name + age combo with score >= 0.85 → confidence = score
//   3. Else → no match, candidates ranked by partial name similarity

import { patients } from "./mockData";
import type { Patient } from "./types";

export type PatientCandidate = {
  patient: Patient;
  score: number;          // 0..1
  reason: string;         // human-readable why
};

export type PatientMatchResult = {
  match: Patient | null;
  confidence: number;     // 0..1
  reason: string;
  candidates: PatientCandidate[]; // top 5 sorted by score desc
};

export type PatientHints = {
  mrn?: string;
  name?: string;
  age?: number | string;
  gender?: string;
  dob?: string;
};

function norm(s: string | undefined | null): string {
  return (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");
}

function jaroWinkler(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aLen = a.length, bLen = b.length;
  const matchDist = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatches = new Array<boolean>(aLen).fill(false);
  const bMatches = new Array<boolean>(bLen).fill(false);
  let matches = 0;
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, bLen);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < aLen; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  const m = matches;
  const jaro = (m / aLen + m / bLen + (m - t) / m) / 3;
  // Winkler boost: common prefix up to 4 chars
  let prefix = 0;
  for (let i = 0; i < Math.min(4, aLen, bLen); i++) {
    if (a[i] === b[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function ageMatch(a?: number | string, b?: number): number {
  if (a === undefined || b === undefined) return 0.5; // unknown — neutral
  const an = typeof a === "number" ? a : parseInt(String(a), 10);
  if (isNaN(an)) return 0.5;
  const diff = Math.abs(an - b);
  if (diff === 0) return 1;
  if (diff <= 1) return 0.95;
  if (diff <= 2) return 0.85;
  if (diff <= 5) return 0.6;
  return 0.2;
}

export function matchPatient(hints: PatientHints): PatientMatchResult {
  // 1. Exact MRN
  if (hints.mrn) {
    const target = norm(hints.mrn);
    const found = patients.find((p) => norm(p.mrn) === target);
    if (found) {
      return {
        match: found,
        confidence: 1.0,
        reason: "Exact MRN match",
        candidates: [{ patient: found, score: 1.0, reason: "MRN exact" }],
      };
    }
  }

  // 2. Fuzzy name + age
  const nameQ = norm(hints.name);
  const candidates: PatientCandidate[] = patients
    .map((p) => {
      const nameScore = nameQ ? jaroWinkler(nameQ, norm(p.name)) : 0;
      const ageScore = ageMatch(hints.age, p.age);
      const combined = nameQ
        ? nameScore * 0.7 + ageScore * 0.3
        : ageScore * 0.4;
      return {
        patient: p,
        score: combined,
        reason: `name ${(nameScore * 100).toFixed(0)}% · age ${(ageScore * 100).toFixed(0)}%`,
      };
    })
    .filter((c) => c.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const top = candidates[0];
  if (top && top.score >= 0.85) {
    return {
      match: top.patient,
      confidence: top.score,
      reason: `Fuzzy match: ${top.reason}`,
      candidates,
    };
  }

  return {
    match: null,
    confidence: 0,
    reason: "No confident match — clerk should review or add new patient",
    candidates,
  };
}
