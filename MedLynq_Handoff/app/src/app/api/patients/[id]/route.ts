// PATCH /api/patients/[id]  { name?, mrn?, age?, gender? }
//
// Renames or edits patient fields. Overrides are persisted to
// db/patient_overrides.json and re-applied by loadDynamicData() on every read,
// so both seed patients and auto-created ones can be renamed uniformly.
//
// mrn is special: it's the actual on-disk document-folder key
// (PatientLog/{mrn}/originals|extracted — every route derives the folder
// live from patient.mrn on each read, it's never cached at creation time).
// Changing it here also renames that folder on disk, so uploaded documents
// stay attached to the patient instead of silently orphaning.
//
// Tenant-scoped: only ADMIN/MEDCO of the same hospital as the patient can edit.

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir, rename } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { scopedPatient } from "@/lib/dataScope";

export const runtime = "nodejs";

const OVERRIDE_FILE = path.resolve(process.cwd(), "db", "patient_overrides.json");
const AUDIT_DIR  = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit_log.jsonl");
const PATIENTLOG_DIR = path.resolve(process.cwd(), "..", "PatientLog");

function safeMrn(mrn: string) {
  return mrn.replace(/[^A-Za-z0-9_-]/g, "_");
}

const PatchSchema = z.object({
  name:   z.string().trim().min(1).max(120).optional(),
  mrn:    z.string().trim().min(1).max(60).optional(),
  age:    z.union([z.number().int().min(0).max(150), z.string()]).optional(),
  gender: z.string().max(6).optional(),
});

async function readOverrides(): Promise<Record<string, any>> {
  try { return JSON.parse(await readFile(OVERRIDE_FILE, "utf8")); } catch { return {}; }
}
async function writeOverrides(v: Record<string, any>) {
  await mkdir(path.dirname(OVERRIDE_FILE), { recursive: true });
  await writeFile(OVERRIDE_FILE, JSON.stringify(v, null, 2));
}
async function appendAudit(entry: Record<string, any>) {
  try {
    await mkdir(AUDIT_DIR, { recursive: true });
    await writeFile(AUDIT_FILE, JSON.stringify(entry) + "\n", { flag: "a" });
  } catch {}
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `patient-patch:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid patch", details: parsed.error.flatten() }, { status: 400 });
  }

  // Tenant-scoped lookup — will return null if patient belongs to a different hospital
  const p = await scopedPatient(params.id);
  if (!p) {
    return NextResponse.json({ ok: false, error: "Patient not found" }, { status: 404 });
  }

  const patch: Record<string, any> = {};
  if (parsed.data.name !== undefined)   patch.name   = parsed.data.name.trim();
  if (parsed.data.age !== undefined) {
    const n = typeof parsed.data.age === "number" ? parsed.data.age : parseInt(String(parsed.data.age), 10);
    if (Number.isFinite(n)) patch.age = n;
  }
  if (parsed.data.gender !== undefined) {
    const g = String(parsed.data.gender).toUpperCase();
    patch.gender = g.startsWith("F") ? "F" : "M";
  }

  let folderRenamed: { from: string; to: string } | null = null;
  if (parsed.data.mrn !== undefined) {
    const newMrn = parsed.data.mrn.trim();
    if (newMrn !== p.mrn) {
      const oldDir = path.join(PATIENTLOG_DIR, safeMrn(p.mrn));
      const newDir = path.join(PATIENTLOG_DIR, safeMrn(newMrn));
      if (existsSync(newDir)) {
        return NextResponse.json({ ok: false, error: `MRN "${newMrn}" is already in use by another patient's document folder` }, { status: 409 });
      }
      if (existsSync(oldDir)) {
        await rename(oldDir, newDir);
        folderRenamed = { from: oldDir, to: newDir };
      }
      patch.mrn = newMrn;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No editable fields provided" }, { status: 400 });
  }

  const overrides = await readOverrides();
  overrides[p.id] = { ...(overrides[p.id] ?? {}), ...patch, updated_at: new Date().toISOString() };
  await writeOverrides(overrides);

  await appendAudit({
    ts: new Date().toISOString(),
    kind: "patient_renamed",
    actor: { id: guard.session.user.id, role: guard.session.user.role },
    hospital_id: guard.session.user.hospital_id,
    patient_id: p.id,
    patch,
    folder_renamed: folderRenamed,
    prior: { name: p.name, age: p.age, gender: p.gender },
  });

  return NextResponse.json({ ok: true, patient_id: p.id, patch });
}
