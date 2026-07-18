// POST /api/mobile-auth/add-patient
//
// The mobile app's "Add Patient" screen (medlynq-cam) has no cookie session
// to authenticate with (OkHttp has no CookieJar — see NetworkClient.kt), so
// this route follows the same trust model already used by the sibling
// GET /api/mobile-auth/patients: it's listed under middleware.ts's
// PUBLIC_PATHS "/api/mobile-auth" prefix and trusts the hospital_id the app
// sends (captured locally on the phone from a real prior login response).
//
// Writes both a patient row AND a matching case row — mirroring
// /api/opd/register, which is the desktop equivalent of "register a new
// patient" and the reason dynamic_patients.json needs both arrays touched
// for the patient to actually show up on the desktop /patients page.

import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { z } from "zod";
import { patients, cases } from "@/lib/mockData";
import { upsertPatient, upsertCase } from "@/lib/db/patientsCases";
import type { Specialty, Treatment } from "@/lib/types";

export const runtime = "nodejs";

const DB_DIR = path.resolve(process.cwd(), "db");
const DYN_FILE = path.join(DB_DIR, "dynamic_patients.json");

async function readJSON<T>(p: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; }
}
async function writeJSON(p: string, value: any) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(value, null, 2));
}

const BodySchema = z.object({
  hospital_id: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
  mrn: z.string().max(60).optional().default(""),
  age: z.union([z.string(), z.number()]).optional().default(""),
  gender: z.string().max(10).optional().default("M"),
  state: z.string().max(100).optional().default(""),
  district: z.string().max(100).optional().default(""),
  department: z.string().max(60).optional().default(""),
});

function generateMRN(hospital_id: string): string {
  const short = (hospital_id.match(/[A-Z]{2,}/g)?.[1] ?? hospital_id.slice(0, 3)).toUpperCase();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `UHID-${short}-${rand}`;
}

function normMrn(s: string) { return s.trim().toLowerCase(); }

// Department display names (e.g. "Oncology") -> Specialty slug used by the
// checklist engine. Falls back to "oncology" — every seeded mobile tenant
// so far is a cancer hospital.
const DEPT_TO_SPECIALTY: Record<string, Specialty> = {
  oncology: "oncology",
  cardiac: "cardiac",
  cardiology: "cardiac",
  ortho: "ortho",
  orthopaedic: "ortho",
  orthopedic: "ortho",
  dialysis: "dialysis",
  icu: "icu",
  maternity: "maternity",
  "general medicine": "general_medicine",
  general_medicine: "general_medicine",
};

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const hospital_id = body.hospital_id;

  const specialty: Specialty = DEPT_TO_SPECIALTY[body.department.trim().toLowerCase()] ?? "oncology";

  const mrnQuery = body.mrn.toString().trim();
  let patient = mrnQuery
    ? patients.find((p) => p.hospital_id === hospital_id && normMrn(p.mrn) === normMrn(mrnQuery))
    : undefined;

  let mrn_auto_generated = false;
  let isNewPatient = false;
  if (!patient) {
    isNewPatient = true;
    let mrn = mrnQuery;
    if (!mrn) {
      mrn = generateMRN(hospital_id);
      mrn_auto_generated = true;
    }
    const ageNum = typeof body.age === "number" ? body.age : parseInt(body.age.toString(), 10) || 0;
    patient = {
      id: "P_AUTO_" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex"),
      mrn,
      name: body.name.trim(),
      age: ageNum,
      gender: (body.gender.trim().toUpperCase() === "F" ? "F" : "M") as "M" | "F",
      state: body.state.trim(),
      district: body.district.trim(),
      department: body.department.trim() || "Oncology",
      hospital_id,
    };
    patients.push(patient);
    try {
      await upsertPatient(patient);
    } catch (e: any) {
      console.error("Supabase upsertPatient failed for mobile add-patient:", e.message);
    }
  }

  const caseId = "MOB-" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex");
  const today = new Date().toISOString().slice(0, 10);
  const newCase = {
    id: caseId,
    patient_id: patient.id,
    registration_id: caseId,
    scheme: "Cash",
    payer: "Self-pay",
    procedure_code: "",
    procedure_name: "",
    diagnosis: "",
    treatment_type: "medicine" as Treatment,
    specialty,
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
  };
  cases.push(newCase as any);

  const dyn = await readJSON<{ patients: any[]; cases: any[] }>(DYN_FILE, { patients: [], cases: [] });
  if (isNewPatient) dyn.patients.push(patient);
  dyn.cases.push(newCase);
  await writeJSON(DYN_FILE, dyn);

  try {
    await upsertCase(newCase as any);
  } catch (e: any) {
    console.error("Supabase upsertCase failed for mobile add-patient:", e.message);
  }

  return NextResponse.json({
    ok: true,
    patient_id: patient.id,
    case_id: caseId,
    mrn: patient.mrn,
    mrn_auto_generated,
  });
}
