// A "document request" is a MEDCO/ADMIN flagging a specific missing document
// on a patient and asking staff to go capture it (with an optional note) —
// surfaced as a red highlight on both the desktop checklist tile/patient row
// AND the mobile app's patient card + document list, until someone actually
// uploads that doc_type (from either desktop or mobile), at which point it
// auto-clears on both sides. See land/route.ts and mobile-upload/route.ts,
// which call fulfillMatching() right after a document lands.
//
// Keyed by patient_id + doc_type, not case_id — documents in this app live
// at the MRN/patient level on disk (docsForCase() just re-reads the same
// folder for whichever case_id is asked), so case_id carries no real
// distinction here and mobile never even has one to send back.
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";

export type DocumentRequest = {
  id: string;
  hospital_id: string;
  patient_id: string;
  case_id?: string;
  doc_type: string;
  note: string;
  status: "pending" | "fulfilled";
  requested_by: string;
  requested_at: string;
  fulfilled_at: string | null;
};

const STORE_FILE = path.resolve(process.cwd(), "db", "document_requests.json");

async function readAll(): Promise<DocumentRequest[]> {
  try {
    return JSON.parse(await readFile(STORE_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function writeAll(requests: DocumentRequest[]) {
  await mkdir(path.dirname(STORE_FILE), { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(requests, null, 2));
}

export async function createRequest(input: {
  hospital_id: string;
  patient_id: string;
  case_id?: string;
  doc_type: string;
  note: string;
  requested_by: string;
}): Promise<DocumentRequest> {
  const requests = await readAll();
  const record: DocumentRequest = {
    id: "REQ_" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex"),
    hospital_id: input.hospital_id,
    patient_id: input.patient_id,
    case_id: input.case_id,
    doc_type: input.doc_type,
    note: input.note.trim(),
    status: "pending",
    requested_by: input.requested_by,
    requested_at: new Date().toISOString(),
    fulfilled_at: null,
  };
  requests.push(record);
  await writeAll(requests);
  return record;
}

export async function getForPatient(patientId: string): Promise<DocumentRequest[]> {
  const requests = await readAll();
  return requests.filter((r) => r.patient_id === patientId);
}

// Set of patient_ids with at least one pending request, scoped to a
// hospital — used for the red badge on both the desktop and mobile
// patient-list cards, which don't want per-document detail, just "does
// this patient have anything outstanding".
export async function getPendingPatientIds(hospitalId: string): Promise<Set<string>> {
  const requests = await readAll();
  return new Set(
    requests
      .filter((r) => r.hospital_id === hospitalId && r.status === "pending")
      .map((r) => r.patient_id)
  );
}

// Called right after any document lands (desktop or mobile) — clears every
// pending request for this patient whose doc_type matches what just got
// uploaded. Matching is case-insensitive since desktop and mobile don't
// always agree on capitalization for the same doc type label.
export async function fulfillMatching(patientId: string, docType: string): Promise<DocumentRequest[]> {
  const requests = await readAll();
  const norm = docType.trim().toLowerCase();
  const fulfilled: DocumentRequest[] = [];
  let changed = false;
  for (const r of requests) {
    if (r.patient_id === patientId && r.status === "pending" && r.doc_type.trim().toLowerCase() === norm) {
      r.status = "fulfilled";
      r.fulfilled_at = new Date().toISOString();
      fulfilled.push(r);
      changed = true;
    }
  }
  if (changed) await writeAll(requests);
  return fulfilled;
}
