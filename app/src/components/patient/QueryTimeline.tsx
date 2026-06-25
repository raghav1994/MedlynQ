import clsx from "clsx";
import type { QueryRound } from "@/lib/mockQueries";
import DeadlineCountdown from "../DeadlineCountdown";

function rupees(n: number) {
  return "₹" + n.toLocaleString("en-IN");
}

const statusStyle = {
  open:      { label: "OPEN",      cls: "bg-bad-soft text-bad border-bad" },
  responded: { label: "RESPONDED", cls: "bg-warn-soft text-warn border-warn" },
  resolved:  { label: "RESOLVED",  cls: "bg-good-soft text-good border-good" },
};

const typeLabel: Record<string, string> = {
  missing_doc: "Missing document",
  code_mismatch: "Code mismatch",
  clinical_elab: "Clinical elaboration",
  date_inconsist: "Date inconsistency",
  post_op_hpe: "Post-op HPE request",
};

export default function QueryTimeline({ rounds }: { rounds: QueryRound[] }) {
  if (rounds.length === 0) {
    return <div className="text-sm text-ink-300 italic">No queries on this case yet.</div>;
  }

  return (
    <ol className="relative border-l-2 border-bone-300 ml-2 space-y-6">
      {rounds.map((r) => {
        const s = statusStyle[r.status];
        const hasDeadline = r.status === "open" && r.deadline_days_total !== undefined && r.days_since_raised !== undefined;
        return (
          <li key={r.id} className="ml-6 relative">
            <span className="absolute -left-[33px] top-1 w-4 h-4 rounded-full bg-bad border-2 border-bone-0" />

            <div className="bg-bone-0 border border-bone-300 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-bad-soft border-b border-bone-300 flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="font-bold uppercase tracking-wide text-bad">Query #{r.round}</span>
                    <span className="text-ink-300">·</span>
                    <span className="text-ink-200">{r.raised_on}</span>
                    <span className="text-ink-300">·</span>
                    <span className="text-ink-200">{r.raised_by}</span>
                    {r.query_type && (
                      <>
                        <span className="text-ink-300">·</span>
                        <span className="bg-bone-0 border border-bone-300 text-ink-200 px-1.5 py-0.5 rounded">
                          {typeLabel[r.query_type] ?? r.query_type}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="font-mono text-sm text-ink-100 mt-2 leading-snug">
                    "{r.raw_text}"
                  </p>
                </div>
                <div className="text-right text-xs">
                  <span className={clsx("inline-block border px-2 py-0.5 rounded text-[10px] font-bold uppercase", s.cls)}>
                    {s.label}
                  </span>
                  <div className="text-ink-300 mt-1">at stake</div>
                  <div className="font-bold text-ink-100 tabular-nums">{rupees(r.amount_at_stake)}</div>
                </div>
              </div>

              {/* Deadline countdown for open queries */}
              {hasDeadline && (
                <div className="px-4 py-3 bg-bone-100 border-b border-bone-300">
                  <div className="flex items-center gap-2 text-xs text-ink-300 mb-2">
                    <span>⏳</span>
                    <span className="font-bold uppercase tracking-wide">
                      {r.awaiting_doc_type ?? "Response"} expected
                    </span>
                  </div>
                  <DeadlineCountdown
                    totalDays={r.deadline_days_total!}
                    daysSinceRaised={r.days_since_raised!}
                  />
                  {r.query_type === "post_op_hpe" && (
                    <p className="text-[11px] text-ink-300 mt-2 leading-snug">
                      Post-op histopathology typically takes 7–10 days to return from the lab.
                      Lynq will nudge daily once the lab is contacted.
                    </p>
                  )}
                </div>
              )}

              {r.response ? (
                <div className="px-4 py-3 border-l-4 border-good">
                  <div className="flex items-center gap-2 text-xs text-ink-300 mb-1">
                    <span className="w-2 h-2 rounded-full bg-good" />
                    <span className="font-bold uppercase tracking-wide text-good">Our response</span>
                    <span>·</span>
                    <span>{r.response.sent_on}</span>
                    {r.response.drafted_by && <><span>·</span><span>by {r.response.drafted_by}</span></>}
                  </div>
                  <p className="text-sm text-ink-200 leading-snug">{r.response.text}</p>

                  {r.response.attached_doc_filenames.length > 0 && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Attached:</span>
                      {r.response.attached_doc_filenames.map((f) => (
                        <span key={f} className="text-[11px] font-mono bg-bone-100 border border-bone-300 text-ink-200 px-2 py-0.5 rounded">
                          📎 {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : !hasDeadline && (
                <div className="px-4 py-3 bg-bone-100 border-l-4 border-bad text-xs text-ink-300 italic">
                  No response sent yet — clerk action needed.
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
