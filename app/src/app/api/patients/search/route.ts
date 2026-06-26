// GET /api/patients/search?q=...
// Simple text search across mock patients + cases. Rule-based, no AI.
// In production: parameterised SQL against patients + claims + evidence_index.

import { NextRequest, NextResponse } from "next/server";
import { patients, cases, loadDynamicData } from "@/lib/mockData";

export const runtime = "nodejs";

type Hit = {
  patient_id: string;
  patient_name: string;
  mrn: string;
  case_id?: string;
  registration_id?: string;
  scheme?: string;
  matched_on: string; // human-readable match reason
};

export async function GET(req: NextRequest) {
  loadDynamicData();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q || q.length < 2) {
    return NextResponse.json({ ok: true, hits: [] });
  }

  const hits: Hit[] = [];

  // Match patients by name + MRN
  for (const p of patients) {
    const fields = [
      { key: "name", val: p.name },
      { key: "MRN",  val: p.mrn },
      { key: "id",   val: p.id },
    ];
    for (const f of fields) {
      if (f.val.toLowerCase().includes(q)) {
        hits.push({
          patient_id: p.id,
          patient_name: p.name,
          mrn: p.mrn,
          matched_on: `${f.key}: ${f.val}`,
        });
        break;
      }
    }
  }

  // Match cases by registration_id, procedure code/name, diagnosis
  for (const c of cases) {
    const p = patients.find((x) => x.id === c.patient_id);
    if (!p) continue;
    const fields = [
      { key: "registration", val: c.registration_id },
      { key: "case id",      val: c.id },
      { key: "procedure",    val: `${c.procedure_code} ${c.procedure_name}` },
      { key: "diagnosis",    val: c.diagnosis },
    ];
    for (const f of fields) {
      if (f.val.toLowerCase().includes(q)) {
        hits.push({
          patient_id: p.id,
          patient_name: p.name,
          mrn: p.mrn,
          case_id: c.id,
          registration_id: c.registration_id,
          scheme: c.scheme,
          matched_on: `${f.key}: ${f.val.slice(0, 50)}`,
        });
        break;
      }
    }
  }

  // Dedupe by (patient_id, case_id|none)
  const seen = new Set<string>();
  const deduped = hits.filter((h) => {
    const k = h.patient_id + "|" + (h.case_id ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return NextResponse.json({ ok: true, q, hits: deduped.slice(0, 20) });
}
