import AppShell from "@/components/AppShell";
import SpecialtyFilter from "@/components/SpecialtyFilter";
import { cases, loadDynamicData, patientName, folderKey } from "@/lib/mockData";

export const dynamic = "force-dynamic";

export default function PatientListPage() {
  loadDynamicData();
  // Pre-resolve patient name + folder key per case so the client component
  // never depends on server-only mock state (avoids hydration mismatch).
  const resolved = cases.map((c) => ({
    ...c,
    _patient_name: patientName(c.patient_id),
    _folder_key: folderKey(c.patient_id),
  }));
  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink-100">Patient List</h1>
            <p className="text-sm text-ink-300 mt-1">
              All patients across pre-auth, treatment, claim and payment stages. Filter by specialty.
            </p>
          </div>
          <div className="text-xs text-ink-300">{cases.length} total cases</div>
        </div>

        <SpecialtyFilter cases={resolved} />
      </div>
    </AppShell>
  );
}
