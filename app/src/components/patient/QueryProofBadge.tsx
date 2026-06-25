import type { QueryProofScore } from "@/lib/queryProof";

export default function QueryProofBadge({ score }: { score: QueryProofScore }) {
  const toneCls = {
    good: { wrap: "border-good/40 bg-good-soft", bar: "bg-good", text: "text-good" },
    warn: { wrap: "border-warn/40 bg-warn-soft", bar: "bg-warn", text: "text-warn" },
    bad: { wrap: "border-bad/40 bg-bad-soft", bar: "bg-bad", text: "text-bad" },
  }[score.tone];

  return (
    <div className={`border rounded-lg p-3 ${toneCls.wrap}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-2xl font-bold tabular-nums ${toneCls.text}`}>{score.pct}%</span>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink-100">
              {score.label}
            </div>
            <div className="text-[10px] text-ink-300">Query-proof score</div>
          </div>
        </div>
      </div>
      <div className="h-1.5 bg-bone-200 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full transition-all ${toneCls.bar}`}
          style={{ width: `${score.pct}%` }}
        />
      </div>
      {score.issues.length > 0 && (
        <ul className="space-y-1 mt-2">
          {score.issues.map((iss) => (
            <li key={iss.id} className="text-[11px] flex items-start gap-1.5">
              <span
                className={
                  iss.severity === "bad"
                    ? "text-bad"
                    : iss.severity === "warn"
                    ? "text-warn"
                    : "text-ink-300"
                }
              >
                {iss.severity === "bad" ? "✗" : iss.severity === "warn" ? "⚠" : "•"}
              </span>
              <span className="flex-1">
                <span className="text-ink-100 font-medium">{iss.message}</span>
                {iss.fix && (
                  <span className="text-ink-300 italic"> — {iss.fix}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {score.issues.length === 0 && (
        <p className="text-[11px] text-good italic">All checks passed. Safe to submit.</p>
      )}
    </div>
  );
}
