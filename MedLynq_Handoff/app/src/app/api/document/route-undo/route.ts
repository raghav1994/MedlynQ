// POST /api/document/route-undo  { token }
//
// Reverses the changes recorded by /route-apply, if still within the 5-min window.
// Returns 410 Gone if the token expired (so the UI knows the undo button is dead).

import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { patchCase, deleteCase, deletePatient } from "@/lib/db/patientsCases";

export const runtime = "nodejs";

const DB_DIR  = path.resolve(process.cwd(), "db");
const DYN_FILE        = path.join(DB_DIR, "dynamic_patients.json");
const CASE_STATE_FILE = path.join(DB_DIR, "nhcx_case_state.json");
const ATTACH_FILE     = path.join(DB_DIR, "doc_attachments.json");
const UNDO_FILE       = path.join(DB_DIR, "undo_tokens.json");

const AUDIT_DIR  = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit_log.jsonl");

async function readJSON<T>(p: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; }
}
async function writeJSON(p: string, value: any) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(value, null, 2));
}
async function appendAudit(entry: Record<string, any>) {
  try {
    await mkdir(AUDIT_DIR, { recursive: true });
    await writeFile(AUDIT_FILE, JSON.stringify(entry) + "\n", { flag: "a" });
  } catch {}
}

const UndoSchema = z.object({ token: z.string().min(10).max(120) });

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = UndoSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid undo payload" }, { status: 400 });
  }
  const { token } = parsed.data;

  const undoStore = await readJSON<Record<string, any>>(UNDO_FILE, {});
  const record = undoStore[token];
  if (!record) {
    return NextResponse.json({ ok: false, error: "Unknown or already-used token" }, { status: 404 });
  }
  if (record.expires_at < Date.now()) {
    delete undoStore[token];
    await writeJSON(UNDO_FILE, undoStore);
    return NextResponse.json({ ok: false, error: "Undo window expired" }, { status: 410 });
  }
  // Tenant guard — undo can only run from the same hospital
  if (record.hospital_id !== guard.session.user.hospital_id) {
    return NextResponse.json({ ok: false, error: "Token belongs to a different hospital" }, { status: 403 });
  }

  // ---- Reverse changes ----
  const { reverse } = record;

  // 1. Remove the attachment record
  if (reverse.attach_id) {
    const attach = await readJSON<any[]>(ATTACH_FILE, []);
    const next = attach.filter((a) => a.id !== reverse.attach_id);
    await writeJSON(ATTACH_FILE, next);
  }

  // 2. Remove created patient + case
  if (reverse.created_patient_id || reverse.created_case_id) {
    const dyn = await readJSON<{ patients: any[]; cases: any[] }>(DYN_FILE, { patients: [], cases: [] });
    dyn.patients = dyn.patients.filter((p: any) => p.id !== reverse.created_patient_id);
    dyn.cases    = dyn.cases.filter((c: any) => c.id !== reverse.created_case_id);
    await writeJSON(DYN_FILE, dyn);
    try {
      if (reverse.created_case_id) await deleteCase(reverse.created_case_id);
      if (reverse.created_patient_id) await deletePatient(reverse.created_patient_id);
    } catch (e: any) {
      console.error("Supabase delete failed reverting auto_create:", e.message);
    }
  }

  // 3. Revert auto_advance — restore prior status (or remove override if none existed)
  if (reverse.auto_advance) {
    const caseState = await readJSON<Record<string, any>>(CASE_STATE_FILE, {});
    const id = reverse.auto_advance.case_id;
    if (reverse.auto_advance.prior_status) {
      caseState[id] = { ...(caseState[id] ?? {}), status: reverse.auto_advance.prior_status, reverted_at: new Date().toISOString() };
    } else {
      delete caseState[id];
    }
    await writeJSON(CASE_STATE_FILE, caseState);
    if (reverse.auto_advance.prior_status) {
      try {
        await patchCase(id, { status: reverse.auto_advance.prior_status as any });
      } catch (e: any) {
        console.error("Supabase patchCase failed reverting auto_advance:", e.message);
      }
    }
  }

  // 4. Consume the token
  delete undoStore[token];
  await writeJSON(UNDO_FILE, undoStore);

  await appendAudit({
    ts: new Date().toISOString(),
    kind: "doc_undone",
    actor: { id: guard.session.user.id, role: guard.session.user.role },
    hospital_id: guard.session.user.hospital_id,
    token,
    reversed: reverse,
  });

  return NextResponse.json({ ok: true, reversed: reverse });
}
