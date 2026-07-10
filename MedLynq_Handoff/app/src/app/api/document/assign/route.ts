// POST /api/document/assign
//
// Body: { caseId, filename, doc_type }
//
// Manually reclassifies an already-landed document — used by the Unsorted
// tray in the merged Documents & Checklist view when a MEDCO drags/assigns
// an unclassified file onto a known checklist slot. Rewrites the manifest's
// doc_type and logs the correction (old label vs new, plus what the content
// classifier originally guessed) so it becomes a labeled training signal
// instead of a silent, one-off fix.

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { z } from "zod";
import { cases, patients, loadDynamicData } from "@/lib/mockData";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";

export const runtime = "nodejs";

const AUDIT_DIR = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const CORRECTIONS_FILE = path.join(AUDIT_DIR, "doc_type_corrections.jsonl");

const BodySchema = z.object({
  caseId: z.string().min(1),
  filename: z.string().min(1),
  doc_type: z.string().min(1).max(120),
});

function safeMrn(mrn: string): string {
  return mrn.replace(/[^A-Za-z0-9_-]/g, "_");
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `doc-assign:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const { caseId, filename, doc_type } = parsed.data;

  loadDynamicData();
  const targetCase = cases.find((c) => c.id === caseId);
  const targetPatient = targetCase && patients.find((p) => p.id === targetCase.patient_id);
  if (!targetPatient) {
    return NextResponse.json({ ok: false, error: "Case or patient not found" }, { status: 404 });
  }

  const mrnDir = safeMrn(targetPatient.mrn);
  const manifestPath = path.resolve(process.cwd(), "..", "PatientLog", mrnDir, "extracted", `${filename}.json`);

  let manifest: Record<string, any>;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return NextResponse.json({ ok: false, error: "Document manifest not found" }, { status: 404 });
  }

  const previous_doc_type = manifest.doc_type;
  manifest.doc_type = doc_type;
  manifest.confidence = 1.0; // human-assigned — no reason to keep it flagged low-confidence
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // Training-feedback log: what we guessed vs what the MEDCO actually meant.
  try {
    await mkdir(AUDIT_DIR, { recursive: true });
    await writeFile(
      CORRECTIONS_FILE,
      JSON.stringify({
        ts: new Date().toISOString(),
        case_id: caseId,
        mrn: targetPatient.mrn,
        filename,
        previous_doc_type,
        content_guess: manifest.content_guess ?? null,
        content_guess_confidence: manifest.content_guess_confidence ?? null,
        assigned_doc_type: doc_type,
        actor: { id: guard.session.user.id, role: guard.session.user.role },
      }) + "\n",
      { flag: "a" },
    );
  } catch {
    // Correction log is best-effort — never block the actual reassignment on it.
  }

  return NextResponse.json({ ok: true, filename, doc_type });
}
