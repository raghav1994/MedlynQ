import clsx from "clsx";
import type { ChecklistEntry } from "@/lib/checklist";
import { summaryByStage } from "@/lib/checklist";
import StageProgress from "./StageProgress";
import type { Stage } from "@/lib/types";

const stageLabels: Record<Stage, string> = {
  pre_auth:  "Pre-Authorization",
  mid_way:   "Mid-Way (during treatment)",
  discharge: "Discharge & Claim",
};

const statusStyle = {
  present:        { dot: "bg-good",  card: "border-good/30",   tag: "" },
  low_confidence: { dot: "bg-warn",  card: "border-warn/40",   tag: "LOW CONF" },
  missing:        { dot: "bg-bad",   card: "border-bad/40",    tag: "MISSING" },
};

export default function ChecklistValidation({
  entries, currentStage,
}: {
  entries: ChecklistEntry[];
  currentStage: Stage;
}) {
  const perStage = summaryByStage(entries);
  const stages: Stage[] = ["pre_auth", "mid_way", "discharge"];

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4 mt-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-bold text-ink-100 flex items-center gap-2">
          <span>✓</span> Checklist &amp; Lynq Validation
        </h3>
        <div className="flex items-center gap-3 text-[10px]">
          <Legend dot="bg-good" label={`Present (${entries.filter(e=>e.status==="present").length})`} />
          <Legend dot="bg-warn" label={`Low confidence (${entries.filter(e=>e.status==="low_confidence").length})`} />
          <Legend dot="bg-bad"  label={`Missing (${entries.filter(e=>e.status==="missing").length})`} />
        </div>
      </div>

      {/* Stage progress bar */}
      <StageProgress currentStage={currentStage} perStage={perStage} />

      {stages.map((s) => {
        const items = entries.filter((e) => e.stage === s);
        if (items.length === 0) return null;
        const isCurrent = s === currentStage;
        const missing = items.filter((e) => e.status === "missing").length;
        const present = items.filter((e) => e.status === "present").length;

        return (
          <section key={s} className={clsx(
            "mb-4 last:mb-0 rounded-lg p-3 border",
            isCurrent ? "border-accent bg-accent-soft/40" : "border-bone-300"
          )}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className={clsx("text-xs font-bold uppercase tracking-wide",
                  isCurrent ? "text-accent" : "text-ink-300"
                )}>{stageLabels[s]}</span>
                {isCurrent && (
                  <span className="text-[9px] font-bold uppercase bg-accent text-white px-1.5 py-0.5 rounded">
                    YOU ARE HERE
                  </span>
                )}
              </div>
              <div className="text-[11px] text-ink-300">
                <span className="text-good font-semibold">{present}</span>
                <span> / {items.length} present</span>
                {missing > 0 && <span className="text-bad font-semibold"> · {missing} missing</span>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {items.map((item) => {
                const st = statusStyle[item.status];
                return (
                  <div key={item.doc_type} className={clsx("border rounded p-3 bg-bone-0 flex items-start gap-2", st.card)}>
                    <span className={clsx("w-2.5 h-2.5 rounded-full mt-1 shrink-0", st.dot)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink-100">{item.doc_type}</div>
                      {item.status === "missing" ? (
                        <button className="mt-1 text-[10px] font-bold uppercase text-bad hover:underline">
                          Request Document →
                        </button>
                      ) : (
                        <div className="text-[10px] text-ink-300 mt-0.5">
                          Updated <span className="font-mono">{item.updated}</span> · Source <span className="font-mono">{item.source}</span>
                        </div>
                      )}
                    </div>
                    {st.tag && (
                      <span className={clsx(
                        "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded",
                        item.status === "low_confidence" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"
                      )}>{st.tag}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="flex items-center gap-1 text-ink-300">
      <span className={clsx("w-2 h-2 rounded-full", dot)} />
      <span>{label}</span>
    </div>
  );
}
