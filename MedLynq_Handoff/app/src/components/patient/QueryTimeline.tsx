import clsx from "clsx";
import type { QueryRound } from "@/lib/mockQueries";
import DeadlineCountdown from "../DeadlineCountdown";

function rupees(n: number) {
  return "₹" + n.toLocaleString("en-IN");
}

const statusStyle = {
  open:      { label: "OPEN",         cls: "bg-bad-soft text-bad border-bad" },
  responded: { label: "RESPONDED",    cls: "bg-warn-soft text-warn border-warn" },
  resolved:  { label: "RESOLVED",     cls: "bg-good-soft text-good border-good" },
  rejected:  { label: "DISAPPROVED",  cls: "bg-bad-soft text-bad border-bad" },
};

const stageLabel: Record<string, { label: string; tone: string }> = {
  pre_auth:  { label: "Pre-Auth",  tone: "bg-bone-200 text-ink-200" },
  approval:  { label: "Approval",  tone: "bg-warn-soft text-warn" },
  mid_way:   { label: "Mid-way",   tone: "bg-accent-soft text-accent" },
  discharge: { label: "Discharge", tone: "bg-bone-200 text-ink-200" },
  claim:     { label: "Claim",     tone: "bg-bone-200 text-ink-200" },
};

// Only the query_type values actually produced anywhere (QueryBoard's
// matcher, the NHCX-auto-created round, and the seeded fixtures) — trimmed
// from a longer list that included types nothing ever set.
const typeLabel: Record<string, string> = {
  missing_doc: "Missing document",
  post_op_hpe: "Post-op HPE request",
};

export default function QueryTimeline({
  rounds,
  onResolve,
  resolvingId,
  onDownload,
  downloading,
}: {
  rounds: QueryRound[];
  onResolve?: (roundId: string) => void;
  resolvingId?: string | null;
  onDownload?: (filenames: string[], zipName: string) => void;
  downloading?: boolean;
}) {
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
                    {r.stage && stageLabel[r.stage] && (
                      <span className={clsx("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded", stageLabel[r.stage].tone)}>
                        {stageLabel[r.stage].label} stage
                      </span>
                    )}
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
                      {onDownload && (
                        <button
                          onClick={() => onDownload(r.response!.attached_doc_filenames, `query_round${r.round}_documents.zip`)}
                          disabled={downloading}
                          className="text-[11px] font-semibold px-2 py-0.5 border border-bone-300 rounded hover:bg-bone-200 disabled:opacity-40"
                        >
                          ↓ Download
                        </button>
                      )}
                    </div>
                  )}

                  {r.status === "responded" && onResolve && (
                    <button
                      onClick={() => onResolve(r.id)}
                      disabled={resolvingId === r.id}
                      className="mt-3 text-xs font-semibold px-3 py-1.5 bg-good text-white rounded hover:opacity-90 disabled:opacity-40"
                    >
                      {resolvingId === r.id ? "Marking resolved…" : "Mark payer accepted · Resolve"}
                    </button>
                  )}
                </div>
              ) : !hasDeadline && (
                <div className="px-4 py-3 bg-bone-100 border-l-4 border-bad text-xs text-ink-300 italic">
                  No response sent yet — clerk action needed.
                </div>
              )}

              {r.status === "rejected" && (
                <div className="px-4 py-3 bg-bad-soft border-t border-bad/40">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-xs font-bold text-bad">✗ Scheme disapproved this round</div>
                      <div className="text-[11px] text-ink-300">
                        All queries exhausted. Pick the next step: appeal, switch scheme, or counsel cash.
                      </div>
                    </div>
                    <a href="#disapproval-action" className="text-xs font-semibold px-3 py-1.5 bg-bad text-white rounded hover:opacity-90">
                      Pick rejection path →
                    </a>
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
