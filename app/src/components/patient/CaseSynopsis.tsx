import type { CaseSynopsis as CaseSynopsisType } from "@/lib/synopsis";

export default function CaseSynopsis({ synopsis }: { synopsis: CaseSynopsisType }) {
  const { aligned_docs, total_docs, open_queries } = synopsis.alignment;
  const alignmentPct = total_docs > 0 ? Math.round((aligned_docs / total_docs) * 100) : 0;
  const tone =
    alignmentPct === 100 && open_queries === 0
      ? "good"
      : alignmentPct >= 80
      ? "warn"
      : "bad";
  const toneCls = {
    good: "border-good/40 bg-good-soft",
    warn: "border-warn/40 bg-warn-soft",
    bad: "border-bad/40 bg-bad-soft",
  }[tone];

  return (
    <div className={`border rounded-lg p-4 ${toneCls}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-6 h-6 rounded-full bg-accent text-white grid place-items-center text-xs font-bold">
          🧠
        </span>
        <h3 className="text-sm font-bold text-ink-100">Case synopsis</h3>
        <span className="text-[10px] text-ink-300">auto-generated from extracted docs</span>
      </div>
      <p className="text-sm text-ink-100 leading-relaxed mb-3">{synopsis.paragraph}</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Pill label="Diagnosis" value={synopsis.diagnosis ?? "—"} />
        <Pill label="Stage" value={synopsis.stage ?? "—"} />
        <Pill
          label="Doc alignment"
          value={`${aligned_docs}/${total_docs} (${alignmentPct}%)`}
        />
        <Pill
          label="Open queries"
          value={String(open_queries)}
          accent={open_queries > 0 ? "bad" : "good"}
        />
      </div>

      {synopsis.drugs_mentioned.length > 0 && (
        <div className="mt-3 flex items-start gap-2 flex-wrap text-xs">
          <span className="text-ink-300 font-semibold uppercase text-[10px] mt-0.5">Drugs:</span>
          {synopsis.drugs_mentioned.map((d) => (
            <span
              key={d}
              className="bg-bone-0 border border-bone-300 text-ink-200 px-2 py-0.5 rounded-full"
            >
              {d}
            </span>
          ))}
        </div>
      )}

      {synopsis.procedures.length > 0 && (
        <div className="mt-2 flex items-start gap-2 flex-wrap text-xs">
          <span className="text-ink-300 font-semibold uppercase text-[10px] mt-0.5">
            Procedures:
          </span>
          {synopsis.procedures.map((p) => (
            <span
              key={p}
              className="bg-bone-0 border border-bone-300 text-ink-200 px-2 py-0.5 rounded-full"
            >
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "good" | "bad";
}) {
  const valueCls =
    accent === "good" ? "text-good" : accent === "bad" ? "text-bad" : "text-ink-100";
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-md px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-300">{label}</div>
      <div className={`text-xs font-bold ${valueCls} truncate`} title={value}>
        {value}
      </div>
    </div>
  );
}
