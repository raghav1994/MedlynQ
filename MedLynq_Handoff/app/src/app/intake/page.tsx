"use client";

// Document Intake — the ONE drop zone. Auto-detects how many patients are in
// the batch, shows a confirm popup, then runs the full pipeline per patient:
//   compress → Sarvam/PyMuPDF → route-decision → route-apply → land in Patient List
//
// No more Single-patient / Drop-and-Go mode toggle. The system detects the
// number of patients from what you dropped.
//
// State lives in intakeStore (module-level, outside React) instead of
// useState — so navigating to Patient List and back via the sidebar doesn't
// wipe an in-progress detection/commit. Only a hard reload resets it.

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import SinglePatientUpload from "@/components/SinglePatientUpload";
import {
  useIntakeState, setIntakeState, resetIntakeState,
  type DetectedFile, type DetectedGroup, type DetectResult,
  type CommitStatus, type CommittedGroup,
} from "@/lib/intakeStore";

export default function IntakePage() {
  const searchParams = useSearchParams();
  const deepLinkMrn = searchParams.get("mrn");
  const deepLinkPatientId = searchParams.get("patient_id");

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const {
    busy, progress, detected, editableGroups, manualGroups,
    unassignedTargets, selectedUnassigned, commit, rawFiles, error,
    filenameOverrides,
  } = useIntakeState();

  // Deep-linked from OPD Registration's "Upload documents →" — we already
  // know who these files belong to, so skip the generic multi-patient
  // detection flow entirely and land straight to this one patient.
  if (deepLinkMrn && deepLinkPatientId) {
    return (
      <AppShell>
        <div className="max-w-3xl space-y-2 mb-2">
          <h1 className="text-xl font-bold text-ink-100">Document Intake</h1>
        </div>
        <SinglePatientUpload
          mrn={deepLinkMrn}
          name={searchParams.get("name") ?? ""}
          patientId={deepLinkPatientId}
        />
      </AppShell>
    );
  }

  function renameFile(originalFilename: string, newName: string) {
    setIntakeState((s) => ({
      filenameOverrides: { ...s.filenameOverrides, [originalFilename]: newName },
    }));
  }

  const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

  async function onFiles(fileList: FileList | File[]) {
    const all = Array.from(fileList);
    if (all.length === 0) return;

    // accept="" on the <input> only constrains the native file picker, not
    // drag-and-drop — so reject unsupported types here too, on both paths.
    const arr = all.filter((f) => {
      const dot = f.name.lastIndexOf(".");
      const ext = dot >= 0 ? f.name.slice(dot).toLowerCase() : "";
      return ALLOWED_EXT.has(ext);
    });
    const rejected = all.filter((f) => !arr.includes(f));
    if (arr.length === 0) {
      setIntakeState({
        error: rejected.length > 0
          ? `Only PDF, JPG, JPEG, PNG are supported. Rejected: ${rejected.map((f) => f.name).join(", ")}`
          : null,
      });
      return;
    }

    setIntakeState({
      rawFiles: arr, busy: true, progress: { done: 0, total: arr.length },
      error: rejected.length > 0
        ? `Skipped ${rejected.length} unsupported file${rejected.length === 1 ? "" : "s"} (only PDF, JPG, JPEG, PNG allowed): ${rejected.map((f) => f.name).join(", ")}`
        : null,
      detected: null, commit: null,
    });

    try {
      const fd = new FormData();
      arr.forEach((f) => fd.append("file", f));
      const r = await fetch("/api/document/detect-patients", { method: "POST", body: fd });
      if (!r.body) throw new Error("Detection failed");

      // Server streams newline-delimited JSON: progress lines as each file
      // finishes reading, then one final result line. Lets the drop zone
      // show "Reading document 4 of 10…" instead of a frozen spinner.
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let j: any = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.type === "progress") {
            setIntakeState({ progress: { done: msg.done, total: msg.total } });
          } else if (msg.type === "result") {
            j = msg;
          }
        }
      }
      if (!j || !j.ok) throw new Error(j?.error ?? "Detection failed");
      // If nothing was auto-detected (common for all-scanned batches), start
      // with ONE manual patient slot so there's somewhere to sort files into —
      // but every file starts UNASSIGNED (null), never auto-merged.
      const startingManual: DetectedGroup[] = j.groups.length === 0 && j.unassigned.length > 0
        ? [{ identity: {}, files: [] }]
        : [];
      // When exactly one patient is detected, there's nowhere else these
      // leftover files (Aadhaar, bills with no printed name/MRN, etc.) could
      // realistically belong — default them into that one patient instead of
      // making the MEDCO manually assign every single one. Still easily
      // undone per-file (see the "Unassign" control below), and this only
      // fires with 1 detected group — a batch with 2+ patients still forces
      // explicit assignment, since a wrong auto-merge there is much costlier.
      const defaults: Record<string, number | null> = {};
      j.unassigned.forEach((u: DetectedFile) => {
        // Only auto-default a file into the sole detected patient when it's
        // genuinely BLANK (no preview text at all — a photo, an empty bill).
        // A file that DID return real OCR text but matched no identity field
        // (u.preview is set) might belong to a totally different, unparsed
        // patient — confirmed on a real case where a chemo chart used "Name;"
        // instead of "Name:" and got silently swept into another patient's
        // group by this exact default before this check existed. Those must
        // always go through manual assignment instead.
        defaults[u.filename] = (j.groups.length === 1 && !u.preview) ? 0 : null;
      });
      setIntakeState({
        detected: j,
        editableGroups: j.groups.map((g: DetectedGroup) => ({ ...g, identity: { ...g.identity } })),
        manualGroups: startingManual,
        unassignedTargets: defaults,
        selectedUnassigned: new Set(),
      });
    } catch (e: any) {
      setIntakeState({ error: e?.message ?? "Detection failed" });
    } finally {
      setIntakeState({ busy: false, progress: null });
    }
  }

  // Combined index space: detected groups first, manual slots after.
  const allGroups = [...editableGroups, ...manualGroups];
  const unresolvedCount = detected?.unassigned.filter((u) => unassignedTargets[u.filename] == null).length ?? 0;

  function addManualSlot() {
    setIntakeState((s) => ({ manualGroups: [...s.manualGroups, { identity: {}, files: [] }] }));
  }

  function bulkAssign(target: number | "new") {
    if (selectedUnassigned.size === 0) return;
    setIntakeState((s) => {
      const groupsLen = s.editableGroups.length + s.manualGroups.length;
      const manualGroups = target === "new" ? [...s.manualGroups, { identity: {}, files: [] }] : s.manualGroups;
      const destIdx = typeof target === "number" ? target : groupsLen;
      const nextTargets = { ...s.unassignedTargets };
      for (const fname of s.selectedUnassigned) nextTargets[fname] = destIdx;
      return { manualGroups, unassignedTargets: nextTargets, selectedUnassigned: new Set() };
    });
  }

  async function confirmAndCommit() {
    if (!detected) return;
    if (unresolvedCount > 0) return; // guard — button should already be disabled
    // Build final groups: detected + manual, with unassigned files routed by index.
    // Never silently merges — every unassigned file was explicitly placed.
    const finalGroups: DetectedGroup[] = allGroups.map((g) => ({ identity: g.identity, files: [...g.files] }));
    for (const u of detected.unassigned) {
      const target = unassignedTargets[u.filename];
      if (target != null && finalGroups[target]) finalGroups[target].files.push(u);
    }
    // Drop any empty slots (e.g. an unused manual slot nobody assigned files to)
    const nonEmpty = finalGroups.filter((g) => g.files.length > 0);

    setIntakeState({
      commit: nonEmpty.map((g, i) => ({
        group_idx: i,
        patient_name: g.identity.name ?? "New patient",
        status: "burning" as CommitStatus,
        needs_ocr: g.files.some((f) => f.needs_ocr),
      })),
    });

    function patchCommit(i: number, patch: Partial<CommittedGroup>) {
      setIntakeState((s) => ({
        commit: s.commit?.map((c) => (c.group_idx === i ? { ...c, ...patch } : c)) ?? null,
      }));
    }

    // Run per-group: (1) redact + Sarvam OCR on any needs_ocr file
    // (2) route-decision + route-apply
    for (let i = 0; i < nonEmpty.length; i++) {
      const g = nonEmpty[i];
      const enriched = { ...g.identity };
      let totalBurned = 0;
      const ocrFiles = g.files.filter((f) => f.needs_ocr);

      // ---- Redact + Sarvam pass ----
      if (ocrFiles.length > 0) {
        patchCommit(i, { status: "burning", sarvam_files: ocrFiles.length });
        for (const f of ocrFiles) {
          const raw = rawFiles.find((rf) => rf.name === f.filename);
          if (!raw) continue;
          patchCommit(i, { status: "burning", detail: `Burning PII from ${f.filename}…` });
          const fd = new FormData(); fd.append("file", raw);
          try {
            patchCommit(i, { status: "sarvam", detail: `Sarvam OCR on ${f.filename}…` });
            const r = await fetch("/api/document/extract", { method: "POST", body: fd });
            const j = await r.json();
            if (j.ok) {
              totalBurned += j.redact?.burned_count ?? 0;
              if (j.hints) {
                for (const k of ["mrn", "name", "age", "gender"] as const) {
                  if (!enriched[k] && j.hints[k]) (enriched as any)[k] = j.hints[k];
                }
              }
            }
          } catch { /* skip; router will still fire with whatever identity we have */ }
        }
      }

      patchCommit(i, { status: "routing", burned_count: totalBurned, detail: "Classifying & routing to patient…" });
      try {
        const bag = {
          identity: {
            mrn: enriched.mrn || undefined,
            name: enriched.name || undefined,
            age: enriched.age || undefined,
            gender: enriched.gender || undefined,
          },
          doc_types: g.files.map((f) => f.doc_type),
          doc_ids: g.files.map((f) => f.filename),
        };
        const dr = await fetch("/api/document/route-decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bag),
        });
        const dj = await dr.json();
        if (!dj.ok) throw new Error(dj.error ?? "route-decision failed");
        // For medium-confidence we auto-apply anyway (this is a bulk flow — user already confirmed identity)
        const decision = dj.decision.action === "review"
          ? { ...dj.decision, action: g.identity.mrn || g.identity.name ? "auto_create" : "auto_create",
              new_case_status: dj.decision.stage.stage === "discharge" ? "discharged" : "preauth_pending" }
          : dj.decision;
        const ar = await fetch("/api/document/route-apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, bag }),
        });
        const aj = await ar.json();
        if (!aj.ok) throw new Error(aj.error ?? "route-apply failed");
        const s = aj.summary;

        // ---- Land every file onto disk so it shows on the Patient page ----
        // Writes PatientLog/{MRN}/originals/{file} + extracted/{file}.json.
        // land_document.py compresses every file first, then either OCRs it
        // (Sarvam) or lands it straight (visual-only docs). This is what
        // makes the checklist row flip red→green with a real thumbnail —
        // docsForCase()/ChecklistValidation already read this exact folder.
        let landedCount = 0;
        if (s.patient_mrn) {
          patchCommit(i, { status: "routing", detail: "Compressing & landing documents on patient folder…" });
          for (const f of g.files) {
            const raw = rawFiles.find((rf) => rf.name === f.filename);
            if (!raw) continue;
            try {
              const fd = new FormData();
              fd.append("file", raw);
              fd.append("mrn", s.patient_mrn);
              fd.append("doc_type_hint", f.doc_type);
              const lr = await fetch("/api/document/land", { method: "POST", body: fd });
              const lj = await lr.json();
              if (lj.ok) landedCount++;
            } catch { /* one failed file shouldn't sink the whole group */ }
          }
        }

        const parts = [decision.action];
        if (s.auto_advance) parts.push(`${s.auto_advance.from} → ${s.auto_advance.to}`);
        if (totalBurned > 0) parts.push(`${totalBurned} PII item${totalBurned === 1 ? "" : "s"} burned`);
        if (ocrFiles.length > 0) parts.push(`${ocrFiles.length} file${ocrFiles.length === 1 ? "" : "s"} via Sarvam`);
        if (landedCount > 0) parts.push(`${landedCount} doc${landedCount === 1 ? "" : "s"} landed`);
        const detail = parts.join(" · ");
        const patient_href = s.patient_id && s.case_id ? `/patient/${s.patient_id}?case=${s.case_id}` : undefined;
        patchCommit(i, { status: "done", detail, patient_href, patient_name: bag.identity.name || `Auto ${s.patient_id?.slice(-6) ?? ""}` });
      } catch (e: any) {
        patchCommit(i, { status: "error", detail: e?.message ?? "failed" });
      }
    }
  }

  function resetAll() {
    resetIntakeState();
  }

  return (
    <AppShell>
      <div className="max-w-5xl space-y-5">
        <div>
          <h1 className="text-xl font-bold text-ink-100">Document Intake</h1>
          <p className="text-sm text-ink-300 mt-1">
            Drop files. MedLynq will detect how many patients are in the batch, ask you to confirm,
            then extract identity, classify, and add each patient to the list.
          </p>
        </div>

        {/* Drop zone */}
        {!detected && !commit && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition ${
              dragOver ? "bg-accent-soft border-accent" : "bg-bone-0 border-bone-300 hover:bg-bone-100"
            } ${busy ? "opacity-50 pointer-events-none" : ""}`}
          >
            <div className="text-5xl mb-3">📂</div>
            <div className="text-lg font-semibold text-ink-100">
              {busy
                ? (progress ? `Reading document ${progress.done} of ${progress.total}…` : "Reading documents…")
                : "Drop files here or click to browse"}
            </div>
            {busy && progress && progress.total > 0 && (
              <div className="w-full max-w-xs mx-auto mt-3 h-1.5 bg-bone-300 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
            )}
            <div className="text-xs text-ink-300 mt-2">
              PDFs, JPGs, PNGs · up to 25 MB each · up to 40 files per drop
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }}
            />
          </div>
        )}

        {error && (
          <div className="bg-bad-soft border border-bad rounded p-3 text-sm text-bad">
            {error}
            <button onClick={resetAll} className="ml-3 underline text-xs">Try again</button>
          </div>
        )}

        {/* Detected popup — shown after quick extraction */}
        {detected && !commit && (
          <DetectedPanel
            detected={detected}
            rawFiles={rawFiles}
            editableGroups={editableGroups}
            setEditableGroups={(updater) => setIntakeState((s) => ({
              editableGroups: typeof updater === "function" ? updater(s.editableGroups) : updater,
            }))}
            manualGroups={manualGroups}
            setManualGroups={(updater) => setIntakeState((s) => ({
              manualGroups: typeof updater === "function" ? updater(s.manualGroups) : updater,
            }))}
            unassignedTargets={unassignedTargets}
            selectedUnassigned={selectedUnassigned}
            setSelectedUnassigned={(updater) => setIntakeState((s) => ({
              selectedUnassigned: typeof updater === "function" ? updater(s.selectedUnassigned) : updater,
            }))}
            unresolvedCount={unresolvedCount}
            onAssign={(fname, idx) => setIntakeState((s) => ({ unassignedTargets: { ...s.unassignedTargets, [fname]: idx } }))}
            onUnassign={(fname) => setIntakeState((s) => ({ unassignedTargets: { ...s.unassignedTargets, [fname]: null } }))}
            onBulkAssign={bulkAssign}
            onAddSlot={addManualSlot}
            onConfirm={confirmAndCommit}
            onCancel={resetAll}
            filenameOverrides={filenameOverrides}
            onRename={renameFile}
          />
        )}

        {/* Commit progress */}
        {commit && (
          <CommitPanel commit={commit} onDone={resetAll} />
        )}
      </div>
    </AppShell>
  );
}

// -------------------------------------------------------------------------

// Filename shown for each dropped file. Click opens the actual document in a
// new tab (a plain client-side blob URL from the already-in-memory File
// object — no backend round-trip needed). Double-click switches to an
// inline text input to fix a bad/generic extracted filename — display-only,
// never touches the underlying File object or backend doc_type.
function FileNamePreview({
  filename, displayName, onRename, file, className,
}: {
  filename: string;
  displayName?: string;
  onRename?: (originalFilename: string, newName: string) => void;
  preview?: string;
  file?: File;
  className?: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName ?? filename);
  const shown = displayName ?? filename;

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function commitRename() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== shown) onRename?.(filename, trimmed);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") { setDraft(shown); setEditing(false); }
        }}
        className={`font-mono text-xs px-1 py-0.5 border border-accent rounded min-w-0 max-w-full ${className ?? ""}`}
      />
    );
  }

  return objectUrl ? (
    <a
      href={objectUrl}
      target="_blank"
      rel="noopener noreferrer"
      title="Click to open · double-click to rename"
      onDoubleClick={(e) => { e.preventDefault(); setDraft(shown); setEditing(true); }}
      className={`font-mono truncate block hover:underline hover:text-accent min-w-0 max-w-full ${className ?? ""}`}
    >
      {shown}
    </a>
  ) : (
    <span
      title="Double-click to rename"
      onDoubleClick={() => { setDraft(shown); setEditing(true); }}
      className={`font-mono truncate block cursor-default ${className ?? ""}`}
    >
      {shown}
    </span>
  );
}

function DetectedPanel({
  detected, rawFiles, editableGroups, setEditableGroups,
  manualGroups, setManualGroups,
  unassignedTargets, selectedUnassigned, setSelectedUnassigned,
  unresolvedCount, onAssign, onUnassign, onBulkAssign, onAddSlot,
  onConfirm, onCancel, filenameOverrides, onRename,
}: {
  detected: DetectResult;
  rawFiles: File[];
  editableGroups: DetectedGroup[];
  setEditableGroups: (updater: DetectedGroup[] | ((prev: DetectedGroup[]) => DetectedGroup[])) => void;
  manualGroups: DetectedGroup[];
  setManualGroups: (updater: DetectedGroup[] | ((prev: DetectedGroup[]) => DetectedGroup[])) => void;
  unassignedTargets: Record<string, number | null>;
  selectedUnassigned: Set<string>;
  setSelectedUnassigned: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  unresolvedCount: number;
  onAssign: (filename: string, idx: number) => void;
  onUnassign: (filename: string) => void;
  onBulkAssign: (target: number | "new") => void;
  onAddSlot: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  filenameOverrides: Record<string, string>;
  onRename: (originalFilename: string, newName: string) => void;
}) {
  const allGroups = [...editableGroups, ...manualGroups];
  const resolvedCounts = allGroups.map((_, i) =>
    detected.unassigned.filter((u) => unassignedTargets[u.filename] === i).length
  );
  const totalPatients = allGroups.filter((_, i) =>
    (i < editableGroups.length ? editableGroups[i].files.length : 0) + resolvedCounts[i] > 0
  ).length;

  function updateGroupField(i: number, k: "name" | "mrn" | "age" | "gender", v: any) {
    if (i < editableGroups.length) {
      setEditableGroups((prev) => prev.map((g, idx) => idx === i ? { ...g, identity: { ...g.identity, [k]: v } } : g));
    } else {
      const mi = i - editableGroups.length;
      setManualGroups((prev) => prev.map((g, idx) => idx === mi ? { ...g, identity: { ...g.identity, [k]: v } } : g));
    }
  }

  function toggleSelect(filename: string) {
    setSelectedUnassigned((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename); else next.add(filename);
      return next;
    });
  }

  function selectAllUnresolved() {
    setSelectedUnassigned(new Set(detected.unassigned.filter((u) => unassignedTargets[u.filename] == null).map((u) => u.filename)));
  }

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg overflow-hidden">
      <div className="bg-bone-100 border-b border-bone-300 p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase font-semibold text-ink-300">Detection complete</div>
          <div className="text-lg font-bold text-ink-100">
            {totalPatients} patient{totalPatients === 1 ? "" : "s"} so far
            <span className="text-ink-300 font-normal"> · {detected.total_files} file{detected.total_files === 1 ? "" : "s"}</span>
          </div>
          <div className="text-[11px] text-ink-300 mt-0.5">
            {detected.stats.pdfs_with_identity} PDFs with identity (free) ·
            {" "}{detected.stats.sarvam_processed_now ?? 0} read via Sarvam just now ·
            {" "}{detected.stats.pdfs_needing_ocr + detected.stats.images_needing_ocr} still unreadable
            {(detected.stats.visual_only_skipped ?? 0) > 0 && <> · {detected.stats.visual_only_skipped} visual-only (skipped)</>}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {unresolvedCount > 0 && (
            <span className="text-xs font-semibold text-warn">{unresolvedCount} file{unresolvedCount === 1 ? "" : "s"} still unassigned</span>
          )}
          <button onClick={onCancel} className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={unresolvedCount > 0}
            title={unresolvedCount > 0 ? "Assign every file to a patient first" : undefined}
            className={`text-xs font-bold px-4 py-1.5 rounded text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed ${
              unresolvedCount > 0 ? "bg-accent" : "bg-good"
            }`}
          >
            ▶ Confirm & process {totalPatients} patient{totalPatients === 1 ? "" : "s"}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {allGroups.map((g, i) => {
          const isManual = i >= editableGroups.length;
          const count = (isManual ? 0 : g.files.length) + resolvedCounts[i];
          return (
            <div key={i} className="border border-bone-300 rounded-lg p-3 bg-bone-0">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase font-bold text-accent">
                  Patient {i + 1} {isManual && <span className="text-ink-300 font-normal normal-case">(manually added)</span>}
                </div>
                <div className="text-[10px] text-ink-300">{count} file{count === 1 ? "" : "s"}</div>
              </div>
              {g.identity.mrnConflict && (
                <div className="mb-2 text-[11px] font-semibold text-warn bg-warn-soft border border-warn/40 rounded px-2 py-1.5">
                  ⚠ One of these files printed a different ID ({g.identity.altMrn}) than the others ({g.identity.mrn}).
                  Same patient across two systems (e.g. a referred-out lab) is common — but double check these files
                  really are the same person before confirming, or use "+ Add another patient" to split them.
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                <input value={g.identity.name ?? ""} onChange={(e) => updateGroupField(i, "name", e.target.value)} placeholder="Name" className="px-2 py-1.5 text-sm border border-bone-300 rounded" />
                <input value={g.identity.mrn ?? ""} onChange={(e) => updateGroupField(i, "mrn", e.target.value)} placeholder="MRN" className="px-2 py-1.5 text-sm border border-bone-300 rounded font-mono" />
                <input value={g.identity.age ?? ""} onChange={(e) => updateGroupField(i, "age", e.target.value)} placeholder="Age" className="px-2 py-1.5 text-sm border border-bone-300 rounded" />
                <select value={g.identity.gender ?? ""} onChange={(e) => updateGroupField(i, "gender", e.target.value)} className="px-2 py-1.5 text-sm border border-bone-300 rounded bg-bone-0">
                  <option value="">Gender</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>
              {!isManual && g.files.length > 0 && (
                <ul className="text-xs text-ink-200 divide-y divide-bone-200 mb-1">
                  {g.files.map((f, k) => (
                    <li key={k} className="py-1 flex items-center justify-between gap-2">
                      <FileNamePreview filename={f.filename} displayName={filenameOverrides[f.filename]} onRename={onRename} preview={f.preview} file={rawFiles.find((rf) => rf.name === f.filename)} />
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-good-soft text-good whitespace-nowrap">
                        {f.doc_type}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {resolvedCounts[i] > 0 && (
                <ul className="text-xs text-ink-200 divide-y divide-bone-200">
                  {detected.unassigned.filter((u) => unassignedTargets[u.filename] === i).map((u) => (
                    <li key={u.filename} className="py-1 flex items-center justify-between gap-2">
                      <FileNamePreview filename={u.filename} displayName={filenameOverrides[u.filename]} onRename={onRename} preview={u.preview} file={rawFiles.find((rf) => rf.name === u.filename)} />
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-good-soft text-good whitespace-nowrap">
                          {u.doc_type}
                        </span>
                        <button
                          onClick={() => onUnassign(u.filename)}
                          title="Move back to unassigned"
                          className="text-[10px] font-semibold text-ink-300 underline hover:text-warn"
                        >
                          Unassign
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <button onClick={onAddSlot} className="text-xs font-semibold px-3 py-1.5 border border-dashed border-bone-300 rounded hover:bg-bone-100 text-ink-300">
          + Add another patient
        </button>

        {unresolvedCount > 0 && (
          <div className="border border-warn/40 bg-warn-soft rounded-lg p-3">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="text-[10px] uppercase font-bold text-warn">
                {unresolvedCount} file{unresolvedCount === 1 ? "" : "s"} without identifiable patient
                <span className="ml-2 font-normal normal-case text-ink-300">— select files below, then assign in bulk</span>
              </div>
              <button onClick={selectAllUnresolved} className="text-[10px] font-semibold text-accent underline">
                Select all unassigned
              </button>
            </div>

            {selectedUnassigned.size > 0 && (
              <div className="flex items-center gap-2 mb-2 bg-bone-0 border border-accent rounded p-2">
                <span className="text-xs font-semibold text-ink-100">{selectedUnassigned.size} selected</span>
                <span className="text-xs text-ink-300">→ Assign to:</span>
                {allGroups.map((g, i) => (
                  <button
                    key={i}
                    onClick={() => onBulkAssign(i)}
                    className="text-[11px] font-semibold px-2 py-1 border border-bone-300 rounded hover:bg-accent-soft hover:border-accent"
                  >
                    Patient {i + 1}{g.identity.name ? ` — ${g.identity.name}` : ""}
                  </button>
                ))}
                <button
                  onClick={() => onBulkAssign("new")}
                  className="text-[11px] font-semibold px-2 py-1 border border-dashed border-bone-300 rounded hover:bg-accent-soft hover:border-accent"
                >
                  + New patient
                </button>
              </div>
            )}

            <ul className="text-xs divide-y divide-bone-200 bg-bone-0 rounded max-h-96 overflow-auto">
              {detected.unassigned.filter((u) => unassignedTargets[u.filename] == null).map((u) => {
                return (
                  <li key={u.filename} className="p-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedUnassigned.has(u.filename)}
                      onChange={() => toggleSelect(u.filename)}
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <FileNamePreview filename={u.filename} displayName={filenameOverrides[u.filename]} onRename={onRename} preview={u.preview} file={rawFiles.find((rf) => rf.name === u.filename)} className="text-ink-200" />
                      <div className="text-[10px] text-ink-300">
                        {u.doc_type} · {u.sarvam_done ? "read via Sarvam — no patient name/MRN found in it" : u.needs_ocr ? "will run Sarvam OCR on commit" : "text extracted but no identity found"}
                      </div>
                    </div>
                    <select
                      value=""
                      onChange={(e) => onAssign(u.filename, Number(e.target.value))}
                      className="text-xs px-2 py-1 border border-warn rounded bg-bone-0"
                    >
                      <option value="" disabled>Assign to…</option>
                      {allGroups.map((g, i) => (
                        <option key={i} value={i}>
                          Patient {i + 1} {g.identity.name ? `— ${g.identity.name}` : ""}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------

// Fixed pipeline stages shown as a milestone timeline per patient group.
// Derived purely from {status, detail, needs_ocr} — no extra state to keep
// in sync. Icons are generic ("reading", "matching") — never say "AI" or
// "Sarvam" in user-facing copy.
const ALL_STEPS = [
  { label: "Queued",        icon: "📥" },
  { label: "Reading",       icon: "🔍" },
  { label: "Classifying",   icon: "🗂️" },
  { label: "Adding",        icon: "📁" },
  { label: "Done",          icon: "✅" },
] as const;

function stepsFor(c: CommittedGroup): { label: string; icon: string; state: "done" | "active" | "pending" | "error" }[] {
  const steps = c.needs_ocr ? ALL_STEPS : ALL_STEPS.filter((s) => s.label !== "Reading");
  const landing = c.status === "routing" && (c.detail ?? "").toLowerCase().includes("landing");
  const idxOf = (label: string) => steps.findIndex((s) => s.label === label);
  let activeIdx: number;
  if (c.status === "error") activeIdx = -1;
  else if (c.status === "done") activeIdx = steps.length;
  else if (landing) activeIdx = idxOf("Adding");
  else if (c.status === "routing") activeIdx = idxOf("Classifying");
  else if (c.status === "burning" || c.status === "sarvam") activeIdx = idxOf("Reading");
  else activeIdx = 0;

  return steps.map((s, i) => ({
    ...s,
    state: c.status === "error" && i === steps.length - 1
      ? "error"
      : i < activeIdx ? "done" : i === activeIdx ? "active" : "pending",
  }));
}

function Timeline({ c }: { c: CommittedGroup }) {
  const steps = stepsFor(c);
  const doneCount = steps.filter((s) => s.state === "done").length;
  const fillPct = steps.length > 1 ? (doneCount / (steps.length - 1)) * 100 : 0;

  return (
    <div className="mt-2 pt-1">
      <div className="relative flex items-start justify-between">
        {/* Track + fill, positioned through the center of the nodes */}
        <div className="absolute top-3.5 left-4 right-4 h-1 bg-bone-300 rounded-full" />
        <div
          className="absolute top-3.5 left-4 h-1 bg-good rounded-full transition-all duration-500"
          style={{ width: `calc(${Math.min(fillPct, 100)}% - ${fillPct >= 100 ? "32px" : "0px"})`, maxWidth: "calc(100% - 32px)" }}
        />
        {steps.map((s) => (
          <div key={s.label} className="relative z-10 flex flex-col items-center gap-1 w-14">
            <span
              title={s.label}
              className={`w-7 h-7 rounded-full grid place-items-center text-xs shrink-0 border-2 ${
                s.state === "done" ? "bg-good border-good text-white"
                : s.state === "active" ? "bg-warn border-warn text-white animate-pulse"
                : s.state === "error" ? "bg-bad border-bad text-white"
                : "bg-bone-0 border-bone-300 text-ink-300"
              }`}
            >
              {s.state === "done" ? "✓" : s.state === "error" ? "!" : s.icon}
            </span>
            <span className={`text-[9px] text-center leading-tight ${s.state === "pending" ? "text-ink-300" : "text-ink-200 font-semibold"}`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommitPanel({ commit, onDone }: { commit: CommittedGroup[]; onDone: () => void }) {
  const allDone = commit.every((c) => c.status === "done" || c.status === "error");
  const successCount = commit.filter((c) => c.status === "done").length;

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase font-semibold text-ink-300">Processing</div>
          <div className="text-lg font-bold text-ink-100">
            {allDone ? `Done — ${successCount} of ${commit.length} landed` : `Processing ${commit.length} patient${commit.length === 1 ? "" : "s"}…`}
          </div>
        </div>
        {allDone && (
          <div className="flex gap-2">
            <button onClick={onDone} className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">
              Drop more files
            </button>
            <a href="/patients" className="text-xs font-bold px-4 py-1.5 rounded bg-accent text-white hover:opacity-90">
              → Go to Patient List
            </a>
          </div>
        )}
      </div>
      <ul className="divide-y divide-bone-200">
        {commit.map((c) => (
          <li key={c.group_idx} className="py-2 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-ink-100">{c.patient_name}</div>
                <StatusPill status={c.status} />
              </div>
              {c.detail && <div className="text-[11px] text-ink-300">{c.detail}</div>}
              <Timeline c={c} />
            </div>
            {c.status === "done" && c.patient_href && (
              <a href={c.patient_href} className="text-xs text-accent underline mr-2 shrink-0">view</a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusPill({ status }: { status: CommitStatus }) {
  const map: Record<CommitStatus, [string, string]> = {
    idle:    ["Idle",           "bg-bone-200 text-ink-300"],
    burning: ["🔥 Burning PII…", "bg-bad-soft text-bad"],
    sarvam:  ["⇧ Sarvam OCR…",  "bg-warn-soft text-warn"],
    routing: ["Attaching…",     "bg-warn-soft text-warn"],
    done:    ["Done",           "bg-good-soft text-good"],
    error:   ["Error",          "bg-bad-soft text-bad"],
  };
  const [text, cls] = map[status];
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${cls}`}>{text}</span>;
}
