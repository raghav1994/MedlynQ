import AppShell from "@/components/AppShell";
import PatientTable from "@/components/PatientTable";
import { cases } from "@/lib/mockData";

export default function PatientListPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink-100">Patient List</h1>
            <p className="text-sm text-ink-300 mt-1">
              All patients across pre-auth, treatment, claim and payment stages. Click any row to open the patient record.
            </p>
          </div>
          <div className="text-xs text-ink-300">{cases.length} total cases · 10 patients</div>
        </div>

        <PatientTable cases={cases} />
      </div>
    </AppShell>
  );
}
