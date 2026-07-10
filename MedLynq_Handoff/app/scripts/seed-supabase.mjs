// One-off seed script — pushes the current seed/runtime JSON data into Supabase.
// Run with: node scripts/seed-supabase.mjs
// Not wired into any npm script; this is a manual migration step, run once
// (safe to re-run — every insert uses upsert on the primary key).

import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Minimal .env.local parser (no dotenv dependency installed).
const envPath = path.join(root, ".env.local");
const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function readJson(relPath) {
  const p = path.join(root, relPath);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

async function main() {
  // ---- hospitals (tenants) ----
  const tenantFiles = ["db/tenants/HOSP-BLR-49.json", "db/tenants/HOSP-DEL-77.json"];
  const hospitals = tenantFiles.map(readJson).filter(Boolean).map((t) => ({
    id: t.hospital_id,
    name: t.name,
    short_name: t.short_name,
    subdomain: t.subdomain,
    logo_initial: t.logo_initial,
    primary_color: t.primary_color,
    accent_color: t.accent_color,
    city: t.city,
    district: t.district,
    vocabulary: t.vocabulary ?? {},
    features: t.features ?? {},
    schemes_enabled: t.schemes_enabled ?? [],
    his_webhook_secret: t.his_webhook_secret,
    tagline: t.tagline,
  }));
  let r = await supabase.from("hospitals").upsert(hospitals);
  if (r.error) throw new Error("hospitals: " + r.error.message);
  console.log(`hospitals: upserted ${hospitals.length}`);

  // ---- users ----
  const users = (readJson("db/users.json") ?? []).map((u) => ({
    id: u.id,
    hospital_id: u.hospital_id,
    email: u.email,
    name: u.name,
    role: u.role,
    designation: u.designation,
    bis_enabled: u.bis_enabled ?? false,
    password_hash: u.password_hash,
    created_at: u.created_at,
  }));
  r = await supabase.from("users").upsert(users);
  if (r.error) throw new Error("users: " + r.error.message);
  console.log(`users: upserted ${users.length}`);

  // ---- patients + cases: seed data lives in TS (mockData.ts), so this
  // script hardcodes the same 6 seed patients/cases rather than importing
  // the TS module directly (no ts-node in this project). Anything created
  // at runtime (dynamic_patients.json) is migrated separately below.
  const ACTION = "HOSP-BLR-49";
  const seedPatients = [
    { id: "P0001", mrn: "PYZBP2Z4P", name: "Chinta Devi",   age: 62, gender: "F", state: "Delhi", district: "West Delhi",    department: "Oncology",        hospital_id: ACTION },
    { id: "P0009", mrn: "PNW72KQ19", name: "Sushila Gupta", age: 55, gender: "F", state: "Delhi", district: "West Delhi",    department: "Oncology",        hospital_id: ACTION },
    { id: "P0010", mrn: "PTBQ4UU03", name: "Ramesh Kohli",  age: 60, gender: "M", state: "Delhi", district: "Central Delhi", department: "Oncology",        hospital_id: ACTION },
    { id: "P0008", mrn: "MK70A6O8G", name: "Vikram Singh",  age: 68, gender: "M", state: "UP",    district: "Noida",         department: "Cardiology",       hospital_id: ACTION },
    { id: "P0003", mrn: "MH9VWGX49", name: "Mohan Lal",     age: 71, gender: "M", state: "UP",    district: "Meerut",        department: "Cardiology",       hospital_id: ACTION },
    { id: "P0007", mrn: "MFXW0R1M1", name: "Anita Desai",   age: 59, gender: "F", state: "Delhi", district: "East Delhi",    department: "Gastroenterology", hospital_id: ACTION },
  ];
  const seedCases = [
    { id: "PRE-2026-0118", patient_id: "P0009", hospital_id: ACTION, registration_id: "PRE-2026-0118", scheme: "PMJAY", payer: "NHA / SHA Delhi", procedure_code: "SG075B", procedure_name: "Modified radical mastectomy", diagnosis: "C50.9 Breast malignant neoplasm", treatment_type: "surgery", admission_date: "2026-06-17", discharge_date: null, status: "preauth_pending", claimed_amount: 134550, approved_amount: null, tat_days: 0, age_days: 1, missing_docs: 1, open_queries: 0 },
    { id: "ADM-2026-0204", patient_id: "P0010", hospital_id: ACTION, registration_id: "REG-2026-9701", scheme: "PMJAY", payer: "NHA / SHA Delhi", procedure_code: "MO001F", procedure_name: "Trastuzumab cycle 3", diagnosis: "C61 Prostate malignant neoplasm", treatment_type: "chemo", cycle_current: 3, cycle_total: 5, admission_date: "2026-06-16", discharge_date: null, status: "admitted", claimed_amount: 31740, approved_amount: null, tat_days: 2, age_days: 2, missing_docs: 0, open_queries: 0 },
    { id: "2026061510020413", patient_id: "P0001", hospital_id: ACTION, registration_id: "REG-2026-9598", scheme: "PMJAY", payer: "NHA / SHA Delhi", procedure_code: "MO001F", procedure_name: "Trastuzumab cycle 4", diagnosis: "C50.9 Breast malignant neoplasm", treatment_type: "chemo", cycle_current: 4, cycle_total: 5, admission_date: "2026-06-15", discharge_date: "2026-06-15", status: "discharged", claimed_amount: 31740, approved_amount: null, tat_days: 3, age_days: 3, missing_docs: 0, open_queries: 0 },
    { id: "2026051410041450", patient_id: "P0008", hospital_id: ACTION, registration_id: "REG-2026-8810", scheme: "Railway_UMID", payer: "Railway UMID", procedure_code: "SC068B", procedure_name: "Chemotherapy administration", diagnosis: "C61 Prostate malignant neoplasm", treatment_type: "chemo", cycle_current: 2, cycle_total: 6, admission_date: "2026-05-14", discharge_date: "2026-05-14", status: "query", claimed_amount: 42500, approved_amount: null, tat_days: 23, age_days: 18, missing_docs: 1, open_queries: 3 },
    { id: "2026051810066828", patient_id: "P0003", hospital_id: ACTION, registration_id: "REG-2026-9088", scheme: "CGHS", payer: "CGHS Central", procedure_code: "SC061A", procedure_name: "CABG + valve repair", diagnosis: "I25.10 Atherosclerotic heart disease", treatment_type: "surgery", admission_date: "2026-05-15", discharge_date: "2026-05-22", status: "query", claimed_amount: 234500, approved_amount: null, tat_days: 18, age_days: 12, missing_docs: 2, open_queries: 2 },
    { id: "2026051610039147", patient_id: "P0007", hospital_id: ACTION, registration_id: "REG-2026-8901", scheme: "PMJAY", payer: "NHA / SHA Delhi", procedure_code: "SC068B", procedure_name: "Chemotherapy administration", diagnosis: "C50.9 Breast malignant neoplasm", treatment_type: "chemo", cycle_current: 4, cycle_total: 4, admission_date: "2026-05-16", discharge_date: "2026-05-16", status: "paid", claimed_amount: 42500, approved_amount: 42500, tat_days: 14, age_days: 1, missing_docs: 0, open_queries: 0 },
  ];

  r = await supabase.from("patients").upsert(seedPatients);
  if (r.error) throw new Error("seed patients: " + r.error.message);
  console.log(`patients (seed): upserted ${seedPatients.length}`);

  r = await supabase.from("cases").upsert(seedCases);
  if (r.error) throw new Error("seed cases: " + r.error.message);
  console.log(`cases (seed): upserted ${seedCases.length}`);

  // ---- dynamic (runtime-created) patients + cases ----
  const dyn = readJson("db/dynamic_patients.json");
  if (dyn) {
    if (dyn.patients?.length) {
      const dynPatients = dyn.patients.map((p) => ({
        id: p.id, mrn: p.mrn, name: p.name, age: p.age || null, gender: p.gender,
        state: p.state || null, district: p.district || null, department: p.department || null,
        hospital_id: p.hospital_id,
      }));
      r = await supabase.from("patients").upsert(dynPatients);
      if (r.error) throw new Error("dynamic patients: " + r.error.message);
      console.log(`patients (dynamic): upserted ${dynPatients.length}`);
    }
    if (dyn.cases?.length) {
      const dynCases = dyn.cases.map((c) => ({
        id: c.id, patient_id: c.patient_id, hospital_id: c.hospital_id,
        registration_id: c.registration_id, scheme: c.scheme, scheme_variant: c.scheme_variant,
        auth_mode: c.auth_mode, entry_mode: c.entry_mode, payer: c.payer,
        procedure_code: c.procedure_code, procedure_name: c.procedure_name, diagnosis: c.diagnosis,
        treatment_type: c.treatment_type, specialty: c.specialty,
        admission_date: c.admission_date, discharge_date: c.discharge_date, status: c.status,
        claimed_amount: c.claimed_amount ?? 0, approved_amount: c.approved_amount,
        tat_days: c.tat_days ?? 0, age_days: c.age_days ?? 0,
        missing_docs: c.missing_docs ?? 0, open_queries: c.open_queries ?? 0,
      }));
      r = await supabase.from("cases").upsert(dynCases);
      if (r.error) throw new Error("dynamic cases: " + r.error.message);
      console.log(`cases (dynamic): upserted ${dynCases.length}`);
    }
  } else {
    console.log("dynamic_patients.json: not found, skipped");
  }

  console.log("\nSeed complete.");
}

main().catch((e) => {
  console.error("SEED FAILED:", e.message);
  process.exit(1);
});
