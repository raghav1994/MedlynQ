"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAllStates, getDistricts } from "india-state-district";
import SearchableSelect from "@/components/backendAdmin/SearchableSelect";

const ALL_STATES = getAllStates();

export default function NewHospitalPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", short_name: "", subdomain: "", state: "", city: "", district: "",
    primary_color: "#1a1a1a", accent_color: "#2563eb", logo_initial: "", tagline: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const stateCode = ALL_STATES.find((s) => s.name === form.state)?.code;
  const districtOptions = stateCode ? getDistricts(stateCode) : [];

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/backend-admin/hospitals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error || "Failed to create hospital");
        setSubmitting(false);
        return;
      }
      router.push(`/backend-admin/hospitals/${j.hospital.hospital_id}`);
    } catch (err: any) {
      setError(err?.message ?? "Network error");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link href="/backend-admin" className="text-xs text-slate-400 hover:text-slate-200">← Hospitals</Link>
        <h1 className="text-lg font-bold mt-1">Add a new hospital</h1>
      </header>

      <main className="max-w-lg mx-auto p-6">
        <form onSubmit={onSubmit} className="space-y-4 bg-slate-900 border border-slate-800 rounded-lg p-5">
          <Field label="Hospital name" required value={form.name} onChange={(v) => set("name", v)} placeholder="City General Hospital" />
          <Field label="Short name" required value={form.short_name} onChange={(v) => set("short_name", v)} placeholder="City General" />
          <Field label="Subdomain" required value={form.subdomain} onChange={(v) => set("subdomain", v.toLowerCase())} placeholder="citygeneral" hint="lowercase letters, numbers, hyphens only" />
          <div className="grid grid-cols-2 gap-3">
            <SearchableSelect
              label="State"
              value={form.state}
              onChange={(v) => setForm((f) => ({ ...f, state: v, district: "" }))}
              options={ALL_STATES.map((s) => s.name)}
            />
            <SearchableSelect
              label="District"
              value={form.district}
              onChange={(v) => set("district", v)}
              options={districtOptions}
              disabled={!stateCode}
            />
          </div>
          <Field label="City / Town" required value={form.city} onChange={(v) => set("city", v)} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primary color" value={form.primary_color} onChange={(v) => set("primary_color", v)} type="color" />
            <Field label="Accent color" value={form.accent_color} onChange={(v) => set("accent_color", v)} type="color" />
          </div>
          <Field label="Logo initial" value={form.logo_initial} onChange={(v) => set("logo_initial", v.slice(0, 3))} placeholder="C" hint="1-3 characters, defaults to first letter of name" />
          <Field label="Tagline" value={form.tagline} onChange={(v) => set("tagline", v)} placeholder="General medicine claims, sorted." />

          {error && (
            <div className="text-xs text-red-300 bg-red-950 border border-red-800 rounded px-2 py-1.5">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create hospital"}
          </button>
          <p className="text-[11px] text-slate-500">
            You'll set departments, document requirements, schemes, and logins on the next screen.
          </p>
        </form>
      </main>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, hint, required, type = "text",
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; required?: boolean; type?: string;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase font-semibold text-slate-400">{label}{required && " *"}</label>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={type === "color"
          ? "mt-1 w-full h-9 bg-slate-800 border border-slate-700 rounded cursor-pointer"
          : "mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"}
      />
      {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}
