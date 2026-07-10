// Document router — the brain of the document intake flow.
//
// Given a bag of extracted documents (identity hints + classified doc types),
// the existing patients[], and the existing cases[] (already tenant-scoped),
// decides ONE of three actions:
//
//   1. "auto_attach"  — high-confidence match. Attach to existing patient + case.
//   2. "review"       — medium-confidence. Show Drop-and-Go modal with candidates.
//   3. "auto_create"  — no plausible match. Create new patient + new case.
//
// Plus an optional "auto_advance" transition when the stage detector is
// confident enough to move the case status (admitted → discharged, etc.).
//
// Pure function. Side-effects (DB writes, audit logs) happen at the call site.

import type { Patient, Case, ClaimStatus, Stage } from "./types";
import { scoreIdentity, type IdentityHints } from "./identityScore";
import { detectStage, type DetectedStage } from "./stageDetector";

// --- Confidence bands ----------------------------------------------------

export const ROUTER_THRESHOLDS = {
  AUTO_ATTACH_MIN: 0.85,     // ≥ this → silent auto-attach
  REVIEW_MIN:      0.60,     // [REVIEW_MIN, AUTO_ATTACH_MIN) → modal
  AUTO_ADVANCE_STAGE_MIN: 0.6, // stage detector confidence to allow status flip
};

export type DocBag = {
  identity: IdentityHints;
  doc_types: string[];      // from content classifier (e.g. ["hpe_report","bill"])
  doc_ids?: string[];       // file ids/names (for audit + attach)
};

export type RouteAction = "auto_attach" | "review" | "auto_create";

export type RouterCandidate = {
  patient: Patient;
  score: number;
  matched_fields: string[];
};

export type RouteResult = {
  action: RouteAction;
  reason: string;
  confidence: number;
  patient_id?: string;            // when action is attach/create
  case_id?: string;               // when action is attach
  new_case_status?: ClaimStatus;  // when action creates a case OR auto-advances
  auto_advance?: {                // when an existing case status should flip
    case_id: string;
    from: ClaimStatus;
    to: ClaimStatus;
    reason: string;
  };
  stage: DetectedStage;
  candidates: RouterCandidate[];  // ranked list for review modal / audit
  doc_count: number;
};

// --- Stage → case-status mapping for create + auto-advance ----------------

// Which initial case status to use when *creating* a case from a fresh bag at a given stage.
const STAGE_TO_INITIAL_STATUS: Record<Stage, ClaimStatus> = {
  opd: "opd_done" as ClaimStatus,
  pre_auth: "preauth_pending" as ClaimStatus,
  mid_way: "admitted" as ClaimStatus,
  discharge: "discharged" as ClaimStatus,
};

// Allowed auto-advance transitions. Anything not listed = no auto-advance.
// Mapping: (current case status, incoming bag stage) → new status
const AUTO_ADVANCE: Array<{ from: ClaimStatus; bagStage: Stage; to: ClaimStatus; reason: string }> = [
  { from: "opd_done"          as ClaimStatus, bagStage: "pre_auth",  to: "preauth_pending"  as ClaimStatus, reason: "Pre-auth bag attached after OPD" },
  { from: "preauth_approved"  as ClaimStatus, bagStage: "mid_way",   to: "admitted"         as ClaimStatus, reason: "Mid-treatment docs attached after approval" },
  { from: "admitted"          as ClaimStatus, bagStage: "discharge", to: "discharged"       as ClaimStatus, reason: "Discharge bag attached" },
  { from: "discharged"        as ClaimStatus, bagStage: "discharge", to: "submitted"        as ClaimStatus, reason: "Final claim bag attached after discharge" },
];

// --- Helpers --------------------------------------------------------------

function rankCandidates(hints: IdentityHints, patients: Patient[]): RouterCandidate[] {
  return patients
    .map((p) => {
      const s = scoreIdentity(hints, p);
      return { patient: p, score: s.confidence, matched_fields: s.matched_fields };
    })
    .filter((c) => c.matched_fields.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/** Pick the right case to attach to for a known patient + detected stage. */
export function pickCaseForStage(
  patient: Patient,
  stage: Stage | "unknown",
  cases: Case[],
): Case | null {
  const patientCases = cases.filter((c) => c.patient_id === patient.id);
  if (patientCases.length === 0) return null;

  // Sort newest first by admission_date
  const sorted = [...patientCases].sort(
    (a, b) => (b.admission_date ?? "").localeCompare(a.admission_date ?? "")
  );

  if (stage === "discharge") {
    // Prefer admitted, then preauth_approved, then most recent open
    return (
      sorted.find((c) => c.status === ("admitted" as ClaimStatus)) ??
      sorted.find((c) => c.status === ("preauth_approved" as ClaimStatus)) ??
      sorted.find((c) => !["paid","approved","rejected"].includes(c.status)) ??
      sorted[0]
    );
  }
  if (stage === "mid_way") {
    return (
      sorted.find((c) => c.status === ("admitted" as ClaimStatus)) ??
      sorted.find((c) => c.status === ("preauth_approved" as ClaimStatus)) ??
      sorted.find((c) => !["paid","approved","rejected"].includes(c.status)) ??
      sorted[0]
    );
  }
  if (stage === "pre_auth") {
    // Prefer an open preauth case; otherwise create a fresh one (caller will see no case match)
    return sorted.find((c) => c.status === ("preauth_pending" as ClaimStatus)) ?? null;
  }
  if (stage === "opd") {
    return sorted.find((c) => c.status === ("opd_done" as ClaimStatus)) ?? null;
  }
  // unknown stage → most recent open
  return sorted.find((c) => !["paid","approved","rejected"].includes(c.status)) ?? sorted[0];
}

/** Compute auto-advance, if applicable. */
function computeAutoAdvance(
  c: Case,
  stage: DetectedStage,
): RouteResult["auto_advance"] | undefined {
  if (stage.stage === "unknown") return undefined;
  if (stage.confidence < ROUTER_THRESHOLDS.AUTO_ADVANCE_STAGE_MIN) return undefined;
  const t = AUTO_ADVANCE.find((x) => x.from === c.status && x.bagStage === stage.stage);
  if (!t) return undefined;
  return { case_id: c.id, from: t.from, to: t.to, reason: t.reason };
}

// --- The main entrypoint --------------------------------------------------

export function routeDocument(
  bag: DocBag,
  patients: Patient[],
  cases: Case[],
): RouteResult {
  const stage = detectStage(bag.doc_types);
  const candidates = rankCandidates(bag.identity, patients);
  const top = candidates[0];
  const topScore = top?.score ?? 0;

  // --- Auto-attach band (high confidence) ---
  if (top && topScore >= ROUTER_THRESHOLDS.AUTO_ATTACH_MIN) {
    const c = pickCaseForStage(top.patient, stage.stage, cases);
    if (c) {
      return {
        action: "auto_attach",
        reason: `High-confidence match (${(topScore * 100).toFixed(0)}%) + matching case found`,
        confidence: topScore,
        patient_id: top.patient.id,
        case_id: c.id,
        auto_advance: computeAutoAdvance(c, stage),
        stage,
        candidates,
        doc_count: bag.doc_types.length,
      };
    }
    // Patient matched but no suitable existing case — create a new case
    const newStatus = STAGE_TO_INITIAL_STATUS[stage.stage as Stage] ?? ("preauth_pending" as ClaimStatus);
    return {
      action: "auto_attach",
      reason: `High-confidence match — new case will be created at stage ${stage.stage}`,
      confidence: topScore,
      patient_id: top.patient.id,
      new_case_status: newStatus,
      stage,
      candidates,
      doc_count: bag.doc_types.length,
    };
  }

  // --- Review band (medium confidence) ---
  if (top && topScore >= ROUTER_THRESHOLDS.REVIEW_MIN) {
    return {
      action: "review",
      reason: `Medium confidence (${(topScore * 100).toFixed(0)}%) — MEDCO must confirm`,
      confidence: topScore,
      stage,
      candidates,
      doc_count: bag.doc_types.length,
    };
  }

  // --- Auto-create band (low / no match) ---
  return {
    action: "auto_create",
    reason: candidates.length === 0
      ? "No identity overlap with any existing patient"
      : `Best candidate only ${(topScore * 100).toFixed(0)}% — below review threshold`,
    confidence: topScore,
    new_case_status: STAGE_TO_INITIAL_STATUS[stage.stage as Stage] ?? ("preauth_pending" as ClaimStatus),
    stage,
    candidates,
    doc_count: bag.doc_types.length,
  };
}
