import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { patients, cases, loadDynamicData } from "@/lib/mockData";
import type { DocSynopsis, CaseSynopsis } from "@/lib/synopsis";

export const runtime = "nodejs";

const docTypeLabels: Record<string, string> = {
  "Patient ID": "Patient ID",
  "Consent Form": "Consent Form",
  "Referral": "Referral Letter",
  "Registration Copy": "Registration Copy",
  "Beneficiary Verification Slip": "Ayushman Card / BIS Verification",
  "Latest Pathology (HPE)": "Histopathology Report",
  "PET-CT Report": "PET-CT Scan Report",
  "Tumor Board Certificate": "Tumor Board Certificate",
  "Prescription / Protocol": "Prescription / Protocol",
  "OPD Slip": "OPD Slip",
  "CBC / LFT / KFT Profile": "Lab Profile (CBC/LFT/KFT)",
  "IPD File (admission)": "IPD Admission File",
  "Prior Imaging (CT/MRI/X-ray)": "Prior Imaging",
  "Drug Pouch / Wrapper Photo": "Drug Pouch Photo",
  "Chemo Chart": "Chemotherapy Chart",
  "IPD File (day care)": "IPD Daycare File",
  "OT Notes": "OT Notes",
  "OT Files": "OT Files",
  "Anaesthesia Note": "Anaesthesia Note",
  "Post Surgery Photo": "Post-Op Wound Photo",
  "Radiation Files": "Radiation Files",
  "Radiation Chart": "Radiation Chart",
  "Feedback Form": "Feedback Form",
  "Discharge Summary": "Discharge Summary",
  "Discharge Photo": "Discharge Photo",
  "Hospital Bill": "Hospital Bill",
  "Geotag Photo": "Geotagged Photo",
  "Post-op Notes": "Post-Op Notes",
  "Clinical Vitals Log": "Clinical Vitals Log"
};

export async function GET(req: NextRequest) {
  try {
    loadDynamicData();
    const mrn = req.nextUrl.searchParams.get("mrn");
    if (!mrn) {
      return NextResponse.json({ ok: false, error: "missing 'mrn' parameter" }, { status: 400 });
    }

    // Resolve patient & case for case_id mapping
    const targetPatient = patients.find(p => p.mrn.toLowerCase() === mrn.toLowerCase());
    const targetCase = targetPatient ? cases.find(c => c.patient_id === targetPatient.id) : null;
    const caseId = targetCase?.id || "unknown_case";

    const safeMrn = mrn.replace(/[^A-Za-z0-9_-]/g, "_");
    const extractedDir = path.join(process.cwd(), "..", "PatientLog", safeMrn, "extracted");

    let docSynopses: DocSynopsis[] = [];
    let drugsMentioned = new Set<string>();
    let procedures = new Set<string>();
    let diagnosis: string | null = null;
    let stage: string | null = null;

    try {
      const files = await fs.readdir(extractedDir);
      const jsonFiles = files.filter(f => f.endsWith(".json") && f !== "case_synopsis.json");

      for (const file of jsonFiles) {
        const raw = await fs.readFile(path.join(extractedDir, file), "utf8");
        const manifest = JSON.parse(raw);

        // Reconstruct doc filename from manifest json name (e.g. Consent.pdf.json -> Consent.pdf)
        const docId = file.substring(0, file.length - 5); 
        const docType = manifest.doc_type || "Consent Form";

        const docSyn: DocSynopsis = {
          doc_id: docId,
          doc_type: docType,
          label: docTypeLabels[docType] || docType,
          fields: manifest.fields || {},
          suggests: manifest.suggests || [],
          confidence: manifest.confidence !== undefined ? manifest.confidence : 1.0,
          flags: manifest.flags || []
        };
        docSynopses.push(docSyn);

        // Aggregate structured fields for case-level overview
        const fields = manifest.fields || {};
        
        // 1. Gather drugs
        if (fields.drugs_given) {
          const list = Array.isArray(fields.drugs_given) 
            ? fields.drugs_given 
            : String(fields.drugs_given).split(/,\s*/);
          list.forEach((d: string) => { if (d.trim()) drugsMentioned.add(d.trim()); });
        }
        if (fields.drugs) {
          const list = Array.isArray(fields.drugs) 
            ? fields.drugs 
            : String(fields.drugs).split(/,\s*/);
          list.forEach((d: string) => { if (d.trim()) drugsMentioned.add(d.trim()); });
        }
        if (fields.regimen) {
          drugsMentioned.add(String(fields.regimen));
        }

        // 2. Gather procedures
        if (fields.procedures_done) {
          const list = Array.isArray(fields.procedures_done) 
            ? fields.procedures_done 
            : String(fields.procedures_done).split(/,\s*/);
          list.forEach((p: string) => { if (p.trim()) procedures.add(p.trim()); });
        }
        if (fields.procedures) {
          const list = Array.isArray(fields.procedures) 
            ? fields.procedures 
            : String(fields.procedures).split(/,\s*/);
          list.forEach((p: string) => { if (p.trim()) procedures.add(p.trim()); });
        }

        // 3. Gather diagnosis
        if (fields.diagnosis && !diagnosis) {
          diagnosis = String(fields.diagnosis);
        }
        if (fields.final_diagnosis && !diagnosis) {
          diagnosis = String(fields.final_diagnosis);
        }

        // 4. Gather staging details
        if (fields.stage_t || fields.stage_n || fields.stage_m) {
          const t = fields.stage_t || "";
          const n = fields.stage_n || "";
          const m = fields.stage_m || "";
          stage = `${t}${n}${m}`.trim() || null;
        }
      }
    } catch {
      // Extracted folder doesn't exist or is empty
    }

    // Build the dynamic case synopsis paragraph
    let paragraph = "No documents have been uploaded yet for this case.";
    if (docSynopses.length > 0) {
      const name = targetPatient?.name || "Patient";
      const diagStr = diagnosis ? `diagnosed with ${diagnosis}` : "with no diagnosed pathology yet";
      const procStr = procedures.size > 0 ? `underwent ${Array.from(procedures).join(", ")}` : "no surgery/procedure recorded";
      const drugStr = drugsMentioned.size > 0 ? `prescribed ${Array.from(drugsMentioned).join(", ")}` : "no prescription logs found";
      
      paragraph = `${name} is ${diagStr}. Case records show the patient ${procStr} and was ${drugStr}.`;
      if (stage) {
        paragraph += ` Staging is confirmed at ${stage}.`;
      }
    }

    // Check if there is an explicit case_synopsis.json on disk
    let caseSynopsis: CaseSynopsis | null = null;
    const caseSynopsisPath = path.join(extractedDir, "case_synopsis.json");
    try {
      const raw = await fs.readFile(caseSynopsisPath, "utf8");
      caseSynopsis = JSON.parse(raw);
    } catch {
      // Create dynamically
      if (docSynopses.length > 0) {
        caseSynopsis = {
          case_id: caseId,
          paragraph,
          drugs_mentioned: Array.from(drugsMentioned),
          procedures: Array.from(procedures),
          diagnosis,
          stage,
          alignment: {
            aligned_docs: docSynopses.length,
            total_docs: docSynopses.length, // fallback
            open_queries: targetCase?.open_queries || 0
          }
        };
      }
    }

    return NextResponse.json({
      ok: true,
      case: caseSynopsis,
      doc_synopses: docSynopses
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
