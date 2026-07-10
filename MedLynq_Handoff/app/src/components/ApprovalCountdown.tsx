// Hours-based countdown for awaiting-approval cases (Ayushman + FCI).
// Two clocks:
//   1. Pre-approval clock (started when MEDCO sent the bundle) — typical resolution 2h–24h
//   2. Approval-validity clock (started when letter received) — 14 days to admit

import clsx from "clsx";

export default function ApprovalCountdown({
  mode,
  hoursElapsed,
  expectedHours,
  caseLabel,
}: {
  mode: "awaiting_approval" | "approval_received";
  hoursElapsed: number;
  expectedHours: number;   // SLA: 24h for Ayushman/FCI; 14d = 336h for validity
  caseLabel?: string;
}) {
  const remaining = expectedHours - hoursElapsed;
  const pastDue = remaining < 0;
  const pct = Math.min(100, Math.round((hoursElapsed / expectedHours) * 100));

  const tone =
    pastDue || remaining <= expectedHours * 0.15 ? "bad" :
    remaining <= expectedHours * 0.35 ? "warn" : "good";

  const toneCls = {
    good: { wrap: "bg-good-soft border-good/40", bar: "bg-good", text: "text-good" },
    warn: { wrap: "bg-warn-soft border-warn/40", bar: "bg-warn", text: "text-warn" },
    bad:  { wrap: "bg-bad-soft border-bad/40",   bar: "bg-bad",  text: "text-bad" },
  }[tone];

  const label = pastDue
    ? `OVERDUE · ${formatHours(Math.abs(remaining))} late`
    : `${formatHours(remaining)} remaining`;

  const heading = mode === "awaiting_approval"
    ? "⏳ Awaiting approval"
    : "📋 Approval received — admit before expiry";

  return (
    <div className={`border rounded-lg p-3 space-y-1.5 ${toneCls.wrap}`}>
      <div className="flex items-center justify-between text-[11px]">
        <div className="font-bold text-ink-100">{heading}</div>
        <span className={clsx("font-bold uppercase text-[10px] px-2 py-0.5 rounded border", toneCls.text, pastDue && "animate-pulse")}>
          {label}
        </span>
      </div>
      <div className="h-1.5 bg-bone-200 rounded-full overflow-hidden">
        <div className={clsx("h-full transition-all", toneCls.bar)} style={{ width: pct + "%" }} />
      </div>
      <div className="flex justify-between text-[10px] text-ink-300">
        <span>elapsed {formatHours(hoursElapsed)}</span>
        <span>SLA {formatHours(expectedHours)}</span>
      </div>
      {caseLabel && (
        <div className="text-[10px] text-ink-300 italic pt-1 border-t border-bone-300">
          {caseLabel}
        </div>
      )}
    </div>
  );
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
