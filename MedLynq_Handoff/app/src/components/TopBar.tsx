"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

type Hit = {
  patient_id: string;
  patient_name: string;
  mrn: string;
  case_id?: string;
  registration_id?: string;
  scheme?: string;
  matched_on: string;
};

export default function TopBar() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/patients/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        setHits(json.ok ? json.hits : []);
        setOpen(true);
      } catch {
        setHits([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <header className="bg-bone-0 border-b border-bone-300 h-14 px-6 flex items-center justify-between">
      <div className="flex-1 max-w-xl relative" ref={wrapRef}>
        <div className="relative">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => q && setOpen(true)}
            placeholder="Search MRN, patient name, registration ID…"
            className="w-full text-sm px-3 py-2 pl-9 bg-bone-100 border border-bone-300 rounded focus:outline-none focus:border-accent focus:bg-bone-0"
          />
          <span className="absolute left-3 top-2 text-ink-300 text-sm">⌕</span>
        </div>

        {open && hits.length > 0 && (
          <div className="absolute z-50 mt-1 w-full bg-bone-0 border border-bone-300 rounded shadow-lg max-h-96 overflow-y-auto">
            {hits.map((h, i) => (
              <Link
                key={i}
                href={h.case_id ? `/patient/${h.patient_id}?case=${h.case_id}` : `/patient/${h.patient_id}`}
                onClick={() => setOpen(false)}
                className="block px-3 py-2 border-b border-bone-200 last:border-0 hover:bg-bone-100 text-sm"
              >
                <div className="font-semibold text-ink-100">{h.patient_name}</div>
                <div className="text-xs text-ink-300 font-mono">
                  {h.mrn}
                  {h.registration_id && <> · {h.registration_id}</>}
                  {h.scheme && <> · {h.scheme}</>}
                </div>
                <div className="text-[10px] text-ink-300 mt-0.5">matched {h.matched_on}</div>
              </Link>
            ))}
          </div>
        )}
        {open && q.trim().length >= 2 && hits.length === 0 && (
          <div className="absolute z-50 mt-1 w-full bg-bone-0 border border-bone-300 rounded shadow text-sm text-ink-300 px-3 py-2">
            No matches for &quot;{q}&quot;.
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 ml-6">
        <Status dot="bad"  label="HIS"    sub="not connected" title="No HIS connector configured." />
        <Status dot="good" label="Server" sub="active"        title="MedLynq dev server is running." />
      </div>
    </header>
  );
}

function Status({ dot, label, sub, title }: { dot: "good" | "warn" | "bad"; label: string; sub: string; title?: string }) {
  const color = dot === "good" ? "bg-good" : dot === "warn" ? "bg-warn" : "bg-bad";
  return (
    <div className="flex items-center gap-1.5 text-xs" title={title}>
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-ink-200 font-medium">{label}</span>
      <span className="text-ink-300">· {sub}</span>
    </div>
  );
}
