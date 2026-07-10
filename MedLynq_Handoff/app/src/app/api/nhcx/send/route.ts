// POST /api/nhcx/send
// Body: { case_id, scheme_card? }
//
// 1. Loads the Case + Patient
// 2. Builds a FHIR R4 Bundle (Patient/Coverage/Claim/DocumentReference)
// 3. Signs it with SHA-256 (canonical JSON)
// 4. Logs to audit trail at PatientLog/_index/nhcx_log.jsonl
// 5. POSTs to the mock NHCX endpoint (in prod: swap to real NHCX URL)
// 6. Returns the NHCX response + audit hash

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { cases, patients } from "@/lib/mockData";
import { buildFhirBundle, signBundle } from "@/lib/fhirBundle";
import { deriveTransition, applyTransition } from "@/lib/nhcxStateMachine";
import { requireRole } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { patchCase } from "@/lib/db/patientsCases";
import { appendEvent } from "@/lib/eventLog";
import { z } from "zod";

const SendBodySchema = z.object({
  case_id: z.string().min(1).max(100),
});

export const runtime = "nodejs";

const NHCX_LOG_DIR  = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const NHCX_LOG_FILE = path.join(NHCX_LOG_DIR, "nhcx_log.jsonl");
const CASE_STATE_DIR  = path.resolve(process.cwd(), "db");
const CASE_STATE_FILE = path.join(CASE_STATE_DIR, "nhcx_case_state.json");

async function persistCaseOverride(caseId: string, patch: any) {
  try {
    await mkdir(CASE_STATE_DIR, { recursive: true });
    let store: Record<string, any> = {};
    try {
      const raw = await readFile(CASE_STATE_FILE, "utf8");
      store = JSON.parse(raw);
    } catch { /* file may not exist yet */ }
    store[caseId] = { ...(store[caseId] ?? {}), ...patch, updated_at: new Date().toISOString() };
    await writeFile(CASE_STATE_FILE, JSON.stringify(store, null, 2));
  } catch { /* never break the response on persist failure */ }
}

const NHCX_ENDPOINT = process.env.NHCX_ENDPOINT
  || "http://localhost:3000/api/nhcx/mock";   // local mock by default

async function appendAudit(event: Record<string, any>) {
  try {
    await mkdir(NHCX_LOG_DIR, { recursive: true });
    await writeFile(NHCX_LOG_FILE, JSON.stringify(event) + "\n", { flag: "a" });
  } catch {
    // never break the response on audit failure
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  // NHCX is a paid + audited side-effect — cap per user to prevent runaway sends
  const rl = rateLimit({ key: `nhcx-send:${guard.session.user.id}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = SendBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const case_id = parsed.data.case_id;

    const c = cases.find((x) => x.id === case_id);
    if (!c) {
      return NextResponse.json({ ok: false, error: "case not found" }, { status: 404 });
    }
    const p = patients.find((x) => x.id === c.patient_id);
    if (!p) {
      return NextResponse.json({ ok: false, error: "patient not found" }, { status: 404 });
    }

    // Load extracted doc synopses for SupportingInfo
    let doc_synopses: any[] = [];
    try {
      const extracted_dir = path.resolve(process.cwd(), "..", "PatientLog", p.mrn, "extracted");
      const { readdir } = await import("fs/promises");
      const files = await readdir(extracted_dir);
      for (const f of files.filter((x) => x.endsWith(".json"))) {
        const raw = await readFile(path.join(extracted_dir, f), "utf8");
        const j = JSON.parse(raw);
        doc_synopses.push({
          doc_id: j.rename ?? f.replace(".json", ""),
          doc_type: j.doc_type_slug ?? "unknown",
          label: j.doc_type ?? "Document",
          confidence: j.confidence,
          file_sha256: j.paths?.original
            ? "extracted-on-disk"
            : undefined,
        });
      }
    } catch {
      // patient has no extracted docs yet — bundle ships without DocumentReference
    }

    // Build + sign
    const bundle = await buildFhirBundle({
      caseRecord: c,
      patient: p,
      hospital: { id: "HOSP-BLR-49", name: "Action Cancer Hospital", npi: "PR123456" },
      treating_doctor: "Dr. J B Sharma",
      doc_synopses,
    });
    const audit_hash = await signBundle(bundle);
    const sent_at = new Date().toISOString();

    // Outbound
    let nhcx_response: any = null;
    let nhcx_status = "no_response";
    let nhcx_http = 0;
    try {
      // This is a server-to-server call — middleware.ts can't see the
      // browser's session cookie on it, so /api/nhcx/mock is public in
      // middleware and instead trusts this shared secret. Only attach it
      // when calling OUR OWN mock endpoint, never a real external NHCX URL
      // (NHCX_ENDPOINT is swapped via env var when this goes live).
      const isLocalMock = NHCX_ENDPOINT.includes("/api/nhcx/mock");
      const r = await fetch(NHCX_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/fhir+json",
          "X-MedLynq-Audit-Hash": audit_hash,
          ...(isLocalMock ? { "X-Internal-Secret": process.env.MEDLYNQ_INTERNAL_SECRET ?? "" } : {}),
        },
        body: JSON.stringify(bundle),
      });
      nhcx_http = r.status;
      nhcx_response = await r.json();
      nhcx_status = nhcx_response?.outcome ?? "received";
    } catch (e: any) {
      nhcx_status = "transmission_failed";
      nhcx_response = { error: e?.message ?? String(e) };
    }

    // D5 — Apply outcome to case state (in-memory + persisted override)
    let transition: any = null;
    if (nhcx_status === "approved" || nhcx_status === "queried" || nhcx_status === "rejected") {
      const bundleUse: "preauthorization" | "claim" =
        ["preauth_pending", "awaiting_approval"].includes(c.status) ? "preauthorization" : "claim";
      const t = deriveTransition(c, nhcx_status as any, nhcx_response, bundleUse);
      if (t) {
        const patched = applyTransition(c, t);
        // Mutate in-memory case (the import is live-shared with mockData.cases)
        Object.assign(c, patched);
        await persistCaseOverride(c.id, {
          status: patched.status,
          approved_amount: patched.approved_amount,
          approval_received_at: patched.approval_received_at,
          approval_valid_till: patched.approval_valid_till,
          open_queries: patched.open_queries,
          scheme_history: patched.scheme_history,
          last_transition: { prev_status: t.prev_status, next_status: t.next_status, reason: t.reason, audit_hash },
        });
        try {
          await patchCase(c.id, {
            status: patched.status,
            approved_amount: patched.approved_amount,
            approval_received_at: patched.approval_received_at,
            approval_valid_till: patched.approval_valid_till,
            open_queries: patched.open_queries,
            scheme_history: patched.scheme_history,
          });
        } catch (e: any) {
          console.error("Supabase patchCase failed for NHCX transition:", e.message);
        }
        transition = { prev_status: t.prev_status, next_status: t.next_status, reason: t.reason };

        // Real, actor-attributed event — backs the dashboard's Scoreboard /
        // Activity Stream / Yesterday's Wins. Only fires on this live send
        // path, never on loadDynamicData's boot-time replay of the same
        // persisted override, so a server restart doesn't double-count it.
        if (patched.status === "approved" || patched.status === "preauth_approved") {
          appendEvent({
            kind: "claim_approved",
            actor_id: guard.session.user.id,
            actor_name: guard.session.user.name,
            hospital_id: guard.session.user.hospital_id,
            case_id: c.id,
            patient_id: c.patient_id,
            amount: patched.approved_amount ?? c.claimed_amount,
            text: `Claim ${c.registration_id ?? c.id} marked Approved · ₹${(patched.approved_amount ?? c.claimed_amount).toLocaleString("en-IN")}`,
            tone: "good",
          });
        } else if (patched.status === "rejected") {
          appendEvent({
            kind: "claim_rejected",
            actor_id: guard.session.user.id,
            actor_name: guard.session.user.name,
            hospital_id: guard.session.user.hospital_id,
            case_id: c.id,
            patient_id: c.patient_id,
            amount: c.claimed_amount,
            text: `Claim ${c.registration_id ?? c.id} rejected by ${c.payer}`,
            tone: "bad",
          });
        }
      }
    }

    // Audit
    await appendAudit({
      ts: sent_at,
      direction: "out",
      case_id,
      scheme: c.scheme,
      scheme_variant: c.scheme_variant,
      bundle_id: bundle.id,
      bundle_entries: bundle.entry.length,
      audit_hash,
      nhcx_endpoint: NHCX_ENDPOINT,
      nhcx_http,
      nhcx_status,
      claim_amount: c.claimed_amount,
      transition,
    });

    return NextResponse.json({
      ok: true,
      sent_at,
      bundle_id: bundle.id,
      bundle_entries: bundle.entry.length,
      audit_hash,
      nhcx_endpoint: NHCX_ENDPOINT,
      nhcx_http,
      nhcx_status,
      nhcx_response,
      transition,
      bundle_preview: bundle,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
