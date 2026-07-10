"use client";

import { useState } from "react";
import type { Case } from "@/lib/types";
import type { CaseDocument } from "@/lib/mockDocuments";
import { queriesForCase, type QueryRound } from "@/lib/mockQueries";
import QueryTimeline from "./QueryTimeline";

// Keyword + synonym matcher — same as before, reused for new-query suggestions
const SYNONYMS: Record<string, string[]> = {
  "Latest Pathology (HPE)": ["hpe", "histopath", "histopathology", "biopsy", "pathology"],
  "Post Surgery Photo":     ["post op", "post-op", "post surgery", "wound", "ot photo", "ot image"],
  "Discharge Summary":      ["discharge", "ds", "summary"],
  "Hospital Bill":          ["bill", "invoice", "billing"],
  "Chemo Chart":            ["chemo", "chemotherapy", "protocol", "regimen", "chart"],
  "Drug Pouch / Wrapper Photo": ["drug", "pouch", "barcode", "wrapper", "trastuzumab"],
  "CBC / LFT / KFT Profile":["cbc", "lft", "kft", "blood count", "blood profile"],
  "Consent Form":           ["consent"],
  "Patient ID":             ["aadhaar", "id proof", "identity"],
  "Referral":               ["referral", "letter"],
  "Registration Copy":      ["registration"],
  "Clinical Vitals Log":    ["vitals", "vital", "bp", "pulse"],
  "Prior Imaging (CT/MRI/X-ray)": ["imaging", "x-ray", "ct", "mri", "scan"],
  "OT Notes":               ["ot notes", "operation theatre"],
  "Anaesthesia Note":       ["anaesthesia", "anesthesia"],
};

function matchDocType(query: string): string[] {
  const q = query.toLowerCase();
  const hits: string[] = [];
  for (const [doc, syns] of Object.entries(SYNONYMS)) {
    if (syns.some((s) => q.includes(s))) hits.push(doc);
  }
  return hits;
}

export default function QueryBoard({ c, docs }: { c: Case; docs: CaseDocument[] }) {
  const initial = queriesForCase(c.id);
  const [rounds, setRounds] = useState<QueryRound[]>(initial);
  const [newQuery, setNewQuery] = useState("");
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"idle" | "matching" | "review">("idle");
  const [resolvingId, setResolvingId] = useState<string | null>(null);

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

  const suggestedTypes = matchDocType(newQuery);
  const suggestedDocs = docs.filter((d) => suggestedTypes.includes(d.doc_type));

  function toggleDoc(id: string) {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function findAndSuggest() {
    if (!newQuery.trim()) return;
    setSelectedDocs(new Set(suggestedDocs.map((d) => d.id)));
    setStep("matching");
  }

  function saveRound() {
    if (!newQuery.trim()) return;
    const attached = docs.filter((d) => selectedDocs.has(d.id));
    const round: QueryRound = {
      id: `q_local_${Date.now()}`,
      case_id: c.id,
      round: rounds.length + 1,
      raw_text: newQuery.trim(),
      raised_by: "Manual entry",
      raised_on: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      query_type: suggestedTypes.length ? "missing_doc" : undefined,
      amount_at_stake: c.claimed_amount,
      status: "responded",
      response: {
        text: attached.length ? `Attached ${attached.length} document${attached.length === 1 ? "" : "s"} requested by the payer.` : "Manual draft.",
        attached_doc_filenames: attached.map((d) => d.filename),
        sent_on: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
        drafted_by: "You",
      },
    };
    setRounds((prev) => [...prev, round]);
    setNewQuery("");
    setSelectedDocs(new Set());
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
          Paste the insurer's query text. Lynq uses a synonym dictionary to suggest which docs to attach.
        </p>

        <textarea
          rows={3}
          value={newQuery}
          onChange={(e) => { setNewQuery(e.target.value); setStep("idle"); setSelectedDocs(new Set()); }}
          placeholder='e.g. "ATTACH DRUG POUCH BAR CODE" or "PROVIDE POST OP HPE REPORT"'
          className="w-full text-sm font-mono px-3 py-2 bg-bone-100 border border-bone-300 rounded focus:outline-none focus:border-accent"
        />

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
              {suggestedTypes.length > 0 ? (
                <span>
                  Looks like the payer is asking for{" "}
                  <span className="font-bold text-accent">{suggestedTypes.join(", ")}</span>.
                </span>
              ) : (
                <span className="text-ink-300">
                  No keyword match — may need clinical clarification. Attach docs manually below.
                </span>
              )}
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-ink-300 font-semibold mb-2">
                Select docs to attach
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                {docs.map((d) => {
                  const isSuggested = suggestedTypes.includes(d.doc_type);
                  const isSelected = selectedDocs.has(d.id);
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
                      {isSuggested && (
                        <span className="text-[9px] font-bold uppercase bg-accent text-white px-1.5 py-0.5 rounded">
                          suggested
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-bone-300">
              <button
                onClick={saveRound}
                disabled={selectedDocs.size === 0}
                className="bg-ink-100 text-white text-sm font-semibold px-4 py-2 rounded hover:opacity-90 disabled:opacity-40"
              >
                Save round + record response
              </button>
              <button
                onClick={() => { setStep("idle"); setSelectedDocs(new Set()); }}
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
        <QueryTimeline rounds={rounds} onResolve={resolveRound} resolvingId={resolvingId} />
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
