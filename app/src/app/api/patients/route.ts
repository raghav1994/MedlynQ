// /api/patients
//   GET  → list of dynamically-added patients (does NOT include the static mock list — UI merges client-side)
//   POST → append a new patient to the local store
//
// Local store: PatientLog/_index/patients.json
// Stays on disk. No cloud. DPDP compliant by default.

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const STORE_DIR = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const STORE_FILE = path.join(STORE_DIR, "patients.json");

type StoredPatient = {
  id: string;
  mrn: string;
  name: string;
  age: number;
  gender: "M" | "F";
  state: string;
  district: string;
  department?: string;
  created_at: string;
};

async function readStore(): Promise<StoredPatient[]> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeStore(list: StoredPatient[]) {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(list, null, 2), "utf8");
}

export async function GET() {
  const list = await readStore();
  return NextResponse.json({ ok: true, patients: list });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name ?? "").trim();
    const mrn = String(body.mrn ?? "").trim();
    if (!name || !mrn) {
      return NextResponse.json({ ok: false, error: "name and mrn required" }, { status: 400 });
    }
    const list = await readStore();
    if (list.find((p) => p.mrn.toLowerCase() === mrn.toLowerCase())) {
      return NextResponse.json({ ok: false, error: "MRN already exists" }, { status: 409 });
    }
    const id = `P_LOCAL_${Date.now().toString(36).toUpperCase()}`;
    const p: StoredPatient = {
      id,
      mrn,
      name,
      age: parseInt(String(body.age ?? 0), 10) || 0,
      gender: String(body.gender ?? "M").toUpperCase().startsWith("F") ? "F" : "M",
      state: String(body.state ?? ""),
      district: String(body.district ?? ""),
      department: String(body.department ?? "Oncology"),
      created_at: new Date().toISOString(),
    };
    list.push(p);
    await writeStore(list);
    return NextResponse.json({ ok: true, patient: p });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
