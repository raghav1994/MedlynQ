// PATCH /api/cases/[id]  { icd10_codes?, procedure_name?, procedure_code?, claimed_amount?, scheme?, specialty?, treatment_type? }
//
// Manual corrections from the pre-send NHCX review screen (NHCXBridge.tsx) —
// mirrors /api/patients/[id]'s override pattern: persisted to
// db/case_overrides.json, re-applied by loadDynamicData() on every read, and
// audit-logged. icd10_codes is stored as icd10_codes_override on the Case —
// fhirBundle.ts and /api/nhcx/preview both prefer that override (a full
// replace, including an explicit empty array) over the auto-resolved single
// guess, and always treat every entry in it as verified (a human
// adding/confirming a code IS the verification).
//
// scheme/specialty/treatment_type are the OPD Registration "edit" flow's
// fields (src/app/opd/page.tsx in edit mode) — a MEDCO correcting "this was
// actually chemo, not surgery" goes through that screen, not this route
// directly, but it's the same override mechanism underneath.
//
// Intentionally does NOT support editing mrn — MRN is the folder key for
// this patient's documents on disk (PatientLog/{mrn}/...); renaming it here
// without also moving that folder would silently disconnect every uploaded
// document from the patient. Fix MRN at the source (OPD Registration edit
// flow, which does the folder rename via /api/patients/[id]) instead. Also
// does not support editing patient name — that's a shared identifier used
// everywhere else in the app, so it's edited via /api/patients/[id]
// (same OPD Registration edit flow), not from a single claim's review screen.

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { scopedCase } from "@/lib/dataScope";

export const runtime = "nodejs";

const OVERRIDE_FILE = path.resolve(process.cwd(), "db", "case_overrides.json");
const AUDIT_DIR  = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit_log.jsonl");

const PatchSchema = z.object({
  icd10_codes: z.array(z.object({
    code: z.string().trim().max(20),
    display: z.string().trim().max(300),
  })).max(20).optional(),
  procedure_name:  z.string().trim().max(300).optional(),
  procedure_code:  z.string().trim().max(50).optional(),
  claimed_amount:  z.union([z.number().min(0), z.string()]).optional(),
  scheme:          z.string().trim().max(60).optional(),
  specialty:       z.string().trim().max(60).optional(),
  treatment_type:  z.string().trim().max(60).optional(),
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

  const rl = rateLimit({ key: `case-patch:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid patch", details: parsed.error.flatten() }, { status: 400 });
  }

  // Tenant-scoped lookup — returns null if the case belongs to a different hospital
  const c = await scopedCase(params.id);
  if (!c) {
    return NextResponse.json({ ok: false, error: "Case not found" }, { status: 404 });
  }

  const patch: Record<string, any> = {};
  if (parsed.data.icd10_codes !== undefined) {
    patch.icd10_codes_override = parsed.data.icd10_codes.filter((e) => e.code.trim());
  }
  if (parsed.data.procedure_name !== undefined) patch.procedure_name = parsed.data.procedure_name;
  if (parsed.data.procedure_code !== undefined) patch.procedure_code = parsed.data.procedure_code;
  if (parsed.data.scheme !== undefined) patch.scheme = parsed.data.scheme;
  if (parsed.data.specialty !== undefined) patch.specialty = parsed.data.specialty;
  if (parsed.data.treatment_type !== undefined) patch.treatment_type = parsed.data.treatment_type;
  if (parsed.data.claimed_amount !== undefined) {
    const n = typeof parsed.data.claimed_amount === "number" ? parsed.data.claimed_amount : parseFloat(String(parsed.data.claimed_amount));
    if (Number.isFinite(n)) patch.claimed_amount = n;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No editable fields provided" }, { status: 400 });
  }

  const overrides = await readOverrides();
  overrides[c.id] = { ...(overrides[c.id] ?? {}), ...patch, updated_at: new Date().toISOString() };
  await writeOverrides(overrides);

  await appendAudit({
    ts: new Date().toISOString(),
    kind: "case_manually_corrected",
    actor: { id: guard.session.user.id, role: guard.session.user.role },
    hospital_id: guard.session.user.hospital_id,
    case_id: c.id,
    patch,
    prior: {
      diagnosis: c.diagnosis,
      icd10_codes_override: c.icd10_codes_override,
      procedure_name: c.procedure_name,
      procedure_code: c.procedure_code,
      scheme: c.scheme,
      specialty: c.specialty,
      treatment_type: c.treatment_type,
      claimed_amount: c.claimed_amount,
    },
  });

  // Apply immediately to the in-memory case too, so a caller that re-reads
  // scopedCase() right after this PATCH (same request cycle, e.g. the review
  // screen's refetch) sees the update without waiting for a fresh
  // loadDynamicData() pass on the next request.
  Object.assign(c, patch);

  return NextResponse.json({ ok: true, case_id: c.id, patch });
}
