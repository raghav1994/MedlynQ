import type { DocSynopsis as DocSynopsisType } from "@/lib/synopsis";

const SUGGEST_LABEL: Record<string, string> = {
  adjuvant_chemo_indicated: "Adjuvant chemo indicated",
  receptor_test_pending: "Receptor test pending",
  re_excision_needed: "Re-excision needed",
  next_cycle_date: "Next cycle date due",
  review_appointment: "Review appointment due",
  over_cap_amount: "Bill over scheme cap",
  missing_line_items: "Missing line items",
  bsa_calculation_check: "BSA dose check needed",
  dose_modification_needed: "Dose modification needed",
  hpe_followup_due: "Post-op HPE follow-up due",
};

function formatVal(v: string | number | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString("en-IN");
  return String(v);
}

function prettyKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DocSynopsis({ synopsis }: { synopsis: DocSynopsisType }) {
  const fieldsWithVals = Object.entries(synopsis.fields).filter(([, v]) => v !== null && v !== undefined);
  return (
    <div className="border border-bone-300 rounded-lg bg-bone-0 overflow-hidden">
      <div className="px-3 py-2 bg-accent-soft border-b border-bone-300 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span>📋</span>
          <span className="text-xs font-bold uppercase tracking-wide text-ink-100">
            {synopsis.label}
          </span>
        </div>
        {synopsis.confidence !== null && (
          <span className="text-[10px] text-ink-300 font-mono">
            conf {(synopsis.confidence * 100).toFixed(0)}%
          </span>
        )}
      </div>
      <div className="p-3 space-y-2">
        {fieldsWithVals.length === 0 ? (
          <p className="text-xs text-ink-300 italic">No structured fields extracted yet.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {fieldsWithVals.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-300">{prettyKey(k)}</dt>
                <dd className="text-ink-100 font-medium text-right truncate" title={formatVal(v)}>
                  {formatVal(v)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {synopsis.suggests.length > 0 && (
          <div className="pt-2 border-t border-bone-300 space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">
              Suggests
            </div>
            {synopsis.suggests.map((s) => (
              <div key={s} className="text-xs text-accent flex items-center gap-1">
                <span>✓</span>
                <span>{SUGGEST_LABEL[s] ?? s}</span>
              </div>
            ))}
          </div>
        )}

        {synopsis.flags.length > 0 && (
          <div className="pt-2 border-t border-bone-300">
            {synopsis.flags.map((f) => (
              <div key={f} className="text-xs text-bad flex items-center gap-1">
                <span>⚠</span>
                <span>{f.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
