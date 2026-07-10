// All schemes MedLynq tracks. Ayushman is the umbrella for PMJAY (central) +
// every state SHA. Private TPAs and self-pay sit alongside.
export type Scheme =
  | "PMJAY"
  | "Ayushman"
  | "CGHS"
  | "CAPF"
  | "ECHS"
  | "ESI"
  | "Railway_UMID"
  | "NDMC"
  | "FCI"
  | "DU"
  | "TPA"
  | "Cash";

// Canonical list for any UI that lets someone pick a scheme (OPD
// registration, sidebar filters, Backend Panel empanelment check) — single
// source of truth so a new scheme only needs to be added here once.
export const ALL_SCHEMES: Scheme[] = [
  "PMJAY", "Ayushman", "CGHS", "CAPF", "ECHS", "ESI",
  "Railway_UMID", "NDMC", "FCI", "DU", "TPA", "Cash",
];

// State / sub-variants. Ayushman has SHA_XX, DU has main vs affiliated.
export type SchemeVariant =
  | "SHA_UP" | "SHA_BIHAR" | "SHA_DELHI" | "SHA_CHANDIGARH"
  | "SHA_HARYANA" | "SHA_PUNJAB" | "SHA_RAJASTHAN" | "SHA_HP"
  | "SHA_UTTARAKHAND" | "SHA_JK" | "SHA_MP"
  | "DU_MAIN" | "DU_AFFILIATED"
  | "NONE";

// Two auth workflows in Indian healthcare claims:
//   pre_auth     → admit first, send paperwork after (CGHS, ECHS, TPAs, etc.)
//   pre_approval → wait for letter, admit only after (Ayushman + SHAs + FCI)
//   cash         → no claim, patient pays directly
export type AuthMode = "pre_auth" | "pre_approval" | "cash";

// How the patient arrived. Emergency skips referral letter and adds
// scheme-specific emergency certificates.
export type EntryMode = "checkup" | "emergency";

export type ClaimStatus =
  | "opd_done"               // OPD registration captured, not yet paperwork
  | "preauth_pending"        // pre_auth flow: paperwork being prepped
  | "awaiting_approval"      // pre_approval flow: waiting for letter
  | "approval_received"      // pre_approval flow: letter in, patient not yet admitted
  | "preauth_approved"       // either flow: cleared for treatment
  | "admitted"               // patient inside the hospital
  | "discharged"
  | "submitted"
  | "pending"
  | "query"
  | "responded"
  | "approved"
  | "paid"
  | "rejected"
  | "cash"                  // self-pay branch
  | "auto_closed"            // J3: no activity for 45 days · reopenable
  | "successful";            // J3: terminal happy state — discharged + settled

export type Treatment = "chemo" | "surgery" | "radiation" | "medicine";

// New: hospital specialty / department. Lets MedLynq go beyond oncology.
export type Specialty =
  | "oncology"
  | "cardiac"
  | "ortho"
  | "dialysis"
  | "icu"
  | "maternity";

export const SPECIALTY_META: Record<Specialty, { label: string; icon: string; treatments: Treatment[] }> = {
  oncology:  { label: "Oncology",  icon: "🎗️", treatments: ["chemo", "surgery", "radiation", "medicine"] },
  cardiac:   { label: "Cardiac",   icon: "❤️",  treatments: ["surgery", "medicine"] },
  ortho:     { label: "Orthopaedic", icon: "🦴", treatments: ["surgery", "medicine"] },
  dialysis:  { label: "Dialysis",  icon: "🩺",  treatments: ["medicine"] },
  icu:       { label: "ICU",       icon: "🏥",  treatments: ["medicine", "surgery"] },
  maternity: { label: "Maternity", icon: "👶",  treatments: ["surgery", "medicine"] },
};

// Four-stage case lifecycle.
//   opd       — doctor consult captured, before any paperwork
//   pre_auth  — paperwork stage (covers both pre_auth and pre_approval workflows)
//   mid_way   — patient admitted, treatment in progress
//   discharge — patient out, claim being filed
export type Stage = "opd" | "pre_auth" | "mid_way" | "discharge";

// === K1: per scheme + variant SLA tables (real MEDCO numbers) ===
// Auth mode now depends on BOTH scheme + variant because:
//   DU_MAIN       → pre_auth   (campus has no approval requirement)
//   DU_AFFILIATED → pre_approval (affiliated college needs approval first)
// All other schemes ignore variant for auth-mode determination.
export const AUTH_MODE_BY_SCHEME: Record<Scheme, AuthMode> = {
  PMJAY:        "pre_approval",
  Ayushman:     "pre_approval",
  FCI:          "pre_approval",
  CGHS:         "pre_auth",
  CAPF:         "pre_auth",
  ECHS:         "pre_auth",
  ESI:          "pre_auth",
  Railway_UMID: "pre_auth",
  NDMC:         "pre_auth",
  DU:           "pre_auth",         // default for DU_MAIN — variant override below
  TPA:          "pre_auth",
  Cash:         "cash",
};

// Variant-level overrides — keyed by SchemeVariant; absent means use scheme default.
const AUTH_MODE_BY_VARIANT: Partial<Record<SchemeVariant, AuthMode>> = {
  DU_AFFILIATED: "pre_approval",    // affiliated colleges need approval
};

// Resolve auth mode for a case. Use this instead of AUTH_MODE_BY_SCHEME directly.
export function authModeFor(scheme: Scheme, variant?: SchemeVariant | null): AuthMode {
  if (variant && AUTH_MODE_BY_VARIANT[variant]) return AUTH_MODE_BY_VARIANT[variant]!;
  return AUTH_MODE_BY_SCHEME[scheme];
}

// Intimation SLA in hours after admission (pre_auth flow only).
// REAL MEDCO NUMBERS — updated K1.
export const INTIMATION_SLA_HOURS: Partial<Record<Scheme, number>> = {
  CGHS:         24,
  CAPF:         24,
  ECHS:         24,
  NDMC:         24,
  DU:           24,
  TPA:          24,
  Railway_UMID: 48,    // still confirm later
  ESI:          48,
};

// Pre-approval SLA in hours (pre_approval flow only) — how fast the scheme
// is expected to grant the approval letter.
export const PRE_APPROVAL_SLA_HOURS: Partial<Record<Scheme, number>> = {
  Ayushman: 3,         // 2-3 hrs per MEDCO
  PMJAY:    3,
  FCI:      24,
};

// Variant-level pre-approval SLA overrides (DU_AFFILIATED needs approval but slower)
export const PRE_APPROVAL_SLA_BY_VARIANT: Partial<Record<SchemeVariant, number>> = {
  DU_AFFILIATED: 24,
};

// Query response window in DAYS per scheme (post-pre-auth-submission queries).
// FCI/DU/NDMC = physical submission, no queries expected. They contact the
// hospital directly if anything is needed.
export const QUERY_RESPONSE_DAYS: Partial<Record<Scheme, number | "physical">> = {
  CGHS:     15,
  CAPF:     15,
  Ayushman: 15,
  ECHS:     30,
  FCI:      "physical",
  DU:       "physical",
  NDMC:     "physical",
  TPA:      15,
};

// Approval letter validity once received (pre_approval flow).
export const APPROVAL_VALIDITY_DAYS: Partial<Record<Scheme, number>> = {
  Ayushman: 14,
  PMJAY:    14,
  FCI:      14,
  DU:       14,         // for DU_AFFILIATED variant
};

export const SCHEME_META: Record<Scheme, { label: string; icon: string; type: "public" | "private" | "self" }> = {
  Ayushman:     { label: "Ayushman / SHA",   icon: "🇮🇳", type: "public" },
  PMJAY:        { label: "PM-JAY",            icon: "🇮🇳", type: "public" },
  CGHS:         { label: "CGHS",              icon: "🏛️", type: "public" },
  CAPF:         { label: "CAPF",              icon: "🛡️", type: "public" },
  ECHS:         { label: "ECHS",              icon: "🎖️", type: "public" },
  ESI:          { label: "ESIC",              icon: "🏭", type: "public" },
  Railway_UMID: { label: "Railway UMID",      icon: "🚂", type: "public" },
  NDMC:         { label: "NDMC",              icon: "🏙️", type: "public" },
  FCI:          { label: "FCI",               icon: "🌾", type: "public" },
  DU:           { label: "Delhi University",  icon: "🎓", type: "public" },
  TPA:          { label: "Private TPA",       icon: "💼", type: "private" },
  Cash:         { label: "Cash / Self-pay",   icon: "💵", type: "self" },
};

export const VARIANT_META: Partial<Record<SchemeVariant, { label: string; parent: Scheme }>> = {
  SHA_UP:          { label: "SHA Uttar Pradesh",   parent: "Ayushman" },
  SHA_BIHAR:       { label: "SHA Bihar",            parent: "Ayushman" },
  SHA_DELHI:       { label: "SHA Delhi",            parent: "Ayushman" },
  SHA_CHANDIGARH:  { label: "SHA Chandigarh",       parent: "Ayushman" },
  SHA_HARYANA:     { label: "SHA Haryana",          parent: "Ayushman" },
  SHA_PUNJAB:      { label: "SHA Punjab",           parent: "Ayushman" },
  SHA_RAJASTHAN:   { label: "SHA Rajasthan",        parent: "Ayushman" },
  SHA_HP:          { label: "SHA Himachal Pradesh", parent: "Ayushman" },
  SHA_UTTARAKHAND: { label: "SHA Uttarakhand",      parent: "Ayushman" },
  SHA_JK:          { label: "SHA J&K (SEHAT)",      parent: "Ayushman" },
  SHA_MP:          { label: "SHA Madhya Pradesh",   parent: "Ayushman" },
  DU_MAIN:         { label: "DU Main Campus",       parent: "DU" },
  DU_AFFILIATED:   { label: "DU Affiliated College",parent: "DU" },
};

export type Patient = {
  id: string;
  mrn: string;
  name: string;
  age: number;
  gender: "M" | "F";
  state: string;
  district: string;
  department?: string;
  // S1 — multi-tenant scoping. Every patient belongs to exactly one hospital.
  hospital_id: string;
};

export type Case = {
  id: string;
  patient_id: string;
  registration_id: string;
  scheme: Scheme;
  scheme_variant?: SchemeVariant;
  auth_mode?: AuthMode;
  entry_mode?: EntryMode;
  payer: string;
  procedure_code: string;
  procedure_name: string;
  diagnosis: string;
  treatment_type: Treatment;
  specialty?: Specialty;
  cycle?: { current: number; total: number };
  admission_date: string;
  discharge_date: string | null;
  status: ClaimStatus;
  claimed_amount: number;
  approved_amount: number | null;
  tat_days: number;
  age_days: number;
  missing_docs: number;
  open_queries: number;
  // === Pre-approval (Ayushman + FCI) ===
  approval_clock_started_at?: string;   // when MEDCO sent the pre-approval bundle
  approval_received_at?: string;         // when the letter landed
  approval_valid_till?: string;          // expiry of the approval
  approval_amount_inr?: number;
  approval_letter_filename?: string;
  // === Pre-auth (others) ===
  intimation_due_at?: string;            // SLA deadline post-admission
  // === Scheme switching after rejection ===
  scheme_history?: Array<{
    scheme: Scheme;
    scheme_variant?: SchemeVariant;
    attempted_at: string;
    outcome: "rejected" | "switched" | "active";
    rejection_reason?: string;
  }>;
  // K1 — rejection rounds counter (round-1 = doctor justification only,
  // round-2+ = full 3-option modal).
  rejection_rounds?: number;
  // K1 — contact person for physical-submission schemes (FCI / DU / NDMC).
  scheme_contact_person?: { name: string; phone?: string; designation?: string };
  // O3 — Team-performance assignment. Which MEDCO owns this case.
  assigned_medco_id?: string;        // matches user.id from db/users.json
  assigned_medco_name?: string;      // denormalized for display
  // S1 — multi-tenant scoping. Mirrors patient.hospital_id for fast filtering.
  hospital_id: string;
};

export type KpiTile = {
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
};

export type ActionTile = {
  label: string;
  value: string;
  subtitle?: string;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
  href?: string;
};

export type ActivityEvent = {
  id: string;
  ts: string;
  text: string;
  actor?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
};

export type WorkQueueGroup = {
  title: string;
  hint: string;
  tone: "bad" | "warn" | "accent" | "neutral";
  case_ids: string[];
};

// Map case status → current journey stage (4-stage model)
export function stageOf(status: ClaimStatus): Stage {
  if (status === "opd_done") return "opd";
  if (status === "preauth_pending"
   || status === "awaiting_approval"
   || status === "approval_received") return "pre_auth";
  if (status === "preauth_approved" || status === "admitted") return "mid_way";
  return "discharge";
}
