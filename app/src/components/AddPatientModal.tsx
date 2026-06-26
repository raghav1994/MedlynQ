"use client";

import { useState, useEffect } from "react";
import type { PatientHints, PatientMatchResult } from "@/lib/patientMatch";

type Props = {
  open: boolean;
  onClose: () => void;
  prefill: PatientHints;
  matchResult?: PatientMatchResult;
  onSaved?: (saved: { name: string; mrn: string; age: number; gender: string }) => void;
};

export default function AddPatientModal({ open, onClose, prefill, matchResult, onSaved }: Props) {
  const [name, setName] = useState("");
  const [mrn, setMrn] = useState("");
  const [age, setAge] = useState<string>("");
  const [gender, setGender] = useState<string>("M");
  const [state, setStateField] = useState("");
  const [department, setDepartment] = useState("Oncology");

  useEffect(() => {
    if (!open) return;
    setName(prefill.name ?? "");
    setMrn(prefill.mrn ?? "");
    setAge(prefill.age ? String(prefill.age) : "");
    const g = (prefill.gender ?? "").toLowerCase();
    setGender(g.startsWith("f") ? "F" : "M");
  }, [open, prefill]);

  if (!open) return null;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mrn, age, gender, state, department }),
      });
      const json = await res.json();
      if (!json.ok) {
        setSaveError(json.error || "Save failed");
        setSaving(false);
        return;
      }
      onSaved?.({ name, mrn, age: parseInt(age, 10) || 0, gender });
      setSaving(false);
      onClose();
    } catch (e: any) {
      setSaveError(e?.message || String(e));
      setSaving(false);
    }
  };

  const candidates = matchResult?.candidates ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-ink-100/50 grid place-items-center p-4" onClick={onClose}>
      <div
        className="bg-bone-0 border border-bone-300 rounded-lg p-6 max-w-lg w-full space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink-100">Add new patient</h2>
            <p className="text-xs text-ink-300 mt-1">
              Fields pre-filled from extracted document text. Review and save.
            </p>
          </div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100 text-xl leading-none">×</button>
        </div>

        {candidates.length > 0 && !matchResult?.match && (
          <div className="bg-warn-soft border border-warn/40 rounded p-2 text-xs">
            <div className="font-semibold text-warn mb-1">⚠ Similar existing patients found</div>
            <ul className="space-y-0.5">
              {candidates.slice(0, 3).map((c) => (
                <li key={c.patient.id} className="flex items-center justify-between">
                  <span className="text-ink-200">{c.patient.name} · MRN {c.patient.mrn} · age {c.patient.age}</span>
                  <span className="text-ink-300 font-mono">{Math.round(c.score * 100)}%</span>
                </li>
              ))}
            </ul>
            <div className="text-[10px] text-ink-300 italic mt-1">
              If one of these is your patient, cancel and attach docs to them instead.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Patient name" value={name} onChange={setName} placeholder="Full name" />
          <Field label="MRN / Hospital ID" value={mrn} onChange={setMrn} placeholder="MRN12345" mono />
          <Field label="Age" value={age} onChange={setAge} placeholder="42" />
          <div>
            <label className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">Gender</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full mt-1 text-sm px-2 py-1.5 bg-bone-0 border border-bone-300 rounded focus:outline-none focus:border-accent"
            >
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </div>
          <Field label="State" value={state} onChange={setStateField} placeholder="Karnataka" />
          <Field label="Department" value={department} onChange={setDepartment} placeholder="Oncology" />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name || !mrn || saving}
            className="text-xs font-semibold px-4 py-1.5 bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save patient + attach docs"}
          </button>
        </div>
        {saveError && (
          <div className="text-xs text-bad bg-bad-soft border border-bad/40 rounded px-3 py-2">
            {saveError}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full mt-1 text-sm px-2 py-1.5 bg-bone-0 border border-bone-300 rounded focus:outline-none focus:border-accent ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
