import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, unlink } from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { patients as mockPatients } from "@/lib/mockData";
import { landViaWorker } from "@/lib/pythonWorker";
import { fulfillMatching } from "@/lib/documentRequests";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const LOCAL_OCR_SCRIPT = path.join(process.cwd(), "python", "tools", "local_text_ocr.py");

// Pure photos — genuinely nothing to read (a geotag stamp photo, a
// discharge/post-surgery snapshot). No background processing at all.
const NO_OCR_SLUGS = new Set([
  "geotag_photo",
  "discharge_photo",
  "post_surgery_photo",
  "generic_photo",
]);

// Cards/IDs/pouch labels — do have text worth capturing, but it's a single
// printed card, not a scan needing Sarvam's handwriting-grade accuracy.
// RapidOCR only: local, free, never leaves the machine.
const LOCAL_OCR_SLUGS = new Set([
  "patient_id",
  "aadhaar_card",
  "voter_id",
  "pan_card",
  "ayushman_card",
  "ration_card",
  "family_id",
  "health_card",
  "drug_pouch",
]);

// Common display labels don't always normalize to the cost_gate slug above
// (e.g. "Aadhaar" -> "aadhaar", not "aadhaar_card") — without this map the
// worker still gets called for these (harmless, since land_document.py's own
// FILENAME_DOCTYPE_TO_SLUG catches it and skips OCR anyway) but wastefully.
const DOC_LABEL_TO_SKIP_SLUG: Record<string, string> = {
  aadhaar: "aadhaar_card",
  drug_pouch_wrapper_photo: "drug_pouch",
};

const COMMON_DOC_TYPES: Record<string, string> = {
  "consent_form": "Consent Form",
  "histopathology_report": "Latest Pathology (HPE)",
  "cbc_lft_kft_profile": "CBC / LFT / KFT Profile",
  "geotag_photo": "Geotag Photo",
  "patient_id": "Patient ID",
  "referral": "Referral",
  "registration_copy": "Registration Copy",
  "beneficiary_verification_slip": "Beneficiary Verification Slip",
  "latest_pathology_hpe": "Latest Pathology (HPE)",
  "pet_ct_report": "PET-CT Report",
  "tumor_board_certificate": "Tumor Board Certificate",
  "prescription_protocol": "Prescription / Protocol",
  "doctor_s_prescription": "Prescription / Protocol",
  "opd_slip": "OPD Slip",
  "ipd_file_admission": "IPD File (admission)",
  "prior_imaging_ct_mri_x_ray": "Prior Imaging (CT/MRI/X-ray)",
  "drug_pouch_wrapper_photo": "Drug Pouch / Wrapper Photo",
  "chemo_chart": "Chemo Chart",
  "ipd_file_day_care": "IPD File (day care)",
  "ot_notes": "OT Notes",
  "ot_files": "OT Files",
  "anaesthesia_note": "Anaesthesia Note",
  "post_surgery_photo": "Post Surgery Photo",
  "radiation_files": "Radiation Files",
  "radiation_chart": "Radiation Chart",
  "feedback_form": "Feedback Form",
  "discharge_summary": "Discharge Summary",
  "discharge_photo": "Discharge Photo",
  "hospital_bill": "Hospital Bill",
  "post_op_notes": "Post-op Notes",
  "clinical_vitals_log": "Clinical Vitals Log"
};

function safeMrn(mrn: string): string {
  return mrn.replace(/[^A-Za-z0-9_-]/g, "_");
}

function getDisplayLabel(docType: string, tenantData?: any): string {
  const normalized = docType.toLowerCase().replace(/[^a-z0-9]/g, "_");
  
  // 1. Check local static dictionary first
  if (COMMON_DOC_TYPES[normalized]) return COMMON_DOC_TYPES[normalized];
  if (COMMON_DOC_TYPES[docType]) return COMMON_DOC_TYPES[docType];

  // 2. Scan tenant document_library
  if (tenantData?.document_library) {
    const found = tenantData.document_library.find(
      (item: any) =>
        String(item.doc_type).toLowerCase() === docType.toLowerCase() ||
        String(item.label).toLowerCase() === docType.toLowerCase()
    );
    if (found) return found.label;
  }

  // 3. Fallback: Title Case format
  return docType
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// RapidOCR only — same script the Query Board's screenshot path uses
// (src/app/api/document/local-ocr/route.ts). No Sarvam, no compression
// byproduct, nothing leaves the machine.
function runLocalOcr(filePath: string): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [LOCAL_OCR_SCRIPT, filePath], { windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ error: err.message }));
    child.on("close", () => {
      const last = stdout.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? stdout;
      try {
        resolve(JSON.parse(last));
      } catch {
        resolve({ error: stderr || stdout || "no output" });
      }
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ ok: false, error: "Expected multipart/form-data" }, { status: 400 });
    }

    const mrn = String(form.get("mrn") ?? "").trim();
    // Accept both keys: the real mobile app sends "doc_type", the web
    // /mobile-sim simulator sends "doc_type_hint" — without this, either
    // caller silently falls back to "Consent Form" for every upload.
    const docTypeRaw = String(form.get("doc_type") ?? form.get("doc_type_hint") ?? "Consent Form").trim();
    const file = form.get("file");

    if (!mrn) {
      return NextResponse.json({ ok: false, error: "mrn required" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing 'file' field" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "File too large" }, { status: 413 });
    }

    const uploadExt = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXT.has(uploadExt)) {
      return NextResponse.json({ ok: false, error: "Unsupported file extension" }, { status: 415 });
    }

    const mrnDir = safeMrn(mrn);
    const originalsDir = path.resolve(process.cwd(), "..", "PatientLog", mrnDir, "originals");
    const extractedDir = path.resolve(process.cwd(), "..", "PatientLog", mrnDir, "extracted");
    await mkdir(originalsDir, { recursive: true });
    await mkdir(extractedDir, { recursive: true });

    // Look up patient to resolve hospital_id
    let hospitalId = "HOSP-BLR-49";
    const patient = mockPatients.find(p => safeMrn(p.mrn) === mrnDir);
    if (patient) {
      hospitalId = patient.hospital_id;
    } else {
      try {
        const STORE_FILE = path.resolve(process.cwd(), "..", "PatientLog", "_index", "patients.json");
        if (fs.existsSync(STORE_FILE)) {
          const raw = fs.readFileSync(STORE_FILE, "utf8");
          const dynamicList = JSON.parse(raw);
          const dynPatient = dynamicList.find((p: any) => safeMrn(p.mrn) === mrnDir);
          if (dynPatient && dynPatient.hospital_id) {
            hospitalId = dynPatient.hospital_id;
          }
        }
      } catch {}
    }

    // Load tenant details to verify custom display names
    let tenantData: any = null;
    try {
      const tenantPath = path.resolve(process.cwd(), "db", "tenants", `${hospitalId.toUpperCase()}.json`);
      if (fs.existsSync(tenantPath)) {
        tenantData = JSON.parse(fs.readFileSync(tenantPath, "utf-8"));
      }
    } catch {}

    const displayLabel = getDisplayLabel(docTypeRaw, tenantData);

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name).toLowerCase();
    
    // Construct a unique filename combining docType slug and timestamp
    const cleanDocType = docTypeRaw.replace(/[^A-Za-z0-9_-]/g, "_").toLowerCase();
    const finalName = `${cleanDocType}_${Date.now()}${ext}`;

    // Write original pre-compressed bytes directly to disk (Instant save - bypasses slow Python worker!)
    const landedPath = path.join(originalsDir, finalName);
    await writeFile(landedPath, buf);

    // Save manifest JSON matching the EXACT file name format expected by loadDiskDocuments
    if (patient) {
      fulfillMatching(patient.id, displayLabel).catch(() => {});
    }

    const manifestPath = path.join(extractedDir, `${finalName}.json`);
    const manifest = {
      doc_type: displayLabel,
      confidence: 1.0,
      processed_at: new Date().toISOString(),
      method: "mobile_scan",
      hospital_id: hospitalId,
      skipped_ocr: true,
      fields: {},
      source: "MedCam",
      text_snippet: "",
      full_text: ""
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    // The nurse already picked the exact patient AND doc type, so identity
    // matching / classification are pointless work — that's what made the
    // old landViaWorker path slow. Everything else still needs its text
    // captured SOMEWHERE — a clinical doc's fields feed /api/synopsis, a
    // card/ID's text is worth having on file — just not on the upload
    // response's critical path. Reply instantly above, then patch the
    // manifest once the background pass finishes.
    const normalizedSlug = docTypeRaw.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const skipSlug = DOC_LABEL_TO_SKIP_SLUG[normalizedSlug] ?? normalizedSlug;

    if (LOCAL_OCR_SLUGS.has(skipSlug)) {
      // Cards/IDs/pouch — RapidOCR only, no Sarvam. Local, free, never
      // leaves the machine; nothing here needs handwriting-grade accuracy.
      runLocalOcr(landedPath)
        .then(async (result: any) => {
          if (!result || result.error) return;
          const enriched = {
            ...manifest,
            method: "local_ocr",
            skipped_ocr: false,
            text_snippet: (result.text ?? "").slice(0, 400),
            full_text: result.text || undefined,
          };
          await writeFile(manifestPath, JSON.stringify(enriched, null, 2)).catch(() => {});
        })
        .catch(() => {}); // best-effort — the instant upload already succeeded
    } else if (!NO_OCR_SLUGS.has(skipSlug)) {
      landViaWorker(landedPath, docTypeRaw, displayLabel, hospitalId)
        .then(async (result: any) => {
          if (!result || result.error) return;
          const enriched = {
            ...manifest,
            confidence: result.confidence ?? manifest.confidence,
            method: result.method ?? manifest.method,
            skipped_ocr: result.skipped_ocr ?? manifest.skipped_ocr,
            fields: result.fields ?? {},
            identity: result.identity ?? undefined,
            redact: result.redact ?? undefined,
            text_snippet: (result.text ?? "").slice(0, 400),
            full_text: result.text || undefined,
          };
          await writeFile(manifestPath, JSON.stringify(enriched, null, 2)).catch(() => {});
          // land_file() compresses landedPath into a "{stem}_c{ext}" SIBLING
          // file in the same originals/ dir (see compress_input in
          // land_document.py) — it's meant as an internal working copy, not
          // a second document. Left alone, loadDiskDocuments() picks it up
          // as its own file with no manifest and silently defaults it to
          // "Consent Form" (mockDocuments.ts's no-manifest fallback), which
          // is exactly what made one mobile upload show up as two different
          // checklist tiles. The desktop /api/document/land route already
          // cleans this up the same way.
          if (result.compressed_path && result.compressed_path !== landedPath) {
            unlink(result.compressed_path).catch(() => {});
          }
        })
        .catch(() => {}); // best-effort — the instant upload already succeeded
    }

    return NextResponse.json({ ok: true, patient: null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
