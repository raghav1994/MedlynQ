"use client";

// Deep-linked single-patient upload — used when arriving from OPD
// Registration's "Upload documents →" button (carries ?mrn=&name=&patient_id=).
// Unlike the main Intake flow (which auto-detects however many patients are
// in an arbitrary batch of dropped files), we already KNOW who these files
// belong to here, so every file lands straight to this one patient via
// /api/document/land — no detection/grouping/ambiguity step needed.

import { useRef, useState } from "react";
import { classifyByFilename } from "@/lib/classifyByFilename";

const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

type FileStatus = { name: string; state: "uploading" | "done" | "error"; error?: string };

export default function SinglePatientUpload({
  mrn, name, patientId,
}: { mrn: string; name: string; patientId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<FileStatus[]>([]);

  async function landOne(file: File) {
    setFiles((f) => [...f, { name: file.name, state: "uploading" }]);
    const form = new FormData();
    form.append("mrn", mrn);
    form.append("doc_type_hint", classifyByFilename(file.name));
    form.append("source", "Manual");
    form.append("file", file);
    try {
      const res = await fetch("/api/document/land", { method: "POST", body: form });
      const json = await res.json();
      setFiles((f) => f.map((x) => x.name === file.name
        ? { name: file.name, state: json.ok ? "done" : "error", error: json.ok ? undefined : json.error }
        : x));
    } catch (e: any) {
      setFiles((f) => f.map((x) => x.name === file.name ? { name: file.name, state: "error", error: e?.message } : x));
    }
  }

  function onFiles(fileList: FileList | File[]) {
    const all = Array.from(fileList);
    const accepted = all.filter((f) => {
      const dot = f.name.lastIndexOf(".");
      const ext = dot >= 0 ? f.name.slice(dot).toLowerCase() : "";
      return ALLOWED_EXT.has(ext);
    });
    accepted.forEach(landOne);
  }

  const doneCount = files.filter((f) => f.state === "done").length;
  const anyUploading = files.some((f) => f.state === "uploading");

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-accent-soft border border-accent/40 rounded-lg p-3 text-sm">
        <span className="font-bold text-accent">Uploading for:</span>{" "}
        <span className="text-ink-100">{name || "Patient"}</span>{" "}
        <span className="font-mono text-ink-300">({mrn})</span>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`bg-bone-0 border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-2 cursor-pointer transition ${
          dragOver ? "border-accent bg-accent-soft" : "border-bone-300"
        }`}
      >
        <span className="text-3xl">📂</span>
        <div className="text-sm font-semibold text-ink-100">Drop files here or click to browse</div>
        <div className="text-xs text-ink-300">PDFs, JPGs, PNGs · up to 25 MB each</div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {files.length > 0 && (
        <div className="bg-bone-0 border border-bone-300 rounded-lg p-3 space-y-1">
          {files.map((f) => (
            <div key={f.name} className="flex items-center justify-between text-xs py-1 border-b border-bone-200 last:border-0">
              <span className="text-ink-100">{f.name}</span>
              <span className={
                f.state === "done" ? "text-good font-semibold" :
                f.state === "error" ? "text-bad font-semibold" : "text-ink-300"
              }>
                {f.state === "uploading" ? "Uploading…" : f.state === "done" ? "✓ Landed" : `✗ ${f.error ?? "Failed"}`}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <a
          href={`/patient/${encodeURIComponent(patientId)}`}
          className={`text-xs font-semibold px-4 py-2 rounded ${
            doneCount > 0 ? "bg-accent text-white hover:opacity-90" : "bg-bone-300 text-ink-300 pointer-events-none"
          }`}
        >
          {anyUploading ? "Uploading…" : `Done → View patient (${doneCount} landed)`}
        </a>
      </div>
    </div>
  );
}
