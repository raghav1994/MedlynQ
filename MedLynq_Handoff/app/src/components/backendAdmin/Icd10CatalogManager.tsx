"use client";

// ICD-10 code catalog editor (owner-only). WHO's own crawled catalog
// (data/icd10_who_full.csv, 10,673 codes) is never edited directly — every
// add/edit/delete here writes to db/icd10_overrides.json instead, layered
// on top at lookup time. That keeps the bulk WHO import safe from a bad
// edit and makes every change here instantly reversible.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Suggestion = { code: string; display: string };
type OverrideRow = {
  code: string;
  display: string;
  status: "added" | "edited" | "deleted";
  base_display?: string;
};

async function api(url: string, method: string, body?: any) {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `${method} ${url} failed`);
  return j;
}

const STATUS_LABEL: Record<OverrideRow["status"], string> = {
  added: "Added by you",
  edited: "Edited by you",
  deleted: "Hidden by you",
};
const STATUS_COLOR: Record<OverrideRow["status"], string> = {
  added: "text-green-300",
  edited: "text-blue-300",
  deleted: "text-red-300",
};

export default function Icd10CatalogManager({ initialOverrides }: { initialOverrides: OverrideRow[] }) {
  const router = useRouter();
  const [overrides, setOverrides] = useState(initialOverrides);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingDisplay, setEditingDisplay] = useState("");
  const [addForm, setAddForm] = useState<{ code: string; display: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const r = await api(`/api/backend-admin/icd10?q=${encodeURIComponent(q)}`, "GET");
      setResults(r.search || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function startEdit(code: string, currentDisplay: string) {
    setEditingCode(code);
    setEditingDisplay(currentDisplay);
    setAddForm(null);
  }

  async function saveEdit() {
    if (!editingCode) return;
    setSaving(true); setError(null);
    try {
      const r = await api("/api/backend-admin/icd10", "POST", { code: editingCode, display: editingDisplay });
      setOverrides(r.overrides);
      setEditingCode(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveAdd() {
    if (!addForm) return;
    setSaving(true); setError(null);
    try {
      const r = await api("/api/backend-admin/icd10", "POST", addForm);
      setOverrides(r.overrides);
      setAddForm(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeCode(code: string, display: string) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Hide "${code} — ${display}" from lookups and search? This can be undone from "Your changes" below.`)) return;
    try {
      const r = await api(`/api/backend-admin/icd10/${encodeURIComponent(code)}`, "DELETE");
      setOverrides(r.overrides);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function restoreCode(code: string) {
    try {
      const r = await api(`/api/backend-admin/icd10/${encodeURIComponent(code)}/restore`, "POST");
      setOverrides(r.overrides);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h3 className="text-sm font-bold">Search WHO ICD-10 catalog (10,673 codes)</h3>
          <button
            onClick={() => { setAddForm({ code: "", display: "" }); setEditingCode(null); }}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
          >
            {addForm ? "Cancel" : "+ Add code"}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          Search by code or diagnosis word to find something to edit or hide. Editing/adding here
          never touches the crawled WHO file itself — changes live in a small overrides file layered
          on top, so they're always reversible.
        </p>

        {addForm && (
          <AddOrEditRow
            code={addForm.code}
            display={addForm.display}
            codeEditable
            onChangeCode={(c) => setAddForm((f) => (f ? { ...f, code: c } : f))}
            onChangeDisplay={(d) => setAddForm((f) => (f ? { ...f, display: d } : f))}
            onCancel={() => setAddForm(null)}
            onSave={saveAdd}
            saving={saving}
          />
        )}
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}

        <input
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search a code (C50.9) or diagnosis word (breast cancer)…"
          className="mt-3 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {searching && <p className="text-[11px] text-slate-500 mt-2">Searching…</p>}

        {results.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {results.map((r) =>
              editingCode === r.code ? (
                <AddOrEditRow
                  key={r.code}
                  code={r.code}
                  display={editingDisplay}
                  onChangeDisplay={setEditingDisplay}
                  onCancel={() => setEditingCode(null)}
                  onSave={saveEdit}
                  saving={saving}
                />
              ) : (
                <div key={r.code} className="flex items-start justify-between gap-3 bg-slate-800 rounded px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">
                      {r.code} <span className="text-slate-400 font-normal">— {r.display}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => startEdit(r.code, r.display)} className="text-[11px] text-blue-300 hover:text-blue-200">Edit</button>
                    <button onClick={() => removeCode(r.code, r.display)} className="text-[11px] text-red-300 hover:text-red-200">Hide</button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h3 className="text-sm font-bold mb-1">Your changes ({overrides.length})</h3>
        <p className="text-[11px] text-slate-500 mb-3">
          Every code you've added, edited, or hidden. WHO's own catalog is untouched — this is
          entirely a local overlay.
        </p>
        {overrides.length === 0 && (
          <p className="text-xs text-slate-500">No changes yet — search above to add or edit a code.</p>
        )}
        <div className="space-y-1.5">
          {overrides.map((o) => (
            <div key={o.code} className="flex items-start justify-between gap-3 bg-slate-800 rounded px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {o.code} <span className="text-slate-400 font-normal">— {o.display}</span>
                </div>
                <div className="text-[11px] mt-0.5">
                  <span className={STATUS_COLOR[o.status]}>{STATUS_LABEL[o.status]}</span>
                  {o.status !== "added" && o.base_display && (
                    <span className="text-slate-500"> · WHO original: {o.base_display}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {o.status === "deleted" ? (
                  <button onClick={() => restoreCode(o.code)} className="text-[11px] text-green-300 hover:text-green-200">Restore</button>
                ) : (
                  <>
                    <button onClick={() => startEdit(o.code, o.display)} className="text-[11px] text-blue-300 hover:text-blue-200">Edit</button>
                    <button onClick={() => removeCode(o.code, o.display)} className="text-[11px] text-red-300 hover:text-red-200">Hide</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddOrEditRow({
  code, display, codeEditable, onChangeCode, onChangeDisplay, onCancel, onSave, saving,
}: {
  code: string; display: string; codeEditable?: boolean;
  onChangeCode?: (v: string) => void; onChangeDisplay: (v: string) => void;
  onCancel: () => void; onSave: () => Promise<void>; saving: boolean;
}) {
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit() {
    setLocalError(null);
    if (codeEditable && !code.trim()) { setLocalError("Code is required"); return; }
    if (!display.trim()) { setLocalError("Description is required"); return; }
    try {
      await onSave();
    } catch (e: any) {
      setLocalError(e.message);
    }
  }

  return (
    <div className="bg-slate-800 border border-blue-700 rounded px-3 py-3 space-y-2 mt-2">
      {codeEditable ? (
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-400">Code</label>
          <input
            value={code}
            onChange={(e) => onChangeCode?.(e.target.value)}
            placeholder="e.g. C61"
            className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-900 text-slate-100 font-mono"
          />
        </div>
      ) : (
        <div className="text-sm font-semibold font-mono">{code}</div>
      )}
      <div>
        <label className="text-[10px] uppercase font-semibold text-slate-400">Description</label>
        <input
          value={display}
          onChange={(e) => onChangeDisplay(e.target.value)}
          placeholder="e.g. Malignant neoplasm of prostate"
          className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-900 text-slate-100"
        />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={saving} className="text-xs font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-200">Cancel</button>
        {localError && <span className="text-xs text-red-300">{localError}</span>}
      </div>
    </div>
  );
}
