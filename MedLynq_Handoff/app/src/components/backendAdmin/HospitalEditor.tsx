"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAllStates, getDistricts } from "india-state-district";
import type { TenantConfig, DocumentLibraryEntry, DocumentRequirement } from "@/lib/tenant/loader";
import type { AdminAuditEntry } from "@/lib/auth/adminAudit";
import type { Scheme } from "@/lib/types";
import SearchableSelect from "./SearchableSelect";

type CatalogEntry = { doc_type: string; label: string; anchors: string[]; category: string };

// Click-only picker — no typing. Options come from the GLOBAL document
// catalog (fetched once by DocumentsCard), grouped by category. Selecting a
// catalog document auto-fills its slug + anchors (both still editable below);
// "+ New document type not listed…" is the only escape into free text, for a
// document not in the catalog yet.
function DocLabelSelect({
  label, library, catalog, onChange,
}: {
  label: string;
  library: DocumentLibraryEntry[];
  catalog: CatalogEntry[];
  onChange: (next: { label: string; doc_type: string; anchors: string }) => void;
}) {
  const [customMode, setCustomMode] = useState(false);
  const libraryByLabel = new Map(library.map((l) => [l.label, l]));
  const usedLabels = new Set(library.map((l) => l.label));
  const catalogByLabel = new Map(catalog.map((c) => [c.label, c]));

  // Catalog grouped by category, hiding docs already used at this hospital.
  const grouped = new Map<string, CatalogEntry[]>();
  for (const c of catalog) {
    if (usedLabels.has(c.label)) continue;
    if (!grouped.has(c.category)) grouped.set(c.category, []);
    grouped.get(c.category)!.push(c);
  }

  if (customMode) {
    return (
      <div>
        <label className="text-[10px] uppercase font-semibold text-slate-400">Display label (new document)</label>
        <div className="flex gap-2 mt-1">
          <input
            autoFocus
            value={label}
            onChange={(e) => onChange({ label: e.target.value, doc_type: slugifyDocType(e.target.value), anchors: "" })}
            placeholder="e.g. Fever / TPR Chart"
            className="flex-1 px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => { setCustomMode(false); onChange({ label: "", doc_type: "", anchors: "" }); }}
            className="text-xs text-slate-400 hover:text-slate-200 px-2"
          >
            Back to list
          </button>
        </div>
        <p className="text-[10px] text-amber-400/80 mt-1">Not in the master catalog — this becomes a hospital-local document. Add it to the catalog to share it with every hospital.</p>
      </div>
    );
  }

  return (
    <div>
      <label className="text-[10px] uppercase font-semibold text-slate-400">Display label</label>
      <select
        value={label}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom__") {
            setCustomMode(true);
            onChange({ label: "", doc_type: "", anchors: "" });
            return;
          }
          const reused = libraryByLabel.get(v);
          const fromCatalog = catalogByLabel.get(v);
          if (reused) {
            onChange({ label: v, doc_type: reused.doc_type, anchors: reused.anchors.join(", ") });
          } else if (fromCatalog) {
            onChange({ label: v, doc_type: fromCatalog.doc_type, anchors: fromCatalog.anchors.join(", ") });
          } else {
            onChange({ label: "", doc_type: "", anchors: "" });
          }
        }}
        className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">— Select a document —</option>
        <option value="__custom__">+ New document type not listed…</option>
        {library.length > 0 && (
          <optgroup label="Already used at this hospital">
            {library.map((l) => <option key={l.doc_type} value={l.label}>{l.label}</option>)}
          </optgroup>
        )}
        {Array.from(grouped.entries()).map(([category, entries]) => (
          <optgroup key={category} label={category}>
            {entries.map((c) => <option key={c.doc_type} value={c.label}>{c.label}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function slugifyDocType(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

type UserRow = { id: string; email: string; name: string; role: string; designation: string; disabled?: boolean };

const TABS = ["Branding", "Departments & Documents", "Schemes & TPAs", "Logins", "Launch", "Audit log"] as const;
type Tab = typeof TABS[number];

export default function HospitalEditor({
  hospital, users, audit, allSchemes, isOwner,
}: {
  hospital: TenantConfig;
  users: UserRow[];
  audit: AdminAuditEntry[];
  allSchemes: Scheme[];
  isOwner: boolean;
}) {
  const [tab, setTab] = useState<Tab>("Branding");

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-800 mb-5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 ${
              tab === t ? "border-blue-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Branding" && <BrandingTab hospital={hospital} />}
      {tab === "Departments & Documents" && <DepartmentsTab hospital={hospital} />}
      {tab === "Schemes & TPAs" && <SchemesTab hospital={hospital} allSchemes={allSchemes} />}
      {tab === "Logins" && <LoginsTab hospital={hospital} users={users} isOwner={isOwner} />}
      {tab === "Launch" && <LaunchTab hospital={hospital} users={users} />}
      {tab === "Audit log" && <AuditTab audit={audit} />}
    </div>
  );
}

// ---------- shared ----------

async function patchHospital(hospital_id: string, patch: Record<string, any>) {
  const r = await fetch(`/api/backend-admin/hospitals/${hospital_id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || "Update failed");
  return j.hospital as TenantConfig;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">{children}</div>;
}

function SaveBar({ error, saving, onSave }: { error: string | null; saving: boolean; onSave: () => void }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <button
        onClick={onSave}
        disabled={saving}
        className="text-xs font-semibold px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
}

// ---------- Branding ----------

const ALL_STATES = getAllStates(); // real 36 states/UTs — india-state-district

function BrandingTab({ hospital }: { hospital: TenantConfig }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: hospital.name, short_name: hospital.short_name, tagline: hospital.tagline,
    primary_color: hospital.primary_color, accent_color: hospital.accent_color,
    logo_initial: hospital.logo_initial, state: hospital.state ?? "", city: hospital.city, district: hospital.district,
    npi: hospital.npi ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stateCode = ALL_STATES.find((s) => s.name === form.state)?.code;
  const districtOptions = stateCode ? getDistricts(stateCode) : [];

  function setState(name: string) {
    // Changing state invalidates whatever district was picked for the old one.
    setForm((f) => ({ ...f, state: name, district: "" }));
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      await patchHospital(hospital.hospital_id, form);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="grid grid-cols-2 gap-4">
        <LabeledInput label="Hospital name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
        <LabeledInput label="Short name" value={form.short_name} onChange={(v) => setForm((f) => ({ ...f, short_name: v }))} />
        <SearchableSelect
          label="State"
          value={form.state}
          onChange={setState}
          options={ALL_STATES.map((s) => s.name)}
        />
        <SearchableSelect
          label="District"
          value={form.district}
          onChange={(v) => setForm((f) => ({ ...f, district: v }))}
          options={districtOptions}
          disabled={!stateCode}
        />
        <LabeledInput label="City / Town" value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} hint="Free text — no single canonical India-wide city list at this granularity" />
        <LabeledInput label="Logo initial" value={form.logo_initial} onChange={(v) => setForm((f) => ({ ...f, logo_initial: v.slice(0, 3) }))} />
        <LabeledInput label="NHA hospital NPI" value={form.npi} onChange={(v) => setForm((f) => ({ ...f, npi: v }))} hint="From NHA's Health Facility Registry / empanelment — leave blank until registered" />
        <LabeledInput label="Primary color" value={form.primary_color} onChange={(v) => setForm((f) => ({ ...f, primary_color: v }))} type="color" />
        <LabeledInput label="Accent color" value={form.accent_color} onChange={(v) => setForm((f) => ({ ...f, accent_color: v }))} type="color" />
        <div className="col-span-2">
          <LabeledInput label="Tagline" value={form.tagline} onChange={(v) => setForm((f) => ({ ...f, tagline: v }))} />
        </div>
      </div>
      <SaveBar error={error} saving={saving} onSave={save} />
    </Card>
  );
}

function LabeledInput({
  label, value, onChange, type = "text", hint,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string }) {
  return (
    <div>
      <label className="text-[10px] uppercase font-semibold text-slate-400">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={type === "color"
          ? "mt-1 w-full h-9 bg-slate-800 border border-slate-700 rounded cursor-pointer"
          : "mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"}
      />
      {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}

// ---------- Departments & Documents (Part A's UI layer) ----------

const STAGES = ["opd", "pre_auth", "mid_way", "discharge"] as const;
const STAGE_LABELS: Record<typeof STAGES[number], string> = {
  opd: "OPD", pre_auth: "Pre-Auth", mid_way: "Mid-way", discharge: "Discharge",
};
const BUILTIN_SPECIALTIES = new Set(["oncology", "cardiac", "ortho", "dialysis", "icu", "maternity"]);

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

function DepartmentsTab({ hospital }: { hospital: TenantConfig }) {
  const router = useRouter();
  const departments = hospital.specialties_enabled ?? [];
  const library = hospital.document_library ?? [];
  const requirements = hospital.document_requirements ?? [];
  const schemes = hospital.schemes_enabled ?? [];

  return (
    <div className="space-y-5">
      <DepartmentsCard hospitalId={hospital.hospital_id} departments={departments} requirements={requirements} onChanged={() => router.refresh()} />
      <DocumentsCard hospitalId={hospital.hospital_id} departments={departments} library={library} requirements={requirements} schemes={schemes} onChanged={() => router.refresh()} />
    </div>
  );
}

// ---- Departments: add / rename / delete ----

function DepartmentsCard({
  hospitalId, departments, requirements, onChanged,
}: { hospitalId: string; departments: string[]; requirements: DocumentRequirement[]; onChanged: () => void }) {
  const [newDept, setNewDept] = useState("");
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addDept() {
    if (!newDept.trim()) return;
    setAdding(true); setError(null);
    try {
      await api(`/api/backend-admin/hospitals/${hospitalId}/specialties`, "POST", { name: newDept });
      setNewDept("");
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function saveRename(oldSlug: string) {
    if (!renameValue.trim()) { setRenaming(null); return; }
    setBusy(true); setError(null);
    try {
      await api(`/api/backend-admin/hospitals/${hospitalId}/specialties`, "PATCH", { old_slug: oldSlug, new_name: renameValue });
      setRenaming(null);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug: string) {
    const reqCount = requirements.filter((r) => r.specialty === slug).length;
    const warning = reqCount > 0
      ? `Delete department "${slug}"? This permanently removes all ${reqCount} document requirement${reqCount === 1 ? "" : "s"} configured under it. This cannot be undone from the UI.\n\nType the department name to confirm:`
      : `Delete department "${slug}"? Type the department name to confirm:`;
    const typed = window.prompt(warning);
    if (typed !== slug) return;

    setBusy(true); setError(null);
    try {
      await api(`/api/backend-admin/hospitals/${hospitalId}/specialties?slug=${encodeURIComponent(slug)}`, "DELETE");
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="text-sm font-bold mb-1">Departments this hospital runs</h3>
      <p className="text-[11px] text-slate-500 mb-3">
        Oncology, cardiac, ortho, dialysis, icu, and maternity already have built-in fast document
        recognition. A brand-new department works immediately via AI classification — no code change —
        and can get its own fast rules later once it has real document volume. Renaming a department
        automatically updates every document requirement under it; deleting removes those requirements too.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {departments.length === 0 && <p className="text-xs text-slate-500 italic">No departments yet.</p>}
        {departments.map((slug) => (
          <div key={slug} className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-full pl-3 pr-1.5 py-1">
            {renaming === slug ? (
              <>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveRename(slug); if (e.key === "Escape") setRenaming(null); }}
                  className="text-xs bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 w-32"
                />
                <button onClick={() => saveRename(slug)} disabled={busy} className="text-[10px] text-green-300 hover:text-green-200 px-1">✓</button>
                <button onClick={() => setRenaming(null)} className="text-[10px] text-slate-400 hover:text-slate-200 px-1">✕</button>
              </>
            ) : (
              <>
                <span className="text-xs font-mono">{slug}</span>
                {BUILTIN_SPECIALTIES.has(slug) && (
                  <span className="text-[9px] uppercase text-blue-400 font-semibold">built-in</span>
                )}
                <button
                  onClick={() => { setRenaming(slug); setRenameValue(slug); }}
                  className="text-[10px] text-slate-400 hover:text-slate-200 px-1"
                  title="Rename"
                >
                  ✎
                </button>
                <button
                  onClick={() => remove(slug)}
                  disabled={busy}
                  className="text-[10px] text-red-400 hover:text-red-300 px-1"
                  title="Delete (also removes its document requirements)"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={newDept}
          onChange={(e) => setNewDept(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addDept(); }}
          placeholder="e.g. general_medicine"
          className="flex-1 px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={addDept}
          disabled={adding || !newDept.trim()}
          className="text-xs font-semibold px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
        >
          {adding ? "Adding…" : "+ Add department"}
        </button>
      </div>
      {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
    </Card>
  );
}

// ---- Documents: scheme-first — pick a scheme/TPA (or "Universal"), see
// what it requires grouped by department -> stage, add/edit/delete inline ----

const UNIVERSAL = "__universal__";

type RequirementForm = {
  doc_type: string; label: string; anchors: string; specialty: string;
  stage: typeof STAGES[number]; schemes: string[]; alt_group: string;
};

function requirementToForm(r: DocumentRequirement, library: DocumentLibraryEntry[]): RequirementForm {
  const entry = library.find((l) => l.doc_type === r.doc_type);
  return {
    doc_type: r.doc_type,
    label: entry?.label ?? r.doc_type,
    anchors: (entry?.anchors ?? []).join(", "),
    specialty: r.specialty,
    stage: r.stage as any,
    schemes: r.schemes ?? [],
    alt_group: r.alt_group ?? "",
  };
}

// Toggleable scheme chips — empty selection = universal (required for every
// scheme this hospital accepts), matching how buildChecklist() treats an
// empty/absent for_schemes list.
function SchemeToggles({ allSchemes, selected, onChange }: { allSchemes: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  function toggle(s: string) {
    onChange(selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s]);
  }
  return (
    <div>
      <label className="text-[10px] uppercase font-semibold text-slate-400">
        Required for which schemes? <span className="normal-case font-normal text-slate-500">(none picked = universal, required for every scheme)</span>
      </label>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {allSchemes.length === 0 && <span className="text-xs text-slate-500 italic">This hospital has no schemes enabled yet — see Schemes & TPAs tab.</span>}
        {allSchemes.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            className={`text-[11px] px-2 py-1 rounded border font-semibold ${
              selected.includes(s)
                ? "bg-blue-600 border-blue-500 text-white"
                : "bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function emptyRequirementForm(specialty: string, schemes: string[]): RequirementForm {
  return { doc_type: "", label: "", anchors: "", specialty, stage: "pre_auth", schemes, alt_group: "" };
}

function DocumentsCard({
  hospitalId, departments, library, requirements, schemes: hospitalSchemes, onChanged,
}: {
  hospitalId: string; departments: string[]; library: DocumentLibraryEntry[];
  requirements: DocumentRequirement[]; schemes: string[]; onChanged: () => void;
}) {
  const [selectedScheme, setSelectedScheme] = useState<string>(UNIVERSAL);
  const [adding, setAdding] = useState(false);
  const [newReq, setNewReq] = useState<RequirementForm>(() => emptyRequirementForm(departments[0] ?? "", []));
  const [error, setError] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<{ doc_type: string; specialty: string; stage: string } | null>(null);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);

  // The global document catalog powers the doc picker below. Fetched once —
  // shared across every hospital, editable by the owner in Backend Admin →
  // Document Catalog.
  useEffect(() => {
    fetch("/api/backend-admin/catalog").then((r) => r.json()).then((j) => setCatalog(j.catalog ?? [])).catch(() => {});
  }, []);

  function toggleDept(dept: string) {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept); else next.add(dept);
      return next;
    });
  }

  // Same stale-<select> issue as before: keep department in sync once the
  // real list loads, and re-seed the scheme toggle whenever the active tab
  // changes so "Add" defaults to the scheme you're currently viewing.
  useEffect(() => {
    if (departments.length > 0 && !departments.includes(newReq.specialty)) {
      setNewReq((f) => ({ ...f, specialty: departments[0] }));
    }
  }, [departments]);
  useEffect(() => {
    setNewReq((f) => ({ ...f, schemes: selectedScheme === UNIVERSAL ? [] : [selectedScheme] }));
  }, [selectedScheme]);

  const libraryByDocType = new Map(library.map((l) => [l.doc_type, l]));
  const libraryByLabel = new Map(library.map((l) => [l.label, l]));

  // Which requirements does the active tab own? Universal = no schemes tag
  // at all; a specific scheme = that scheme is in the requirement's list
  // (a requirement can belong to more than one scheme at once).
  const visible = requirements.filter((r) =>
    selectedScheme === UNIVERSAL ? !r.schemes || r.schemes.length === 0 : !!r.schemes?.includes(selectedScheme)
  );

  // Group: department -> stage -> requirements, for the active scheme tab.
  const bySpecialty = new Map<string, DocumentRequirement[]>();
  for (const dept of departments) bySpecialty.set(dept, []);
  for (const r of visible) {
    if (!bySpecialty.has(r.specialty)) bySpecialty.set(r.specialty, []); // orphaned specialty, still show it
    bySpecialty.get(r.specialty)!.push(r);
  }

  // Oncology + General Medicine were this app's original two departments and
  // tend to accumulate the most requirements over time — sinking them below
  // newer/smaller departments keeps the page scannable instead of burying
  // everything else under two huge sections.
  const LOW_PRIORITY_DEPTS = new Set(["oncology", "general_medicine"]);
  const sortedDeptEntries = Array.from(bySpecialty.entries()).sort(
    ([a], [b]) => (LOW_PRIORITY_DEPTS.has(a) ? 1 : 0) - (LOW_PRIORITY_DEPTS.has(b) ? 1 : 0)
  );

  async function addRequirement() {
    setAdding(true); setError(null);
    try {
      const doc_type = newReq.doc_type.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (!doc_type || !newReq.specialty.trim()) {
        throw new Error("Doc type slug and department are required");
      }
      const reused = libraryByDocType.get(doc_type);
      const anchors = newReq.anchors.split(",").map((a) => a.trim()).filter(Boolean);
      if (!reused && (!newReq.label.trim() || anchors.length === 0)) {
        throw new Error("This doc_type is new — a display label and at least one anchor phrase are required to define it");
      }

      // A requirement's identity is (doc_type, specialty, stage) — not scheme
      // — so this doc may already exist here under a scheme you can't see
      // from the current tab (e.g. added as Universal, or for another
      // scheme). Rather than reject as a duplicate, fold the schemes you're
      // adding into that existing row.
      const existing = requirements.find(
        (r) => r.doc_type === doc_type && r.specialty === newReq.specialty && r.stage === newReq.stage
      );
      if (existing) {
        if (!existing.schemes || existing.schemes.length === 0) {
          throw new Error(`${newReq.label || doc_type} is already Universal for this department + stage — it already applies to every scheme, including ${selectedScheme === UNIVERSAL ? "all of them" : selectedScheme}.`);
        }
        const mergedSchemes = Array.from(new Set([...existing.schemes, ...newReq.schemes]));
        await api(`/api/backend-admin/hospitals/${hospitalId}/document-requirements`, "PATCH", {
          original: { doc_type: existing.doc_type, specialty: existing.specialty, stage: existing.stage },
          doc_type, specialty: newReq.specialty, stage: newReq.stage, schemes: mergedSchemes,
          label: newReq.label, anchors,
          alt_group: (newReq.alt_group.trim() || existing.alt_group) || undefined,
        });
      } else {
        await api(`/api/backend-admin/hospitals/${hospitalId}/document-requirements`, "POST", {
          doc_type, specialty: newReq.specialty, stage: newReq.stage, schemes: newReq.schemes,
          label: newReq.label, anchors,
          alt_group: newReq.alt_group.trim() || undefined,
        });
      }
      setNewReq(emptyRequirementForm(newReq.specialty, newReq.schemes));
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function removeRequirement(slot: { doc_type: string; specialty: string; stage: string }) {
    const qs = new URLSearchParams(slot).toString();
    await api(`/api/backend-admin/hospitals/${hospitalId}/document-requirements?${qs}`, "DELETE");
    onChanged();
  }

  async function saveEdit(original: { doc_type: string; specialty: string; stage: string }, form: RequirementForm) {
    const doc_type = form.doc_type.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const anchors = form.anchors.split(",").map((a) => a.trim()).filter(Boolean);
    await api(`/api/backend-admin/hospitals/${hospitalId}/document-requirements`, "PATCH", {
      original, doc_type, specialty: form.specialty, stage: form.stage, schemes: form.schemes,
      label: form.label, anchors,
      alt_group: form.alt_group.trim() || undefined,
    });
    setEditingSlot(null);
    onChanged();
  }

  const tabs = [UNIVERSAL, ...hospitalSchemes];

  return (
    <Card>
      <h3 className="text-sm font-bold mb-1">Document requirements, by scheme</h3>
      <p className="text-[11px] text-slate-500 mb-3">
        Pick a scheme/TPA to see exactly what it requires, by department and stage. "Universal" holds
        documents required no matter the scheme (Bill, Consent Form, ...). A document is defined once —
        its label and anchor phrases (the text the AI/classifier looks for, e.g. "temperature chart", "TPR
        chart" for a Fever Chart) are shared everywhere it's reused, so editing it here updates it for every
        department and scheme that requires it.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-4 border-b border-slate-800 pb-3">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setSelectedScheme(t)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
              selectedScheme === t
                ? "bg-blue-600 border-blue-500 text-white"
                : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"
            }`}
          >
            {t === UNIVERSAL ? "Universal" : t}
          </button>
        ))}
        {hospitalSchemes.length === 0 && (
          <span className="text-xs text-slate-500 italic self-center">No schemes enabled yet — see Schemes & TPAs tab.</span>
        )}
      </div>

      {departments.length === 0 && (
        <p className="text-xs text-slate-500 italic mb-4">Add a department above first.</p>
      )}

      <div className="space-y-2 mb-5">
        {sortedDeptEntries.map(([dept, deptReqs]) => {
          const isExpanded = expandedDepts.has(dept) || dept === newReq.specialty;
          const stageCounts = STAGES.map((s) => ({ stage: s, count: deptReqs.filter((r) => r.stage === s).length }));
          return (
            <div key={dept} className="border border-slate-800 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => toggleDept(dept)}
                className="w-full flex items-center justify-between gap-3 bg-slate-800/60 px-3 py-2 text-left hover:bg-slate-800"
              >
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-xs font-bold font-mono shrink-0">{dept}</span>
                  <div className="flex gap-1 flex-wrap">
                    {stageCounts.map(({ stage, count }) => (
                      <span
                        key={stage}
                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${
                          count > 0 ? "bg-blue-950/60 text-blue-300" : "bg-slate-900 text-slate-600"
                        }`}
                      >
                        {STAGE_LABELS[stage]} {count}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="text-slate-500 text-[10px] shrink-0">{isExpanded ? "▲" : "▼"}</span>
              </button>
              {isExpanded && (
                <div className="p-3 space-y-3">
                  {STAGES.map((stage) => {
                    const stageReqs = deptReqs.filter((r) => r.stage === stage);
                    return (
                      <div key={stage}>
                        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">
                          {STAGE_LABELS[stage]} <span className="text-slate-600">({stageReqs.length})</span>
                        </div>
                        {stageReqs.length === 0 ? (
                          <p className="text-xs text-slate-600 italic">
                            None yet for {STAGE_LABELS[stage]}
                            {selectedScheme !== UNIVERSAL && ` (${selectedScheme})`}.
                          </p>
                        ) : (
                        <div className="space-y-1.5">
                          {stageReqs.map((r) => {
                            const slot = { doc_type: r.doc_type, specialty: r.specialty, stage: r.stage };
                            const entry = libraryByDocType.get(r.doc_type);
                            const isEditing = editingSlot?.doc_type === r.doc_type && editingSlot.specialty === r.specialty && editingSlot.stage === r.stage;
                            return isEditing ? (
                              <EditRequirementRow
                                key={`${r.doc_type}-${r.specialty}-${r.stage}`}
                                initial={requirementToForm(r, library)}
                                departments={departments}
                                allSchemes={hospitalSchemes}
                                library={library}
                                catalog={catalog}
                                onCancel={() => setEditingSlot(null)}
                                onSave={(form) => saveEdit(slot, form)}
                              />
                            ) : (
                              <div key={`${r.doc_type}-${r.specialty}-${r.stage}`} className="flex items-start justify-between gap-3 bg-slate-800 rounded px-3 py-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold">{entry?.label ?? r.doc_type} <span className="text-[10px] text-slate-500 font-mono">({r.doc_type})</span></div>
                                  <div className="text-[11px] text-slate-400">anchors: {(entry?.anchors ?? []).join(", ")}</div>
                                  <div className="text-[11px] mt-0.5">
                                    {!r.schemes || r.schemes.length === 0 ? (
                                      <span className="text-slate-500 italic">Universal — required for every scheme</span>
                                    ) : (
                                      <span className="text-blue-400">Required for: {r.schemes.join(", ")}</span>
                                    )}
                                  </div>
                                  {r.alt_group && (
                                    <div className="text-[11px] mt-0.5 text-amber-400">
                                      Alternative group: <span className="font-mono">{r.alt_group}</span> — any ONE requirement in this group satisfies all of them
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button onClick={() => setEditingSlot(slot)} className="text-[11px] text-blue-300 hover:text-blue-200">Edit</button>
                                  <button onClick={() => removeRequirement(slot)} className="text-[11px] text-red-300 hover:text-red-200">Remove</button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-800 pt-4 space-y-3">
        <h4 className="text-xs font-bold text-slate-300">
          Add a document requirement {selectedScheme !== UNIVERSAL && <span className="text-blue-400">for {selectedScheme}</span>}
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400">Department</label>
            <select
              value={newReq.specialty}
              onChange={(e) => setNewReq((f) => ({ ...f, specialty: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100"
            >
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400">Stage</label>
            <select
              value={newReq.stage}
              onChange={(e) => setNewReq((f) => ({ ...f, stage: e.target.value as any }))}
              className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100"
            >
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
          </div>
        </div>
        <DocLabelSelect
          label={newReq.label}
          library={library}
          catalog={catalog}
          onChange={(next) => setNewReq((f) => ({ ...f, ...next }))}
        />
        {libraryByLabel.has(newReq.label) && (
          <p className="text-xs text-green-300 bg-green-950/30 border border-green-900 rounded px-3 py-2">
            Reusing existing document "{newReq.label}" for this department. Editing its slug/anchors below updates it everywhere it's used.
          </p>
        )}
        <LabeledInput label="Doc type slug" value={newReq.doc_type} onChange={(v) => setNewReq((f) => ({ ...f, doc_type: v }))} hint="e.g. fever_chart — auto-filled above, editable" />
        <LabeledInput
          label="Anchor phrases (comma-separated)"
          value={newReq.anchors}
          onChange={(v) => setNewReq((f) => ({ ...f, anchors: v }))}
          hint="e.g. temperature chart, TPR chart, fever spike"
        />
        <SchemeToggles allSchemes={hospitalSchemes} selected={newReq.schemes} onChange={(v) => setNewReq((f) => ({ ...f, schemes: v }))} />
        <LabeledInput
          label="Alternative group (optional)"
          value={newReq.alt_group}
          onChange={(v) => setNewReq((f) => ({ ...f, alt_group: v }))}
          hint='e.g. "report" — leave blank unless this document is interchangeable with others (any ONE satisfies all requirements sharing the same group, e.g. Histopathology / Biopsy / PET-CT Report)'
        />
        <SaveBar error={error} saving={adding} onSave={addRequirement} />
      </div>
    </Card>
  );
}

function EditRequirementRow({
  initial, departments, allSchemes, library, catalog, onCancel, onSave,
}: { initial: RequirementForm; departments: string[]; allSchemes: string[]; library: DocumentLibraryEntry[]; catalog: CatalogEntry[]; onCancel: () => void; onSave: (form: RequirementForm) => Promise<void> }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      await onSave(form);
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="bg-slate-800 border border-blue-700 rounded px-3 py-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-400">Department</label>
          <select
            value={form.specialty}
            onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
            className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-900 text-slate-100"
          >
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase font-semibold text-slate-400">Stage</label>
          <select
            value={form.stage}
            onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as any }))}
            className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-900 text-slate-100"
          >
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </div>
      </div>
      <p className="text-[10px] text-amber-400/80">Editing the label/anchors below updates this document everywhere it's used at this hospital, and detaches it from the central catalog.</p>
      <DocLabelSelect
        label={form.label}
        library={library}
        catalog={catalog}
        onChange={(next) => setForm((f) => ({ ...f, ...next }))}
      />
      <LabeledInput label="Doc type slug" value={form.doc_type} onChange={(v) => setForm((f) => ({ ...f, doc_type: v }))} />
      <LabeledInput label="Anchor phrases (comma-separated)" value={form.anchors} onChange={(v) => setForm((f) => ({ ...f, anchors: v }))} />
      <SchemeToggles allSchemes={allSchemes} selected={form.schemes} onChange={(v) => setForm((f) => ({ ...f, schemes: v }))} />
      <LabeledInput
        label="Alternative group (optional)"
        value={form.alt_group}
        onChange={(v) => setForm((f) => ({ ...f, alt_group: v }))}
        hint='Leave blank unless interchangeable with other documents — any ONE requirement sharing this group satisfies all of them'
      />
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="text-xs font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-200">Cancel</button>
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>
    </div>
  );
}

// ---------- Schemes & TPAs ----------

function SchemesTab({ hospital, allSchemes }: { hospital: TenantConfig; allSchemes: Scheme[] }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<Set<string>>(new Set(hospital.schemes_enabled ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(s: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      await patchHospital(hospital.hospital_id, { schemes_enabled: Array.from(enabled) });
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h3 className="text-sm font-bold mb-1">Schemes & TPAs this hospital accepts</h3>
      <p className="text-[11px] text-slate-500 mb-3">
        Picked from MedLynq's supported scheme list. A scheme MedLynq doesn't support yet needs a code
        change (this list itself — PMJAY, CGHS, etc. — is not config-driven today).
      </p>
      <div className="flex flex-wrap gap-2">
        {allSchemes.map((s) => (
          <button
            key={s}
            onClick={() => toggle(s)}
            className={`text-xs px-2.5 py-1.5 rounded border font-semibold ${
              enabled.has(s)
                ? "bg-blue-600 border-blue-500 text-white"
                : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <SaveBar error={error} saving={saving} onSave={save} />
    </Card>
  );
}

// ---------- Logins ----------

function LoginsTab({ hospital, users, isOwner }: { hospital: TenantConfig; users: UserRow[]; isOwner: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", name: "", role: "MEDCO", designation: "", password: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createLogin(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true); setError(null);
    try {
      const r = await fetch(`/api/backend-admin/hospitals/${hospital.hospital_id}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed to create login");
      setForm({ email: "", name: "", role: "MEDCO", designation: "", password: "" });
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleDisabled(userId: string, disabled: boolean) {
    await fetch(`/api/backend-admin/hospitals/${hospital.hospital_id}/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Card>
        <h3 className="text-sm font-bold mb-3">Existing logins ({users.length})</h3>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between bg-slate-800 rounded px-3 py-2">
              <div>
                <div className="text-sm font-semibold">{u.name} <span className="text-[10px] text-slate-500">· {u.role}</span></div>
                <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
              </div>
              <button
                onClick={() => toggleDisabled(u.id, !u.disabled)}
                className={`text-[11px] font-semibold px-2 py-1 rounded ${
                  u.disabled ? "text-green-300 hover:text-green-200" : "text-red-300 hover:text-red-200"
                }`}
              >
                {u.disabled ? "Re-enable" : "Disable"}
              </button>
            </div>
          ))}
          {users.length === 0 && <p className="text-xs text-slate-500 italic">No logins yet for this hospital.</p>}
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-bold mb-3">Create a new login</h3>
        <form onSubmit={createLogin} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput label="Full name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
            <LabeledInput label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} type="email" />
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-400">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100"
              >
                <option value="ADMIN">ADMIN</option>
                <option value="MEDCO">MEDCO</option>
                <option value="CFO">CFO</option>
                <option value="DOCTOR">DOCTOR</option>
              </select>
            </div>
            <LabeledInput label="Designation" value={form.designation} onChange={(v) => setForm((f) => ({ ...f, designation: v }))} />
          </div>
          <LabeledInput label="Temporary password (min 8 chars)" value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} type="password" />
          {error && <p className="text-xs text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={creating}
            className="text-xs font-semibold px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create login"}
          </button>
        </form>
      </Card>

      {isOwner && <HisWebhookCard hospital={hospital} />}
    </div>
  );
}

function HisWebhookCard({ hospital }: { hospital: TenantConfig }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = !!hospital.his_webhook_secret;

  function generate() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    setValue(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/backend-admin/hospitals/${hospital.hospital_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ his_webhook_secret: value }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Failed to save");
      setValue("");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h3 className="text-sm font-bold mb-1">HIS webhook secret</h3>
      <p className="text-[11px] text-slate-500 mb-3">
        Authenticates this hospital's Hospital Information System when it pushes admissions into
        MedLynq via <code className="text-slate-400">/api/his/ingest</code>. Owner-only — rotating it
        immediately invalidates the old value, so coordinate with the HIS vendor before saving.
      </p>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[11px] font-semibold ${configured ? "text-green-300" : "text-slate-500"}`}>
          {configured ? "Configured" : "Not configured"}
        </span>
        {configured && <span className="text-[11px] text-slate-500 font-mono">{hospital.his_webhook_secret}</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="New secret (min 16 chars)…"
          className="flex-1 px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="button" onClick={generate} className="text-xs font-semibold px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 whitespace-nowrap">
          Generate
        </button>
      </div>
      {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
      <button
        onClick={save}
        disabled={saving || value.trim().length < 16}
        className="mt-3 text-xs font-semibold px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : configured ? "Rotate secret" : "Save secret"}
      </button>
    </Card>
  );
}

// ---------- Launch ----------
// Tenants are already live the instant any tab is saved — there's no
// separate "draft" state to flip. This tab is deliberately just a closing
// confirmation: the URL staff will actually log into, plus every login
// created so far, so whoever set this hospital up knows they're done and
// has what they need to hand off.

function LaunchTab({ hospital, users }: { hospital: TenantConfig; users: UserRow[] }) {
  const [switching, setSwitching] = useState(false);
  const productionUrl = `https://${hospital.subdomain}.medlynq.co.in/login`;
  const devUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/login`;

  async function openDevLogin() {
    setSwitching(true);
    try {
      await fetch("/api/tenant/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: hospital.subdomain }),
      });
      window.open(devUrl, "_blank");
    } finally {
      setSwitching(false);
    }
  }

  const activeUsers = users.filter((u) => !u.disabled);

  return (
    <div className="space-y-5">
      <Card>
        <h3 className="text-sm font-bold mb-1">{hospital.name} is live</h3>
        <p className="text-[11px] text-slate-500 mb-4">
          Every tab saves immediately — there's no separate publish step. This screen is just the
          hand-off: where staff sign in, and who already has a login.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400">Production login URL</label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 text-sm bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 font-mono">
                {productionUrl}
              </code>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Based on subdomain "{hospital.subdomain}" — resolves once this hospital's DNS/subdomain is live.</p>
          </div>

          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400">This environment (dev)</label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 text-sm bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-200 font-mono">{devUrl}</code>
              <button
                onClick={openDevLogin}
                disabled={switching}
                className="text-xs font-semibold px-3 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 whitespace-nowrap"
              >
                {switching ? "Opening…" : "Open login →"}
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">Sets the dev tenant-switcher cookie to "{hospital.subdomain}" and opens the shared /login page.</p>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-bold mb-1">Logins created ({activeUsers.length})</h3>
        <p className="text-[11px] text-slate-500 mb-4">
          Passwords aren't shown here — they were only visible once, at creation time, on the Logins
          tab. If someone's forgotten theirs, disable the account and create a fresh one.
        </p>
        {activeUsers.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No logins yet — add at least one on the Logins tab before handing this off.</p>
        ) : (
          <div className="space-y-1.5">
            {activeUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 bg-slate-800 rounded px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{u.name} <span className="text-[10px] text-slate-500 font-mono">{u.role}</span></div>
                  <div className="text-[11px] text-slate-400">{u.email}{u.designation ? ` · ${u.designation}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Audit log ----------

function AuditTab({ audit }: { audit: AdminAuditEntry[] }) {
  return (
    <Card>
      <h3 className="text-sm font-bold mb-3">Every change made to this hospital via Backend Admin</h3>
      <div className="space-y-2">
        {audit.map((e) => (
          <div key={e.id} className="bg-slate-800 rounded px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{e.action.replace(/_/g, " ")}</span>
              <span className="text-slate-500">{new Date(e.ts).toLocaleString()}</span>
            </div>
            <div className="text-slate-400 mt-0.5">by {e.actor_name}</div>
            <pre className="text-[10px] text-slate-500 mt-1 whitespace-pre-wrap break-all">{JSON.stringify(e.detail)}</pre>
          </div>
        ))}
        {audit.length === 0 && <p className="text-xs text-slate-500 italic">No changes recorded yet.</p>}
      </div>
    </Card>
  );
}
