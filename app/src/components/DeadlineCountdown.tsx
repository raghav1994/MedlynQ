import clsx from "clsx";

// Visual countdown for query response deadlines (e.g. 15 days for post-op HPE).
// Shows days remaining + a tone band: green > 7d, amber 4-7d, red 0-3d, RED ZONE if past due.

export default function DeadlineCountdown({
  totalDays, daysSinceRaised, compact = false,
}: {
  totalDays: number;
  daysSinceRaised: number;
  compact?: boolean;
}) {
  const remaining = totalDays - daysSinceRaised;
  const pastDue = remaining < 0;

  let tone: "good" | "warn" | "bad";
  let label: string;
  if (pastDue) {
    tone = "bad";
    label = `OVERDUE · ${Math.abs(remaining)}d late`;
  } else if (remaining <= 3) {
    tone = "bad";
    label = remaining === 0 ? "DUE TODAY" : `${remaining}d left`;
  } else if (remaining <= 7) {
    tone = "warn";
    label = `${remaining}d left`;
  } else {
    tone = "good";
    label = `${remaining}d left`;
  }

  const toneCls = {
    good: "bg-good-soft text-good border-good/40",
    warn: "bg-warn-soft text-warn border-warn/40",
    bad:  "bg-bad-soft text-bad border-bad/40",
  }[tone];

  if (compact) {
    return (
      <span className={clsx("inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border", toneCls, pastDue && "animate-pulse")}>
        {label}
      </span>
    );
  }

  // Full progress bar
  const pct = Math.min(100, Math.round((daysSinceRaised / totalDays) * 100));
  const barTone = {
    good: "bg-good",
    warn: "bg-warn",
    bad:  "bg-bad",
  }[tone];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-ink-300">
          Payer deadline: <span className="font-semibold text-ink-200">{totalDays} days</span> ·
          raised <span className="font-semibold text-ink-200">{daysSinceRaised}d</span> ago
        </span>
        <span className={clsx("font-bold uppercase text-[10px] px-2 py-0.5 rounded border", toneCls, pastDue && "animate-pulse")}>
          {label}
        </span>
      </div>
      <div className="h-1.5 bg-bone-200 rounded-full overflow-hidden">
        <div className={clsx("h-full transition-all", barTone)} style={{ width: pct + "%" }} />
      </div>
    </div>
  );
}
