import type { Stage } from "@/lib/types";

const STEPS: { key: Stage; label: string }[] = [
  { key: "opd", label: "OPD" },
  { key: "pre_auth", label: "Pre-Auth" },
  { key: "mid_way", label: "Mid-way" },
  { key: "discharge", label: "Discharge" },
];

// Small visual "which stage is this file at" tracker for the MEDCO — separate
// from StatusBadge, which shows the precise (and more technical) ClaimStatus.
export default function StageTracker({ stage }: { stage: Stage }) {
  const currentIdx = STEPS.findIndex((s) => s.key === stage);

  return (
    <div className="flex items-center" title={`Currently at: ${STEPS[currentIdx]?.label}`}>
      {STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <span
                className={
                  "w-2.5 h-2.5 rounded-full " +
                  (active ? "bg-accent ring-2 ring-accent/30" : done ? "bg-good" : "bg-bone-300")
                }
              />
              <span
                className={
                  "text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap " +
                  (active ? "text-accent" : done ? "text-good" : "text-ink-300")
                }
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span className={"w-6 h-px mx-1 mb-3.5 " + (i < currentIdx ? "bg-good" : "bg-bone-300")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
