"use client";

import { useState, useRef } from "react";
import AppShell from "@/components/AppShell";
import { patients } from "@/lib/mockData";
import { scoreRisk } from "@/lib/risk";
import { requiredDocsByStage } from "@/lib/checklist";
import type { Treatment } from "@/lib/types";

type Job = {
  id: string;
  name: string;
  size: number;
  status: "queued" | "compressing" | "done" | "error";
  result?: {
    original_name: string;
    ai_filename?: string | null;
    renamed?: boolean;
    original_size: number;
    compressed_size: number;
    reduction_pct: number;
    download_url: string;
    doc_type?: string;
    doc_type_confidence?: number;
    doc_type_source?: string;
    page_count?: number;
    fields?: Record<string, string>;
  };
  error?: string;
};

type Session = {
  patient_name?: string;
  patient_mrn?: string;
  treatment: Treatment;
  collected_doc_types: string[];
  low_confidence_doc_types: string[];
};

function fmtBytes(b: number) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(2) + " MB";
}

const treatmentMeta: Record<Treatment, { label: string; icon: string }> = {
  chemo:     { label: "Chemotherapy",          icon: "💊" },
  surgery:   { label: "Surgery",               icon: "🔪" },
  radiation: { label: "Radiation",             icon: "☢️" },
  medicine:  { label: "Medication only · no admission", icon: "💊" },
};

export default function IntakePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<Session>({
    treatment: "chemo",
    collected_doc_types: [],
    low_confidence_doc_types: [],
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function enqueue(files: FileList | File[]) {
    const arr = Array.from(files);
    const next: Job[] = arr.map((f, i) => ({
      id: `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      name: f.name,
      size: f.size,
      status: "queued",
    }));
    setJobs((prev) => [...next, ...prev]);
    runCompression(arr, next.map((j) => j.id));
  }

  async function runCompression(files: File[], ids: string[]) {
    setBusy(true);
    for (let i = 0; i < files.length; i++) {
      const id = ids[i];
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "compressing" } : j)));
      try {
        const form = new FormData();
        form.append("file", files[i]);
        const res = await fetch("/api/compress", { method: "POST", body: form });
        const json = await res.json();
        if (json.ok) {
          setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "done", result: json } : j)));
          setSession((prev) => {
            const next = { ...prev };
            const f = json.fields ?? {};
            if (!next.patient_name && f.patient_name) next.patient_name = f.patient_name;
            if (!next.patient_mrn  && f.mrn)          next.patient_mrn  = f.mrn;
            if (json.doc_type && json.doc_type !== "Unclassified") {
              if (!next.collected_doc_types.includes(json.doc_type)) {
                next.collected_doc_types = [...next.collected_doc_types, json.doc_type];
              }
              if (json.doc_type_confidence !== undefined && json.doc_type_confidence < 0.7) {
                if (!next.low_confidence_doc_types.includes(json.doc_type)) {
                  next.low_confidence_doc_types = [...next.low_confidence_doc_types, json.doc_type];
                }
              }
            }
            return next;
          });
        } else {
          setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "error", error: json.error } : j)));
        }
      } catch (e: any) {
        setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: "error", error: e?.message || String(e) } : j)));
      }
    }
    setBusy(false);
  }

  function clearDone() {
    setJobs((prev) => prev.filter((j) => j.status !== "done"));
  }

  function resetSession() {
    setJobs([]);
    setSession({ treatment: "chemo", collected_doc_types: [], low_confidence_doc_types: [] });
  }

  const totalSaved = jobs.reduce((sum, j) => {
    if (j.status === "done" && j.result) return sum + (j.result.original_size - j.result.compressed_size);
    return sum;
  }, 0);
  const doneCount = jobs.filter((j) => j.status === "done").length;

  const matchedPatient = session.patient_mrn
    ? patients.find((p) => p.mrn.toLowerCase() === session.patient_mrn!.toLowerCase())
    : session.patient_name
    ? patients.find((p) => p.name.toLowerCase() === session.patient_name!.toLowerCase())
    : undefined;

  const risk = scoreRisk({
    treatment: session.treatment,
    present_doc_types: session.collected_doc_types,
    low_confidence_types: session.low_confidence_doc_types,
  });

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-100">Document Intake</h1>
            <p className="text-sm text-ink-300 mt-1">
              Drag-drop patient documents. Lynq compresses each file, classifies it (by filename + content), auto-renames it, and continuously
              scores the case&apos;s query risk against the treatment&apos;s required-doc list.
            </p>
          </div>
          {jobs.length > 0 && (
            <button onClick={resetSession} className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">
              Start new patient session
            </button>
          )}
        </div>

        {/* Treatment dropdown — clarifies it's one type per session */}
        <div className="bg-bone-0 border border-bone-300 rounded-lg p-4 flex items-center gap-4 flex-wrap">
          <label htmlFor="treatment-select" className="text-sm font-semibold text-ink-100 shrink-0">
            Patient came for:
          </label>
          <select
            id="treatment-select"
            value={session.treatment}
            onChange={(e) => setSession((p) => ({ ...p, treatment: e.target.value as Treatment }))}
            className="text-sm font-semibold px-3 py-2 bg-bone-100 border border-bone-300 rounded focus:outline-none focus:border-accent min-w-[260px]"
          >
            {(["chemo", "surgery", "radiation", "medicine"] as Treatment[]).map((t) => (
              <option key={t} value={t}>
                {treatmentMeta[t].icon} {treatmentMeta[t].label}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-300 flex-1 min-w-[260px]">
            The required-doc checklist below is computed from this. Change it and the list updates immediately.
          </p>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Files processed" value={String(doneCount)} />
          <Stat label="Total saved" value={fmtBytes(totalSaved)} tone="good" />
          <Stat label="Queue" value={String(jobs.filter((j) => j.status === "queued" || j.status === "compressing").length)} tone="warn" />
          <Stat label="Query risk" value={risk.score + "%"} tone={risk.band === "high" ? "bad" : risk.band === "medium" ? "warn" : "good"} />
        </div>

        {/* Dropzone + Lynq panel */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files?.length) enqueue(e.dataTransfer.files);
            }}
            onClick={() => fileInput.current?.click()}
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition ${
              dragOver ? "border-accent bg-accent-soft" : "border-bone-300 bg-bone-0 hover:bg-bone-200"
            }`}
          >
            <div className="text-3xl mb-2">📎</div>
            <div className="font-semibold text-ink-100">Drop files here or click to browse</div>
            <div className="text-xs text-ink-300 mt-1">Supported: .pdf, .jpg, .jpeg, .png · Up to 50 MB per file</div>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="hidden"
              onChange={(e) => e.target.files && enqueue(e.target.files)}
            />
          </div>

          <LynqPanel
            session={session}
            matchedPatient={matchedPatient}
            risk={risk}
          />
        </div>

        {/* Job list */}
        {jobs.length > 0 && (
          <div className="bg-bone-0 border border-bone-300 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-bone-300 flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink-100">Intake queue</h2>
              <button
                onClick={clearDone}
                disabled={busy || doneCount === 0}
                className="text-xs px-3 py-1 border border-bone-300 rounded hover:bg-bone-200 disabled:opacity-50"
              >
                Clear completed
              </button>
            </div>
            <ul className="divide-y divide-bone-300">
              {jobs.map((j) => (
                <li key={j.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs text-ink-200 truncate">
                        {j.result?.ai_filename ?? j.name}
                      </div>
                      {j.result?.ai_filename && (
                        <div className="text-[10px] text-ink-300 mt-0.5 truncate">
                          ↻ renamed from <span className="font-mono">{j.name}</span>
                        </div>
                      )}
                      <div className="text-[10px] text-ink-300 mt-0.5">
                        {fmtBytes(j.size)}
                        {j.result && (
                          <> · → <span className="text-good font-semibold">{fmtBytes(j.result.compressed_size)}</span> · saved <span className="text-good font-semibold">{j.result.reduction_pct}%</span></>
                        )}
                        {j.error && <> · <span className="text-bad">{j.error}</span></>}
                      </div>
                    </div>
                    <StatusPill status={j.status} />
                    {j.status === "done" && j.result && (
                      <a href={j.result.download_url} download className="text-xs px-3 py-1 bg-accent text-white rounded hover:opacity-90">
                        Download
                      </a>
                    )}
                  </div>

                  {j.status === "done" && j.result && (j.result.doc_type || (j.result.fields && Object.keys(j.result.fields).length > 0)) && (
                    <div className="mt-2 bg-bone-100 border border-bone-300 rounded p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Lynq detected</span>
                        {j.result.doc_type && j.result.doc_type !== "Unclassified" ? (
                          <>
                            <span className="bg-accent text-white text-[11px] font-semibold px-2 py-0.5 rounded">{j.result.doc_type}</span>
                            {j.result.doc_type_confidence !== undefined && (
                              <span className="text-[10px] text-ink-300">{Math.round(j.result.doc_type_confidence * 100)}% confidence</span>
                            )}
                            {j.result.doc_type_source && (
                              <span className="text-[10px] text-ink-300">· matched via {j.result.doc_type_source}</span>
                            )}
                          </>
                        ) : (
                          <span className="bg-bone-200 text-ink-300 text-[11px] font-semibold px-2 py-0.5 rounded">Unclassified — kept original name</span>
                        )}
                        {typeof j.result.page_count === "number" && j.result.page_count > 0 && (
                          <span className="text-[10px] text-ink-300">· {j.result.page_count} page{j.result.page_count === 1 ? "" : "s"}</span>
                        )}
                      </div>
                      {j.result.fields && Object.keys(j.result.fields).length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                          {Object.entries(j.result.fields).map(([k, v]) => (
                            <div key={k}>
                              <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">{k.replace(/_/g, " ")}</div>
                              <div className="text-ink-100 truncate" title={v}>{v}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-ink-300">
          Note: requires Python 3 + <code>pymupdf</code> + <code>pillow</code> installed. Run once:{" "}
          <code className="bg-bone-200 px-1 rounded">pip install pymupdf pillow</code>
        </p>
      </div>
    </AppShell>
  );
}

function LynqPanel({
  session, matchedPatient, risk,
}: {
  session: Session;
  matchedPatient: ReturnType<typeof Array.prototype.find>;
  risk: ReturnType<typeof scoreRisk>;
}) {
  const bandColor =
    risk.band === "high" ? "text-bad" :
    risk.band === "medium" ? "text-warn" : "text-good";
  const bandBg =
    risk.band === "high" ? "bg-bad-soft border-bad/40" :
    risk.band === "medium" ? "bg-warn-soft border-warn/40" : "bg-good-soft border-good/40";

  const required = requiredDocsByStage(session.treatment);
  const totalRequired = required.pre_auth.length + required.mid_way.length + required.discharge.length;

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-accent text-white grid place-items-center text-[10px] font-bold">L</span>
          <h3 className="text-sm font-bold text-ink-100">Lynq live scan</h3>
        </div>
        <span className="text-[10px] text-ink-300 uppercase tracking-wide">rule-based</span>
      </div>

      {/* Patient match */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold mb-1">Patient</div>
        {!session.patient_name && !session.patient_mrn ? (
          <div className="text-xs text-ink-300 italic">Waiting for first file with patient details…</div>
        ) : matchedPatient ? (
          <div className="bg-good-soft border border-good/40 rounded p-2">
            <div className="text-xs font-semibold text-good">Matched existing</div>
            <div className="text-sm font-bold text-ink-100">{matchedPatient.name}</div>
            <div className="text-[11px] text-ink-300 font-mono">MRN {matchedPatient.mrn} · {matchedPatient.id}</div>
          </div>
        ) : (
          <div className="bg-warn-soft border border-warn/40 rounded p-2">
            <div className="text-xs font-semibold text-warn">New patient · would auto-create</div>
            <div className="text-sm font-bold text-ink-100">{session.patient_name ?? "(name not yet detected)"}</div>
            <div className="text-[11px] text-ink-300 font-mono">MRN {session.patient_mrn ?? "—"}</div>
            <button className="mt-2 text-[10px] font-bold uppercase bg-warn text-white px-2 py-1 rounded hover:opacity-90">
              Create patient
            </button>
          </div>
        )}
      </div>

      {/* Risk */}
      <div className={`rounded p-3 border ${bandBg}`}>
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">Predicted query risk</div>
          <span className={`text-[10px] font-bold uppercase ${bandColor}`}>{risk.band}</span>
        </div>
        <div className={`text-3xl font-bold tabular-nums mt-1 ${bandColor}`}>{risk.score}%</div>
        <ul className="mt-2 text-[11px] text-ink-200 space-y-0.5">
          {risk.reasons.map((r, i) => <li key={i}>· {r}</li>)}
        </ul>
      </div>

      {/* What's strong */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold mb-1">What&apos;s strong ({risk.strong.length})</div>
        <div className="flex flex-wrap gap-1">
          {risk.strong.length === 0 ? (
            <span className="text-[11px] text-ink-300 italic">Nothing collected yet.</span>
          ) : (
            risk.strong.map((s) => (
              <span key={s} className="text-[10px] bg-good-soft text-good border border-good/30 px-1.5 py-0.5 rounded">{s}</span>
            ))
          )}
        </div>
      </div>

      {/* What's missing */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold mb-1">What&apos;s missing ({risk.missing.length})</div>
        <ul className="space-y-1 text-[11px] max-h-44 overflow-y-auto">
          {risk.missing.length === 0 ? (
            <li className="text-good">✓ All required docs accounted for.</li>
          ) : (
            risk.missing.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-2 bg-bad-soft border border-bad/30 px-2 py-1 rounded">
                <span className="text-ink-200">{m.doc_type}</span>
                <span className="text-[9px] uppercase font-bold text-bad">{m.stage.replace("_", " ")}</span>
              </li>
            ))
          )}
        </ul>
      </div>

      {/* Why this list */}
      <details className="bg-bone-100 border border-bone-300 rounded p-2 text-xs">
        <summary className="cursor-pointer font-semibold text-ink-100 select-none">
          Why this list? · {totalRequired} docs required for {treatmentMeta[session.treatment].label}
        </summary>
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-ink-300">
            For <strong>{treatmentMeta[session.treatment].label}</strong> patients, MedLynq tracks the following documents grouped by treatment stage:
          </p>
          <Group title={`Pre-Auth (${required.pre_auth.length})`} items={required.pre_auth} />
          <Group title={`Mid-Way (${required.mid_way.length})`}   items={required.mid_way} />
          <Group title={`Discharge (${required.discharge.length})`} items={required.discharge} />
          <p className="text-[10px] text-ink-300 italic">
            Switching the treatment dropdown at the top rebuilds this list and recalculates the risk score.
          </p>
        </div>
      </details>
    </div>
  );
}

function Group({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-accent font-bold">{title}</div>
      <ul className="ml-2 mt-0.5 list-disc list-inside text-[11px] text-ink-200">
        {items.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color =
    tone === "good" ? "text-good" :
    tone === "warn" ? "text-warn" :
    tone === "bad"  ? "text-bad"  :
                      "text-ink-100";
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
      <div className="text-xs uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
      <div className={`text-2xl font-bold mt-2 ${color}`}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: Job["status"] }) {
  const map = {
    queued: ["Queued", "bg-bone-200 text-ink-300"],
    compressing: ["Processing…", "bg-warn-soft text-warn"],
    done: ["Done", "bg-good-soft text-good"],
    error: ["Error", "bg-bad-soft text-bad"],
  } as const;
  const [text, cls] = map[status];
  return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${cls}`}>{text}</span>;
}
