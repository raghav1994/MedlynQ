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
import { fulfillMatching } from "@/lib/documentRequests";

export const runtime = "nodejs";

const AUDIT_DIR = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const CORRECTIONS_FILE = path.join(AUDIT_DIR, "doc_type_corrections.jsonl");
const CATALOG_FILE = path.resolve(process.cwd(), "db", "document_catalog.json");

const BodySchema = z.object({
  caseId: z.string().min(1),
  filename: z.string().min(1),
  doc_type: z.string().min(1).max(120),
  force: z.boolean().optional(),
});

// A drag-onto-slot assign is a human claim, not a measurement — nothing
// stopped a MEDCO from dropping an unrelated document onto the wrong slot
// and having it stored as confidence: 1.0 (see the Sushila Gupta / ICU
// Justification Letter incident, 2026-07-17: a different patient's CBC
// report was assigned onto that slot with zero content overlap). This does
// a best-effort keyword sanity check against the catalog's known anchors for
// the target label and asks for one extra confirmation when there's no
// textual support, instead of silently trusting every manual assignment.
async function hasContentSupport(docType: string, text: string): Promise<boolean | null> {
  if (!text || text.trim().length === 0) return null; // nothing to check against — don't block
  let catalog: Array<{ label: string; anchors: string[] }>;
  try {
    catalog = JSON.parse(await readFile(CATALOG_FILE, "utf8"));
  } catch {
    return null;
  }
  const entry = catalog.find((c) => c.label.toLowerCase() === docType.toLowerCase());
  if (!entry || entry.anchors.length === 0) return null; // unknown label — nothing to check
  const haystack = text.toLowerCase();
  return entry.anchors.some((a) => a.trim().length > 0 && haystack.includes(a.toLowerCase()));
}

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
  const { caseId, filename, doc_type, force } = parsed.data;

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

  if (!force) {
    const supported = await hasContentSupport(doc_type, manifest.full_text ?? manifest.text_snippet ?? "");
    if (supported === false) {
      return NextResponse.json({
        ok: false,
        needs_confirmation: true,
        warning: `This document's extracted text doesn't mention "${doc_type}" anywhere. It may belong to a different slot — assign anyway?`,
      });
    }
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

  fulfillMatching(targetPatient.id, doc_type).catch(() => {});

  return NextResponse.json({ ok: true, filename, doc_type });
}
