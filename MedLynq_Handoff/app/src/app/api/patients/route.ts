// /api/patients
//   GET  → list of dynamically-added patients (does NOT include the static mock list — UI merges client-side)
//   POST → append a new patient to the local store
//
// Local store: PatientLog/_index/patients.json
// Stays on disk. No cloud. DPDP compliant by default.

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { z } from "zod";

const PatientCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mrn: z.string().trim().min(1).max(50),
  age: z.coerce.number().int().min(0).max(150).optional(),
  gender: z.string().optional(),
  state: z.string().max(60).optional(),
  district: z.string().max(80).optional(),
  department: z.string().max(80).optional(),
});

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
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `patients-create:${guard.session.user.id}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = PatientCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid patient payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const list = await readStore();
    if (list.find((p) => p.mrn.toLowerCase() === body.mrn.toLowerCase())) {
      // Generic — don't confirm whether a particular MRN is registered.
      return NextResponse.json({ ok: false, error: "Could not create patient" }, { status: 400 });
    }
    const id = `P_LOCAL_${Date.now().toString(36).toUpperCase()}`;
    const p: StoredPatient = {
      id,
      mrn: body.mrn,
      name: body.name,
      age: body.age ?? 0,
      gender: String(body.gender ?? "M").toUpperCase().startsWith("F") ? "F" : "M",
      state: body.state ?? "",
      district: body.district ?? "",
      department: body.department ?? "Oncology",
      created_at: new Date().toISOString(),
    };
    list.push(p);
    await writeStore(list);
    return NextResponse.json({ ok: true, patient: p });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
