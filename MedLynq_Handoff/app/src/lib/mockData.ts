// Seed mock data based on real extracted Batch_01 patient names.

import type { Patient, Case, KpiTile, ActivityEvent, WorkQueueGroup, ActionTile } from "./types";
import { openPostOpHPEQueries } from "./mockQueries";
import { approvalCasesFromList } from "./approval";
import { autoCloseQueueFromList } from "./autoClose";

const ACTION = "HOSP-BLR-49";
const FORTIS = "HOSP-DEL-77";

// Trimmed to 6 diverse test scenarios — one patient per case-status.
export const patients: Patient[] = [
  { id: "P0001", mrn: "PYZBP2Z4P", name: "Chinta Devi",   age: 62, gender: "F", state: "Delhi", district: "West Delhi",  department: "Oncology",         hospital_id: ACTION },
  { id: "P0009", mrn: "PNW72KQ19", name: "Sushila Gupta", age: 55, gender: "F", state: "Delhi", district: "West Delhi",  department: "Oncology",         hospital_id: ACTION },
  { id: "P0010", mrn: "PTBQ4UU03", name: "Ramesh Kohli",  age: 60, gender: "M", state: "Delhi", district: "Central Delhi", department: "Oncology",       hospital_id: ACTION },
  { id: "P0008", mrn: "MK70A6O8G", name: "Vikram Singh",  age: 68, gender: "M", state: "UP",    district: "Noida",       department: "Cardiology",        hospital_id: ACTION },
  { id: "P0003", mrn: "MH9VWGX49", name: "Mohan Lal",     age: 71, gender: "M", state: "UP",    district: "Meerut",      department: "Cardiology",        hospital_id: ACTION },
  { id: "P0007", mrn: "MFXW0R1M1", name: "Anita Desai",   age: 59, gender: "F", state: "Delhi", district: "East Delhi",  department: "Gastroenterology",  hospital_id: ACTION },
];

// Trimmed to 6 diverse test cases — one per status band.
export const cases: Case[] = [
  // 1. Sushila Gupta — pre-auth pending (PMJAY surgery)
  {
    id: "PRE-2026-0118",
    patient_id: "P0009",
    registration_id: "PRE-2026-0118",
    scheme: "PMJAY", payer: "NHA / SHA Delhi",
    procedure_code: "SG075B", procedure_name: "Modified radical mastectomy",
    diagnosis: "C50.9 Breast malignant neoplasm",
    treatment_type: "surgery",
    admission_date: "2026-06-17", discharge_date: null,
    status: "preauth_pending",
    claimed_amount: 134550, approved_amount: null,
    tat_days: 0, age_days: 1, missing_docs: 1, open_queries: 0,
  },
  // 2. Ramesh Kohli — admitted mid-way (PMJAY chemo cycle 3 of 5)
  {
    id: "ADM-2026-0204",
    patient_id: "P0010",
    registration_id: "REG-2026-9701",
    scheme: "PMJAY", payer: "NHA / SHA Delhi",
    procedure_code: "MO001F", procedure_name: "Trastuzumab cycle 3",
    diagnosis: "C61 Prostate malignant neoplasm",
    treatment_type: "chemo",
    cycle: { current: 3, total: 5 },
    admission_date: "2026-06-16", discharge_date: null,
    status: "admitted",
    claimed_amount: 31740, approved_amount: null,
    tat_days: 2, age_days: 2, missing_docs: 0, open_queries: 0,
  },
  // 3. Chinta Devi — discharged, ready for claim submission
  {
    id: "2026061510020413",
    patient_id: "P0001",
    registration_id: "REG-2026-9598",
    scheme: "PMJAY", payer: "NHA / SHA Delhi",
    procedure_code: "MO001F", procedure_name: "Trastuzumab cycle 4",
    diagnosis: "C50.9 Breast malignant neoplasm",
    treatment_type: "chemo",
    cycle: { current: 4, total: 5 },
    admission_date: "2026-06-15", discharge_date: "2026-06-15",
    status: "discharged",
    claimed_amount: 31740, approved_amount: null,
    tat_days: 3, age_days: 3, missing_docs: 0, open_queries: 0,
  },
  // 4. Vikram Singh — in query (Railway UMID)
  {
    id: "2026051410041450",
    patient_id: "P0008",
    registration_id: "REG-2026-8810",
    scheme: "Railway_UMID", payer: "Railway UMID",
    procedure_code: "SC068B", procedure_name: "Chemotherapy administration",
    diagnosis: "C61 Prostate malignant neoplasm",
    treatment_type: "chemo",
    cycle: { current: 2, total: 6 },
    admission_date: "2026-05-14", discharge_date: "2026-05-14",
    status: "query",
    claimed_amount: 42500, approved_amount: null,
    tat_days: 23, age_days: 18, missing_docs: 1, open_queries: 3,
  },
  // 5. Mohan Lal — CGHS surgery in query
  {
    id: "2026051810066828",
    patient_id: "P0003",
    registration_id: "REG-2026-9088",
    scheme: "CGHS", payer: "CGHS Central",
    procedure_code: "SC061A", procedure_name: "CABG + valve repair",
    diagnosis: "I25.10 Atherosclerotic heart disease",
    treatment_type: "surgery",
    admission_date: "2026-05-15", discharge_date: "2026-05-22",
    status: "query",
    claimed_amount: 234500, approved_amount: null,
    tat_days: 18, age_days: 12, missing_docs: 2, open_queries: 2,
  },
  // 6. Anita Desai — fully paid (end-state)
  {
    id: "2026051610039147",
    patient_id: "P0007",
    registration_id: "REG-2026-8901",
    scheme: "PMJAY", payer: "NHA / SHA Delhi",
    procedure_code: "SC068B", procedure_name: "Chemotherapy administration",
    diagnosis: "C50.9 Breast malignant neoplasm",
    treatment_type: "chemo",
    cycle: { current: 4, total: 4 },
    admission_date: "2026-05-16", discharge_date: "2026-05-16",
    status: "paid",
    claimed_amount: 42500, approved_amount: 42500,
    tat_days: 14, age_days: 1, missing_docs: 0, open_queries: 0,
  },
] as any;

// S1 — backfill hospital_id on all Action-seeded cases (existing seeds predate multi-tenancy)
cases.forEach((c) => { if (!c.hospital_id) c.hospital_id = "HOSP-BLR-49"; });

// O3 — Round-robin assign cases to the two seeded MEDCOs.
// Richa (U002) takes even-index cases, Priya (U003) takes odd-index.
// Replace later with real assignment when ADMIN UI lands.
const MEDCO_ROSTER_BY_HOSPITAL: Record<string, { id: string; name: string }[]> = {
  "HOSP-BLR-49": [
    { id: "U002", name: "Richa Attri" },
    { id: "U003", name: "Priya Kulkarni" },
  ],
  "HOSP-DEL-77": [
    { id: "U011", name: "Kavita Sharma" },
  ],
};
const _assignCounter: Record<string, number> = {};
cases.forEach((c) => {
  if (!c.assigned_medco_id) {
    const roster = MEDCO_ROSTER_BY_HOSPITAL[c.hospital_id] ?? [];
    if (roster.length > 0) {
      const idx = (_assignCounter[c.hospital_id] ?? 0) % roster.length;
      _assignCounter[c.hospital_id] = (_assignCounter[c.hospital_id] ?? 0) + 1;
      c.assigned_medco_id = roster[idx].id;
      c.assigned_medco_name = roster[idx].name;
    }
  }
});

export function loadDynamicData() {
  if (typeof window === "undefined") {
    try {
      const fs = require("fs");
      const path = require("path");
      const dbPath = path.join(process.cwd(), "db", "dynamic_patients.json");
      if (fs.existsSync(dbPath)) {
        const raw = fs.readFileSync(dbPath, "utf8");
        const { patients: dynamicPatients, cases: dynamicCases } = JSON.parse(raw);
        for (const dp of dynamicPatients) {
          if (!patients.some((x) => x.mrn.toLowerCase() === dp.mrn.toLowerCase())) {
            patients.push(dp);
          }
        }
        for (const dc of dynamicCases) {
          if (!cases.some((x) => x.id === dc.id)) {
            cases.push(dc);
          }
        }
      }
      // H — surface HIS admissions (from /api/his/ingest) in the main lists
      const hisPath = path.join(process.cwd(), "db", "his_admissions.json");
      if (fs.existsSync(hisPath)) {
        const hisRecords = JSON.parse(fs.readFileSync(hisPath, "utf8")) as Array<any>;
        for (const r of hisRecords) {
          if (!patients.some((x) => x.id === r.patient.id || x.mrn.toLowerCase() === r.patient.mrn.toLowerCase())) {
            patients.push(r.patient);
          }
          if (!cases.some((x) => x.id === r.case_seed.id)) {
            cases.push(r.case_seed);
          }
        }
      }

      // E5 — apply patient-field overrides (rename etc.) on top of everything else
      const patientOverridePath = path.join(process.cwd(), "db", "patient_overrides.json");
      if (fs.existsSync(patientOverridePath)) {
        const povr = JSON.parse(fs.readFileSync(patientOverridePath, "utf8")) as Record<string, any>;
        for (const [pid, patch] of Object.entries(povr)) {
          const idx = patients.findIndex((x) => x.id === pid);
          if (idx >= 0) {
            const { updated_at, ...rest } = patch as any;
            patients[idx] = { ...patients[idx], ...rest };
          }
        }
      }

      // D5 — replay NHCX-driven case state overrides
      const fs2 = require("fs");
      const path2 = require("path");
      const nhcxPath = path2.join(process.cwd(), "db", "nhcx_case_state.json");
      if (fs2.existsSync(nhcxPath)) {
        const overrides = JSON.parse(fs2.readFileSync(nhcxPath, "utf8")) as Record<string, any>;
        for (const [cid, patch] of Object.entries(overrides)) {
          const idx = cases.findIndex((x) => x.id === cid);
          if (idx >= 0) {
            const { last_transition, updated_at, ...rest } = patch as any;
            cases[idx] = { ...cases[idx], ...rest };
          }
        }
      }

      // Manual corrections from the pre-send NHCX review screen (diagnosis,
      // ICD-10 override, procedure, claimed amount) — applied last so a
      // human's explicit fix always wins over anything auto-generated above.
      const caseOverridePath = path2.join(process.cwd(), "db", "case_overrides.json");
      if (fs2.existsSync(caseOverridePath)) {
        const covr = JSON.parse(fs2.readFileSync(caseOverridePath, "utf8")) as Record<string, any>;
        for (const [cid, patch] of Object.entries(covr)) {
          const idx = cases.findIndex((x) => x.id === cid);
          if (idx >= 0) {
            const { updated_at, ...rest } = patch as any;
            cases[idx] = { ...cases[idx], ...rest };
          }
        }
      }
    } catch (e) {
      console.error("Failed to load dynamic patients:", e);
    }
  }
}

// Load dynamic patients on server startup
loadDynamicData();

// ---- Supabase hydration ----
// Pulls the durable copy of patients/cases from Postgres and merges it on
// top of the in-memory arrays (same additive/patch pattern as
// loadDynamicData's JSON merge, just sourced from the DB instead of files).
// Memoized per server process — first caller pays the round-trip, everyone
// after gets the cached result until the process restarts.
let _hydratePromise: Promise<void> | null = null;

async function doHydrate() {
  const { fetchAllPatients, fetchAllCases } = await import("./db/patientsCases");
  const [dbPatients, dbCases] = await Promise.all([fetchAllPatients(), fetchAllCases()]);
  for (const dp of dbPatients) {
    const idx = patients.findIndex((x) => x.id === dp.id);
    if (idx >= 0) patients[idx] = { ...patients[idx], ...dp };
    else patients.push(dp);
  }
  for (const dc of dbCases) {
    const idx = cases.findIndex((x) => x.id === dc.id);
    if (idx >= 0) cases[idx] = { ...cases[idx], ...dc };
    else cases.push(dc);
  }
}

export function hydrateFromSupabase(): Promise<void> {
  if (!_hydratePromise) {
    _hydratePromise = doHydrate().catch((e) => {
      console.error("hydrateFromSupabase failed, falling back to in-memory/JSON data:", e.message);
      _hydratePromise = null; // allow retry on next call
    });
  }
  return _hydratePromise;
}

export const kpis: KpiTile[] = [
  { label: "Total cases",     value: String(cases.length), delta: "+2 today" },
  { label: "Pending",         value: String(cases.filter(c => ["pending","query","submitted","responded"].includes(c.status)).length), delta: "↓ 18% MoM", tone: "warn" },
  { label: "Approved %",      value: Math.round(100 * cases.filter(c => c.status === "approved" || c.status === "paid").length / cases.length) + "%", tone: "good" },
  { label: "Avg TAT (days)",  value: (cases.reduce((s, c) => s + c.tat_days, 0) / cases.length).toFixed(1), delta: "↓ 9d vs Q1", tone: "good" },
];

export function morningTiles(): ActionTile[] {
  const openQueries = cases.filter(c => c.status === "query");
  const queriesAging = openQueries.filter(c => c.age_days >= 7);
  const preauths = cases.filter(c => c.status === "preauth_pending");
  const discharges = cases.filter(c => c.status === "discharged");
  const aging15 = cases.filter(c => ["query","pending","submitted","responded"].includes(c.status) && c.age_days >= 15);
  const moneyAtRisk = aging15.reduce((s, c) => s + c.claimed_amount, 0);
  const missingDocs = cases.filter(c => c.missing_docs > 0);

  // Post-op HPE queries with 15-day countdown
  const postopQ = openPostOpHPEQueries();
  const postopStake = postopQ.reduce((s, q) => s + q.amount_at_stake, 0);
  const oldestRemaining = postopQ.length > 0
    ? (postopQ[0].deadline_days_total ?? 15) - (postopQ[0].days_since_raised ?? 0)
    : null;

  // Approval flow (Ayushman + FCI)
  const { awaiting, received } = approvalCasesFromList(cases);
  const approvalOldestRemain = awaiting.length > 0
    ? Math.round(awaiting[0].state.expectedHours - awaiting[0].state.hoursElapsed)
    : null;

  // Auto-close warnings (45-day inactivity)
  const { closingSoon, overdue: closingOverdue } = autoCloseQueueFromList(cases);
  const oldestAutoCloseRemain = closingSoon.length > 0
    ? closingSoon[0].state.daysUntilAutoClose
    : null;

  return [
    { label: "Queries due response", value: String(openQueries.length),
      subtitle: queriesAging.length > 0 ? `${queriesAging.length} aging > 7 days` : "all fresh",
      tone: queriesAging.length > 0 ? "bad" : "warn", href: "/patients?filter=query" },
    { label: "Post-op HPE queries",
      value: String(postopQ.length),
      subtitle: postopQ.length === 0
        ? "none pending"
        : oldestRemaining! < 0
          ? `OVERDUE · ₹ ${(postopStake/100000).toFixed(1)} L at stake`
          : `oldest ${oldestRemaining}d left · ₹ ${(postopStake/100000).toFixed(1)} L`,
      tone: postopQ.length === 0 ? "good" : oldestRemaining! <= 3 ? "bad" : "warn",
      href: "/patients?filter=postop_hpe" },
    { label: "Awaiting approval", value: String(awaiting.length),
      subtitle: awaiting.length === 0
        ? (received.length > 0 ? `${received.length} approved · admit them` : "none pending")
        : approvalOldestRemain! < 0
          ? `OVERDUE · oldest ${Math.abs(approvalOldestRemain!)}h late`
          : `oldest ${approvalOldestRemain}h left · Ayushman/FCI`,
      tone: awaiting.length === 0 ? "good" : approvalOldestRemain! <= 6 ? "bad" : "warn",
      href: "/patients?filter=awaiting_approval" },
    { label: "Pre-auths pending", value: String(preauths.length),
      subtitle: "needs cost estimate + consent", tone: "accent", href: "/patients?filter=preauth" },
    { label: "Discharges to submit", value: String(discharges.length),
      subtitle: "claims ready to file", tone: "warn", href: "/patients?filter=discharged" },
    { label: "Aging > 15 days", value: "₹ " + (moneyAtRisk/100000).toFixed(1) + " L",
      subtitle: `${aging15.length} cases at risk`, tone: "bad", href: "/patients?filter=aging" },
    { label: "Missing documents", value: String(missingDocs.length),
      subtitle: "request from ward", tone: "warn", href: "/patients?filter=missing" },
    { label: "Auto-closing soon", value: String(closingSoon.length + closingOverdue.length),
      subtitle: closingOverdue.length > 0
        ? `${closingOverdue.length} past 45 days · act now`
        : oldestAutoCloseRemain !== null
          ? `oldest ${oldestAutoCloseRemain}d left · 45-day rule`
          : "none this week",
      tone: closingOverdue.length > 0 ? "bad" : closingSoon.length > 0 ? "warn" : "good",
      href: "/patients?filter=closing_soon" },
  ];
}

export function workQueueGroups(): WorkQueueGroup[] {
  return [
    { title: "Reply to queries today",   hint: "Aging clock ticking · respond before EOD",
      tone: "bad",    case_ids: cases.filter(c => c.status === "query").map(c => c.id) },
    { title: "Pre-authorizations to draft", hint: "Build cost-estimate packet → submit to scheme",
      tone: "accent", case_ids: cases.filter(c => c.status === "preauth_pending").map(c => c.id) },
    { title: "Discharges ready to submit", hint: "All docs collected · file claim",
      tone: "warn",   case_ids: cases.filter(c => c.status === "discharged").map(c => c.id) },
  ];
}

export const activity: ActivityEvent[] = [
  { id: "a1", ts: "just now",   text: "Lynq compressed 6 docs in MRN PYZBP2Z4P folder · saved 4.2 MB", actor: "Lynq",  tone: "good" },
  { id: "a2", ts: "2 mins ago", text: "Query received from CPD-Trust for REG-2026-8965: 'Provide post-op HPE'", actor: "NHA",   tone: "bad" },
  { id: "a3", ts: "14 mins ago", text: "Patient documents pulled for MRN MU29120HU — 13 docs fetched from HIS", actor: "HIS",   tone: "neutral" },
  { id: "a4", ts: "32 mins ago", text: "Claim REG-2026-9412 marked Approved · ₹ 31,740", actor: "NHA", tone: "good" },
  { id: "a5", ts: "1 hr ago",   text: "Risk scorer flagged REG-2026-9088 — 72% query probability (HPE missing)", actor: "Lynq", tone: "warn" },
  { id: "a6", ts: "2 hr ago",   text: "Pre-auth submitted for Sushila Gupta · SG075B · ₹ 1,34,550", actor: "Priya", tone: "neutral" },
  { id: "a7", ts: "3 hr ago",   text: "Empanelment renewal due in 14 days · PMJAY Specialty Oncology", actor: "Admin", tone: "warn" },
];

export function patientName(p_id: string) {
  const p = patients.find(p => p.id === p_id);
  return p ? p.name : "Unknown";
}
export function patientMRN(p_id: string) {
  const p = patients.find(p => p.id === p_id);
  return p ? p.mrn : "—";
}
export function folderKey(p_id: string) {
  const p = patients.find(p => p.id === p_id);
  if (!p) return "Unknown_MRN";
  return p.name.toUpperCase().replace(/\s+/g, "_") + "_" + p.mrn;
}
export function caseById(case_id: string) {
  return cases.find(c => c.id === case_id);
}
