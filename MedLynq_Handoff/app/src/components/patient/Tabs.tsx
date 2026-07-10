"use client";

import { useState, useEffect } from "react";
import clsx from "clsx";
import type { Case } from "@/lib/types";
import type { CaseDocument } from "@/lib/mockDocuments";
import type { ChecklistEntry } from "@/lib/checklist";
import DocumentChecklist from "./DocumentChecklist";
import FinancialsTab from "./FinancialsTab";
import QueryBoard from "./QueryBoard";

type TabKey = "checklist" | "fin" | "query";

export default function Tabs({
  c, docs, checklist, mrn,
}: {
  c: Case;
  docs: CaseDocument[];
  checklist: ChecklistEntry[];
  mrn: string;
}) {
  const [tab, setTab] = useState<TabKey>("checklist");
  const [downloadingAll, setDownloadingAll] = useState(false);
  // Owned here (not inside DocumentChecklist) so a "Not needed" toggle or a
  // fresh upload survives switching to another tab and back — a component
  // holding this in its own local state resets to the stale server-loaded
  // `checklist` prop every time the tab conditionally unmounts/remounts.
  const [entries, setEntries] = useState(checklist);
  // useState only seeds the initial value — it ignores later prop changes.
  // router.refresh() after an upload/assign re-renders the server component
  // tree with a fresh `checklist` (new doc matches, updated Unsorted tray),
  // but without this the identity/prop-object never reaches `entries`, so a
  // just-assigned doc kept showing "unmatched" until a hard reload. Skip
  // toggles don't call router.refresh(), so this never clobbers an
  // in-flight optimistic skip edit — the prop only actually changes on a
  // real server round-trip.
  useEffect(() => { setEntries(checklist); }, [checklist]);

  const missingCount = entries.filter((e) => e.status === "missing").length;
  const items: { key: TabKey; label: string; badge?: number }[] = [
    { key: "checklist", label: "Documents & Checklist", badge: missingCount || undefined },
    { key: "fin",       label: "Financials & Codes" },
    { key: "query",     label: "Query Board", badge: c.open_queries || undefined },
  ];

  async function downloadAll() {
    if (docs.length === 0 || downloadingAll) return;
    setDownloadingAll(true);
    try {
      const res = await fetch("/api/document/download-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: c.id, filenames: docs.map((d) => d.filename) }),
      });
      if (!res.ok) { alert("Download failed: " + (await res.text())); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${mrn}_all_documents.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert("Download error: " + (e?.message ?? String(e)));
    } finally {
      setDownloadingAll(false);
    }
  }

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
          <button
            onClick={downloadAll}
            disabled={docs.length === 0 || downloadingAll}
            className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200 disabled:opacity-40"
          >
            {downloadingAll ? "Zipping…" : "↓ Download All"}
          </button>
        </div>
      </div>

      <div className="p-4">
        {tab === "checklist" && <DocumentChecklist entries={entries} onEntriesChange={setEntries} docs={docs} caseId={c.id} mrn={mrn} treatment={c.treatment_type} />}
        {tab === "fin"       && <FinancialsTab c={c} />}
        {tab === "query"     && <QueryBoard c={c} docs={docs} />}
      </div>
    </div>
  );
}
