"use client";

// "+ New pre-auth" trigger — pre-auth always attaches to an existing patient
// (OPD already happened), so this is a lightweight patient search that then
// deep-links into Document Intake for that patient, same pattern as the OPD
// registration success screen's "Upload documents →" link.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Hit = {
  patient_id: string;
  patient_name: string;
  mrn: string;
  case_id?: string;
  registration_id?: string;
  scheme?: string;
  matched_on: string;
};

export default function NewPreAuthModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/patients/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        setHits(json.ok ? json.hits : []);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  function pick(h: Hit) {
    const params = new URLSearchParams({ mrn: h.mrn, patient_id: h.patient_id, name: h.patient_name });
    router.push(`/intake?${params.toString()}`);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-24" onClick={onClose}>
      <div
        className="bg-bone-0 border border-bone-300 rounded-lg shadow-xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-bone-300 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink-100">New pre-auth</h3>
            <p className="text-xs text-ink-300 mt-0.5">Find the patient to start pre-auth paperwork for.</p>
          </div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100 text-lg leading-none">×</button>
        </div>

        <div className="p-4">
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search MRN, patient name, registration ID…"
            className="w-full text-sm px-3 py-2 bg-bone-100 border border-bone-300 rounded focus:outline-none focus:border-accent focus:bg-bone-0"
          />

          <div className="mt-3 max-h-80 overflow-y-auto space-y-1">
            {loading && <div className="text-xs text-ink-300 px-1 py-2">Searching…</div>}
            {!loading && q.trim().length >= 2 && hits.length === 0 && (
              <div className="text-xs text-ink-300 px-1 py-2">
                No patient matches &quot;{q}&quot;. If they haven&apos;t been registered yet, use{" "}
                <a href="/opd" className="text-accent hover:underline">OPD Registration</a> first.
              </div>
            )}
            {hits.map((h, i) => (
              <button
                key={i}
                onClick={() => pick(h)}
                className="w-full text-left px-3 py-2 rounded border border-bone-200 hover:bg-bone-100 hover:border-accent transition"
              >
                <div className="font-semibold text-ink-100 text-sm">{h.patient_name}</div>
                <div className="text-xs text-ink-300 font-mono">
                  {h.mrn}
                  {h.registration_id && <> · {h.registration_id}</>}
                  {h.scheme && <> · {h.scheme}</>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
