// POST /api/document/download-batch
// Body: { caseId?: string, mrn?: string, filenames: string[] }
// Zips real files from PatientLog/{mrn}/originals/ and returns one download —
// same resolution logic as /api/document (caseId -> patient -> mrn), reused
// here so the Patient Detail page's "Download All" / "Download N selected"
// always pulls the actual landed documents, not mock placeholders.

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import fs from "fs";
import JSZip from "jszip";
import { cases, patients, loadDynamicData } from "@/lib/mockData";
import { requireRole } from "@/lib/auth/guards";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;

  try {
    loadDynamicData();
    const body = await req.json();
    const filenames: string[] = Array.isArray(body.filenames) ? body.filenames : [];
    if (filenames.length === 0) {
      return NextResponse.json({ ok: false, error: "no filenames" }, { status: 400 });
    }

    let safeMrn: string | null = null;
    if (body.mrn) {
      safeMrn = String(body.mrn).replace(/[^A-Za-z0-9_-]/g, "_");
    } else if (body.caseId) {
      const targetCase = cases.find((c) => c.id === body.caseId);
      const targetPatient = targetCase && patients.find((p) => p.id === targetCase.patient_id);
      if (targetPatient) safeMrn = targetPatient.mrn.replace(/[^A-Za-z0-9_-]/g, "_");
    }
    if (!safeMrn) {
      return NextResponse.json({ ok: false, error: "Patient or MRN not found" }, { status: 404 });
    }

    const originalsDir = path.join(process.cwd(), "..", "PatientLog", safeMrn, "originals");
    const zip = new JSZip();
    let added = 0;
    for (const name of filenames) {
      const safeName = path.basename(String(name)); // no path traversal
      const filePath = path.join(originalsDir, safeName);
      if (!fs.existsSync(filePath)) continue;
      zip.file(safeName, await readFile(filePath));
      added++;
    }
    if (added === 0) {
      return NextResponse.json({ ok: false, error: "none of the requested files exist on disk" }, { status: 404 });
    }

    const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return new NextResponse(zipBuf as any, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeMrn}_documents.zip"`,
        "Content-Length": String(zipBuf.length),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
