// FHIR R4 Bundle builder for NHCX claims.
//
// Converts a MedLynq Case + Patient + extracted document synopses into a
// FHIR Bundle in the shape the National Health Claims Exchange (NHCX) expects.
//
// Reference: https://nrces.in/ndhm/fhir/r4/index.html (NRCeS FHIR R4 profiles)
//
// What we send:
//   - Bundle (type: "document")
//     ├─ Patient        (Aadhaar/ABHA identifier, age, gender)
//     ├─ Coverage       (scheme + scheme card # + payer)
//     ├─ Practitioner   (treating doctor — from prescription synopsis)
//     ├─ Organization   (hospital — sender)
//     ├─ Organization   (insurer — receiver)
//     ├─ Claim          (procedure code, amount, line items, supporting info)
//     └─ DocumentReference[]  (one per uploaded supporting doc, with SHA-256 hash)
//
// Patient PII is ONLY identified by scheme card # + ABHA-style hash —
// names + DOB are NOT sent. DPDP-clean by construction.

import type { Case, Patient, Scheme } from "./types";
import { resolveIcd10Codes } from "./icd10";

// ---------- FHIR resource shapes (minimal, only what NHCX cares about) ----------

type FHIRReference = { reference: string };
type FHIRCodeableConcept = {
  coding?: Array<{ system?: string; code?: string; display?: string }>;
  text?: string;
};
type FHIRIdentifier = { system?: string; value: string };
type FHIRPeriod = { start?: string; end?: string };

export type FHIRResource =
  | FHIRBundle
  | FHIRPatient
  | FHIRCoverage
  | FHIRPractitioner
  | FHIROrganization
  | FHIRCondition
  | FHIREncounter
  | FHIRClaim
  | FHIRDocumentReference;

export type FHIRBundle = {
  resourceType: "Bundle";
  id: string;
  type: "document";
  timestamp: string;
  identifier: FHIRIdentifier;
  entry: Array<{ fullUrl: string; resource: any }>;
  meta?: {
    profile?: string[];
    versionId?: string;
  };
};

export type FHIRPatient = {
  resourceType: "Patient";
  id: string;
  identifier: FHIRIdentifier[];
  gender?: "male" | "female" | "other";
  birthDate?: string;
};

export type FHIRCoverage = {
  resourceType: "Coverage";
  id: string;
  status: "active";
  beneficiary: FHIRReference;
  payor: FHIRReference[];
  identifier?: FHIRIdentifier[];
  type?: FHIRCodeableConcept;
};

export type FHIRPractitioner = {
  resourceType: "Practitioner";
  id: string;
  identifier?: FHIRIdentifier[];
  name: Array<{ text: string }>;
};

export type FHIROrganization = {
  resourceType: "Organization";
  id: string;
  identifier?: FHIRIdentifier[];
  name: string;
  type?: FHIRCodeableConcept[];
};

// verifiedIcd10 — the FHIR-standard way to flag data quality is a
// dataAbsentReason/extension, not a custom field on the resource itself.
// We use a simple extension so downstream consumers (or our own audit UI)
// can tell "hospital-coded" apart from "LLM guessed, needs review" without
// parsing free text.
const UNVERIFIED_CODE_EXTENSION_URL = "https://medlynq.app/fhir/StructureDefinition/unverified-code-source";

export type FHIRCondition = {
  resourceType: "Condition";
  id: string;
  clinicalStatus?: FHIRCodeableConcept;
  code: FHIRCodeableConcept;
  subject: FHIRReference;
  encounter?: FHIRReference;
  recordedDate?: string;
  extension?: Array<{ url: string; valueString?: string; valueBoolean?: boolean }>;
};

export type FHIREncounter = {
  resourceType: "Encounter";
  id: string;
  status: "in-progress" | "finished";
  class: { system?: string; code: string; display?: string };
  subject: FHIRReference;
  serviceProvider?: FHIRReference;
  period?: FHIRPeriod;
};

export type FHIRClaim = {
  resourceType: "Claim";
  id: string;
  status: "active";
  use: "claim" | "preauthorization";
  type: FHIRCodeableConcept;
  patient: FHIRReference;
  created: string;
  insurer: FHIRReference;
  provider: FHIRReference;
  priority: FHIRCodeableConcept;
  insurance: Array<{ sequence: number; focal: boolean; coverage: FHIRReference }>;
  // A coded diagnosis (Condition resource, preferred — has a real ICD-10
  // code) uses diagnosisReference; a diagnosis we couldn't code at all
  // falls back to free-text diagnosisCodeableConcept so the claim still
  // carries SOME diagnosis info rather than dropping it silently.
  diagnosis?: Array<{
    sequence: number;
    diagnosisCodeableConcept?: FHIRCodeableConcept;
    diagnosisReference?: FHIRReference;
  }>;
  item: Array<{
    sequence: number;
    productOrService: FHIRCodeableConcept;
    encounter?: FHIRReference[];
    unitPrice?: { value: number; currency: "INR" };
    net?: { value: number; currency: "INR" };
  }>;
  total: { value: number; currency: "INR" };
  supportingInfo?: Array<{
    sequence: number;
    category: FHIRCodeableConcept;
    valueReference?: FHIRReference;
  }>;
};

export type FHIRDocumentReference = {
  resourceType: "DocumentReference";
  id: string;
  status: "current";
  type: FHIRCodeableConcept;
  subject: FHIRReference;
  date: string;
  content: Array<{
    attachment: {
      contentType: string;
      hash?: string;          // base64-encoded SHA-256 of doc bytes
      title?: string;
    };
  }>;
};

// ---------- Scheme → FHIR payer codes ----------
const PAYER_SYSTEM = "https://nha.gov.in/CodeSystem/payer-id";
const PAYER_CODES: Record<Scheme, { code: string; display: string }> = {
  Ayushman:     { code: "NHA-PMJAY",     display: "Ayushman Bharat PM-JAY" },
  PMJAY:        { code: "NHA-PMJAY",     display: "PM-JAY" },
  CGHS:         { code: "CGHS-CENTRAL",  display: "CGHS" },
  CAPF:         { code: "CAPF-MHA",      display: "CAPF" },
  ECHS:         { code: "ECHS-IDS",      display: "ECHS" },
  ESI:          { code: "ESIC-MOL",      display: "ESIC" },
  Railway_UMID: { code: "RAIL-UMID",     display: "Railway UMID" },
  NDMC:         { code: "NDMC-MED",      display: "NDMC Medical" },
  DGHS:         { code: "DGHS-MED",      display: "DGHS" },
  FCI:          { code: "FCI-HR",        display: "FCI" },
  DU:           { code: "DU-HEALTH",     display: "DU Health Centre" },
  TPA:          { code: "TPA",           display: "Private TPA" },
  Cash:         { code: "SELF",          display: "Self-pay" },
};

// ---------- ABHA-style hashed identifier (DPDP — no raw Aadhaar leaves) ----------
export async function hashIdentifier(raw: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") {
    // Node fallback
    const { createHash } = await import("crypto");
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }
  const buf = new TextEncoder().encode(raw);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// ---------- Bundle builder ----------
export type BuildBundleInput = {
  caseRecord: Case;
  patient: Patient;
  hospital: { id: string; name: string; npi?: string };
  treating_doctor?: string;
  doc_synopses?: Array<{
    doc_id: string;
    doc_type: string;
    label: string;
    confidence?: number | null;
    file_sha256?: string;     // when available, included as attachment.hash
  }>;
};

export async function buildFhirBundle(input: BuildBundleInput): Promise<FHIRBundle> {
  const { caseRecord: c, patient: p, hospital, treating_doctor, doc_synopses } = input;
  const now = new Date().toISOString();
  const bundle_id = `bundle-${c.id}-${Date.now()}`;

  const patient_hash = await hashIdentifier(`${p.mrn}|${p.name}|${p.age}`);
  const patient_id = `pat-${patient_hash}`;
  const coverage_id = `cov-${patient_hash}`;
  const practitioner_id = `prac-${hospital.id}-dr`;
  const provider_org_id = `org-provider-${hospital.id}`;
  const insurer_org_id = `org-insurer-${c.scheme}`;
  const claim_id = `claim-${c.id}`;
  const encounter_id = `enc-${c.id}`;

  const payerInfo = PAYER_CODES[c.scheme];
  // A real claim can carry more than one diagnosis (primary + comorbidity) —
  // one Condition resource per code, each with its own stable id so the
  // Claim.diagnosis array can reference them all by sequence.
  const icd10Codes = await resolveIcd10Codes(c.diagnosis, c.icd10_codes_override);

  // === Resources ===
  const patientRes: FHIRPatient = {
    resourceType: "Patient",
    id: patient_id,
    identifier: [
      { system: "https://nha.gov.in/abha", value: patient_hash },
      { system: `https://${c.scheme.toLowerCase()}.gov.in/beneficiary`, value: p.mrn },
    ],
    gender: p.gender === "F" ? "female" : "male",
  };

  const coverageRes: FHIRCoverage = {
    resourceType: "Coverage",
    id: coverage_id,
    status: "active",
    beneficiary: { reference: `Patient/${patient_id}` },
    payor: [{ reference: `Organization/${insurer_org_id}` }],
    identifier: [{ system: PAYER_SYSTEM, value: payerInfo.code }],
    type: { coding: [{ system: PAYER_SYSTEM, code: payerInfo.code, display: payerInfo.display }] },
  };

  const practitionerRes: FHIRPractitioner = {
    resourceType: "Practitioner",
    id: practitioner_id,
    name: [{ text: treating_doctor || "Treating Physician" }],
  };

  const providerOrgRes: FHIROrganization = {
    resourceType: "Organization",
    id: provider_org_id,
    identifier: hospital.npi ? [{ system: "https://nha.gov.in/hospital-id", value: hospital.npi }] : undefined,
    name: hospital.name,
    type: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/organization-type", code: "prov", display: "Healthcare Provider" }] }],
  };

  const insurerOrgRes: FHIROrganization = {
    resourceType: "Organization",
    id: insurer_org_id,
    name: payerInfo.display,
    type: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/organization-type", code: "ins", display: "Insurance Company" }] }],
  };

  // Every claim needs an Encounter — this is the "which admission does this
  // claim belong to" resource NHCX expects. class "IMP" (inpatient) is the
  // right default for a hospital claims workflow; day-care chemo cycles are
  // still technically inpatient encounters even at a few hours' stay.
  const encounterRes: FHIREncounter = {
    resourceType: "Encounter",
    id: encounter_id,
    status: c.discharge_date ? "finished" : "in-progress",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" },
    subject: { reference: `Patient/${patient_id}` },
    serviceProvider: { reference: `Organization/${provider_org_id}` },
    period: c.admission_date ? { start: c.admission_date, end: c.discharge_date ?? undefined } : undefined,
  };

  // One Condition resource per resolved code — empty when nothing could be
  // coded at all, in which case the Claim falls back to a free-text
  // diagnosisCodeableConcept instead of shipping a fake/empty code.
  const conditionResources: FHIRCondition[] = icd10Codes.map((icd10, i) => ({
    resourceType: "Condition",
    id: `cond-${c.id}-${i + 1}`,
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active", display: "Active" }] },
    code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: icd10.code, display: icd10.display }], text: icd10.display },
    subject: { reference: `Patient/${patient_id}` },
    encounter: { reference: `Encounter/${encounter_id}` },
    recordedDate: now,
    extension: icd10.verified ? undefined : [{
      url: UNVERIFIED_CODE_EXTENSION_URL,
      valueBoolean: true,
      valueString: `LLM-guessed ICD-10 (source: ${icd10.source}) — confirm before a real submission`,
    }],
  }));

  const claimRes: FHIRClaim = {
    resourceType: "Claim",
    id: claim_id,
    status: "active",
    use: c.status === "preauth_pending" || c.status === "awaiting_approval" ? "preauthorization" : "claim",
    type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/claim-type", code: "institutional", display: "Institutional" }] },
    patient: { reference: `Patient/${patient_id}` },
    created: now,
    insurer: { reference: `Organization/${insurer_org_id}` },
    provider: { reference: `Organization/${provider_org_id}` },
    priority: { coding: [{ code: "normal" }] },
    insurance: [{ sequence: 1, focal: true, coverage: { reference: `Coverage/${coverage_id}` } }],
    diagnosis: conditionResources.length > 0
      ? conditionResources.map((cond, i) => ({ sequence: i + 1, diagnosisReference: { reference: `Condition/${cond.id}` } }))
      : c.diagnosis ? [{ sequence: 1, diagnosisCodeableConcept: { text: c.diagnosis } }] : undefined,
    item: [{
      sequence: 1,
      productOrService: {
        coding: [{
          system: "https://nha.gov.in/hbp-2.2",
          code: c.procedure_code,
          display: c.procedure_name,
        }],
      },
      encounter: [{ reference: `Encounter/${encounter_id}` }],
      unitPrice:  { value: c.claimed_amount, currency: "INR" },
      net:        { value: c.claimed_amount, currency: "INR" },
    }],
    total: { value: c.claimed_amount, currency: "INR" },
    supportingInfo: doc_synopses && doc_synopses.length > 0
      ? doc_synopses.map((d, i) => ({
          sequence: i + 1,
          category: { text: d.label },
          valueReference: { reference: `DocumentReference/doc-${d.doc_id.slice(0, 32)}` },
        }))
      : undefined,
  };

  const docRefs: FHIRDocumentReference[] = (doc_synopses ?? []).map((d) => ({
    resourceType: "DocumentReference",
    id: `doc-${d.doc_id.slice(0, 32)}`,
    status: "current",
    type: { text: d.label },
    subject: { reference: `Patient/${patient_id}` },
    date: now,
    content: [{
      attachment: {
        contentType: d.doc_id.endsWith(".pdf") ? "application/pdf" : "image/jpeg",
        title: d.doc_id,
        hash: d.file_sha256,
      },
    }],
  }));

  const bundle: FHIRBundle = {
    resourceType: "Bundle",
    id: bundle_id,
    type: "document",
    timestamp: now,
    identifier: { system: "https://medlynq.app/bundle-id", value: bundle_id },
    meta: { profile: ["https://nrces.in/fhir/StructureDefinition/Claim-Bundle"] },
    entry: [
      { fullUrl: `urn:uuid:${patient_id}`,      resource: patientRes },
      { fullUrl: `urn:uuid:${coverage_id}`,     resource: coverageRes },
      { fullUrl: `urn:uuid:${practitioner_id}`, resource: practitionerRes },
      { fullUrl: `urn:uuid:${provider_org_id}`, resource: providerOrgRes },
      { fullUrl: `urn:uuid:${insurer_org_id}`,  resource: insurerOrgRes },
      { fullUrl: `urn:uuid:${encounter_id}`,    resource: encounterRes },
      ...conditionResources.map((cond) => ({ fullUrl: `urn:uuid:${cond.id}`, resource: cond })),
      { fullUrl: `urn:uuid:${claim_id}`,        resource: claimRes },
      ...docRefs.map((d) => ({ fullUrl: `urn:uuid:${d.id}`, resource: d })),
    ],
  };

  return bundle;
}

// ---------- Audit-hash signing ----------
// Returns a canonical SHA-256 of the bundle (deterministic — same bundle → same hash).
export async function signBundle(bundle: FHIRBundle): Promise<string> {
  // Canonical JSON: sort keys recursively so hash is stable across reorderings
  const canonical = JSON.stringify(sortKeys(bundle));
  if (typeof globalThis.crypto?.subtle?.digest !== "function") {
    const { createHash } = await import("crypto");
    return createHash("sha256").update(canonical).digest("hex");
  }
  const buf = new TextEncoder().encode(canonical);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}
