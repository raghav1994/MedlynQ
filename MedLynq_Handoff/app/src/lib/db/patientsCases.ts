// Thin data-access layer over Postgres for patients + cases. Plain SQL via
// `pg` — works against Supabase's own Postgres endpoint, Azure Database for
// PostgreSQL, or any Postgres 13+. Column names here must match
// db/schema_v2.sql exactly.
import { pool } from "@/lib/db/pool";
import type { Patient, Case } from "@/lib/types";

export async function fetchAllPatients(): Promise<Patient[]> {
  const { rows } = await pool.query("select * from patients");
  return rows.map((r: any) => ({
    id: r.id, mrn: r.mrn, name: r.name, age: r.age ?? 0, gender: r.gender,
    state: r.state ?? "", district: r.district ?? "", department: r.department ?? undefined,
    hospital_id: r.hospital_id,
  }));
}

export async function fetchAllCases(): Promise<Case[]> {
  const { rows } = await pool.query("select * from cases");
  return rows.map((r: any) => ({
    id: r.id, patient_id: r.patient_id, registration_id: r.registration_id ?? r.id,
    scheme: r.scheme, scheme_variant: r.scheme_variant ?? undefined, auth_mode: r.auth_mode ?? undefined,
    entry_mode: r.entry_mode ?? undefined, payer: r.payer ?? "", procedure_code: r.procedure_code ?? "",
    procedure_name: r.procedure_name ?? "", diagnosis: r.diagnosis ?? "", treatment_type: r.treatment_type ?? "medicine",
    specialty: r.specialty ?? undefined,
    cycle: r.cycle_current != null && r.cycle_total != null ? { current: r.cycle_current, total: r.cycle_total } : undefined,
    admission_date: r.admission_date, discharge_date: r.discharge_date,
    status: r.status, claimed_amount: Number(r.claimed_amount ?? 0),
    approved_amount: r.approved_amount != null ? Number(r.approved_amount) : null,
    tat_days: r.tat_days ?? 0, age_days: r.age_days ?? 0, missing_docs: r.missing_docs ?? 0,
    open_queries: r.open_queries ?? 0,
    approval_clock_started_at: r.approval_clock_started_at ?? undefined,
    approval_received_at: r.approval_received_at ?? undefined,
    approval_valid_till: r.approval_valid_till ?? undefined,
    approval_amount_inr: r.approval_amount_inr != null ? Number(r.approval_amount_inr) : undefined,
    approval_letter_filename: r.approval_letter_filename ?? undefined,
    intimation_due_at: r.intimation_due_at ?? undefined,
    scheme_history: r.scheme_history ?? undefined,
    rejection_rounds: r.rejection_rounds ?? undefined,
    scheme_contact_person: r.scheme_contact_person ?? undefined,
    assigned_medco_id: r.assigned_medco_id ?? undefined,
    assigned_medco_name: r.assigned_medco_name ?? undefined,
    hospital_id: r.hospital_id,
  }));
}

export async function upsertPatient(p: Patient): Promise<void> {
  await pool.query(
    `insert into patients (id, mrn, name, age, gender, state, district, department, hospital_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (id) do update set
       mrn = excluded.mrn, name = excluded.name, age = excluded.age, gender = excluded.gender,
       state = excluded.state, district = excluded.district, department = excluded.department,
       hospital_id = excluded.hospital_id`,
    [p.id, p.mrn, p.name, p.age, p.gender, p.state || null, p.district || null, p.department || null, p.hospital_id]
  );
}

export async function upsertCase(c: Case): Promise<void> {
  await pool.query(
    `insert into cases (
       id, patient_id, hospital_id, registration_id, scheme, scheme_variant, auth_mode, entry_mode,
       payer, procedure_code, procedure_name, diagnosis, treatment_type, specialty,
       cycle_current, cycle_total, admission_date, discharge_date, status, claimed_amount,
       approved_amount, tat_days, age_days, missing_docs, open_queries, assigned_medco_id, assigned_medco_name
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     on conflict (id) do update set
       patient_id = excluded.patient_id, hospital_id = excluded.hospital_id,
       registration_id = excluded.registration_id, scheme = excluded.scheme,
       scheme_variant = excluded.scheme_variant, auth_mode = excluded.auth_mode,
       entry_mode = excluded.entry_mode, payer = excluded.payer, procedure_code = excluded.procedure_code,
       procedure_name = excluded.procedure_name, diagnosis = excluded.diagnosis,
       treatment_type = excluded.treatment_type, specialty = excluded.specialty,
       cycle_current = excluded.cycle_current, cycle_total = excluded.cycle_total,
       admission_date = excluded.admission_date, discharge_date = excluded.discharge_date,
       status = excluded.status, claimed_amount = excluded.claimed_amount,
       approved_amount = excluded.approved_amount, tat_days = excluded.tat_days,
       age_days = excluded.age_days, missing_docs = excluded.missing_docs,
       open_queries = excluded.open_queries, assigned_medco_id = excluded.assigned_medco_id,
       assigned_medco_name = excluded.assigned_medco_name`,
    [
      c.id, c.patient_id, c.hospital_id, c.registration_id, c.scheme, c.scheme_variant ?? null,
      c.auth_mode ?? null, c.entry_mode ?? null, c.payer, c.procedure_code, c.procedure_name, c.diagnosis,
      c.treatment_type, c.specialty ?? null, c.cycle?.current ?? null, c.cycle?.total ?? null,
      c.admission_date, c.discharge_date, c.status, c.claimed_amount, c.approved_amount,
      c.tat_days, c.age_days, c.missing_docs, c.open_queries, c.assigned_medco_id ?? null,
      c.assigned_medco_name ?? null,
    ]
  );
}

/** Patch a subset of case fields (e.g. status transitions) directly in the DB. */
export async function patchCase(id: string, patch: Partial<Case>): Promise<void> {
  const entries = Object.entries(patch).filter(([k]) => k !== "cycle"); // handled separately if ever needed
  if (entries.length === 0) return;
  const setClauses = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const values = entries.map(([, v]) => v);
  await pool.query(`update cases set ${setClauses} where id = $1`, [id, ...values]);
}

/** Delete a case row — used when /route-undo reverses an auto-created case. */
export async function deleteCase(id: string): Promise<void> {
  await pool.query("delete from cases where id = $1", [id]);
}

/** Delete a patient row — used when /route-undo reverses an auto-created patient. */
export async function deletePatient(id: string): Promise<void> {
  await pool.query("delete from patients where id = $1", [id]);
}
