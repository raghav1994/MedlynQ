"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Patient } from "@/lib/types";

// Root cause worth documenting here: when a patient is auto-created (Smart
// Drop / auto-detected from a document bag), the NAME comes from whichever
// doc's identity extraction landed first — often OCR off a low-quality scan,
// or a MEDCO's manual typo at OPD registration. Nothing here cross-checks
// that first name against later, cleaner documents (e.g. a proper OPD panel
// card). This inline editor is the fix: correct it once it's noticed, right
// from the page where the MEDCO is actually looking at the real documents.
export default function PatientIdentity({ p, hospital }: { p: Patient; hospital: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(p.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === p.name.trim()) { setEditing(false); setValue(p.name); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/patients/${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Save failed");
      setEditing(false);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
      <h3 className="text-sm font-bold text-ink-100 mb-3 flex items-center gap-2">
        <span>👤</span> Patient Identity
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">NAME</div>
          {editing ? (
            <div className="mt-0.5">
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); save(); }
                  else if (e.key === "Escape") { e.preventDefault(); setEditing(false); setValue(p.name); }
                }}
                disabled={saving}
                className="w-full px-1.5 py-0.5 text-sm border border-accent rounded font-semibold text-ink-100 focus:outline-none"
              />
              {error && <div className="text-[10px] text-bad mt-0.5">{error}</div>}
            </div>
          ) : (
            <div
              className="text-sm text-ink-100 mt-0.5 cursor-pointer hover:underline decoration-dotted"
              onDoubleClick={() => setEditing(true)}
              title="Double-click to correct the name"
            >
              {p.name}
            </div>
          )}
        </div>
        <Field label="MRN" value={p.mrn} mono />
        <Field label="GENDER" value={p.gender === "M" ? "Male" : p.gender === "F" ? "Female" : "Other"} />
        <Field label="AGE" value={p.age ? p.age + " Years" : "—"} />
        <Field label="HOSPITAL ID" value={p.hospital_id} mono />
      </div>
      <div className="mt-3 pt-3 border-t border-bone-300 space-y-2 text-xs">
        <Field label="HOSPITAL" value={hospital} block />
        <Field label="LOCATION" value={p.district || p.state ? `${p.district || "—"}, ${p.state || "—"}` : "—"} block />
      </div>
    </div>
  );
}

function Field({ label, value, mono, block }: { label: string; value: string; mono?: boolean; block?: boolean }) {
  return (
    <div className={block ? "" : "min-w-0"}>
      <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
      <div className={`text-sm text-ink-100 mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
