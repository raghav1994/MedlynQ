export default function ClinicalVitals({ admission_date }: { admission_date: string }) {
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
      <h3 className="text-sm font-bold text-ink-100 mb-3 flex items-center gap-2">
        <span>🩺</span> Clinical Vitals
      </h3>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <Vital icon="🌡️" label="TEMP"   value="98.6°F" />
        <Vital icon="💓" label="PULSE"  value="78 BPM" />
        <Vital icon="📏" label="HEIGHT" value="175 cm" />
        <Vital icon="⚖️" label="WEIGHT" value="72 kg" />
      </div>
      <div className="mt-3 pt-3 border-t border-bone-300">
        <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">ADMISSION DATE</div>
        <div className="text-sm text-ink-100 mt-0.5">{formatDate(admission_date)}, 08:30</div>
      </div>
    </div>
  );
}

function Vital({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 bg-bone-100 rounded p-2">
      <span className="text-base">{icon}</span>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
        <div className="text-sm font-semibold text-ink-100">{value}</div>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
