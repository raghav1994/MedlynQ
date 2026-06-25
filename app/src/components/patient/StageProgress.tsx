import clsx from "clsx";
import type { Stage } from "@/lib/types";

const STAGES: { key: Stage; label: string }[] = [
  { key: "pre_auth",  label: "Pre-Auth" },
  { key: "mid_way",   label: "Mid-Way (Treatment)" },
  { key: "discharge", label: "Discharge & Claim" },
];

export default function StageProgress({
  currentStage,
  perStage,
}: {
  currentStage: Stage;
  perStage: { stage: Stage; present: number; total: number; missing: number }[];
}) {
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-3 mb-3">
      <div className="flex items-center gap-3 flex-wrap">
        {STAGES.map((s, i) => {
          const info = perStage.find((p) => p.stage === s.key);
          const isCurrent = s.key === currentStage;
          const pct = info && info.total > 0 ? Math.round((info.present / info.total) * 100) : 0;
          const isComplete = info && info.missing === 0 && info.total > 0;
          return (
            <div key={s.key} className="flex items-center gap-3 flex-1 min-w-[180px]">
              <div className={clsx(
                "w-8 h-8 rounded-full grid place-items-center text-xs font-bold shrink-0",
                isComplete ? "bg-good text-white"
                  : isCurrent ? "bg-accent text-white"
                  : "bg-bone-200 text-ink-300"
              )}>
                {isComplete ? "✓" : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className={clsx(
                  "text-xs font-semibold uppercase tracking-wide",
                  isCurrent ? "text-accent" : isComplete ? "text-good" : "text-ink-300"
                )}>
                  {s.label}
                  {isCurrent && <span className="ml-1 text-[10px] normal-case">· you are here</span>}
                </div>
                <div className="text-xs text-ink-300">
                  {info ? `${info.present}/${info.total} docs · ${pct}%` : "—"}
                </div>
                <div className="h-1 bg-bone-200 rounded-full mt-1 overflow-hidden">
                  <div className={clsx(
                    "h-full transition-all",
                    isComplete ? "bg-good" : isCurrent ? "bg-accent" : "bg-bone-300"
                  )} style={{ width: pct + "%" }} />
                </div>
              </div>
              {i < STAGES.length - 1 && (
                <div className="hidden md:block w-6 h-[2px] bg-bone-200 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
