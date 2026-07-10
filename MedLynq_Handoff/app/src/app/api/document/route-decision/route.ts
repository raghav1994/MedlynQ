// POST /api/document/route-decision
//
// Given a DocBag (identity hints + classified doc types extracted from the
// Sarvam/PyMuPDF pipeline), returns the routing decision:
//   - auto_attach  → the patient/case to attach to (+ optional auto-advance)
//   - review       → ranked candidates for the Drop-and-Go modal
//   - auto_create  → recommended initial case status for a fresh patient
//
// Side-effects: emits an audit-log line (kind: "doc_routed"). Does NOT execute
// the attach itself — the UI calls /api/document/route-apply after user
// confirmation (or immediately for auto bands).

import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { scopedData } from "@/lib/dataScope";
import { routeDocument, type DocBag } from "@/lib/docRouter";

export const runtime = "nodejs";

const BagSchema = z.object({
  identity: z.object({
    name:         z.string().optional(),
    age:          z.union([z.number(), z.string()]).optional(),
    dob:          z.string().optional(),
    gender:       z.string().optional(),
    mrn:          z.string().optional(),
    scheme_card:  z.string().optional(),
  }),
  doc_types: z.array(z.string()).min(1).max(100),
  doc_ids:   z.array(z.string()).max(100).optional(),
});

const AUDIT_DIR  = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit_log.jsonl");

async function appendAudit(entry: Record<string, any>) {
  try {
    await mkdir(AUDIT_DIR, { recursive: true });
    await writeFile(AUDIT_FILE, JSON.stringify(entry) + "\n", { flag: "a" });
  } catch { /* never break the response on audit failure */ }
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `doc-route:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = BagSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid document bag", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const bag: DocBag = parsed.data;

  // Tenant-scoped patients + cases (S-series guarantee)
  const { patients, cases } = await scopedData();
  const decision = routeDocument(bag, patients, cases);

  await appendAudit({
    ts: new Date().toISOString(),
    kind: "doc_routed",
    actor: { id: guard.session.user.id, role: guard.session.user.role },
    hospital_id: guard.session.user.hospital_id,
    action: decision.action,
    confidence: decision.confidence,
    stage: decision.stage.stage,
    stage_confidence: decision.stage.confidence,
    patient_id: decision.patient_id,
    case_id: decision.case_id,
    auto_advance: decision.auto_advance,
    candidate_count: decision.candidates.length,
    doc_count: decision.doc_count,
    doc_types: bag.doc_types,
    doc_ids: bag.doc_ids,
    reason: decision.reason,
  });

  return NextResponse.json({ ok: true, decision });
}
