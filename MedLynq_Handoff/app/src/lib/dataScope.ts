// Multi-tenant data scoping.
//
// Every page that reads cases/patients MUST go through these helpers.
// They filter by session.user.hospital_id so Action's MEDCO never sees
// Fortis's cases, and vice versa.
//
// Usage in a server component:
//   const { cases: myCases, patients: myPatients } = await scopedData();

import { cases as ALL_CASES, patients as ALL_PATIENTS, loadDynamicData, hydrateFromSupabase } from "@/lib/mockData";
import { getSession } from "@/lib/auth/session";
import type { Case, Patient } from "@/lib/types";

export type ScopedData = {
  cases: Case[];
  patients: Patient[];
  hospital_id: string;
};

export async function scopedData(): Promise<ScopedData> {
  loadDynamicData();
  await hydrateFromSupabase();
  const session = await getSession();
  if (!session.user) {
    // Middleware should already have blocked this. Defensive throw.
    throw new Error("scopedData called without session — middleware misconfigured");
  }
  const hid = session.user.hospital_id;
  return {
    cases: ALL_CASES.filter((c) => c.hospital_id === hid),
    patients: ALL_PATIENTS.filter((p) => p.hospital_id === hid),
    hospital_id: hid,
  };
}

/** Lookup a single patient with tenant guard. Returns null if not found OR not owned. */
export async function scopedPatient(id: string): Promise<Patient | null> {
  const { patients } = await scopedData();
  return patients.find((p) => p.id === id) ?? null;
}

/** Lookup a single case with tenant guard. */
export async function scopedCase(id: string): Promise<Case | null> {
  const { cases } = await scopedData();
  return cases.find((c) => c.id === id) ?? null;
}
