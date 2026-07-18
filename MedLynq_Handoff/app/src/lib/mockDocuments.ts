// Mock documents per case. Doc types align with the new stage-aware checklist
// (Pre-auth / Mid-way / Discharge) from the handwritten flow.

import fs from "fs";
import path from "path";
import { cases, patients } from "./mockData";

export type CaseDocument = {
  id: string;
  case_id: string;
  doc_type: string;
  filename: string;
  original_filename: string;
  ext: "pdf" | "jpg" | "jpeg" | "png";
  source: "MedCam" | "HIS" | "Manual";
  size_bytes: number;
  uploaded_at: string;
  confidence?: number; // 0..1, undefined = full
  fields?: Record<string, any>; // structured fields extracted by md_parser.py, when present
  text_snippet?: string; // first ~200 chars of OCR/extracted text — lets a MEDCO tell what an Unsorted doc is without opening it
  // Set when content_classifier.py detects a single document covers MORE
  // than one checklist slot (e.g. a combined "CBC / LFT / KFT Profile"
  // report contains all three panels) — lets checklist.ts's matchDocument
  // flip every slot this one file actually proves, instead of only its
  // primary doc_type label.
  satisfied_labels?: string[];
};

function doc(p: Partial<CaseDocument> & Pick<CaseDocument, "case_id" | "doc_type" | "filename" | "ext" | "source">): CaseDocument {
  return {
    id: `${p.case_id}_${p.filename}`.replace(/\W+/g, "_"),
    original_filename: p.filename,
    size_bytes: 1024 * 1024,
    uploaded_at: "15 Jun 2026",
    ...p,
  } as CaseDocument;
}

export const DOCUMENTS_BY_CASE: Record<string, CaseDocument[]> = {
  // Chinta Devi — chemo cycle 3 approved · all stages covered
  "2026052910050818": [
    // Pre-auth
    doc({ case_id: "2026052910050818", doc_type: "Patient ID",          filename: "Patient_ID.pdf",            ext: "pdf", source: "HIS",    uploaded_at: "15 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "Consent Form",        filename: "Consent_Form.pdf",          ext: "pdf", source: "MedCam", uploaded_at: "15 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "Referral",            filename: "Referral_Intake.pdf",       ext: "pdf", source: "HIS",    uploaded_at: "13 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "Registration Copy",   filename: "Registration_Copy.pdf",     ext: "pdf", source: "HIS",    uploaded_at: "15 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "Latest Pathology (HPE)", filename: "HPE_Pathology_Report.pdf", ext: "pdf", source: "MedCam", uploaded_at: "15 Jun 2026", confidence: 0.55 }),
    doc({ case_id: "2026052910050818", doc_type: "Prescription / Protocol", filename: "Protocol_0001.pdf",     ext: "pdf", source: "MedCam", uploaded_at: "15 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "CBC / LFT / KFT Profile", filename: "CBC_Baseline_Report.pdf", ext: "pdf", source: "HIS", uploaded_at: "14 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "IPD File (admission)", filename: "IPD_Admission.pdf",        ext: "pdf", source: "HIS",    uploaded_at: "14 Jun 2026" }),
    // Mid-way
    doc({ case_id: "2026052910050818", doc_type: "Drug Pouch / Wrapper Photo", filename: "Pouch.jpg",          ext: "jpg", source: "MedCam", uploaded_at: "15 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "Chemo Chart",         filename: "Chemo_Chart.pdf",           ext: "pdf", source: "HIS",    uploaded_at: "15 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "IPD File (day care)", filename: "IPD_Daycare.pdf",           ext: "pdf", source: "HIS",    uploaded_at: "15 Jun 2026" }),
    // Discharge
    doc({ case_id: "2026052910050818", doc_type: "Feedback Form",       filename: "Feedback_FB.pdf",           ext: "pdf", source: "MedCam", uploaded_at: "16 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "Discharge Summary",   filename: "Discharge_Summary.pdf",     ext: "pdf", source: "HIS",    uploaded_at: "16 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "Hospital Bill",       filename: "Hospital_Bill.pdf",         ext: "pdf", source: "HIS",    uploaded_at: "16 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "Geotag Photo",        filename: "Geotag_Discharge.jpg",      ext: "jpg", source: "MedCam", uploaded_at: "16 Jun 2026" }),
    doc({ case_id: "2026052910050818", doc_type: "Clinical Vitals Log", filename: "Vitals_Log.pdf",            ext: "pdf", source: "HIS",    uploaded_at: "16 Jun 2026" }),
  ],

  // Vikram Singh — chemo with queries · missing midway docs
  "2026051410041450": [
    // Pre-auth (complete)
    doc({ case_id: "2026051410041450", doc_type: "Patient ID",          filename: "Patient_ID.pdf",            ext: "pdf", source: "HIS" }),
    doc({ case_id: "2026051410041450", doc_type: "Consent Form",        filename: "Consent_Form.pdf",          ext: "pdf", source: "MedCam" }),
    doc({ case_id: "2026051410041450", doc_type: "Referral",            filename: "Referral.pdf",              ext: "pdf", source: "HIS" }),
    doc({ case_id: "2026051410041450", doc_type: "Registration Copy",   filename: "Registration_Copy.pdf",     ext: "pdf", source: "HIS" }),
    doc({ case_id: "2026051410041450", doc_type: "Latest Pathology (HPE)", filename: "HPE_Report.pdf",         ext: "pdf", source: "MedCam" }),
    doc({ case_id: "2026051410041450", doc_type: "Prescription / Protocol", filename: "Protocol.pdf",          ext: "pdf", source: "MedCam" }),
    doc({ case_id: "2026051410041450", doc_type: "CBC / LFT / KFT Profile", filename: "CBC.pdf",               ext: "pdf", source: "HIS" }),
    // Mid-way INCOMPLETE — Drug Pouch + Chemo Chart missing → triggered queries
    doc({ case_id: "2026051410041450", doc_type: "IPD File (day care)", filename: "IPD_Daycare.pdf",           ext: "pdf", source: "HIS" }),
    // Discharge
    doc({ case_id: "2026051410041450", doc_type: "Discharge Summary",   filename: "Discharge_Summary.pdf",     ext: "pdf", source: "HIS" }),
    doc({ case_id: "2026051410041450", doc_type: "Hospital Bill",       filename: "Hospital_Bill.pdf",         ext: "pdf", source: "HIS" }),
    doc({ case_id: "2026051410041450", doc_type: "Clinical Vitals Log", filename: "Clinical_Vitals.pdf",       ext: "pdf", source: "HIS" }),
  ],

  // Sushila Gupta — pre-auth pending surgery · just starting
  "PRE-2026-0118": [
    doc({ case_id: "PRE-2026-0118", doc_type: "Patient ID",          filename: "Aadhaar_Sushila.jpg",        ext: "jpg", source: "MedCam", uploaded_at: "17 Jun 2026" }),
    doc({ case_id: "PRE-2026-0118", doc_type: "Consent Form",        filename: "Consent.pdf",                ext: "pdf", source: "MedCam", uploaded_at: "17 Jun 2026" }),
    doc({ case_id: "PRE-2026-0118", doc_type: "Referral",            filename: "Referral_Letter.pdf",        ext: "pdf", source: "HIS",    uploaded_at: "16 Jun 2026" }),
    doc({ case_id: "PRE-2026-0118", doc_type: "Latest Pathology (HPE)", filename: "HPE_Biopsy.pdf",          ext: "pdf", source: "MedCam", uploaded_at: "17 Jun 2026" }),
    // Missing: Registration Copy, Prescription/Protocol, Prior Imaging, IPD admission
  ],

  // Mohan Lal — surgery with query (missing pre-auth imaging)
  "2026051810066828": [
    doc({ case_id: "2026051810066828", doc_type: "Patient ID",        filename: "Patient_ID.pdf",            ext: "pdf", source: "HIS" }),
    doc({ case_id: "2026051810066828", doc_type: "Consent Form",      filename: "Consent.pdf",               ext: "pdf", source: "MedCam" }),
    doc({ case_id: "2026051810066828", doc_type: "Referral",          filename: "Referral.pdf",              ext: "pdf", source: "HIS" }),
    doc({ case_id: "2026051810066828", doc_type: "Registration Copy", filename: "Registration_Copy.pdf",     ext: "pdf", source: "HIS" }),
    doc({ case_id: "2026051810066828", doc_type: "Prescription / Protocol", filename: "Protocol.pdf",        ext: "pdf", source: "MedCam" }),
    // Missing: Prior Imaging, OT Notes, OT Files, Post-op Notes, Anaesthesia Note
    doc({ case_id: "2026051810066828", doc_type: "Discharge Summary", filename: "Discharge_Summary.pdf",     ext: "pdf", source: "HIS" }),
    doc({ case_id: "2026051810066828", doc_type: "Hospital Bill",     filename: "Hospital_Bill.pdf",         ext: "pdf", source: "HIS" }),
  ],
};

export function loadDiskDocuments(caseId: string) {
  try {
    const targetCase = cases.find(c => c.id === caseId);
    if (!targetCase) return;
    const targetPatient = patients.find(p => p.id === targetCase.patient_id);
    if (!targetPatient) return;
    
    // Sanitize MRN for directory name
    const safeMrn = targetPatient.mrn.replace(/[^A-Za-z0-9_-]/g, "_");
    const originalsDir = path.join(process.cwd(), "..", "PatientLog", safeMrn, "originals");
    const extractedDir = path.join(process.cwd(), "..", "PatientLog", safeMrn, "extracted");
    
    if (fs.existsSync(originalsDir)) {
      const files = fs.readdirSync(originalsDir);
      
      // Clean up cached documents that are no longer on disk
      if (DOCUMENTS_BY_CASE[caseId]) {
        DOCUMENTS_BY_CASE[caseId] = DOCUMENTS_BY_CASE[caseId].filter(d => {
          if (d.source !== "MedCam") return true;
          return files.includes(d.filename);
        });
      }

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (![".pdf", ".jpg", ".jpeg", ".png"].includes(ext)) continue;
        
        let docType = "Consent Form";
        let confidence = 1.0;
        let uploadedAt = "23 Jun 2026";
        let fields: Record<string, any> | undefined;
        let text_snippet: string | undefined;
        let satisfied_labels: string[] | undefined;
        // "MedCam" is reserved for the future mobile-camera app — until that
        // exists, everything landed here came from a desktop upload. Only
        // trust an explicit manifest.source if a landing route ever sets
        // "MedCam" or "HIS" themselves; default is "Manual", never MedCam.
        let source: "MedCam" | "HIS" | "Manual" = "Manual";

        const jsonPath = path.join(extractedDir, `${file}.json`);
        if (fs.existsSync(jsonPath)) {
          try {
            const raw = fs.readFileSync(jsonPath, "utf8");
            const manifest = JSON.parse(raw);
            docType = manifest.doc_type || docType;
            confidence = manifest.confidence !== undefined ? manifest.confidence : confidence;
            fields = manifest.fields && Object.keys(manifest.fields).length > 0 ? manifest.fields : undefined;
            text_snippet = manifest.text_snippet || undefined;
            satisfied_labels = Array.isArray(manifest.satisfied_labels) && manifest.satisfied_labels.length > 0 ? manifest.satisfied_labels : undefined;
            if (manifest.source === "MedCam" || manifest.source === "HIS" || manifest.source === "Manual") {
              source = manifest.source;
            }
            if (manifest.processed_at) {
              const dt = new Date(manifest.processed_at);
              uploadedAt = dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
            }
          } catch {}
        } else {
          if (file.toLowerCase().includes("consent")) docType = "Consent Form";
          else if (file.toLowerCase().includes("referral")) docType = "Referral";
          else if (file.toLowerCase().includes("id")) docType = "Patient ID";
        }
        
        if (!DOCUMENTS_BY_CASE[caseId]) {
          DOCUMENTS_BY_CASE[caseId] = [];
        }
        
        // Upsert, not add-once: a filename already in the cache still needs
        // its doc_type/confidence/fields refreshed from the manifest every
        // read, otherwise a manual assign (/api/document/assign) or a
        // re-land with force_doc_type writes the correct doc_type to disk
        // but the cached copy this function returns keeps showing the OLD
        // value forever — the document looks "stuck" in Unsorted no matter
        // how many times a MEDCO reassigns it, because nothing here ever
        // re-reads the manifest for a filename it's already seen once.
        const idx = DOCUMENTS_BY_CASE[caseId].findIndex(d => d.filename === file);
        const record = {
          id: `${caseId}_${file}`.replace(/\W+/g, "_"),
          case_id: caseId,
          doc_type: docType,
          filename: file,
          original_filename: file,
          ext: ext.replace(".", "") as any,
          source,
          size_bytes: fs.statSync(path.join(originalsDir, file)).size,
          uploaded_at: uploadedAt,
          confidence: confidence,
          fields,
          text_snippet,
          satisfied_labels,
        };
        if (idx >= 0) {
          DOCUMENTS_BY_CASE[caseId][idx] = record;
        } else {
          DOCUMENTS_BY_CASE[caseId].push(record);
        }
      }
    }
  } catch (e) {
    console.error("Failed to load documents from disk:", e);
  }
}

// Deleting a document only makes sense as "unlink the file on disk" for
// documents that actually have one. The seed docs above (and any other
// hardcoded/HIS-sourced entry) have no backing file, so DELETE /api/document
// is a silent no-op for them and they reappear on the next read — this file
// is what makes that delete stick. Keyed by "case_id::filename", checked
// here on every read so a deleted seed doc stays gone across dev-server
// restarts too (DOCUMENTS_BY_CASE is just an in-memory object).
const DELETIONS_FILE = path.resolve(process.cwd(), "db", "document_deletions.json");

function readDeletions(): Record<string, true> {
  try { return JSON.parse(fs.readFileSync(DELETIONS_FILE, "utf8")); } catch { return {}; }
}

export function isDocumentDeleted(case_id: string, filename: string): boolean {
  return !!readDeletions()[`${case_id}::${filename}`];
}

export function docsForCase(case_id: string): CaseDocument[] {
  loadDiskDocuments(case_id);
  const deletions = readDeletions();
  return (DOCUMENTS_BY_CASE[case_id] ?? []).filter((d) => !deletions[`${case_id}::${d.filename}`]);
}
