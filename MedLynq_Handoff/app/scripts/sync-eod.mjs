// EOD (end-of-day) sync — pushes real, disk-based data that accumulates
// during the day into Supabase, so accuracy/history isn't lost to a JSON
// file or local disk being the only copy. Covers:
//   1. documents  — every real file a MEDCO actually landed under
//      PatientLog/{mrn}/originals/, with its extracted-manifest JSON
//      (fields/identity/doc_type) attached. Deliberately does NOT touch
//      the hardcoded demo documents in mockDocuments.ts — only real files
//      on disk, which is exactly "documents a MEDCO added today".
//   2. audit_log  — new lines appended to PatientLog/_index/audit_log.jsonl
//      since the last run (cursor-tracked in db/audit_sync_cursor.json).
//
// Safe to run repeatedly / idempotent for documents (upsert by id).
// Not wired to a cron yet — run manually or via a scheduled task:
//   node scripts/sync-eod.mjs
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const patientLogRoot = path.resolve(root, "..", "PatientLog");

const envPath = path.join(root, ".env.local");
const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const SKIP_DIRS = new Set(["Approved", "Synthetic", "_index", "_tmp_extract", "_tmp_land"]);

function safeMrn(mrn) {
  return mrn.replace(/[^A-Za-z0-9_-]/g, "_");
}

async function syncDocuments() {
  const { data: patients, error: perr } = await supabase.from("patients").select("id,mrn,hospital_id");
  if (perr) throw new Error("fetch patients: " + perr.message);
  const { data: cases, error: cerr } = await supabase.from("cases").select("id,patient_id");
  if (cerr) throw new Error("fetch cases: " + cerr.message);

  const caseByPatient = new Map();
  for (const c of cases) if (!caseByPatient.has(c.patient_id)) caseByPatient.set(c.patient_id, c.id);

  const bySafeMrn = new Map();
  for (const p of patients) bySafeMrn.set(safeMrn(p.mrn), p);

  const dirs = existsSync(patientLogRoot)
    ? readdirSync(patientLogRoot).filter((d) => !SKIP_DIRS.has(d) && statSync(path.join(patientLogRoot, d)).isDirectory())
    : [];

  const rows = [];
  let skippedNoPatientMatch = 0;

  for (const dir of dirs) {
    const patient = bySafeMrn.get(dir);
    const originalsDir = path.join(patientLogRoot, dir, "originals");
    const extractedDir = path.join(patientLogRoot, dir, "extracted");
    if (!existsSync(originalsDir)) continue;
    if (!patient) { skippedNoPatientMatch++; continue; }

    const caseId = caseByPatient.get(patient.id) ?? null;
    const files = readdirSync(originalsDir).filter((f) => {
      const full = path.join(originalsDir, f);
      return statSync(full).isFile();
    });

    for (const file of files) {
      const ext = path.extname(file).replace(".", "").toLowerCase();
      if (!["pdf", "jpg", "jpeg", "png"].includes(ext)) continue;

      const filePath = path.join(originalsDir, file);
      const size_bytes = statSync(filePath).size;

      let extracted = null;
      const jsonPath = path.join(extractedDir, `${file}.json`);
      if (existsSync(jsonPath)) {
        try { extracted = JSON.parse(readFileSync(jsonPath, "utf8")); } catch {}
      }

      const idBase = `${caseId ?? patient.id}_${file}`;
      const id = idBase.replace(/\W+/g, "_");
      const uploaded_at = extracted?.processed_at ?? statSync(filePath).mtime.toISOString();

      rows.push({
        id,
        case_id: caseId,
        patient_id: patient.id,
        hospital_id: patient.hospital_id,
        doc_type: extracted?.doc_type ?? null,
        filename: file,
        original_filename: file,
        ext,
        source: "MedCam",
        size_bytes,
        confidence: extracted?.confidence ?? null,
        storage_path: `PatientLog/${dir}/originals/${file}`,
        extracted,
        uploaded_at,
      });
    }
  }

  if (rows.length === 0) {
    console.log(`documents: nothing to sync (0 real files found across ${dirs.length} patient folders, ${skippedNoPatientMatch} folders had no matching patient row)`);
    return;
  }
  // Upsert in chunks to stay well under any request-size limits.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("documents").upsert(chunk);
    if (error) throw new Error("documents upsert: " + error.message);
  }
  console.log(`documents: upserted ${rows.length} real files (${skippedNoPatientMatch} folders skipped — no matching patient row)`);
}

async function syncAuditLog() {
  const auditFile = path.join(patientLogRoot, "_index", "audit_log.jsonl");
  if (!existsSync(auditFile)) {
    console.log("audit_log: source file not found, skipped");
    return;
  }
  const cursorFile = path.join(root, "db", "audit_sync_cursor.json");
  let cursor = { lines_synced: 0 };
  if (existsSync(cursorFile)) {
    try { cursor = JSON.parse(readFileSync(cursorFile, "utf8")); } catch {}
  }

  const lines = readFileSync(auditFile, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const newLines = lines.slice(cursor.lines_synced);
  if (newLines.length === 0) {
    console.log(`audit_log: up to date (${cursor.lines_synced} lines already synced)`);
    return;
  }

  const rows = [];
  for (const line of newLines) {
    try {
      const ev = JSON.parse(line);
      rows.push({
        ts: ev.ts, kind: ev.kind, mrn: ev.mrn ?? null, file: ev.file ?? null,
        sha256_in: ev.sha256_in ?? null, sha256_out: ev.sha256_out ?? null,
        burned_count: ev.burned_count ?? null, extra: ev.extra ?? null,
      });
    } catch { /* skip corrupt line */ }
  }

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("audit_log").insert(chunk);
    if (error) throw new Error("audit_log insert: " + error.message);
  }
  writeFileSync(cursorFile, JSON.stringify({ lines_synced: lines.length, last_synced_at: new Date().toISOString() }, null, 2));
  console.log(`audit_log: inserted ${rows.length} new events (cursor now at ${lines.length})`);
}

async function main() {
  await syncDocuments();
  await syncAuditLog();
  console.log("\nEOD sync complete.");
}

main().catch((e) => {
  console.error("EOD SYNC FAILED:", e.message);
  process.exit(1);
});
