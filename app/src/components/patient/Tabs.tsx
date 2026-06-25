"use client";

import { useState } from "react";
import clsx from "clsx";
import type { Case, Stage } from "@/lib/types";
import type { CaseDocument } from "@/lib/mockDocuments";
import type { ChecklistEntry } from "@/lib/checklist";
import DocumentsGrid from "./DocumentsGrid";
import ChecklistValidation from "./ChecklistValidation";
import FinancialsTab from "./FinancialsTab";
import QueryBoard from "./QueryBoard";

type TabKey = "docs" | "fin" | "query";

export default function Tabs({
  c, docs, checklist, currentStage,
}: {
  c: Case;
  docs: CaseDocument[];
  checklist: ChecklistEntry[];
  currentStage: Stage;
}) {
  const [tab, setTab] = useState<TabKey>("docs");

  const items: { key: TabKey; label: string; badge?: number }[] = [
    { key: "docs",  label: "Documents & Images", badge: docs.length },
    { key: "fin",   label: "Financials & Codes" },
    { key: "query", label: "Query Board", badge: c.open_queries || undefined },
  ];

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg">
      <div className="border-b border-bone-300 px-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {items.map((it) => (
            <button
              key={it.key}
              onClick={() => setTab(it.key)}
              className={clsx(
                "px-4 py-3 text-sm font-semibold border-b-2 -mb-px flex items-center gap-2",
                tab === it.key ? "border-ink-100 text-ink-100" : "border-transparent text-ink-300 hover:text-ink-200"
              )}
            >
              {it.label}
              {it.badge !== undefined && (
                <span className={clsx(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  tab === it.key ? "bg-warn-soft text-warn" : "bg-bone-200 text-ink-300"
                )}>
                  {it.badge}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 py-2">
          <button className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">⛌ Filter</button>
          <button className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">↓ Download All</button>
        </div>
      </div>

      <div className="p-4">
        {tab === "docs"  && <DocumentsGrid docs={docs} />}
        {tab === "fin"   && <FinancialsTab c={c} />}
        {tab === "query" && <QueryBoard c={c} docs={docs} />}
      </div>

      {tab === "docs" && <ChecklistValidation entries={checklist} currentStage={currentStage} />}
    </div>
  );
}
