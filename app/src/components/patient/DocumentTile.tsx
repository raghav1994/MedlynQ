"use client";

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
            "absolute top-2 left-2 w-4 h-4 rounded border grid place-items-center text-[10px] font-bold transition",
            selected ? "bg-accent border-accent text-white" : "bg-bone-0 border-bone-300 text-transparent"
          )}
        >
          ✓
        </span>
      )}

      <span className={clsx("absolute top-2 right-2 w-2.5 h-2.5 rounded-full", dot.color)} title={dot.label} />

      <div className="aspect-[4/3] bg-bone-200 rounded mb-2 grid place-items-center overflow-hidden">
        {isImage ? (
          <div className="w-full h-full bg-gradient-to-br from-bone-300 to-bone-200 grid place-items-center">
            <span className={clsx("text-2xl font-bold tracking-wide", glyph.color)}>{glyph.label}</span>
          </div>
        ) : (
          <span className={clsx("text-2xl font-bold tracking-wide", glyph.color)}>{glyph.label}</span>
        )}
      </div>

      <div className="text-xs font-semibold text-ink-100 truncate" title={d.filename}>{d.filename}</div>
      <div className="text-[10px] text-ink-300 truncate">Orig: {d.original_filename}</div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-ink-300">{d.uploaded_at}</span>
        <span className={clsx("text-[10px] font-semibold px-1.5 py-0.5 rounded", sourceTint[d.source])}>{d.source}</span>
      </div>
    </div>
  );
}
