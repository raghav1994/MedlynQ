// /api/synopsis?mrn=XYZ
// Reads PatientLog/{MRN}/extracted/*.json manifests written by python/pipeline.py
// and returns a normalised payload the UI can consume:
//   { ok, mrn, doc_synopses: [DocSynopsis], case: CaseSynopsis | null }
//
// If the folder doesn't exist, returns ok:true with empty arrays so the UI
// can fall back to mock data cleanly.

import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

const PATIENTLOG_ROOT = path.resolve(process.cwd(), "..", "PatientLog");

type Manifest = {
  mrn?: string;
  doc_type?: string;
  doc_type_slug?: string;
  extractability?: string;
  patient_identity?: Record<string, string>;
  rename?: string;
  synopsis?: {
    doc_type: string;
    label: string;
    fields: Record<string, any>;
    suggests: string[];
    raw_text?: string;
    confidence?: number | null;
  };
  confidence?: number;
  flags?: string[];
  processed_at?: string;
};

export async function GET(req: NextRequest) {
  const mrn = req.nextUrl.searchParams.get("mrn");
  if (!mrn) {
    return NextResponse.json({ ok: false, error: "missing mrn" }, { status: 400 });
  }

  const extractedDir = path.join(PATIENTLOG_ROOT, mrn, "extracted");
  try {
    const s = await stat(extractedDir);
    if (!s.isDirectory()) throw new Error("not a directory");
  } catch {
    return NextResponse.json({ ok: true, mrn, doc_synopses: [], case: null, source: "empty" });
  }

  const files = (await readdir(extractedDir)).filter((f) => f.endsWith(".json"));
  const manifests: Manifest[] = [];
  for (const f of files) {
    try {
      const raw = await readFile(path.join(extractedDir, f), "utf8");
      manifests.push(JSON.parse(raw));
    } catch {
      // skip corrupt
    }
  }

  const doc_synopses = manifests.map((m) => ({
    doc_id: m.rename ?? "",
    doc_type: m.synopsis?.doc_type ?? m.doc_type_slug ?? "generic",
    label: m.synopsis?.label ?? m.doc_type ?? "Document",
    fields: m.synopsis?.fields ?? {},
    suggests: m.synopsis?.suggests ?? [],
    confidence: m.synopsis?.confidence ?? m.confidence ?? null,
    flags: m.flags ?? [],
  }));

  // Build a case-level paragraph from extracted facts
  const facts = collectFacts(manifests);
  const caseSyn = facts.diagnosis || facts.procedures.length || facts.drugs.length
    ? {
        case_id: mrn,
        paragraph: buildParagraph(facts),
        drugs_mentioned: facts.drugs,
        procedures: facts.procedures,
        diagnosis: facts.diagnosis,
        stage: facts.stage,
        alignment: {
          aligned_docs: manifests.filter((m) => (m.confidence ?? 0) >= 0.8).length,
          total_docs: manifests.length,
          open_queries: 0, // wired via mockQueries on the page
        },
      }
    : null;

  return NextResponse.json({
    ok: true,
    mrn,
    doc_synopses,
    case: caseSyn,
    source: "pipeline",
  });
}

type Facts = {
  diagnosis: string | null;
  stage: string | null;
  drugs: string[];
  procedures: string[];
};

function collectFacts(ms: Manifest[]): Facts {
  const out: Facts = { diagnosis: null, stage: null, drugs: [], procedures: [] };
  for (const m of ms) {
    const f = m.synopsis?.fields ?? {};
    if (!out.diagnosis && (f.diagnosis || f.final_diagnosis || f.primary_site)) {
      out.diagnosis = String(f.diagnosis ?? f.final_diagnosis ?? f.primary_site);
    }
    if (!out.stage && (f.stage_t || f.stage_n || f.stage_m)) {
      out.stage = `${f.stage_t ?? ""}${f.stage_n ?? ""}${f.stage_m ?? ""}`.trim() || null;
    }
    const drugStr = String(f.drugs ?? f.drugs_given ?? "");
    if (drugStr) {
      drugStr.split(/[,;]+/).map((s) => s.trim()).filter(Boolean).forEach((d) => {
        if (!out.drugs.includes(d)) out.drugs.push(d);
      });
    }
    const procStr = String(f.procedures_done ?? f.procedure_name ?? "");
    if (procStr && !out.procedures.includes(procStr)) out.procedures.push(procStr);
  }
  return out;
}

function buildParagraph(f: Facts): string {
  const parts: string[] = [];
  if (f.diagnosis) parts.push(`Diagnosis: ${f.diagnosis}`);
  if (f.stage) parts.push(`stage ${f.stage}`);
  if (f.procedures.length) parts.push(`procedure: ${f.procedures.join(", ")}`);
  if (f.drugs.length) parts.push(`drugs noted: ${f.drugs.slice(0, 5).join(", ")}`);
  return parts.join(" · ") || "Case extracted from uploaded documents.";
}
