import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { patients, cases } from "@/lib/mockData";
import { promises as fs } from "fs";

export const runtime = "nodejs";

const PYTHON = process.env.MEDLYNQ_PYTHON || "python";
const PIPELINE_SCRIPT = path.join(process.cwd(), "python", "pipeline.py");
const PATIENTLOG_ROOT = path.join(process.cwd(), "..", "PatientLog");
const DB_PATH = path.join(process.cwd(), "db", "dynamic_patients.json");

const docTypeKeywords: Record<string, string> = {
  "Patient ID": "PATIENT_ID",
  "Consent Form": "CONSENT",
  "Referral": "REFERRAL",
  "Registration Copy": "REGISTRATION",
  "Beneficiary Verification Slip": "BIS",
  "Latest Pathology (HPE)": "HPE",
  "PET-CT Report": "PETCT",
  "Tumor Board Certificate": "TBC",
  "Prescription / Protocol": "PROTOCOL",
  "OPD Slip": "OPD",
  "CBC / LFT / KFT Profile": "CBC",
  "IPD File (admission)": "IPD_ADMISSION",
  "Prior Imaging (CT/MRI/X-ray)": "XRAY",
  "Drug Pouch / Wrapper Photo": "POUCH",
  "Chemo Chart": "CHEMOCHART",
  "IPD File (day care)": "IPD_DAYCARE",
  "OT Notes": "OT_NOTES",
  "OT Files": "OT_FILE",
  "Anaesthesia Note": "ANAES",
  "Post Surgery Photo": "POSTOP",
  "Radiation Files": "RADIATION",
  "Radiation Chart": "RAD_CHART",
  "Feedback Form": "FB",
  "Discharge Summary": "DS",
  "Discharge Photo": "DSP",
  "Hospital Bill": "BILL",
  "Geotag Photo": "GEOTAG",
  "Post-op Notes": "POSTOP_NOTES",
  "Clinical Vitals Log": "VITALS"
};

async function runPipeline(input: string, mrn: string): Promise<any> {
  // 1. Try to hit the local Python daemon for fast processing (2-3 seconds)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout
    const res = await fetch("http://127.0.0.1:8000/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw_path: input,
        mrn: mrn,
        patientlog_root: PATIENTLOG_ROOT
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      console.log("PIPELINE SUCCESS: Processed via Python Daemon");
      return data;
    }
  } catch (err: any) {
    console.log("Python Daemon not reachable or timed out. Falling back to cold start subprocess...", err?.message || String(err));
  }

  // 2. Fallback: Invoke pipeline.py with raw_path, mrn, patientlog_root
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [PIPELINE_SCRIPT, input, mrn, PATIENTLOG_ROOT], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("close", () => {
      const trimmed = stdout.trim();
      try {
        resolve(JSON.parse(trimmed));
      } catch {
        const last = trimmed.split(/\r?\n/).filter(Boolean).pop() || "";
        try {
          resolve(JSON.parse(last));
        } catch {
          resolve({ ok: false, error: stderr || stdout || "no output from pipeline" });
        }
      }
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const mrn = (form.get("mrn") as string || "").trim();
    const docType = (form.get("doc_type") as string || "").trim();
    const patientName = (form.get("patient_name") as string || "").trim();
    const department = (form.get("department") as string || "Oncology").trim();

    console.log("UPLOAD RECEIVED:", {
      hasFile: file instanceof File,
      fileName: file instanceof File ? file.name : null,
      fileSize: file instanceof File ? file.size : null,
      mrn,
      docType,
      patientName,
      department
    });

    if (!(file instanceof File)) {
      console.log("UPLOAD FAILED: missing file field");
      return NextResponse.json({ ok: false, error: "missing 'file' field" }, { status: 400 });
    }
    if (!mrn) {
      console.log("UPLOAD FAILED: missing mrn field");
      return NextResponse.json({ ok: false, error: "missing 'mrn' field" }, { status: 400 });
    }

    // 1. Check if patient exists or if we should add a new one
    let targetPatient = patients.find(x => x.mrn.toLowerCase() === mrn.toLowerCase());
    if (!targetPatient && patientName) {
      // Add new patient dynamically
      const nextId = `P${String(patients.length + 1).padStart(4, "0")}`;
      targetPatient = {
        id: nextId,
        mrn: mrn,
        name: patientName,
        age: 48,
        gender: "M",
        state: "Delhi",
        district: "New Delhi",
        department: department
      };
      patients.push(targetPatient);

      const nextCaseId = `CASE-${nextId}`;
      const newCase = {
        id: nextCaseId,
        patient_id: nextId,
        registration_id: `REG-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        scheme: "PMJAY" as const,
        payer: "NHA / SHA Delhi",
        procedure_code: "MO001F",
        procedure_name: "Trastuzumab cycle 1",
        diagnosis: "C50.9 Breast malignant neoplasm",
        treatment_type: "chemo" as const,
        admission_date: new Date().toISOString().split('T')[0],
        discharge_date: null,
        status: "preauth_pending" as const,
        claimed_amount: 31740,
        approved_amount: null,
        tat_days: 0,
        age_days: 0,
        missing_docs: 2,
        open_queries: 0
      };
      cases.push(newCase);

      // Persist to local JSON file
      try {
        let store = { patients: [], cases: [] };
        try {
          const raw = await fs.readFile(DB_PATH, "utf8");
          store = JSON.parse(raw);
        } catch {}
        store.patients.push(targetPatient as never);
        store.cases.push(newCase as never);
        await fs.writeFile(DB_PATH, JSON.stringify(store, null, 2), "utf8");
      } catch (e) {
        console.error("Failed to write dynamic database:", e);
      }
    }

    // 2. Map docType to filename keyword for classification mapping
    const kw = docTypeKeywords[docType] || "GENERIC";
    const ext = path.extname(file.name).toLowerCase() || ".jpg";
    const jobId = crypto.randomBytes(8).toString("hex");
    const workDir = path.join(os.tmpdir(), "medlynq", jobId);
    await mkdir(workDir, { recursive: true });

    // Sanitize MRN for safe filename on disk
    const safeMrn = mrn.replace(/[^A-Za-z0-9_-]/g, "_");

    // Include the docType keyword so pipeline.py rule-based classifier picks it up correctly
    const inPath = path.join(workDir, `upload_${safeMrn}_${kw}${ext}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(inPath, bytes);

    // 3. Run the python sidecar pipeline
    const pipelineResult = await runPipeline(inPath, mrn);

    // Update in-memory mock document logs if successful
    if (pipelineResult && !pipelineResult.error) {
      // In production, the UI will read directly from the PatientLog directory.
      // But we can also return a success response containing the manifest info
      return NextResponse.json({
        ok: true,
        patient: targetPatient,
        manifest: pipelineResult
      });
    } else {
      console.log("UPLOAD FAILED: pipeline error", pipelineResult?.error);
      return NextResponse.json({
        ok: false,
        error: pipelineResult?.error || "Pipeline processing failed"
      }, { status: 500 });
    }

  } catch (e: any) {
    console.error("UPLOAD CRASHED:", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
