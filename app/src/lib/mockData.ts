// Seed mock data based on real extracted Batch_01 patient names.

import type { Patient, Case, KpiTile, ActivityEvent, WorkQueueGroup, ActionTile } from "./types";
import { openPostOpHPEQueries } from "./mockQueries";

export const patients: Patient[] = [
  { id: "P0001", mrn: "PYZBP2Z4P", name: "Chinta Devi",   age: 62, gender: "F", state: "Delhi", district: "West Delhi" },
  { id: "P0002", mrn: "MU29120HU", name: "Rajkumari",     age: 65, gender: "F", state: "Delhi", district: "West Delhi" },
  { id: "P0003", mrn: "MH9VWGX49", name: "Mohan Lal",     age: 71, gender: "M", state: "UP",    district: "Meerut" },
  { id: "P0004", mrn: "PSR85W9EF", name: "Priya Varma",   age: 48, gender: "F", state: "Delhi", district: "South Delhi" },
  { id: "P0005", mrn: "MRX37VL82", name: "Krishan Verma", age: 47, gender: "M", state: "Haryana", district: "Gurgaon" },
  { id: "P0006", mrn: "MFT6BQT0Q", name: "Rajeev Saini",  age: 54, gender: "M", state: "Delhi", district: "North Delhi" },
  { id: "P0007", mrn: "MFXW0R1M1", name: "Anita Desai",   age: 59, gender: "F", state: "Delhi", district: "East Delhi" },
  { id: "P0008", mrn: "MK70A6O8G", name: "Vikram Singh",  age: 68, gender: "M", state: "UP",    district: "Noida" },
  { id: "P0009", mrn: "PNW72KQ19", name: "Sushila Gupta", age: 55, gender: "F", state: "Delhi", district: "West Delhi" },
  { id: "P0010", mrn: "PTBQ4UU03", name: "Ramesh Kohli",  age: 60, gender: "M", state: "Delhi", district: "Central Delhi" },
];

export const cases: Case[] = [
  // Sushila Gupta — pre-auth pending for SURGERY
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
  // Ramesh Kohli — admitted, midway CHEMO cycle 3 of 5
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
  // Chinta Devi — discharged CHEMO cycle 4 ready to submit
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
  // Vikram Singh — CHEMO with open queries
  {
    id: "2026051410041450",
    patient_id: "P0008",
    registration_id: "REG-2026-8810",
    scheme: "Railway", payer: "Railway UMID",
    procedure_code: "SC068B", procedure_name: "Chemotherapy administration",
    diagnosis: "C61 Prostate malignant neoplasm",
    treatment_type: "chemo",
    cycle: { current: 2, total: 6 },
    admission_date: "2026-05-14", discharge_date: "2026-05-14",
    status: "query",
    claimed_amount: 42500, approved_amount: null,
    tat_days: 23, age_days: 18, missing_docs: 1, open_queries: 3,
  },
  // Mohan Lal — SURGERY with query
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
  // Rajkumari — CHEMO cycle 2 query
  {
    id: "2026051910005686",
    patient_id: "P0002",
    registration_id: "REG-2026-9145",
    scheme: "PMJAY", payer: "NHA / SHA Delhi",
    procedure_code: "MO001F", procedure_name: "Trastuzumab cycle 2",
    diagnosis: "C50.9 Breast malignant neoplasm",
    treatment_type: "chemo",
    cycle: { current: 2, total: 5 },
    admission_date: "2026-05-19", discharge_date: "2026-05-19",
    status: "query",
    claimed_amount: 31740, approved_amount: null,
    tat_days: 12, age_days: 8, missing_docs: 1, open_queries: 1,
  },
  // Krishan Verma — SURGERY submitted
  {
    id: "2026051810027940",
    patient_id: "P0005",
    registration_id: "REG-2026-9024",
    scheme: "SHA", payer: "SHA UP",
    procedure_code: "SG075B", procedure_name: "Modified radical mastectomy",
    diagnosis: "C50.9 Breast malignant neoplasm",
    treatment_type: "surgery",
    admission_date: "2026-05-18", discharge_date: "2026-05-22",
    status: "submitted",
    claimed_amount: 134550, approved_amount: null,
    tat_days: 21, age_days: 15, missing_docs: 0, open_queries: 0,
  },
  // Rajeev Saini — CHEMO cycle 1 responded
  {
    id: "2026051710015296",
    patient_id: "P0006",
    registration_id: "REG-2026-8965",
    scheme: "PMJAY", payer: "NHA / SHA Delhi",
    procedure_code: "MO001F", procedure_name: "Trastuzumab cycle 1",
    diagnosis: "C50.9 Breast malignant neoplasm",
    treatment_type: "chemo",
    cycle: { current: 1, total: 5 },
    admission_date: "2026-05-17", discharge_date: "2026-05-17",
    status: "responded",
    claimed_amount: 31740, approved_amount: null,
    tat_days: 19, age_days: 4, missing_docs: 0, open_queries: 0,
  },
  // Chinta Devi — CHEMO cycle 3 approved
  {
    id: "2026052910050818",
    patient_id: "P0001",
    registration_id: "REG-2026-9412",
    scheme: "PMJAY", payer: "NHA / SHA Delhi",
    procedure_code: "MO001F", procedure_name: "Trastuzumab cycle 3",
    diagnosis: "C50.9 Breast malignant neoplasm",
    treatment_type: "chemo",
    cycle: { current: 3, total: 5 },
    admission_date: "2026-05-29", discharge_date: "2026-05-30",
    status: "approved",
    claimed_amount: 31740, approved_amount: 31740,
    tat_days: 4, age_days: 2, missing_docs: 0, open_queries: 0,
  },
  // Rajkumari — CHEMO cycle 1 approved
  {
    id: "2026052010050145",
    patient_id: "P0002",
    registration_id: "REG-2026-9220",
    scheme: "PMJAY", payer: "NHA / SHA Delhi",
    procedure_code: "MO001F", procedure_name: "Trastuzumab cycle 1",
    diagnosis: "C50.9 Breast malignant neoplasm",
    treatment_type: "chemo",
    cycle: { current: 1, total: 5 },
    admission_date: "2026-05-20", discharge_date: "2026-05-21",
    status: "approved",
    claimed_amount: 31740, approved_amount: 28200,
    tat_days: 7, age_days: 1, missing_docs: 0, open_queries: 0,
  },
  // Priya Varma — SURGERY approved
  {
    id: "2026051810061254",
    patient_id: "P0004",
    registration_id: "REG-2026-9051",
    scheme: "PMJAY", payer: "NHA / SHA Delhi",
    procedure_code: "SG075B", procedure_name: "Modified radical mastectomy",
    diagnosis: "C50.9 Breast malignant neoplasm",
    treatment_type: "surgery",
    admission_date: "2026-05-18", discharge_date: "2026-05-21",
    status: "approved",
    claimed_amount: 134550, approved_amount: 112000,
    tat_days: 9, age_days: 5, missing_docs: 0, open_queries: 0,
  },
  // Anita Desai — CHEMO paid
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
  // Rajeev Saini — CHEMO cycle 2 approved
  {
    id: "2026051510049371",
    patient_id: "P0006",
    registration_id: "REG-2026-8854",
    scheme: "PMJAY", payer: "NHA / SHA Delhi",
    procedure_code: "MO001F", procedure_name: "Trastuzumab cycle 2",
    diagnosis: "C50.9 Breast malignant neoplasm",
    treatment_type: "chemo",
    cycle: { current: 2, total: 5 },
    admission_date: "2026-05-15", discharge_date: "2026-05-15",
    status: "approved",
    claimed_amount: 31740, approved_amount: 31740,
    tat_days: 6, age_days: 9, missing_docs: 0, open_queries: 0,
  },
];

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
    { label: "Pre-auths pending", value: String(preauths.length),
      subtitle: "needs cost estimate + consent", tone: "accent", href: "/patients?filter=preauth" },
    { label: "Discharges to submit", value: String(discharges.length),
      subtitle: "claims ready to file", tone: "warn", href: "/patients?filter=discharged" },
    { label: "Aging > 15 days", value: "₹ " + (moneyAtRisk/100000).toFixed(1) + " L",
      subtitle: `${aging15.length} cases at risk`, tone: "bad", href: "/patients?filter=aging" },
    { label: "Missing documents", value: String(missingDocs.length),
      subtitle: "request from ward", tone: "warn", href: "/patients?filter=missing" },
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
