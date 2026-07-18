"use client";

// Global API/integration settings editor (owner-only). Every hospital shares
// these credentials — one Sarvam AI account, one NHCX gateway — so unlike
// the Document Catalog there's no per-hospital dimension here. Values are
// masked on read: once saved, a secret only ever shows as "••••1234", never
// its full contents, so this page is safe to have open on a shared screen.

import { useState } from "react";
import { useRouter } from "next/navigation";

type MaskedField = { configured: boolean; hint?: string; value?: string };
type MaskedSettings = Record<string, MaskedField>;

async function api(url: string, body: any) {
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || "Save failed");
  return j;
}

type FieldSpec = { key: string; label: string; secret: boolean; placeholder: string; hint?: string };

const SARVAM_FIELDS: FieldSpec[] = [
  { key: "sarvam_api_key", label: "API key", secret: true, placeholder: "sk_...", hint: "Powers Lynq's document OCR (Doc Intelligence) and identity extraction." },
  { key: "sarvam_chat_model", label: "Chat model", secret: false, placeholder: "sarvam-30b" },
  { key: "sarvam_doc_lang", label: "OCR language", secret: false, placeholder: "en-IN" },
  { key: "sarvam_doc_format", label: "OCR output format", secret: false, placeholder: "md" },
];

const NHCX_FIELDS: FieldSpec[] = [
  { key: "nhcx_endpoint", label: "Gateway URL", secret: false, placeholder: "https://...", hint: "Where claim/pre-auth bundles are sent. Defaults to the local mock until a real NHCX URL is set." },
  { key: "nhcx_internal_secret", label: "Internal secret", secret: true, placeholder: "random string", hint: "Server-to-server secret between MedLynq and its own mock NHCX endpoint." },
];

export default function ApiSettingsManager({ settings }: { settings: MaskedSettings }) {
  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Sarvam AI"
        description="One shared account across every hospital — OCR + identity extraction for the whole platform."
        fields={SARVAM_FIELDS}
        settings={settings}
      />
      <SettingsGroup
        title="NHCX gateway"
        description="National Health Claims Exchange — where pre-auth/claim submissions go out."
        fields={NHCX_FIELDS}
        settings={settings}
      />
    </div>
  );
}

function SettingsGroup({
  title, description, fields, settings,
}: { title: string; description: string; fields: FieldSpec[]; settings: MaskedSettings }) {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = fields.some((f) => (form[f.key] ?? "").trim() !== "");

  async function save() {
    setSaving(true); setError(null);
    try {
      await api("/api/backend-admin/settings", form);
      setForm({});
      setSavedAt(Date.now());
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="text-[11px] text-slate-500 mb-4">{description}</p>

      <div className="space-y-3">
        {fields.map((f) => {
          const current = settings[f.key];
          return (
            <div key={f.key}>
              <label className="text-[10px] uppercase font-semibold text-slate-400">{f.label}</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type={f.secret ? "password" : "text"}
                  value={form[f.key] ?? ""}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder={current?.configured ? (current.hint ?? current.value ?? "configured") : f.placeholder}
                  className="flex-1 px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className={`text-[11px] font-semibold whitespace-nowrap ${current?.configured ? "text-green-300" : "text-slate-500"}`}>
                  {current?.configured ? "Set" : "Using .env default"}
                </span>
              </div>
              {f.hint && <p className="text-[10px] text-slate-500 mt-0.5">{f.hint}</p>}
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-300 mt-3">{error}</p>}
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="text-xs font-semibold px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {savedAt && !dirty && <span className="text-[11px] text-green-300">Saved</span>}
      </div>
    </div>
  );
}
