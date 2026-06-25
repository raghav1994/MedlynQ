import clsx from "clsx";

// Aging pill now also surfaces a countdown to red-zone (21 days).
// At 21+ days: "RED ZONE" badge instead.
export default function AgingPill({ days }: { days: number }) {
  const RED_ZONE = 21;
  const remaining = RED_ZONE - days;

  if (days >= RED_ZONE) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-bad text-white animate-pulse">
        RED ZONE · {days}d
      </span>
    );
  }
  if (days >= 15) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-warn-soft text-warn">
        <span>{days}d</span>
        <span className="text-warn font-bold">· {remaining}d left</span>
      </span>
    );
  }
  if (days >= 7) {
    return (
      <span className={clsx("inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-bone-200 text-ink-200")}>
        {days}d
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-good-soft text-good">
      {days}d · fresh
    </span>
  );
}
