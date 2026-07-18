import StatusBadge from "../StatusBadge";
import StageTracker from "./StageTracker";
import type { Case, Patient, Stage } from "@/lib/types";
import { folderKey } from "@/lib/mockData";
import Link from "next/link";

function rupees(n: number | null) {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

const treatmentLabels: Record<string, { label: string }> = {
  chemo:     { label: "Chemotherapy" },
  surgery:   { label: "Surgery" },
  radiation: { label: "Radiation" },
  medicine:  { label: "Medication only" },
};
const FALLBACK_TX = { label: "Treatment pending" };

export default function PatientHeader({ c, patient, stage }: { c: Case; patient: Patient; stage: Stage }) {
  const tx = treatmentLabels[c.treatment_type] ?? FALLBACK_TX;
  const editHref =
    `/opd?edit=1&patient_id=${encodeURIComponent(patient.id)}&case_id=${encodeURIComponent(c.id)}` +
    `&name=${encodeURIComponent(patient.name)}&mrn=${encodeURIComponent(patient.mrn)}` +
    `&age=${encodeURIComponent(String(patient.age))}&gender=${encodeURIComponent(patient.gender)}` +
    `&state=${encodeURIComponent(patient.state)}&scheme=${encodeURIComponent(c.scheme)}` +
    // Cases created before specialty was tracked (or via the doc-router's
    // auto-create path) can have it unset — default to "oncology" here too,
    // matching buildChecklist()'s own fallback, so the edit form's Specialty
    // dropdown shows a real selection instead of silently landing on
    // whatever its first <option> happens to be.
    `&specialty=${encodeURIComponent(c.specialty ?? "oncology")}&treatment=${encodeURIComponent(c.treatment_type)}`;
  return (
    <div className="bg-bone-0 border-b border-bone-300 -mx-6 px-6 py-4 mb-6">
      <Link href="/patients" className="text-xs text-accent hover:underline">
        ← Patient List
      </Link>

      <div className="flex items-end justify-between mt-2 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-ink-100 font-mono">{folderKey(patient.id)}</h1>
            <Link
              href={editHref}
              title="Edit name, MRN, scheme, or treatment type — via OPD Registration"
              className="text-ink-300 hover:text-accent text-base leading-none"
            >
              ✎
            </Link>
            <StatusBadge status={c.status} />
            <span className="inline-flex items-center gap-1 text-xs font-semibold bg-accent-soft text-accent px-2 py-0.5 rounded-full">
              {tx.label}
              {c.cycle && <span className="ml-1 font-normal text-ink-300">· cycle {c.cycle.current} of {c.cycle.total}</span>}
            </span>
            {c.entry_mode === ("his_feed" as any) && (
              <span
                className="text-[10px] font-bold bg-good-soft text-good px-2 py-0.5 rounded-full uppercase tracking-wide"
                title="Admission auto-received from hospital HIS (HL7 ADT^A04)"
              >
                via HIS
              </span>
            )}
          </div>
          <div className="text-sm text-ink-300 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Reg ID: <span className="font-mono text-ink-200">{c.registration_id}</span></span>
            <span>Ref No: <span className="font-mono text-ink-200">{c.id.slice(0, 12)}</span></span>
            <span>Scheme: <span className="text-ink-200">{c.scheme} — {c.payer}</span></span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <StageTracker stage={stage} />
          <div className="flex gap-2">
            <MiniAmount label="Net Payable" value={rupees(c.claimed_amount)} tone="neutral" />
            <MiniAmount label="Approved" value={rupees(c.approved_amount)} tone="good" />
            <MiniAmount label="Payment UTR" value={c.status === "paid" || c.status === "approved" ? "TXN" + c.id.slice(-8) + "X" : "—"} tone="neutral" sub={c.status === "paid" ? "Paid · " + c.discharge_date : "Pending"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniAmount({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "neutral" | "good" }) {
  const color = tone === "good" ? "text-good border-good/40 bg-good-soft" : "text-ink-100 border-bone-300 bg-bone-100";
  return (
    <div className={`border rounded px-3 py-2 ${color} min-w-[120px]`}>
      <div className="text-[10px] uppercase tracking-wide font-semibold opacity-80">{label}</div>
      <div className="text-base font-bold mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}
