import clsx from "clsx";
import type { ActivityEvent } from "@/lib/types";

const dotTone = {
  neutral: "bg-ink-300",
  good:    "bg-good",
  warn:    "bg-warn",
  bad:     "bg-bad",
};

export default function ActivityStream({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg">
      <div className="px-4 py-3 border-b border-bone-300">
        <h3 className="text-sm font-bold text-ink-100">Recent activity</h3>
        <p className="text-xs text-ink-300">Across the hospital · last 4 hours</p>
      </div>
      <ul className="divide-y divide-bone-300">
        {events.map((e) => (
          <li key={e.id} className="px-4 py-3 flex items-start gap-3 text-sm">
            <span className={clsx("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", dotTone[e.tone ?? "neutral"])} />
            <div className="flex-1 min-w-0">
              <div className="text-ink-200">{e.text}</div>
              <div className="text-[10px] text-ink-300 mt-0.5">
                {e.actor && <span className="font-semibold mr-1">{e.actor}</span>}
                · {e.ts}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
