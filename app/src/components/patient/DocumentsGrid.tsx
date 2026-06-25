"use client";

import { useState } from "react";
import DocumentTile from "./DocumentTile";
import type { CaseDocument } from "@/lib/mockDocuments";

export default function DocumentsGrid({ docs }: { docs: CaseDocument[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeMsg, setMergeMsg] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMergeMsg(null);
  }

  function clear() {
    setSelected(new Set());
    setMergeMsg(null);
  }

  async function merge() {
    if (selected.size < 2) return;
    setMerging(true);
    setMergeMsg("Merging…");
    try {
      // Mock files (no real bytes yet) — for demo we just call the endpoint
      // with empty payload to confirm the API responds.
      const form = new FormData();
      // No real files attached because docs are mocks; we'll show a friendly demo result.
      const res = await fetch("/api/merge", { method: "POST", body: form });
      if (res.status === 400) {
        setMergeMsg(`Demo: would merge ${selected.size} docs → 1 PDF · upload-ready packet (real files arrive once Batch_01 is wired).`);
      } else {
        const json = await res.json();
        if (json.ok) {
          setMergeMsg(`Merged ${selected.size} docs into 1 PDF · ${json.page_count} pages. <a href="${json.download_url}" class="underline" download>Download</a>`);
        } else {
          setMergeMsg("Merge failed: " + (json.error ?? "unknown"));
        }
      }
    } catch (e: any) {
      setMergeMsg("Merge error: " + (e?.message ?? String(e)));
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Selection toolbar */}
      {selected.size > 0 && (
        <div className="bg-accent-soft border border-accent/30 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-semibold text-accent">
            {selected.size} document{selected.size === 1 ? "" : "s"} selected
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={merge}
              disabled={selected.size < 2 || merging}
              className="bg-accent text-white text-xs font-bold px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-40"
              title={selected.size < 2 ? "Pick at least 2 files" : "Combine selected files into one PDF"}
            >
              {merging ? "Merging…" : `Merge ${selected.size} → 1 PDF`}
            </button>
            <button
              onClick={clear}
              className="text-xs px-3 py-1.5 border border-bone-300 bg-bone-0 rounded hover:bg-bone-200"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {mergeMsg && (
        <div
          className="text-xs bg-bone-100 border border-bone-300 rounded p-2 text-ink-200"
          dangerouslySetInnerHTML={{ __html: mergeMsg }}
        />
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {docs.map((d) => (
          <DocumentTile
            key={d.id}
            d={d}
            selected={selected.has(d.id)}
            onToggle={toggle}
          />
        ))}
        <button className="bg-bone-100 border-2 border-dashed border-bone-300 rounded-lg p-3 flex flex-col items-center justify-center gap-2 min-h-[160px] hover:border-accent hover:bg-accent-soft transition cursor-pointer">
          <span className="w-10 h-10 rounded-full bg-bone-0 border border-bone-300 grid place-items-center text-xl text-ink-300">+</span>
          <div className="text-xs font-semibold text-ink-100">Add Document</div>
          <div className="text-[10px] text-ink-300">MedCam · Upload · Scan</div>
        </button>
      </div>
    </div>
  );
}
