"use client";

// Global Document Catalog editor (owner-only). The master list of document
// definitions every hospital draws from. Editing an entry live-propagates to
// every hospital using it (unless that hospital detached it with a local
// edit); deleting detaches hospitals rather than dropping their requirements.

import { useState } from "react";
import { useRouter } from "next/navigation";

type CatalogEntry = {
  doc_type: string;
  label: string;
  anchors: string[];
  extraction_keys?: string[];
  category: string;
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

function slugify(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

type EntryForm = { doc_type: string; label: string; anchors: string; category: string };

export default function CatalogManager({ catalog }: { catalog: CatalogEntry[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [activeTab, setActiveTab] = useState<string>("All");

  const categories = Array.from(new Set(catalog.map((c) => c.category)));

  const byCategory = new Map<string, CatalogEntry[]>();
  for (const c of catalog) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c);
  }
  const q = filter.trim().toLowerCase();
  const visible = (entries: CatalogEntry[]) =>
    q ? entries.filter((e) => e.label.toLowerCase().includes(q) || e.doc_type.includes(q)) : entries;

  // Typing a search jumps to "All" so results aren't hidden behind a tab
  // that doesn't happen to be selected.
  function onFilterChange(v: string) {
    setFilter(v);
    if (v.trim() && activeTab !== "All") setActiveTab("All");
  }

  const tabs = ["All", ...categories];
  const visibleCategoryEntries = Array.from(byCategory.entries())
    .map(([cat, entries]) => [cat, visible(entries)] as const)
    .filter(([cat, shown]) => shown.length > 0 && (activeTab === "All" || activeTab === cat));

  async function save(originalDocType: string | null, form: EntryForm) {
    setError(null);
    const doc_type = slugify(form.doc_type);
    const anchors = form.anchors.split(",").map((a) => a.trim()).filter(Boolean);
    if (!doc_type || !form.label.trim() || anchors.length === 0 || !form.category.trim()) {
      throw new Error("Slug, label, category, and at least one anchor are required");
    }
    const body = { doc_type, label: form.label, anchors, category: form.category };
    if (originalDocType) {
      const r = await api(`/api/backend-admin/catalog/${originalDocType}`, "PATCH", body);
      if (r.hospitals_synced > 0) {
        // eslint-disable-next-line no-alert
        window.alert(`Saved. ${r.hospitals_synced} hospital(s) using this document were updated live.`);
      }
    } else {
      await api("/api/backend-admin/catalog", "POST", body);
    }
    setEditing(null);
    setAdding(false);
    router.refresh();
  }

  async function remove(entry: CatalogEntry) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove "${entry.label}" from the catalog? Hospitals already using it keep their copy (it just stops syncing).`)) return;
    try {
      const r = await api(`/api/backend-admin/catalog/${entry.doc_type}`, "DELETE");
      if (r.hospitals_detached > 0) {
        // eslint-disable-next-line no-alert
        window.alert(`Removed. ${r.hospitals_detached} hospital(s) kept their local copy (now detached).`);
      }
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h3 className="text-sm font-bold">Master document catalog ({catalog.length})</h3>
          <button
            onClick={() => { setAdding((v) => !v); setEditing(null); }}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
          >
            {adding ? "Cancel" : "+ Add document"}
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">
          The shared library every hospital picks from. Editing a document here updates it live in
          every hospital using it (unless a hospital customised it locally). Anchors are the phrases
          Lynq's classifier looks for.
        </p>

        {adding && (
          <EditRow
            initial={{ doc_type: "", label: "", anchors: "", category: categories[0] ?? "" }}
            categories={categories}
            isNew
            onCancel={() => setAdding(false)}
            onSave={(f) => save(null, f)}
          />
        )}
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}

        <input
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter by name or slug…"
          className="mt-3 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-800 pb-3">
        {tabs.map((t) => {
          const count = t === "All" ? catalog.length : (byCategory.get(t)?.length ?? 0);
          return (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition ${
                activeTab === t
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {t} <span className={activeTab === t ? "text-blue-200" : "text-slate-500"}>({count})</span>
            </button>
          );
        })}
      </div>

      {visibleCategoryEntries.length === 0 && (
        <p className="text-xs text-slate-500 px-1">No documents match.</p>
      )}

      {visibleCategoryEntries.map(([cat, shown]) => (
        <div key={cat} className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          {activeTab === "All" && (
            <h4 className="text-xs font-bold text-slate-300 mb-2">{cat} <span className="text-slate-600">({shown.length})</span></h4>
          )}
          <div className="space-y-1.5">
            {shown.map((e) =>
              editing === e.doc_type ? (
                <EditRow
                  key={e.doc_type}
                  initial={{ doc_type: e.doc_type, label: e.label, anchors: e.anchors.join(", "), category: e.category }}
                  categories={categories}
                  onCancel={() => setEditing(null)}
                  onSave={(f) => save(e.doc_type, f)}
                />
              ) : (
                <div key={e.doc_type} className="flex items-start justify-between gap-3 bg-slate-800 rounded px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{e.label} <span className="text-[10px] text-slate-500 font-mono">({e.doc_type})</span></div>
                    <div className="text-[11px] text-slate-400">anchors: {e.anchors.join(", ")}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => { setEditing(e.doc_type); setAdding(false); }} className="text-[11px] text-blue-300 hover:text-blue-200">Edit</button>
                    <button onClick={() => remove(e)} className="text-[11px] text-red-300 hover:text-red-200">Remove</button>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function EditRow({
  initial, categories, isNew, onCancel, onSave,
}: {
  initial: EntryForm; categories: string[]; isNew?: boolean;
  onCancel: () => void; onSave: (form: EntryForm) => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true); setError(null);
    try {
      await onSave(form);
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="bg-slate-800 border border-blue-700 rounded px-3 py-3 space-y-2 mt-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-400">Display label</label>
          <input
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value, doc_type: isNew ? slugify(e.target.value) : f.doc_type }))}
            className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-900 text-slate-100"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-400">Category</label>
          <input
            list="catalog-categories"
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-900 text-slate-100"
          />
          <datalist id="catalog-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase font-semibold text-slate-400">Doc type slug</label>
        <input
          value={form.doc_type}
          onChange={(e) => setForm((f) => ({ ...f, doc_type: e.target.value }))}
          className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-900 text-slate-100 font-mono"
        />
      </div>
      <div>
        <label className="text-[10px] uppercase font-semibold text-slate-400">Anchor phrases (comma-separated)</label>
        <input
          value={form.anchors}
          onChange={(e) => setForm((f) => ({ ...f, anchors: e.target.value }))}
          className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-900 text-slate-100"
        />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={saving} className="text-xs font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-200">Cancel</button>
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>
    </div>
  );
}
