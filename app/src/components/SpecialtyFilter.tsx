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

export default function SpecialtyFilter({ cases }: { cases: ResolvedCase[] }) {
  const [sel, setSel] = useState<Specialty | "all">("all");

  const counts: Record<Specialty | "all", number> = {
    all: cases.length,
    oncology: 0, cardiac: 0, ortho: 0, dialysis: 0, icu: 0, maternity: 0,
  };
  for (const c of cases) counts[specialtyOf(c)]++;

  const filtered = sel === "all" ? cases : cases.filter((c) => specialtyOf(c) === sel);

  const chips: Array<{ key: Specialty | "all"; label: string; icon: string }> = [
    { key: "all", label: "All specialties", icon: "🏥" },
    ...(Object.keys(SPECIALTY_META) as Specialty[]).map((s) => ({
      key: s, label: SPECIALTY_META[s].label, icon: SPECIALTY_META[s].icon,
    })),
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
      <PatientTable cases={filtered} />
    </div>
  );
}
