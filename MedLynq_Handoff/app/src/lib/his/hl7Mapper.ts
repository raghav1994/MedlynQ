// Map a parsed ADT^A04 HL7 message into the MedLynq Patient + provisional Case
// shapes the rest of the app understands.
//
// HL7 segments we read:
//   PID — patient demographics (name, DOB, gender, MRN, address, scheme card)
//   PV1 — visit details (admission date, ward, attending doctor, patient class)
//   IN1 — insurance / payer
//   DG1 — primary diagnosis (optional)

import type { HL7Message } from "./hl7Parser";
import { getField, messageType } from "./hl7Parser";
import type { Patient, Case, Scheme } from "@/lib/types";

export type MappedAdmission = {
  patient: Omit<Patient, "id"> & { id: string };
  case_seed: Pick<Case,
    "id" | "patient_id" | "registration_id" | "scheme" | "payer" |
    "procedure_code" | "procedure_name" | "diagnosis" | "treatment_type" |
    "admission_date" | "discharge_date" | "status" | "claimed_amount" |
    "approved_amount" | "tat_days" | "age_days" | "missing_docs" | "open_queries" |
    "hospital_id" | "entry_mode"
  >;
  source: { msg_control_id: string; sending_facility: string; trigger: string };
};

/** Parse an HL7 date string. Accepts YYYYMMDD or YYYYMMDDHHMMSS. */
function parseHL7Date(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function calcAgeFromDob(dob: string | null): number {
  if (!dob) return 0;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return 0;
  const diffYears = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  return Math.floor(diffYears);
}

/** Pure scheme normalizer — HIS data tends to be inconsistent. */
function normalizeScheme(raw: string | undefined): Scheme {
  if (!raw) return "PMJAY";
  const u = raw.toUpperCase();
  if (u.includes("PMJAY") || u.includes("AYUSHMAN")) return "PMJAY";
  if (u.includes("CGHS")) return "CGHS";
  if (u.includes("ECHS")) return "ECHS";
  if (u.includes("CAPF")) return "CAPF";
  if (u.includes("ESI"))  return "ESI";
  if (u.includes("RAIL") || u.includes("UMID")) return "Railway_UMID";
  if (u.includes("NDMC")) return "NDMC";
  if (u.includes("FCI"))  return "FCI";
  return "PMJAY";
}

export function mapHL7ToAdmission(msg: HL7Message, hospital_id: string): MappedAdmission {
  const mt = messageType(msg);
  if (mt.trigger !== "A04" && mt.trigger !== "A01") {
    throw new Error(`Unsupported HL7 message type: ${mt.structure}^${mt.trigger}. Expected ADT^A04.`);
  }

  // ---- PID ----
  const mrn      = getField(msg, "PID", 3, 1, 1) ?? "";
  const familyName = getField(msg, "PID", 5, 1, 1) ?? "";
  const givenName  = getField(msg, "PID", 5, 1, 2) ?? "";
  const name = [givenName, familyName].filter(Boolean).join(" ").trim() || mrn || "Unknown";
  const dob      = parseHL7Date(getField(msg, "PID", 7));
  const genderRaw = (getField(msg, "PID", 8) ?? "").toUpperCase();
  const gender: "M" | "F" = genderRaw === "F" ? "F" : "M";

  // PID-11: address (street ^ other ^ city ^ state ^ zip ^ country)
  const city  = getField(msg, "PID", 11, 1, 3) ?? "";
  const state = getField(msg, "PID", 11, 1, 4) ?? "";

  // ---- PV1 ----
  const patientClass = (getField(msg, "PV1", 2) ?? "").toUpperCase();   // I/O/E/P
  const ward         = getField(msg, "PV1", 3, 1, 1) ?? "";
  const department   = ward || "General";
  const doctorFamily = getField(msg, "PV1", 7, 1, 2) ?? "";
  const doctorGiven  = getField(msg, "PV1", 7, 1, 3) ?? "";
  const attendingDoctor = [doctorGiven, doctorFamily].filter(Boolean).join(" ").trim();
  const admitDate    = parseHL7Date(getField(msg, "PV1", 44)) ?? new Date().toISOString().slice(0, 10);

  // ---- IN1 ----
  const planId    = getField(msg, "IN1", 2) ?? "";
  const planName  = getField(msg, "IN1", 4) ?? "";
  const payer     = planName || planId || "Unknown payer";
  const cardNo    = getField(msg, "IN1", 36) ?? "";
  const scheme    = normalizeScheme(`${planId} ${planName}`);

  // ---- DG1 (optional) ----
  const diagText  = getField(msg, "DG1", 4) ?? getField(msg, "DG1", 3) ?? "";

  const localPatientId = `HIS-${mrn || Date.now().toString(36).toUpperCase()}`;
  const caseId = `HIS-${mrn || Date.now().toString(36).toUpperCase()}-${admitDate.replace(/-/g, "")}`;

  const patient: Omit<Patient, "id"> & { id: string } = {
    id: localPatientId,
    mrn: mrn || localPatientId,
    name,
    age: calcAgeFromDob(dob),
    gender,
    state: state || "",
    district: city || "",
    department,
    hospital_id,
  };

  const case_seed: MappedAdmission["case_seed"] = {
    id: caseId,
    patient_id: localPatientId,
    registration_id: caseId,
    scheme,
    payer,
    procedure_code: "",                  // unknown at admission — MEDCO fills later
    procedure_name: "",
    diagnosis: diagText,
    treatment_type: "other" as any,
    admission_date: admitDate,
    discharge_date: null,
    status: patientClass === "I" ? "admitted" as any : "opd_done" as any,
    claimed_amount: 0,
    approved_amount: null,
    tat_days: 0,
    age_days: 0,
    missing_docs: 0,
    open_queries: 0,
    hospital_id,
    entry_mode: "his_feed" as any,
  };

  return {
    patient,
    case_seed,
    source: {
      msg_control_id: getField(msg, "MSH", 10) ?? "",
      sending_facility: getField(msg, "MSH", 4) ?? "",
      trigger: mt.trigger,
    },
  };
}
