"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import StatusBadge from "./StatusBadge";
import AgingPill from "./AgingPill";
import NewPreAuthModal from "./NewPreAuthModal";
import type { Case } from "@/lib/types";
import { patientName, folderKey } from "@/lib/mockData";

type ResolvedCase = Case & { _patient_name?: string; _folder_key?: string };

function rupees(n: number | null) {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

export default function PatientTable({ cases }: { cases: ResolvedCase[] }) {
  // Local rename map so the row updates immediately after save (server re-fetch
  // happens on next full navigation — this keeps the UI responsive in between).
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [showNewPreAuth, setShowNewPreAuth] = useState(false);

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg overflow-hidden">
      <div className="p-4 border-b border-bone-300 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-ink-100">Patient Admissions &amp; Claims</h2>
          <p className="text-xs text-ink-300">{cases.length} cases · pre-auth → admitted → discharged → submitted → approved → paid</p>
        </div>
        <div className="flex gap-2">
          <button className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">Export</button>
          <button
            onClick={() => setShowNewPreAuth(true)}
            className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:opacity-90"
          >
            + New pre-auth
          </button>
        </div>
      </div>

      {showNewPreAuth && <NewPreAuthModal onClose={() => setShowNewPreAuth(false)} />}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bone-200 border-b border-bone-300">
            <tr className="text-left text-xs uppercase tracking-wide text-ink-300">
              <th className="px-4 py-2 font-semibold">Case</th>
              <th className="px-4 py-2 font-semibold">Patient_MRN</th>
              <th className="px-4 py-2 font-semibold">Scheme / Payer</th>
              <th className="px-4 py-2 font-semibold">Procedure</th>
              <th className="px-4 py-2 font-semibold">Stage</th>
              <th className="px-4 py-2 font-semibold text-right">Claimed</th>
              <th className="px-4 py-2 font-semibold text-right">Approved</th>
              <th className="px-4 py-2 font-semibold text-center">Age</th>
              <th className="px-4 py-2 font-semibold text-center">Flags</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c, idx) => (
              <tr
                key={c.id}
                className={(idx % 2 === 0 ? "bg-bone-0" : "bg-bone-100") + " hover:bg-accent-soft/50 cursor-pointer transition"}
              >
                <td className="px-4 py-3">
                  <Link href={`/patient/${c.patient_id}?case=${c.id}`} className="block">
                    <div className="font-mono text-xs text-ink-200 flex items-center gap-1.5 flex-wrap">
                      {c.registration_id}
                      {c.entry_mode === ("his_feed" as any) && (
                        <span
                          className="bg-good-soft text-good text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                          title="Admission received from the hospital's HIS via HL7 ADT^A04"
                        >
                          via HIS
                        </span>
                      )}
                      {c.entry_mode === ("doc_router_auto" as any) && (
                        <span
                          className="bg-accent-soft text-accent text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                          title="Patient auto-created by Smart Drop (document router)"
                        >
                          via Smart Drop
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-300 font-mono">{c.id.slice(0, 12)}…</div>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="block">
                    {editing === c.patient_id ? (
                      <NameEditor
                        initial={renames[c.patient_id] ?? c._patient_name ?? patientName(c.patient_id)}
                        patientId={c.patient_id}
                        onSaved={(name) => { setRenames((r) => ({ ...r, [c.patient_id]: name })); setEditing(null); }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <div
                        onDoubleClick={(e) => { e.preventDefault(); setEditing(c.patient_id); }}
                        title="Double-click to rename"
                      >
                        <Link href={`/patient/${c.patient_id}?case=${c.id}`}>
                          <span className="font-semibold text-ink-100 hover:underline">
                            {renames[c.patient_id] ?? c._patient_name ?? patientName(c.patient_id)}
                          </span>
                          {c.entry_mode === ("doc_router_auto" as any) && !renames[c.patient_id] && (
                            <span className="ml-1.5 text-[10px] font-normal text-ink-300 italic">(auto-created)</span>
                          )}
                        </Link>
                        <div className="text-xs text-ink-300 font-mono">{c._folder_key ?? folderKey(c.patient_id)}</div>
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-ink-100">{c.scheme}</div>
                  <div className="text-xs text-ink-300">{c.payer}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-ink-100">{c.procedure_code}</div>
                  <div className="text-xs text-ink-300 max-w-[18ch] truncate" title={c.procedure_name}>{c.procedure_name}</div>
                </td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3 text-right tabular-nums">{rupees(c.claimed_amount)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{rupees(c.approved_amount)}</td>
                <td className="px-4 py-3 text-center"><AgingPill days={c.age_days} /></td>
                <td className="px-4 py-3 text-center">
                  <div className="flex justify-center gap-1">
                    {c.missing_docs > 0 && (
                      <span className="bg-bad-soft text-bad text-[10px] font-semibold px-2 py-0.5 rounded-full" title="missing documents">
                        {c.missing_docs} miss
                      </span>
                    )}
                    {c.open_queries > 0 && (
                      <span className="bg-warn-soft text-warn text-[10px] font-semibold px-2 py-0.5 rounded-full" title="open queries">
                        {c.open_queries} Q
                      </span>
                    )}
                    {c.missing_docs === 0 && c.open_queries === 0 && (
                      <span className="text-good text-xs">✓ clean</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-bone-300 text-xs text-ink-300 flex items-center justify-between">
        <div>{cases.length} of {cases.length} cases · <span className="italic">double-click a name to rename</span></div>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 border border-bone-300 rounded disabled:opacity-50" disabled>‹</button>
          <span>Page 1</span>
          <button className="px-2 py-1 border border-bone-300 rounded disabled:opacity-50" disabled>›</button>
        </div>
      </div>
    </div>
  );
}

function NameEditor({
  initial, patientId, onSaved, onCancel,
}: { initial: string; patientId: string; onSaved: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initial.trim()) { onCancel(); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/patients/${encodeURIComponent(patientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Save failed");
      onSaved(trimmed);
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        disabled={saving}
        className="w-full px-2 py-1 text-sm border border-accent rounded font-semibold text-ink-100 focus:outline-none"
      />
      {error && <div className="text-[10px] text-bad">{error}</div>}
      <div className="text-[10px] text-ink-300 italic">Enter to save · Esc to cancel</div>
    </div>
  );
}
