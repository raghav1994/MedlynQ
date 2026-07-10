"use client";

import { useState } from "react";
import clsx from "clsx";
import type { CaseDocument } from "@/lib/mockDocuments";

const sourceTint = {
  MedCam: "bg-accent-soft text-accent",
  HIS: "bg-bone-200 text-ink-200",
  Manual: "bg-warn-soft text-warn",
};

function statusDot(c: CaseDocument) {
  if (c.confidence !== undefined && c.confidence < 0.7) return { color: "bg-warn", label: "Low confidence" };
  return { color: "bg-good", label: "Present" };
}

function fileGlyph(ext: string) {
  if (ext === "pdf") return { label: "PDF", color: "text-bad" };
  if (ext === "png") return { label: "PNG", color: "text-ink-300" };
  return { label: "JPG", color: "text-good" };
}

export default function DocumentTile({
  d,
  selected = false,
  onToggle,
}: {
  d: CaseDocument;
  selected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const dot = statusDot(d);
  const glyph = fileGlyph(d.ext);
  const isImage = d.ext !== "pdf";

  return (
    <div
      className={clsx(
        "bg-bone-0 border rounded-lg p-3 relative hover:border-accent transition cursor-pointer",
        selected ? "border-accent ring-2 ring-accent/30" : "border-bone-300"
      )}
      onClick={() => onToggle?.(d.id)}
    >
      {/* selection checkbox */}
      {onToggle && (
        <span
          className={clsx(
            "absolute top-2 left-2 z-10 w-4 h-4 rounded border grid place-items-center text-[10px] font-bold transition shadow-sm",
            selected ? "bg-accent border-accent text-white" : "bg-bone-0 border-bone-300 text-transparent"
          )}
        >
          ✓
        </span>
      )}

      <span className={clsx("absolute top-2 right-2 w-2.5 h-2.5 rounded-full", dot.color)} title={dot.label} />

      <PdfPreview d={d} isImage={isImage} glyph={glyph} />

      <div className="text-xs font-semibold text-ink-100 truncate mt-2" title={d.doc_type}>{d.doc_type}</div>
      <div className="text-[10px] text-ink-300 truncate" title={d.original_filename}>{d.original_filename}</div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-ink-300">{d.uploaded_at}</span>
        <span className={clsx("text-[10px] font-semibold px-1.5 py-0.5 rounded", sourceTint[d.source])}>{d.source}</span>
      </div>

      <button
        type="button"
        title={`Delete ${d.original_filename}`}
        onClick={async (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete ${d.original_filename}?`)) {
            try {
              const res = await fetch(`/api/document?caseId=${d.case_id}&filename=${encodeURIComponent(d.filename)}`, { method: "DELETE" });
              if (res.ok) window.location.reload();
              else alert("Failed to delete document.");
            } catch (err) { alert("Error deleting document: " + err); }
          }
        }}
        className="absolute bottom-1 right-1 w-5 h-5 grid place-items-center text-xs leading-none opacity-70 hover:opacity-100 transition-opacity"
      >
        🗑️
      </button>
    </div>
  );
}

// Renders the document preview: a real page-1 thumbnail when available,
// otherwise falls back to the original /api/document image (for true images)
// or the static PDF/PNG/JPG glyph.
function PdfPreview({
  d, isImage, glyph,
}: {
  d: CaseDocument;
  isImage: boolean;
  glyph: { label: string; color: string };
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbUrl = `/api/thumb?file=${encodeURIComponent(d.filename)}`;
  // Thumbnails are only ever generated for PDFs (see land/route.ts) — for
  // images, /api/thumb is a guaranteed 404 every render, causing a visible
  // broken-image flash before the fallback below kicks in. Skip straight to
  // the real image instead of re-attempting a request we already know fails.
  const showThumb = !isImage && !thumbFailed;

  return (
    <div className="aspect-[4/3] bg-bone-200 rounded grid place-items-center overflow-hidden relative group">
      {showThumb ? (
        <img
          src={thumbUrl}
          alt={d.doc_type}
          onError={() => setThumbFailed(true)}
          className="w-full h-full object-cover object-top transition-transform duration-200 group-hover:scale-105"
          loading="lazy"
        />
      ) : isImage ? (
        <img
          src={`/api/document?caseId=${d.case_id}&filename=${encodeURIComponent(d.filename)}`}
          alt={d.doc_type}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <span className={clsx("text-2xl font-bold tracking-wide", glyph.color)}>{glyph.label}</span>
      )}

      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none group-hover:pointer-events-auto">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            window.open(`/api/document?caseId=${d.case_id}&filename=${encodeURIComponent(d.filename)}`, "_blank");
          }}
          className="bg-white hover:bg-bone-100 text-ink-100 text-[10px] font-bold px-2.5 py-1.5 rounded shadow-md flex items-center gap-1 transition-transform scale-90 group-hover:scale-100 duration-150"
        >
          👁️ View {isImage ? "Image" : "PDF"}
        </button>
      </div>
    </div>
  );
}
