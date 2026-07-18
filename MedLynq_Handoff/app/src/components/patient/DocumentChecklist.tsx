"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import DocumentTile from "./DocumentTile";
import StageProgress from "./StageProgress";
import type { CaseDocument } from "@/lib/mockDocuments";
import type { ChecklistEntry } from "@/lib/checklist";
import { summaryByStage, deriveCurrentStage, unmatchedDocuments } from "@/lib/checklist";
import type { Stage, Treatment } from "@/lib/types";
import { scoreRisk } from "@/lib/risk";
import { classifyByFilename } from "@/lib/classifyByFilename";
import { useRequestMissing } from "./RequestMissingContext";
import { contrastingHighlight } from "@/lib/color";

type DocRequest = {
  id: string;
  doc_type: string;
  note: string;
  status: "pending" | "fulfilled";
  requested_by: string;
  requested_at: string;
};

const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

const stageLabels: Record<Stage, string> = {
  opd: "OPD",
  pre_auth: "Pre-Authorization / Approval",
  mid_way: "Mid-Way (during treatment)",
  discharge: "Discharge & Claim",
};

export default function DocumentChecklist({
  entries: localEntries, onEntriesChange, docs, caseId, patientId, mrn, treatment, tenantAccentColor,
}: {
  entries: ChecklistEntry[];
  onEntriesChange: (updater: (prev: ChecklistEntry[]) => ChecklistEntry[]) => void;
  docs: CaseDocument[];
  caseId: string;
  patientId: string;
  mrn: string;
  treatment?: Treatment;
  tenantAccentColor: string;
}) {
  const router = useRouter();
  // Computed once per tenant color, not hardcoded red — a hospital that
  // picks a red/orange brand color would otherwise see "still outstanding"
  // flags blend right into their own buttons.
  const requestedHighlight = useMemo(() => contrastingHighlight(tenantAccentColor), [tenantAccentColor]);
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const slotInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const addPageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null); // doc id currently being reassigned
  const [addingPageTo, setAddingPageTo] = useState<string | null>(null); // doc_type currently getting a page merged in
  const [msg, setMsg] = useState<string | null>(null);
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const { active: requestMode, selected: requestSelected, toggle: toggleRequestDoc, refreshToken } = useRequestMissing();

  // Which staff-facing requests are still pending, keyed by doc_type
  // (lowercased — desktop and mobile don't always agree on capitalization
  // for the same label). This is what turns a MISSING tile into REQUESTED.
  const pendingByDocType = useMemo(() => {
    const m = new Map<string, DocRequest>();
    for (const r of requests) {
      if (r.status === "pending") m.set(r.doc_type.trim().toLowerCase(), r);
    }
    return m;
  }, [requests]);

  async function refreshRequests() {
    try {
      const res = await fetch(`/api/document-requests?patient_id=${encodeURIComponent(patientId)}`);
      const json = await res.json();
      if (json.ok) setRequests(json.requests);
    } catch { /* non-critical — tile just won't show a request badge this round */ }
  }
  useEffect(() => { refreshRequests(); }, [patientId]);
  // The bulk request send (via ActionButtons' "Request Missing Doc" flow)
  // happens outside this component; refetch once it completes so tiles flip
  // from MISSING to "requested" without a full page reload.
  useEffect(() => { if (refreshToken > 0) refreshRequests(); }, [refreshToken]);

  const perStage = summaryByStage(localEntries);
  const currentStage = deriveCurrentStage(perStage);
  const stages: Stage[] = ["opd", "pre_auth", "mid_way", "discharge"];
  const unsorted = useMemo(() => unmatchedDocuments(docs, localEntries), [docs, localEntries]);

  const risk = useMemo(() => scoreRisk({
    treatment: treatment ?? "chemo",
    present_doc_types: localEntries
      .filter((e) => e.status === "present" || e.status === "alternative_present" || e.status === "skipped" || e.status === "low_confidence")
      .map((e) => e.doc_type),
    low_confidence_types: localEntries.filter((e) => e.status === "low_confidence").map((e) => e.doc_type),
  }), [localEntries, treatment]);
  const riskColor = risk.band === "high" ? "text-bad" : risk.band === "medium" ? "text-warn" : "text-good";
  const riskBg = risk.band === "high" ? "bg-bad-soft border-bad/40" : risk.band === "medium" ? "bg-warn-soft border-warn/40" : "bg-good-soft border-good/40";

  // ---- Selection (works across slot thumbnails + Unsorted tray alike) ----
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setMsg(null);
  }
  function clearSelection() { setSelected(new Set()); setMsg(null); }
  function selectedDocs(): CaseDocument[] { return docs.filter((d) => selected.has(d.id)); }

  async function fetchAsFile(d: CaseDocument): Promise<File> {
    const res = await fetch(`/api/document?caseId=${encodeURIComponent(caseId)}&filename=${encodeURIComponent(d.filename)}`);
    const blob = await res.blob();
    return new File([blob], d.filename, { type: blob.type });
  }

  async function downloadSelected() {
    const picked = selectedDocs();
    if (picked.length === 0 || downloading) return;
    setDownloading(true);
    try {
      if (picked.length === 1) {
        const res = await fetch(`/api/document?caseId=${encodeURIComponent(caseId)}&filename=${encodeURIComponent(picked[0].filename)}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = picked[0].filename; a.click();
        URL.revokeObjectURL(url);
      } else {
        const res = await fetch("/api/document/download-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId, mrn, filenames: picked.map((d) => d.filename) }),
        });
        if (!res.ok) { setMsg("Download failed: " + (await res.text())); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${mrn}_selected_documents.zip`; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      setMsg("Download error: " + (e?.message ?? String(e)));
    } finally {
      setDownloading(false);
    }
  }

  async function merge() {
    const picked = selectedDocs();
    if (picked.length < 2) return;
    setMerging(true);
    setMsg("Merging…");
    try {
      const files = await Promise.all(picked.map(fetchAsFile));
      const form = new FormData();
      for (const f of files) form.append("file", f);
      const res = await fetch("/api/merge", { method: "POST", body: form });
      const json = await res.json();
      if (!json.ok) { setMsg("Merge failed: " + (json.error ?? "unknown")); return; }
      setMsg("Merged — adding to patient documents…");
      const mergedRes = await fetch(json.download_url);
      const mergedBlob = await mergedRes.blob();
      const landForm = new FormData();
      landForm.append("mrn", mrn);
      landForm.append("doc_type_hint", "Merged Document");
      landForm.append("file", new File([mergedBlob], `Merged_${Date.now()}.pdf`, { type: "application/pdf" }));
      const landRes = await fetch("/api/document/save-direct", { method: "POST", body: landForm });
      const landJson = await landRes.json();
      if (!landJson.ok) {
        setMsg(`Merged ${picked.length} docs (${json.page_count} pages) but couldn't add to patient record: ${landJson.error}. <a href="${json.download_url}" class="underline" download>Download it directly</a>.`);
        return;
      }
      setMsg(`Merged ${picked.length} docs into 1 PDF (${json.page_count} pages) and added to this patient's documents.`);
      clearSelection();
      router.refresh();
    } catch (e: any) {
      setMsg("Merge error: " + (e?.message ?? String(e)));
    } finally {
      setMerging(false);
    }
  }

  // ---- Uploads ----
  function extOk(name: string): boolean {
    const dot = name.lastIndexOf(".");
    return ALLOWED_EXT.has(dot >= 0 ? name.slice(dot).toLowerCase() : "");
  }

  // Bulk drop: same generic classify-and-sort pipeline as before. Confident
  // matches land straight into their slot; anything else falls into Unsorted.
  async function addBulkFiles(fileList: FileList | File[]) {
    const accepted = Array.from(fileList).filter((f) => extOk(f.name));
    if (accepted.length === 0) { setMsg("Only PDF, JPG, JPEG, PNG are supported."); return; }
    setUploading(true);
    setMsg(null);
    setProgress({ done: 0, total: accepted.length });
    try {
      let landed = 0;
      let doneCount = 0;
      const mismatches: { filename: string; doc_name?: string; doc_mrn?: string }[] = [];
      // Matches the persistent Python worker pool size (MEDLYNQ_WORKER_POOL_SIZE,
      // default 3) — sending files one at a time left 2 of 3 warm workers idle
      // the entire drop. This mirrors the same worker-queue pattern already
      // used for Intake's bulk detect-patients call.
      const BULK_CONCURRENCY = 3;
      let nextIndex = 0;
      async function worker() {
        while (true) {
          const i = nextIndex++;
          if (i >= accepted.length) return;
          const file = accepted[i];
          const form = new FormData();
          form.append("mrn", mrn);
          form.append("doc_type_hint", classifyByFilename(file.name));
          form.append("source", "Manual");
          form.append("file", file);
          try {
            const res = await fetch("/api/document/land", { method: "POST", body: form });
            const json = await res.json();
            if (json.ok) landed++;
            if (json.identity_mismatch) mismatches.push({ filename: file.name, doc_name: json.identity_mismatch.doc_name, doc_mrn: json.identity_mismatch.doc_mrn });
          } catch { /* counted as not-landed below */ }
          doneCount++;
          setProgress({ done: doneCount, total: accepted.length });
        }
      }
      await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, accepted.length) }, worker));
      setMsg(`Added ${landed} of ${accepted.length} document${accepted.length === 1 ? "" : "s"}.`);
      router.refresh();
      refreshRequests();
      // Flag once per batch (not per file) — a MEDCO scanning a real stack
      // of mixed documents shouldn't get interrupted mid-drop by a dialog
      // for every page; one summary after everything lands is enough for
      // them to go check the Unsorted tray / reassign anything wrong.
      if (mismatches.length > 0) {
        const lines = mismatches.map((m) => `• ${m.filename} — says "${m.doc_name ?? "?"}"${m.doc_mrn ? ` (MRN ${m.doc_mrn})` : ""}`).join("\n");
        window.alert(
          `⚠ ${mismatches.length} of ${accepted.length} document(s) don't match this patient's name/MRN (this case is MRN ${mrn}) and may belong to someone else:\n\n${lines}\n\nDouble-check these before submitting.`
        );
      }
    } catch (e: any) {
      setMsg("Upload error: " + (e?.message ?? String(e)));
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  // Slot-targeted upload: MEDCO explicitly chose this doc_type by clicking
  // "Upload" on that exact card — force_doc_type skips the classifier
  // override entirely and trusts the human's unambiguous choice.
  async function uploadToSlot(file: File, docType: string) {
    if (!extOk(file.name)) { setMsg("Only PDF, JPG, JPEG, PNG are supported."); return; }
    setUploading(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("mrn", mrn);
      form.append("doc_type_hint", docType);
      form.append("force_doc_type", docType);
      form.append("source", "Manual");
      form.append("file", file);
      const res = await fetch("/api/document/land", { method: "POST", body: form });
      const json = await res.json();
      if (!json.ok) { setMsg(`Upload failed: ${json.error}`); return; }
      setMsg(`Added "${docType}".`);
      if (json.identity_mismatch) {
        const m = json.identity_mismatch;
        window.alert(
          `⚠ This document doesn't match this patient's name/MRN (this case is MRN ${mrn}) and may belong to someone else:\n\nDocument says: ${m.doc_name ?? "?"}${m.doc_mrn ? ` (MRN ${m.doc_mrn})` : ""}\n\nDouble-check before submitting — you can reassign or delete it from the Unsorted tray if it's wrong.`
        );
      }
      router.refresh();
      refreshRequests();
    } catch (e: any) {
      setMsg("Upload error: " + (e?.message ?? String(e)));
    } finally {
      setUploading(false);
    }
  }

  async function toggleSkip(doc_type: string, skip: boolean) {
    onEntriesChange((prev) => prev.map((e) => e.doc_type === doc_type ? { ...e, status: skip ? "skipped" : "missing" } : e));
    try {
      await fetch("/api/checklist/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseId, doc_type, skip }),
      });
    } catch { /* optimistic update already applied */ }
  }

  // Reassign an Unsorted doc onto a known slot — this is the training signal:
  // what we guessed (or failed to guess) vs. what the MEDCO actually meant.
  async function assignToSlot(doc: CaseDocument, docType: string, force = false) {
    setAssigning(doc.id);
    try {
      const res = await fetch("/api/document/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, filename: doc.filename, doc_type: docType, force }),
      });
      const json = await res.json();
      if (json.needs_confirmation) {
        setAssigning(null);
        if (window.confirm(json.warning)) {
          await assignToSlot(doc, docType, true);
        }
        return;
      }
      if (!json.ok) { setMsg(`Couldn't assign: ${json.error}`); return; }
      router.refresh();
    } catch (e: any) {
      setMsg("Assign error: " + (e?.message ?? String(e)));
    } finally {
      setAssigning(null);
    }
  }

  // A slot that already has a document but is missing a page (e.g. MEDCO
  // scanned page 1 as its own file, then found page 2 later). Combines the
  // existing document + the new page into one PDF via the same merger.py
  // used by the multi-select "Merge" toolbar, re-lands it straight into this
  // slot (force_doc_type — no manual reassignment needed), then retires the
  // old single-page file so it doesn't linger as an orphan duplicate.
  async function addPageToSlot(item: ChecklistEntry, file: File) {
    if (!item.doc) return;
    if (!extOk(file.name)) { setMsg("Only PDF, JPG, JPEG, PNG are supported."); return; }
    setAddingPageTo(item.doc_type);
    setMsg("Adding page…");
    try {
      const existingFile = await fetchAsFile(item.doc);
      const form = new FormData();
      form.append("file", existingFile);
      form.append("file", file);
      const res = await fetch("/api/merge", { method: "POST", body: form });
      const json = await res.json();
      if (!json.ok) { setMsg("Couldn't add page: " + (json.error ?? "unknown")); return; }

      const mergedRes = await fetch(json.download_url);
      const mergedBlob = await mergedRes.blob();
      const landForm = new FormData();
      landForm.append("mrn", mrn);
      landForm.append("doc_type_hint", item.doc_type);
      landForm.append("force_doc_type", item.doc_type);
      landForm.append("source", "Manual");
      landForm.append("file", new File([mergedBlob], `${item.doc_type.replace(/[^a-z0-9]+/gi, "_")}_merged.pdf`, { type: "application/pdf" }));
      const landRes = await fetch("/api/document/land", { method: "POST", body: landForm });
      const landJson = await landRes.json();
      if (!landJson.ok) { setMsg(`Couldn't add page: ${landJson.error}`); return; }

      // Old single-page file is now fully superseded by the merged one.
      await fetch(`/api/document?caseId=${encodeURIComponent(caseId)}&filename=${encodeURIComponent(item.doc.filename)}`, { method: "DELETE" });

      setMsg(`Added page to "${item.doc_type}" (${json.page_count} pages total).`);
      router.refresh();
      refreshRequests();
    } catch (e: any) {
      setMsg("Add-page error: " + (e?.message ?? String(e)));
    } finally {
      setAddingPageTo(null);
    }
  }

  // Only slots that still need a document — assigning an Unsorted file onto
  // an already-filled slot silently overwrites that slot's manifest and
  // orphans the file that was there (see assignToSlot), so a filled slot
  // should never be a target here. To attach a second page to a document
  // that's already present, use "+ Add page" on that slot instead.
  const assignOptions = useMemo(
    () => Array.from(new Set(
      localEntries.filter((e) => e.status === "missing").map((e) => e.doc_type),
    )).sort(),
    [localEntries],
  );

  return (
    <div className="space-y-3">
      {/* Selection toolbar — works across slots AND the Unsorted tray */}
      {selected.size > 0 && (
        <div className="bg-accent-soft border border-accent/30 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap sticky top-0 z-10">
          <div className="text-sm font-semibold text-accent">
            {selected.size} document{selected.size === 1 ? "" : "s"} selected
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadSelected} disabled={downloading}
              className="bg-bone-0 border border-accent text-accent text-xs font-bold px-3 py-1.5 rounded hover:bg-accent-soft disabled:opacity-40">
              {downloading ? "Downloading…" : `↓ Download ${selected.size}`}
            </button>
            <button onClick={merge} disabled={selected.size < 2 || merging}
              className="bg-accent text-white text-xs font-bold px-3 py-1.5 rounded hover:opacity-90 disabled:opacity-40"
              title={selected.size < 2 ? "Pick at least 2 files" : "Combine selected files into one PDF"}>
              {merging ? "Merging…" : `Merge ${selected.size} → 1 PDF`}
            </button>
            <button onClick={clearSelection} className="text-xs px-3 py-1.5 border border-bone-300 bg-bone-0 rounded hover:bg-bone-200">
              Clear
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className="text-xs bg-bone-100 border border-bone-300 rounded p-2 text-ink-200" dangerouslySetInnerHTML={{ __html: msg }} />
      )}

      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h3 className="text-sm font-bold text-ink-100 flex items-center gap-2"><span>✓</span> Documents &amp; Checklist</h3>
        <div className="flex items-center gap-3 text-[10px]">
          <Legend dot="bg-good" label={`Present (${localEntries.filter(e=>e.status==="present" || e.status==="alternative_present").length})`} />
          <Legend dot="bg-warn" label={`Low confidence (${localEntries.filter(e=>e.status==="low_confidence").length})`} />
          <Legend dot="bg-bad"  label={`Missing (${localEntries.filter(e=>e.status==="missing").length})`} />
          <Legend dot="bg-ink-300" label={`Not needed (${localEntries.filter(e=>e.status==="skipped").length})`} />
        </div>
      </div>

      {/* Live query-risk strip */}
      <div className={clsx("rounded p-3 border mb-1 flex items-center justify-between", riskBg)}>
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">Predicted query risk if submitted now</div>
          <div className="text-[11px] text-ink-300 mt-0.5">{risk.reasons[0]}</div>
        </div>
        <div className={clsx("text-2xl font-bold tabular-nums", riskColor)}>{risk.score}%</div>
      </div>

      <StageProgress currentStage={currentStage} perStage={perStage} />

      {/* Bulk drop */}
      <div
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploading && e.dataTransfer.files.length > 0) addBulkFiles(e.dataTransfer.files);
        }}
        onClick={() => !uploading && bulkInputRef.current?.click()}
        className={clsx(
          "w-full border-2 border-dashed rounded-lg p-3 flex flex-col items-center justify-center gap-1 transition cursor-pointer",
          uploading ? "opacity-60 pointer-events-none" : "",
          dragOver ? "bg-accent-soft border-accent" : "bg-bone-100 border-bone-300 hover:border-accent hover:bg-accent-soft"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg text-ink-300">{uploading ? "…" : "+"}</span>
          <span className="text-xs font-semibold text-ink-100">
            {uploading
              ? (progress ? `Uploading ${progress.done} of ${progress.total}…` : "Uploading…")
              : "Drop or add documents in bulk — they'll be auto-sorted into slots below"}
          </span>
        </div>
        {uploading && progress && progress.total > 0 && (
          <div className="w-full max-w-xs h-1.5 bg-bone-300 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        )}
      </div>
      <input
        ref={bulkInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
        onChange={(e) => { if (e.target.files) addBulkFiles(e.target.files); e.target.value = ""; }}
      />

      {stages.map((s) => {
        const items = localEntries.filter((e) => e.stage === s);
        if (items.length === 0) return null;
        const isCurrent = s === currentStage;
        const missing = items.filter((e) => e.status === "missing").length;
        const present = items.filter((e) => e.status === "present" || e.status === "alternative_present" || e.status === "skipped").length;

        return (
          <section key={s} className="mb-4 last:mb-0 rounded-lg p-3 border border-bone-300">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className={clsx("text-xs font-bold uppercase tracking-wide", isCurrent ? "text-accent" : "text-ink-300")}>
                  {stageLabels[s]}
                </span>
                {isCurrent && <span className="text-[9px] font-bold uppercase bg-accent text-white px-1.5 py-0.5 rounded">YOU ARE HERE</span>}
              </div>
              <div className="text-[11px] text-ink-300">
                <span className="text-good font-semibold">{present}</span>
                <span> / {items.length} present</span>
                {missing > 0 && <span className="text-bad font-semibold"> · {missing} missing</span>}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {items.map((item) => (
                <ChecklistSlot
                  key={item.doc_type}
                  item={item}
                  selected={item.doc ? selected.has(item.doc.id) : false}
                  onToggle={toggle}
                  onUploadClick={() => slotInputRefs.current[item.doc_type]?.click()}
                  onFileChosen={(f) => uploadToSlot(f, item.doc_type)}
                  onSkip={() => toggleSkip(item.doc_type, true)}
                  onUndoSkip={() => toggleSkip(item.doc_type, false)}
                  inputRef={(el) => { slotInputRefs.current[item.doc_type] = el; }}
                  uploading={uploading}
                  onAddPageClick={() => addPageInputRefs.current[item.doc_type]?.click()}
                  onAddPageFileChosen={(f) => addPageToSlot(item, f)}
                  addPageInputRef={(el) => { addPageInputRefs.current[item.doc_type] = el; }}
                  addingPage={addingPageTo === item.doc_type}
                  pendingRequest={pendingByDocType.get(item.doc_type.trim().toLowerCase())}
                  requestMode={requestMode}
                  requestSelected={requestSelected.has(item.doc_type)}
                  onRequestToggle={() => toggleRequestDoc(item.doc_type)}
                  requestedHighlight={requestedHighlight}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Unsorted tray */}
      <section className="rounded-lg p-3 border border-bone-300 bg-bone-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-300">Unsorted ({unsorted.length})</span>
          <span className="text-[11px] text-ink-300">Didn't confidently match a checklist slot — assign manually to correct it.</span>
        </div>
        {unsorted.length === 0 ? (
          <div className="text-xs text-ink-300 italic py-2">Nothing unsorted.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {unsorted.map((d) => (
              <div key={d.id} className="space-y-1">
                <DocumentTile d={d} selected={selected.has(d.id)} onToggle={toggle} />
                {d.text_snippet && (
                  <div className="text-[9px] text-ink-300 italic line-clamp-2 px-0.5" title={d.text_snippet}>
                    “{d.text_snippet}”
                  </div>
                )}
                <select
                  className="w-full text-[10px] border border-bone-300 rounded px-1.5 py-1 bg-bone-0 text-ink-200"
                  disabled={assigning === d.id}
                  value=""
                  onChange={(e) => { if (e.target.value) assignToSlot(d, e.target.value); }}
                >
                  <option value="" disabled>{assigning === d.id ? "Assigning…" : "Assign to…"}</option>
                  {assignOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="flex items-center gap-1 text-ink-300">
      <span className={clsx("w-2 h-2 rounded-full", dot)} />
      <span>{label}</span>
    </div>
  );
}

function ChecklistSlot({
  item, selected, onToggle, onUploadClick, onFileChosen, onSkip, onUndoSkip, inputRef, uploading,
  onAddPageClick, onAddPageFileChosen, addPageInputRef, addingPage,
  pendingRequest, requestMode, requestSelected, onRequestToggle, requestedHighlight,
}: {
  item: ChecklistEntry;
  selected: boolean;
  onToggle: (id: string) => void;
  onUploadClick: () => void;
  onFileChosen: (f: File) => void;
  onSkip: () => void;
  onUndoSkip: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
  uploading: boolean;
  onAddPageClick: () => void;
  onAddPageFileChosen: (f: File) => void;
  addPageInputRef: (el: HTMLInputElement | null) => void;
  addingPage: boolean;
  pendingRequest?: { id: string; doc_type: string; note: string; status: "pending" | "fulfilled"; requested_by: string; requested_at: string };
  requestMode: boolean;
  requestSelected: boolean;
  onRequestToggle: () => void;
  requestedHighlight: { border: string; bg: string };
}) {
  const [showExtra, setShowExtra] = useState(false);
  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".pdf,.jpg,.jpeg,.png"
      className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChosen(f); e.target.value = ""; }}
    />
  );

  // Present / low-confidence / alternative-present — real doc, real thumbnail.
  if (item.doc) {
    return (
      <div>
        <div className="relative">
          <DocumentTile d={item.doc} selected={selected} onToggle={onToggle} />
          {/* A second (or third...) file also matched this same slot — e.g.
              pages captured as separate files, or two reports both proving
              the same requirement. Stack badge instead of silently hiding
              them or overwriting the primary thumbnail. */}
          {item.extraDocs && item.extraDocs.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowExtra((v) => !v); }}
              title={`${item.extraDocs.length} more file${item.extraDocs.length === 1 ? "" : "s"} attached to this document`}
              className="absolute top-2 right-8 bg-ink-100 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm hover:opacity-90"
            >
              📎 +{item.extraDocs.length}
            </button>
          )}
        </div>
        {item.status === "low_confidence" && (
          <div className="text-[9px] font-bold uppercase text-warn mt-1">LOW CONFIDENCE</div>
        )}
        <button
          type="button"
          onClick={onAddPageClick}
          disabled={addingPage}
          title="Missed a page? Attach it to this same document."
          className="w-full text-[10px] font-bold uppercase text-accent hover:underline mt-1 disabled:opacity-40"
        >
          {addingPage ? "Adding page…" : "+ Add page"}
        </button>
        <input
          ref={addPageInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onAddPageFileChosen(f); e.target.value = ""; }}
        />
        {showExtra && item.extraDocs && (
          <div className="mt-2 space-y-1 border-t border-bone-300 pt-2">
            <div className="text-[9px] font-bold uppercase text-ink-300">Also attached:</div>
            {item.extraDocs.map((d) => (
              <DocumentTile key={d.id} d={d} selected={selected} onToggle={onToggle} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSkipped = item.status === "skipped";
  // No file was uploaded for THIS exact slot, but a sibling in the same
  // alt_group was (e.g. PET-CT Report present satisfies Histopathology +
  // Biopsy too — any one proves the diagnosis). Distinct from both "missing"
  // (still needs action) and "skipped" (a human decided it's not needed) —
  // this is already satisfied, just not via this specific document.
  const isAlternativePresent = item.status === "alternative_present";
  if (isAlternativePresent) {
    return (
      <div className="border border-good/40 bg-good-soft/40 rounded-lg p-3 flex flex-col items-center justify-center text-center gap-1.5 min-h-[160px]">
        <div className="text-xs font-semibold text-ink-100">{item.doc_type}</div>
        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-good-soft text-good">
          ✓ Satisfied — alternative on file
        </span>
        <button onClick={onUploadClick} disabled={uploading}
          className="text-[10px] font-bold uppercase text-accent hover:underline mt-1 disabled:opacity-40">
          ⬆ Upload this document too
        </button>
        {hiddenInput}
      </div>
    );
  }

  const isRequested = !isSkipped && !!pendingRequest;
  // Selectable for a bulk staff request only while ActionButtons' "Request
  // Missing Doc" flow is active, and only if it isn't already requested or
  // marked not-needed — re-requesting an already-pending doc is redundant.
  const canSelect = requestMode && !isSkipped && !isRequested;

  return (
    <div
      onClick={canSelect ? onRequestToggle : undefined}
      style={isSkipped || canSelect ? undefined : isRequested ? { borderColor: requestedHighlight.border, backgroundColor: requestedHighlight.bg } : undefined}
      className={clsx(
        "border rounded-lg p-3 flex flex-col items-center justify-center text-center gap-1.5 min-h-[160px] relative",
        isSkipped ? "border-bone-300 bg-bone-100"
          : canSelect
            ? (requestSelected ? "border-bad ring-2 ring-bad/50 bg-bad-soft cursor-pointer" : "border-bad/50 bg-bad-soft/40 border-dashed cursor-pointer hover:border-bad")
            // Requested-but-not-yet-uploaded gets a modestly stronger solid
            // border, colored to contrast with this tenant's brand color
            // (see requestedHighlight/contrastingHighlight) rather than a
            // hardcoded red — just enough to keep reading as outstanding
            // until a MEDCO or the mobile app uploads into this slot.
            : isRequested ? ""
            : "border-bad/40 bg-bad-soft/40 border-dashed"
      )}
    >
      {canSelect && (
        <span
          className={clsx(
            "absolute top-2 left-2 w-4 h-4 rounded border grid place-items-center text-[10px] font-bold shadow-sm",
            requestSelected ? "bg-bad border-bad text-white" : "bg-bone-0 border-bone-300 text-transparent"
          )}
        >
          ✓
        </span>
      )}
      <div className={clsx("text-xs font-semibold", isSkipped ? "text-ink-300 line-through" : "text-ink-100")}>
        {item.doc_type}
      </div>
      {isSkipped ? (
        <>
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-bone-200 text-ink-300">NOT NEEDED</span>
          <button onClick={(e) => { e.stopPropagation(); onUndoSkip(); }} className="text-[10px] font-bold uppercase text-accent hover:underline mt-1">
            ↺ Undo — mark as required again
          </button>
        </>
      ) : isRequested ? (
        <>
          <span className="text-[9px] font-semibold text-ink-300">Requested{pendingRequest!.requested_by ? ` · ${pendingRequest!.requested_by}` : ""}</span>
          {pendingRequest!.note && (
            <div className="text-[10px] text-ink-200 italic px-1" title={pendingRequest!.note}>
              “{pendingRequest!.note}”
            </div>
          )}
          <button onClick={(e) => { e.stopPropagation(); onUploadClick(); }} disabled={uploading}
            className="text-[10px] font-bold uppercase text-accent hover:underline mt-1 disabled:opacity-40">
            ⬆ Upload document
          </button>
        </>
      ) : (
        <>
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-bad-soft text-bad">MISSING</span>
          <button onClick={(e) => { e.stopPropagation(); onUploadClick(); }} disabled={uploading}
            className="text-[10px] font-bold uppercase text-accent hover:underline mt-1 disabled:opacity-40">
            ⬆ Upload document
          </button>
          <button onClick={(e) => { e.stopPropagation(); onSkip(); }} className="text-[10px] font-bold uppercase text-ink-300 hover:text-ink-100 hover:underline">
            ✕ Not needed
          </button>
        </>
      )}
      {hiddenInput}
    </div>
  );
}
