// POST /api/opd/register
//
// The OPD Registration page's "Create case" action. Given the patient +
// consult fields captured on that page:
//   1. Matches against existing patients (same hospital only) — reuses the
//      patient row if found, creates a new one if not.
//   2. Auto-generates a UHID/MRN when the MEDCO left it blank (no HIS to
//      pull one from) so every patient still gets a stable identifier.
//   3. Creates a new Case with status "opd_done" — the first of the
//      4-stage model everything downstream (checklist, Lynq, Patient List) depends on.
//   4. Persists to Supabase (durable) + the in-memory store + dynamic_patients.json
//      (so it's visible immediately in this same server process, and survives
//      a restart before the next Supabase hydration), mirroring the doc-router
//      auto-create pattern already used elsewhere.
//
// Returns: { ok, patient_id, case_id, mrn, mrn_auto_generated }

import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { scopedData } from "@/lib/dataScope";
import { patients, cases } from "@/lib/mockData";
import { upsertPatient, upsertCase } from "@/lib/db/patientsCases";
import type { Specialty, Treatment } from "@/lib/types";

export const runtime = "nodejs";

const DB_DIR   = path.resolve(process.cwd(), "db");
const DYN_FILE = path.join(DB_DIR, "dynamic_patients.json");

async function readJSON<T>(p: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; }
}
async function writeJSON(p: string, value: any) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(value, null, 2));
}

const BodySchema = z.object({
  name: z.string().min(1).max(200),
  mrn: z.string().max(60).optional().default(""),
  age: z.string().max(3).optional().default(""),
  gender: z.enum(["M", "F"]),
  state: z.string().max(100).optional().default(""),
  scheme: z.string().max(60).optional().default(""),
  specialty: z.string(),
  treatment: z.string(),
  doctor: z.string().max(150).optional().default(""),
  reasonForVisit: z.string().min(1).max(2000),
});

// Generates a MedLynq-issued UHID when the hospital has no HIS to pull one
// from — e.g. UHID-BLR-4F8A2C. Format is deliberately distinct from a real
// HIS's own numbering so it's obviously MedLynq-assigned if ever compared.
function generateMRN(hospital_id: string): string {
  const short = (hospital_id.match(/[A-Z]{2,}/g)?.[1] ?? hospital_id.slice(0, 3)).toUpperCase();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `UHID-${short}-${rand}`;
}

function normMrn(s: string) { return s.trim().toLowerCase(); }

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `opd-register:${guard.session.user.id}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const hospital_id = guard.session.user.hospital_id;

  // Ensure we're matching against fresh data (Supabase + JSON fallbacks).
  await scopedData();

  // ---- Find or create the patient (same-hospital only) ----
  // Two lookup passes, both scoped to this hospital only (never cross-tenant):
  //   1. Exact MRN match — the common case.
  //   2. Name + age fallback — catches the same real person coming back with
  //      a DIFFERENT MRN than what's on file (e.g. they were first registered
  //      here with a MedLynq-generated UHID, and this time the MEDCO has a
  //      real HIS-issued MRN in hand, or vice versa). We never silently
  //      create a second patient row in that case — we reuse the match and
  //      flag the mismatch back to the caller instead of guessing which
  //      MRN is "right".
  const mrnQuery = body.mrn.trim();
  let patient = mrnQuery
    ? patients.find((p) => p.hospital_id === hospital_id && normMrn(p.mrn) === normMrn(mrnQuery))
    : undefined;
  let matchedByMrn = !!patient;
  if (!patient && body.name) {
    const nameQuery = body.name.trim().toLowerCase();
    const ageNum = body.age ? parseInt(body.age, 10) : undefined;
    patient = patients.find((p) =>
      p.hospital_id === hospital_id &&
      p.name.trim().toLowerCase() === nameQuery &&
      (ageNum === undefined || p.age === ageNum)
    );
  }

  // Same person, different MRN than what's on file — surfaced as a warning,
  // never overwritten automatically (either MRN could be the "wrong" one
  // from MedLynq's point of view; a human should reconcile it).
  const mrn_conflict = !!(patient && !matchedByMrn && mrnQuery && normMrn(mrnQuery) !== normMrn(patient.mrn));

  let mrn_auto_generated = false;
  let isNewPatient = false;
  if (!patient) {
    isNewPatient = true;
    let mrn = mrnQuery;
    if (!mrn) {
      mrn = generateMRN(hospital_id);
      mrn_auto_generated = true;
    }
    patient = {
      id: "P_AUTO_" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex"),
      mrn,
      name: body.name.trim(),
      age: body.age ? parseInt(body.age, 10) || 0 : 0,
      gender: body.gender,
      state: body.state.trim(),
      district: "",
      department: body.specialty,
      hospital_id,
    };
    patients.push(patient);
    try {
      await upsertPatient(patient);
    } catch (e: any) {
      console.error("Supabase upsertPatient failed for OPD registration:", e.message);
    }
  }

  // ---- Create the case ----
  const caseId = "OPD-" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex");
  const today = new Date().toISOString().slice(0, 10);
  const newCase = {
    id: caseId,
    patient_id: patient.id,
    registration_id: caseId,
    scheme: body.scheme.trim() || "Cash",
    payer: body.scheme.trim() || "Self-pay",
    procedure_code: "",
    procedure_name: "",
    // Diagnosis is the doctor's call, not captured at OPD registration —
    // left blank here deliberately (the doctor records it during consult,
    // via prescription/discharge documents landed later in the case).
    diagnosis: "",
    treatment_type: body.treatment as Treatment,
    specialty: body.specialty as Specialty,
    admission_date: today,
    discharge_date: null,
    status: "opd_done",
    claimed_amount: 0,
    approved_amount: null,
    tat_days: 0,
    age_days: 0,
    missing_docs: 0,
    open_queries: 0,
    hospital_id,
    entry_mode: "checkup",
    chief_complaint: body.reasonForVisit.trim(),
    consulting_doctor: body.doctor.trim() || undefined,
  };
  cases.push(newCase as any);

  const dyn = await readJSON<{ patients: any[]; cases: any[] }>(DYN_FILE, { patients: [], cases: [] });
  if (isNewPatient) dyn.patients.push(patient);
  dyn.cases.push(newCase);
  await writeJSON(DYN_FILE, dyn);

  try {
    await upsertCase(newCase as any);
  } catch (e: any) {
    console.error("Supabase upsertCase failed for OPD registration:", e.message);
  }

  return NextResponse.json({
    ok: true,
    patient_id: patient.id,
    case_id: caseId,
    mrn: patient.mrn,
    mrn_auto_generated,
    mrn_conflict,
    provided_mrn: mrn_conflict ? mrnQuery : undefined,
  });
}
