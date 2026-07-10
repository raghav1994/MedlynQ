"use client";

import { useState } from "react";
import type { Case, Specialty } from "@/lib/types";
import { SPECIALTY_META } from "@/lib/types";
import PatientTable from "./PatientTable";

export type ResolvedCase = Case & { _patient_name?: string; _folder_key?: string };

// Default-infer specialty when case doesn't carry it: today's mock corpus is all oncology.
function specialtyOf(c: Case): Specialty {
  return c.specialty ?? "oncology";
}

type StatusFilter =
  | "all"
  | "awaiting_approval"
  | "approval_received"
  | "rejected"
  | "cash"
  | "auto_closed"
  | "successful";

export default function SpecialtyFilter({ cases }: { cases: ResolvedCase[] }) {
  const [sel, setSel] = useState<Specialty | "all">("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const counts: Record<Specialty | "all", number> = {
    all: cases.length,
    oncology: 0, cardiac: 0, ortho: 0, dialysis: 0, icu: 0, maternity: 0,
  };
  for (const c of cases) counts[specialtyOf(c)]++;

  const statusCounts = {
    awaiting_approval: cases.filter((c) => c.status === "awaiting_approval").length,
    approval_received: cases.filter((c) => c.status === "approval_received").length,
    rejected: cases.filter((c) => c.status === "rejected").length,
    cash: cases.filter((c) => c.status === "cash").length,
    auto_closed: cases.filter((c) => c.status === "auto_closed").length,
    successful: cases.filter((c) => c.status === "successful" || c.status === "paid").length,
  };

  const filtered = cases
    .filter((c) => sel === "all" ? true : specialtyOf(c) === sel)
    .filter((c) => status === "all" ? true : c.status === status);

  const chips: Array<{ key: Specialty | "all"; label: string; icon: string }> = [
    { key: "all", label: "All specialties", icon: "🏥" },
    ...(Object.keys(SPECIALTY_META) as Specialty[]).map((s) => ({
      key: s, label: SPECIALTY_META[s].label, icon: SPECIALTY_META[s].icon,
    })),
  ];

  const statusChips: Array<{ key: StatusFilter; label: string; icon: string; count: number; tone: string }> = [
    { key: "all", label: "All", icon: "📋", count: cases.length, tone: "ink" },
    { key: "awaiting_approval", label: "Awaiting approval", icon: "⏳", count: statusCounts.awaiting_approval, tone: "warn" },
    { key: "approval_received", label: "Approval received", icon: "✅", count: statusCounts.approval_received, tone: "good" },
    { key: "rejected", label: "Rejected", icon: "✗", count: statusCounts.rejected, tone: "bad" },
    { key: "cash", label: "Cash", icon: "💵", count: statusCounts.cash, tone: "ink" },
    { key: "auto_closed", label: "Auto-closed", icon: "📁", count: statusCounts.auto_closed, tone: "ink" },
    { key: "successful", label: "Successful", icon: "✓", count: statusCounts.successful, tone: "good" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setSel(c.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
              sel === c.key
                ? "bg-accent text-white border-accent"
                : "bg-bone-0 text-ink-200 border-bone-300 hover:bg-bone-200"
            }`}
          >
            <span className="mr-1">{c.icon}</span>
            {c.label}
            <span className={`ml-1 text-[10px] ${sel === c.key ? "text-white/80" : "text-ink-300"}`}>
              {counts[c.key]}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Status:</span>
        {statusChips.map((c) => {
          const active = status === c.key;
          const cls = active
            ? c.tone === "warn" ? "bg-warn text-white border-warn"
            : c.tone === "good" ? "bg-good text-white border-good"
            : c.tone === "bad"  ? "bg-bad  text-white border-bad"
            : "bg-ink-100 text-white border-ink-100"
            : "bg-bone-0 text-ink-200 border-bone-300 hover:bg-bone-200";
          return (
            <button key={c.key} onClick={() => setStatus(c.key)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${cls}`}>
              <span className="mr-1">{c.icon}</span>{c.label}
              <span className={`ml-1 text-[10px] ${active ? "text-white/80" : "text-ink-300"}`}>{c.count}</span>
            </button>
          );
        })}
      </div>
      <PatientTable cases={filtered} />
    </div>
  );
}
