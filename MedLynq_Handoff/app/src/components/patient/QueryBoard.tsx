"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Case } from "@/lib/types";
import type { CaseDocument } from "@/lib/mockDocuments";
import type { ChecklistEntry } from "@/lib/checklist";
import { DOC_TYPE_ALIASES } from "@/lib/checklist";
import { queriesForCase, type QueryRound } from "@/lib/mockQueries";
import QueryTimeline from "./QueryTimeline";

const ALLOWED_EXT = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

// Words too generic on their own to identify a specific document (they show
// up in half the catalog's labels — "Report", "Form", "Photo"...) — excluded
// from the significant-word count so a query saying just "report" can't
// match every doc type that happens to end in "Report".
const STOPWORDS = new Set(["the", "and", "for", "of", "or", "a", "an", "to", "with", "this", "that", "is", "are", "in", "on"]);

function significantWords(phrase: string): string[] {
  return phrase.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// Matches free-text query wording against this CASE's actual checklist doc
// types (not a small hand-picked list) — every doc type this case could ever
// need, with the same alias table the Documents & Checklist tab uses, so
// "tumor board certificate" matches even though it was never hand-added to a
// local synonym dict here.
//
// Partial-word overlap, not whole-phrase matching: a real query rarely
// quotes the catalog label verbatim ("Need Drug pouch" should still match
// "Drug Pouch / Wrapper Photo" even though it omits "Wrapper Photo"). An
// alias counts as matched once the query contains at least 2 of its
// significant words (or its one word, for genuinely single-word aliases
// like "Referral") — enough to be specific, not so much that it requires an
// exact quote.
function matchChecklistEntries(query: string, entries: ChecklistEntry[]): ChecklistEntry[] {
  const q = query.toLowerCase();
  if (!q.trim()) return [];
  const seen = new Set<string>();
  const hits: ChecklistEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.doc_type)) continue;
    const aliases = [entry.doc_type, ...(DOC_TYPE_ALIASES[entry.doc_type] ?? [])];
    const isHit = aliases.some((alias) => {
      const words = significantWords(alias);
      if (words.length === 0) return false;
      const needed = words.length <= 1 ? 1 : 2;
      const matchedCount = words.filter((w) => {
        const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}\\b`, "i").test(q);
      }).length;
      return matchedCount >= needed;
    });
    if (isHit) {
      seen.add(entry.doc_type);
      hits.push(entry);
    }
  }
  return hits;
}

export default function QueryBoard({
  c, docs, entries, mrn,
}: {
  c: Case;
  docs: CaseDocument[];
  entries: ChecklistEntry[];
  mrn: string;
}) {
  const router = useRouter();
  const initial = queriesForCase(c.id);
  const [rounds, setRounds] = useState<QueryRound[]>(initial);
  const [newQuery, setNewQuery] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [responseNote, setResponseNote] = useState("");
  const [step, setStep] = useState<"idle" | "matching">("idle");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrFilled, setOcrFilled] = useState(false);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Filenames just landed via this panel, keyed by doc_type — covers the gap
  // between a successful upload and router.refresh() bringing a fresh
  // `entries`/`docs` prop back down, so the row flips to "present" instantly
  // instead of looking like the upload silently did nothing.
  const [justUploaded, setJustUploaded] = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState(false);
  const slotInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // There's no live NHCX API for query *responses* yet (only outbound claim
  // submission has one) — so "sending" a response today means the MEDCO
  // downloads the exact attached files and uploads them on the NHA portal
  // by hand. Zips real files from disk via the same endpoint the Documents
  // tab's "Download All" uses — no placeholder "Send" button that would
  // silently do nothing.
  async function downloadFiles(filenames: string[], zipName: string) {
    if (filenames.length === 0 || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/document/download-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mrn, filenames }),
      });
      if (!res.ok) { setUploadError("Download failed: " + (await res.text())); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setUploadError("Download error: " + (e?.message ?? String(e)));
    } finally {
      setDownloading(false);
    }
  }

  // Screenshot -> OCR, until real NHCX sandbox access lands. MEDCO pastes or
  // uploads a screenshot of the query from the NHA portal instead of typing
  // it out. Uses the local-only RapidOCR path, not Sarvam — a payer query
  // screenshot is already-digital UI text (not a scanned patient document),
  // so there's nothing to redact and no reason to send it to a cloud API.
  async function ocrScreenshot(file: File) {
    setOcrBusy(true);
    setOcrError(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name || "query_screenshot.png");
      const res = await fetch("/api/document/local-ocr", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setOcrError(json.error || "Couldn't read that screenshot.");
        return;
      }
      const text = (json.text ?? "").trim();
      if (!text) {
        setOcrError("No text found in the screenshot — try a clearer crop.");
        return;
      }
      setNewQuery(text);
      setStep("idle");
      setSelectedDocIds(new Set());
      setOcrFilled(true);
    } catch (e: any) {
      setOcrError(e?.message || "OCR request failed.");
    } finally {
      setOcrBusy(false);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          ocrScreenshot(file);
        }
        return;
      }
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) ocrScreenshot(file);
    e.target.value = "";
  }

  async function resolveRound(roundId: string) {
    setResolvingId(roundId);
    try {
      const res = await fetch("/api/query/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: c.id, query_id: roundId }),
      });
      if (res.ok) {
        setRounds((prev) => prev.map((r) => (r.id === roundId ? { ...r, status: "resolved" } : r)));
      }
    } finally {
      setResolvingId(null);
    }
  }

  const matchedEntries = useMemo(() => matchChecklistEntries(newQuery, entries), [newQuery, entries]);
  const currentAttachedFilenames = useMemo(
    () => [...docs.filter((d) => selectedDocIds.has(d.id)).map((d) => d.filename), ...Object.values(justUploaded)],
    [docs, selectedDocIds, justUploaded]
  );

  function toggleDoc(id: string) {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function findAndSuggest() {
    if (!newQuery.trim()) return;
    const presentIds = matchedEntries.filter((e) => e.doc).map((e) => e.doc!.id);
    setSelectedDocIds(new Set(presentIds));
    setStep("matching");
  }

  // Same slot-targeted upload DocumentChecklist uses — force_doc_type trusts
  // the human's unambiguous choice (the matched checklist row) instead of
  // running it back through the classifier.
  async function uploadToSlot(file: File, docType: string) {
    const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      setUploadError("Only PDF, JPG, JPEG, PNG are supported.");
      return;
    }
    setUploadingDocType(docType);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("mrn", mrn);
      form.append("doc_type_hint", docType);
      form.append("force_doc_type", docType);
      form.append("source", "QueryBoard");
      form.append("file", file);
      const res = await fetch("/api/document/land", { method: "POST", body: form });
      const json = await res.json();
      if (!json.ok) {
        setUploadError(`Upload failed: ${json.error}`);
        return;
      }
      setJustUploaded((prev) => ({ ...prev, [docType]: file.name }));
      router.refresh();
    } catch (e: any) {
      setUploadError(e?.message || "Upload failed.");
    } finally {
      setUploadingDocType(null);
    }
  }

  function saveRound() {
    if (!newQuery.trim()) return;
    const attachedCount = currentAttachedFilenames.length;
    const round: QueryRound = {
      id: `q_local_${Date.now()}`,
      case_id: c.id,
      round: rounds.length + 1,
      raw_text: newQuery.trim(),
      raised_by: ocrFilled ? "NHA portal screenshot (OCR)" : "Manual entry",
      raised_on: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      query_type: matchedEntries.length ? "missing_doc" : undefined,
      amount_at_stake: c.claimed_amount,
      status: "responded",
      response: {
        text: responseNote.trim() || (attachedCount ? `Attached ${attachedCount} document${attachedCount === 1 ? "" : "s"} requested by the payer.` : "Manual draft."),
        attached_doc_filenames: currentAttachedFilenames,
        sent_on: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
        drafted_by: "You",
      },
    };
    setRounds((prev) => [...prev, round]);
    setNewQuery("");
    setSelectedDocIds(new Set());
    setJustUploaded({});
    setOcrFilled(false);
    setResponseNote("");
    setStep("idle");
  }

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <Pill label="Rounds" value={String(rounds.length)} />
        <Pill label="Open"      value={String(rounds.filter(r=>r.status==="open").length)}      tone="bad" />
        <Pill label="Responded" value={String(rounds.filter(r=>r.status==="responded").length)} tone="warn" />
        <Pill label="Resolved"  value={String(rounds.filter(r=>r.status==="resolved").length)}  tone="good" />
      </div>

      {/* New query form */}
      <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-ink-100">Log a new query</h4>
          <span className="text-[10px] text-ink-300 uppercase tracking-wide">Round #{rounds.length + 1}</span>
        </div>
        <p className="text-xs text-ink-300 mt-1 mb-3">
          Screenshot the query from the NHA portal and paste it (Ctrl+V) into the box below — Lynq reads it for
          you. Or type it in directly. Either way, Lynq checks it against this case's actual document checklist.
        </p>

        <textarea
          rows={3}
          value={newQuery}
          onChange={(e) => { setNewQuery(e.target.value); setStep("idle"); setSelectedDocIds(new Set()); setJustUploaded({}); }}
          onPaste={handlePaste}
          placeholder='Paste a screenshot here, or type e.g. "ATTACH DRUG POUCH BAR CODE"'
          className="w-full text-sm font-mono px-3 py-2 bg-bone-100 border border-bone-300 rounded focus:outline-none focus:border-accent"
        />

        <div className="flex items-center gap-2 mt-2">
          <label className="text-xs font-semibold text-accent hover:underline cursor-pointer">
            Or upload a screenshot
            <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
          </label>
          {ocrBusy && <span className="text-xs text-ink-300">Reading screenshot…</span>}
        </div>
        {ocrError && <div className="text-xs text-warn mt-1">{ocrError}</div>}
        {!ocrBusy && ocrFilled && (
          <div className="text-[10px] text-ink-300 mt-1 italic">
            Review the text above before saving — OCR can misread a word or two.
          </div>
        )}

        {step === "idle" && (
          <button
            onClick={findAndSuggest}
            disabled={!newQuery.trim()}
            className="mt-2 bg-accent text-white text-sm font-semibold px-4 py-2 rounded hover:opacity-90 disabled:opacity-40"
          >
            Suggest docs to attach
          </button>
        )}

        {step === "matching" && (
          <div className="mt-3 space-y-3">
            <div className="text-xs">
              <span className="font-semibold text-ink-100">Lynq match: </span>
              {matchedEntries.length > 0 ? (
                <span>
                  Looks like the payer is asking for{" "}
                  <span className="font-bold text-accent">{matchedEntries.map((e) => e.doc_type).join(", ")}</span>.
                </span>
              ) : (
                <span className="text-ink-300">
                  No keyword match — may need clinical clarification. Attach docs manually below.
                </span>
              )}
            </div>

            {matchedEntries.length > 0 && (
              <div className="space-y-2">
                {matchedEntries.map((entry) => {
                  const isPresent = !!entry.doc;
                  const uploadedName = justUploaded[entry.doc_type];
                  const isUploading = uploadingDocType === entry.doc_type;
                  return (
                    <div
                      key={entry.doc_type}
                      className={`flex items-center gap-2 p-2 rounded border text-xs ${
                        isPresent || uploadedName ? "border-good bg-good-soft" : "border-warn bg-warn-soft"
                      }`}
                    >
                      {isPresent ? (
                        <input
                          type="checkbox"
                          checked={selectedDocIds.has(entry.doc!.id)}
                          onChange={() => toggleDoc(entry.doc!.id)}
                          className="accent-accent"
                        />
                      ) : (
                        <span className="w-4 shrink-0 text-center">{uploadedName ? "✓" : "✗"}</span>
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="font-semibold text-ink-100 block truncate">{entry.doc_type}</span>
                        <span className="text-ink-300 truncate">
                          {isPresent ? entry.doc!.filename : uploadedName ? `Uploaded: ${uploadedName}` : "Not on file for this case"}
                        </span>
                      </span>
                      {!isPresent && !uploadedName && (
                        <>
                          <input
                            ref={(el) => { slotInputRefs.current[entry.doc_type] = el; }}
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadToSlot(f, entry.doc_type); e.target.value = ""; }}
                          />
                          <button
                            onClick={() => slotInputRefs.current[entry.doc_type]?.click()}
                            disabled={isUploading}
                            className="text-[10px] font-bold uppercase bg-warn text-white px-2 py-1 rounded hover:opacity-90 disabled:opacity-50 shrink-0"
                          >
                            {isUploading ? "Uploading…" : "Upload"}
                          </button>
                        </>
                      )}
                      {(isPresent || uploadedName) && (
                        <span className="text-[9px] font-bold uppercase bg-good text-white px-1.5 py-0.5 rounded shrink-0">
                          on file
                        </span>
                      )}
                    </div>
                  );
                })}
                {uploadError && <div className="text-xs text-warn">{uploadError}</div>}
              </div>
            )}

            {matchedEntries.length === 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-300 font-semibold mb-2">
                  Select docs to attach
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                  {docs.map((d) => {
                    const isSelected = selectedDocIds.has(d.id);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-xs ${
                          isSelected ? "border-accent bg-accent-soft" : "border-bone-300 bg-bone-100 hover:bg-bone-200"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleDoc(d.id)}
                          className="accent-accent"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="font-semibold text-ink-100 block truncate">{d.filename}</span>
                          <span className="text-ink-300 truncate">{d.doc_type}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {currentAttachedFilenames.length > 0 && (
              <div className="flex items-center justify-between gap-2 bg-bone-100 border border-bone-300 rounded p-2">
                <span className="text-xs text-ink-200">
                  {currentAttachedFilenames.length} file{currentAttachedFilenames.length === 1 ? "" : "s"} ready to send.
                  No NHCX query-response API yet — download and upload on the NHA portal yourself for now.
                </span>
                <button
                  onClick={() => downloadFiles(currentAttachedFilenames, `${mrn}_query_round${rounds.length + 1}.zip`)}
                  disabled={downloading}
                  className="text-xs font-semibold px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200 disabled:opacity-40 shrink-0"
                >
                  {downloading ? "Zipping…" : "↓ Download"}
                </button>
              </div>
            )}

            <div>
              <label className="text-xs uppercase tracking-wide text-ink-300 font-semibold mb-1 block">
                Message to the payer (optional)
              </label>
              <textarea
                rows={2}
                value={responseNote}
                onChange={(e) => setResponseNote(e.target.value)}
                placeholder="e.g. Attached the tumor board certificate as requested. Please process the pre-auth."
                className="w-full text-sm px-3 py-2 bg-bone-100 border border-bone-300 rounded focus:outline-none focus:border-accent"
              />
            </div>

            <div className="flex gap-2 pt-2 border-t border-bone-300">
              <button
                onClick={saveRound}
                disabled={selectedDocIds.size === 0 && Object.keys(justUploaded).length === 0 && !responseNote.trim()}
                className="bg-ink-100 text-white text-sm font-semibold px-4 py-2 rounded hover:opacity-90 disabled:opacity-40"
              >
                Save round + record response
              </button>
              <button
                onClick={() => { setStep("idle"); setSelectedDocIds(new Set()); setJustUploaded({}); setResponseNote(""); }}
                className="text-sm px-4 py-2 border border-bone-300 rounded hover:bg-bone-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div>
        <h4 className="text-sm font-bold text-ink-100 mb-3">Query history · {rounds.length} round{rounds.length === 1 ? "" : "s"}</h4>
        <QueryTimeline rounds={rounds} onResolve={resolveRound} resolvingId={resolvingId} onDownload={downloadFiles} downloading={downloading} />
      </div>
    </div>
  );
}

function Pill({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color =
    tone === "good" ? "text-good border-good/40 bg-good-soft" :
    tone === "warn" ? "text-warn border-warn/40 bg-warn-soft" :
    tone === "bad"  ? "text-bad border-bad/40 bg-bad-soft" :
                      "text-ink-100 border-bone-300 bg-bone-100";
  return (
    <div className={`border rounded px-2 py-1.5 ${color}`}>
      <div className="text-[9px] uppercase tracking-wide font-semibold opacity-70">{label}</div>
      <div className="text-base font-bold mt-0.5">{value}</div>
    </div>
  );
}
