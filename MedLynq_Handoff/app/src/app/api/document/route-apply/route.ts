// POST /api/document/route-apply
//
// Body: {
//   decision: <RouteResult from route-decision>,
//   bag: <DocBag>,
//   override?: { patient_id?, case_id? }   // for review-band confirmations
// }
//
// Executes the decision:
//   auto_attach   → record doc attachments + (if auto_advance) write case status override
//   auto_create   → write a new patient + new case into dynamic_patients.json
//                   + record doc attachments
//   review        → expects the UI to pass `override` with the user's chosen patient/case
//                   and is then treated like auto_attach
//
// Returns: { ok, undo_token, summary }
//
// The undo token TTL is 5 minutes. After that, /route-undo returns 410 Gone.

import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { scopedPatient } from "@/lib/dataScope";
import { upsertPatient, upsertCase, patchCase } from "@/lib/db/patientsCases";

export const runtime = "nodejs";

const DB_DIR  = path.resolve(process.cwd(), "db");
const DYN_FILE        = path.join(DB_DIR, "dynamic_patients.json");
const CASE_STATE_FILE = path.join(DB_DIR, "nhcx_case_state.json");
const ATTACH_FILE     = path.join(DB_DIR, "doc_attachments.json");
const UNDO_FILE       = path.join(DB_DIR, "undo_tokens.json");

const AUDIT_DIR  = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit_log.jsonl");

// ----- File helpers -----

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

// ----- Schemas -----

const DecisionSchema = z.object({
  action: z.enum(["auto_attach", "review", "auto_create"]),
  reason: z.string(),
  confidence: z.number(),
  patient_id: z.string().optional(),
  case_id: z.string().optional(),
  new_case_status: z.string().optional(),
  auto_advance: z.object({
    case_id: z.string(),
    from: z.string(),
    to: z.string(),
    reason: z.string(),
  }).optional(),
  stage: z.any(),
  candidates: z.array(z.any()),
  doc_count: z.number(),
});

const BagSchema = z.object({
  identity: z.record(z.string(), z.any()),
  doc_types: z.array(z.string()),
  doc_ids: z.array(z.string()).optional(),
});

const ApplySchema = z.object({
  decision: DecisionSchema,
  bag: BagSchema,
  override: z.object({
    patient_id: z.string().optional(),
    case_id: z.string().optional(),
  }).optional(),
});

// ----- The handler -----

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `doc-apply:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = ApplySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid apply payload", details: parsed.error.flatten() }, { status: 400 });
  }
  const { decision, bag, override } = parsed.data;
  const hospital_id = guard.session.user.hospital_id;
  const actor = { id: guard.session.user.id, role: guard.session.user.role };

  // ---- Branch: review band requires an override ----
  let effectiveAction = decision.action;
  let target_patient_id = decision.patient_id;
  let target_case_id    = decision.case_id;
  if (decision.action === "review") {
    if (!override?.patient_id) {
      return NextResponse.json({ ok: false, error: "Review-band apply needs override.patient_id" }, { status: 400 });
    }
    target_patient_id = override.patient_id;
    target_case_id    = override.case_id;
    effectiveAction   = "auto_attach";
  }

  // ---- Load current state once ----
  const dyn       = await readJSON<{ patients: any[]; cases: any[] }>(DYN_FILE, { patients: [], cases: [] });
  const caseState = await readJSON<Record<string, any>>(CASE_STATE_FILE, {});
  const attach    = await readJSON<any[]>(ATTACH_FILE, []);
  const undoStore = await readJSON<Record<string, any>>(UNDO_FILE, {});

  // ---- Compute reverse-instructions before mutating, so undo is deterministic ----
  const created_patient_id: string | null = decision.action === "auto_create" ? "P_AUTO_" + Date.now().toString(36).toUpperCase() : null;
  const created_case_id:    string | null = decision.action === "auto_create" ? "CASE_AUTO_" + Date.now().toString(36).toUpperCase() : null;
  const prior_case_status = decision.auto_advance ? caseState[decision.auto_advance.case_id]?.status : undefined;

  // ---- AUTO_CREATE: persist new patient + new case ----
  if (decision.action === "auto_create") {
    const id = created_patient_id!;
    const newPatient = {
      id,
      mrn: bag.identity.mrn ?? id,
      // Prefer any extracted name; fall back to a friendlier default than "Unnamed"
      name: bag.identity.name ?? `New patient · ${new Date().toISOString().slice(0, 10)}`,
      age: Number(bag.identity.age ?? 0) || 0,
      gender: String(bag.identity.gender ?? "M").toUpperCase().startsWith("F") ? "F" : "M",
      state: "",
      district: "",
      department: "—",
      hospital_id,
    };
    const newCase = {
      id: created_case_id!,
      patient_id: id,
      registration_id: created_case_id!,
      scheme: "PMJAY",
      payer: "—",
      procedure_code: "",
      procedure_name: "",
      diagnosis: "",
      // Auto-created from a doc bag with no MEDCO input yet — "pending" is a
      // real, type-safe sentinel (not a guessed clinical treatment). It
      // renders as "Treatment pending" via PatientHeader's fallback and
      // matches no for_treatments-tagged checklist rule, so nothing gets
      // falsely required until a human picks the real treatment via OPD edit.
      treatment_type: "pending",
      specialty: "oncology",
      admission_date: new Date().toISOString().slice(0, 10),
      discharge_date: null,
      status: decision.new_case_status ?? "preauth_pending",
      claimed_amount: 0,
      approved_amount: null,
      tat_days: 0,
      age_days: 0,
      missing_docs: 0,
      open_queries: 0,
      hospital_id,
      entry_mode: "doc_router_auto",
    };
    dyn.patients.push(newPatient);
    dyn.cases.push(newCase);
    target_patient_id = id;
    target_case_id    = created_case_id ?? undefined;
    await writeJSON(DYN_FILE, dyn);
    // Persist to Supabase too — dynamic_patients.json stays as a local
    // fallback/cache, but the DB is now the durable copy. Best-effort: a
    // Supabase hiccup shouldn't block the doc-router flow the MEDCO is
    // waiting on, since the JSON write above already succeeded.
    try {
      await upsertPatient(newPatient as any);
      await upsertCase(newCase as any);
    } catch (e: any) {
      console.error("Supabase upsert failed for auto-created patient/case:", e.message);
    }
  }

  // ---- AUTO_ADVANCE: write case status override ----
  if (decision.auto_advance) {
    const id = decision.auto_advance.case_id;
    caseState[id] = {
      ...(caseState[id] ?? {}),
      status: decision.auto_advance.to,
      last_transition: {
        prev_status: decision.auto_advance.from,
        next_status: decision.auto_advance.to,
        reason: decision.auto_advance.reason,
        by: actor.id,
      },
      updated_at: new Date().toISOString(),
    };
    await writeJSON(CASE_STATE_FILE, caseState);
    try {
      await patchCase(id, { status: decision.auto_advance.to as any });
    } catch (e: any) {
      console.error("Supabase patchCase failed for auto_advance:", e.message);
    }
  }

  // ---- Record attachments ----
  const attachId = "ATT_" + Date.now().toString(36).toUpperCase() + "_" + crypto.randomBytes(2).toString("hex");
  attach.push({
    id: attachId,
    ts: new Date().toISOString(),
    hospital_id,
    patient_id: target_patient_id,
    case_id: target_case_id,
    doc_ids: bag.doc_ids ?? [],
    doc_types: bag.doc_types,
    actor,
  });
  await writeJSON(ATTACH_FILE, attach);

  // ---- Issue undo token (5-min TTL) ----
  const token = crypto.randomBytes(12).toString("hex");
  undoStore[token] = {
    expires_at: Date.now() + 5 * 60 * 1000,
    hospital_id,
    actor,
    reverse: {
      attach_id: attachId,
      created_patient_id,
      created_case_id,
      auto_advance: decision.auto_advance ? {
        case_id: decision.auto_advance.case_id,
        prior_status: prior_case_status,  // may be undefined → undo simply removes the override entry
      } : null,
    },
  };
  await writeJSON(UNDO_FILE, undoStore);

  // ---- Audit ----
  await appendAudit({
    ts: new Date().toISOString(),
    kind: "doc_applied",
    actor,
    hospital_id,
    effective_action: effectiveAction,
    original_action: decision.action,
    patient_id: target_patient_id,
    case_id: target_case_id,
    auto_advance: decision.auto_advance,
    doc_count: decision.doc_count,
    attach_id: attachId,
    undo_token: token,
  });

  // Resolve MRN for the landing step (writes files under PatientLog/{MRN}/...)
  let patient_mrn: string | undefined;
  if (decision.action === "auto_create") {
    patient_mrn = dyn.patients.find((p: any) => p.id === target_patient_id)?.mrn;
  } else if (target_patient_id) {
    const p = await scopedPatient(target_patient_id);
    patient_mrn = p?.mrn;
  }

  return NextResponse.json({
    ok: true,
    undo_token: token,
    summary: {
      action: effectiveAction,
      patient_id: target_patient_id,
      patient_mrn,
      case_id: target_case_id,
      created_patient: created_patient_id,
      created_case: created_case_id,
      auto_advance: decision.auto_advance,
      attach_id: attachId,
    },
  });
}
