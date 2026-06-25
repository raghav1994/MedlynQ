import type { Patient } from "@/lib/types";

export default function PatientIdentity({ p, hospital }: { p: Patient; hospital: string }) {
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
      <h3 className="text-sm font-bold text-ink-100 mb-3 flex items-center gap-2">
        <span>👤</span> Patient Identity
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <Field label="NAME" value={p.name} />
        <Field label="MRN" value={p.mrn} mono />
        <Field label="DOB" value="12 May 1982" />
        <Field label="GENDER" value={p.gender === "M" ? "Male" : p.gender === "F" ? "Female" : "Other"} />
        <Field label="AGE" value={p.age + " Years"} />
        <Field label="HOSPITAL ID" value={"HOSP-BLR-" + (1 + (Math.abs(p.id.charCodeAt(1)) % 99)).toString().padStart(2, "0")} mono />
      </div>
      <div className="mt-3 pt-3 border-t border-bone-300 space-y-2 text-xs">
        <Field label="HOSPITAL" value={hospital} block />
        <Field label="LOCATION" value={`${p.district}, ${p.state}`} block />
        <Field label="DISTRICT" value={p.district + " Urban"} block />
      </div>
    </div>
  );
}

function Field({ label, value, mono, block }: { label: string; value: string; mono?: boolean; block?: boolean }) {
  return (
    <div className={block ? "" : "min-w-0"}>
      <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
      <div className={`text-sm text-ink-100 mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
