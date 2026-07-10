import clsx from "clsx";
import type { Case } from "@/lib/types";

type Step = { label: string; date: string; done: boolean };

function buildSteps(c: Case): Step[] {
  const status = c.status;
  const adm = formatDate(c.admission_date);
  const dis = c.discharge_date ? formatDate(c.discharge_date) : "—";

  return [
    { label: "Payment Received",  date: status === "paid" ? formatDate(c.discharge_date ?? c.admission_date) : "—",
      done: status === "paid" },
    { label: "Final Approval",    date: ["approved", "paid"].includes(status) ? dis : "—",
      done: ["approved", "paid"].includes(status) },
    { label: "Lynq AI Validation", date: dis !== "—" ? dis : adm,
      done: !["preauth_pending", "admitted"].includes(status) },
    { label: "Case Initiated",    date: adm, done: true },
  ];
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
}

export default function CaseTimeline({ c }: { c: Case }) {
  const steps = buildSteps(c);
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
      <h3 className="text-sm font-bold text-ink-100 mb-3 flex items-center gap-2">
        <span>🕒</span> Case Timeline
      </h3>
      <ul className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className={clsx(
              "w-2.5 h-2.5 rounded-full mt-1.5 shrink-0",
              s.done ? "bg-good" : "bg-bone-300"
            )} />
            <div className="flex-1">
              <div className={clsx("font-semibold", s.done ? "text-ink-100" : "text-ink-300")}>{s.label}</div>
              <div className="text-[11px] text-ink-300">{s.date}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 pt-3 border-t border-bone-300 flex justify-between text-xs">
        <span className="text-ink-300 uppercase tracking-wide font-semibold">Case TAT</span>
        <span className="font-bold text-ink-100">{c.tat_days} Days</span>
      </div>
    </div>
  );
}
