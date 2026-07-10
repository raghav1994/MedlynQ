// Real vitals only — pulled from md_parser.py's _parse_vitals() output on a
// landed "Clinical Vitals Log" document (fields.temperature_f / pulse_bpm /
// height_cm / weight_kg). If no such document has been landed for this
// patient yet, each value shows "—" rather than a placeholder number.
export type Vitals = {
  temperature_f?: string | number;
  pulse_bpm?: string | number;
  height_cm?: string | number;
  weight_kg?: string | number;
};

export default function ClinicalVitals({ admission_date, vitals }: { admission_date: string; vitals?: Vitals }) {
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
      <h3 className="text-sm font-bold text-ink-100 mb-3 flex items-center gap-2">
        <span>🩺</span> Clinical Vitals
      </h3>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Vital icon="🌡️" label="TEMP"   value={vitals?.temperature_f ? `${vitals.temperature_f}°F` : undefined} />
        <Vital icon="💓" label="PULSE"  value={vitals?.pulse_bpm ? `${vitals.pulse_bpm} BPM` : undefined} />
        <Vital icon="📏" label="HEIGHT" value={vitals?.height_cm ? `${vitals.height_cm} cm` : undefined} />
        <Vital icon="⚖️" label="WEIGHT" value={vitals?.weight_kg ? `${vitals.weight_kg} kg` : undefined} />
      </div>
      {!vitals && (
        <div className="mt-2 text-[10px] text-ink-300 italic">No Clinical Vitals Log landed yet for this patient.</div>
      )}
      <div className="mt-3 pt-3 border-t border-bone-300">
        <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">ADMISSION DATE</div>
        <div className="text-sm text-ink-100 mt-0.5">{formatDate(admission_date)}</div>
      </div>
    </div>
  );
}

function Vital({ icon, label, value }: { icon: string; label: string; value?: string }) {
  return (
    <div className="flex items-center gap-2 bg-bone-100 rounded p-2">
      <span className="text-base">{icon}</span>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
        <div className="text-sm font-semibold text-ink-100">{value ?? "—"}</div>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
