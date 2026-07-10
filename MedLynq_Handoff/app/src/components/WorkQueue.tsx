import Link from "next/link";
import clsx from "clsx";
import { caseById, patientName, folderKey } from "@/lib/mockData";
import type { WorkQueueGroup } from "@/lib/types";
import StatusBadge from "./StatusBadge";
import AgingPill from "./AgingPill";

const toneRibbon = {
  bad:     "bg-bad-soft text-bad border-l-4 border-bad",
  warn:    "bg-warn-soft text-warn border-l-4 border-warn",
  accent:  "bg-accent-soft text-accent border-l-4 border-accent",
  neutral: "bg-bone-200 text-ink-200 border-l-4 border-bone-300",
};

function rupees(n: number | null) {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

// Smart sort: priority score = (₹ × aging) / 100k. Higher = act first.
function priorityScore(amount: number, ageDays: number) {
  return Math.round((amount * Math.max(ageDays, 1)) / 100000);
}

export default function WorkQueue({ groups }: { groups: WorkQueueGroup[] }) {
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        // sort cases by priority score desc within each group
        const sorted = [...g.case_ids].sort((a, b) => {
          const ca = caseById(a);
          const cb = caseById(b);
          if (!ca || !cb) return 0;
          return priorityScore(cb.claimed_amount, cb.age_days) - priorityScore(ca.claimed_amount, ca.age_days);
        });

        return (
          <div key={g.title} className="bg-bone-0 border border-bone-300 rounded-lg overflow-hidden">
            <div className={clsx("px-4 py-3 flex items-center justify-between", toneRibbon[g.tone])}>
              <div>
                <div className="text-sm font-bold">{g.title}</div>
                <div className="text-xs opacity-80">{g.hint}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs font-bold">{sorted.length} case{sorted.length === 1 ? "" : "s"}</div>
                {sorted.length > 0 && (
                  <button className="text-[10px] uppercase font-bold bg-bone-0 px-2 py-1 rounded border border-current hover:opacity-80">
                    Handle all
                  </button>
                )}
              </div>
            </div>
            <ul className="divide-y divide-bone-300">
              {sorted.length === 0 && (
                <li className="px-4 py-3 text-sm text-ink-300">Nothing here — clean.</li>
              )}
              {sorted.map((id, idx) => {
                const c = caseById(id);
                if (!c) return null;
                const score = priorityScore(c.claimed_amount, c.age_days);
                return (
                  <li key={id} className="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-bone-100">
                    {idx === 0 && (
                      <span className="bg-accent text-white text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" title={`Highest priority score: ${score}`}>
                        TOP
                      </span>
                    )}
                    <Link
                      href={`/patient/${c.patient_id}?case=${c.id}`}
                      className="flex-1 min-w-0 flex items-center gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-ink-100 truncate">{patientName(c.patient_id)}</div>
                        <div className="text-xs text-ink-300 font-mono truncate">{folderKey(c.patient_id)}</div>
                      </div>
                      <div className="hidden md:block text-xs text-ink-200 w-28 truncate" title={c.procedure_name}>
                        {c.procedure_code}
                      </div>
                      <div className="hidden md:block text-xs text-ink-300 w-24 text-right tabular-nums">{rupees(c.claimed_amount)}</div>
                      <AgingPill days={c.age_days} />
                      <StatusBadge status={c.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
