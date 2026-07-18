"use client";

// Internal (SUPERADMIN) login management — the counterpart to each
// hospital's own Logins tab, except these accounts aren't scoped to any
// hospital. This is the only screen that can create a SUPERADMIN account.

import { useState } from "react";
import { useRouter } from "next/navigation";

type StaffRow = {
  id: string;
  email: string;
  name: string;
  designation: string;
  created_at: string;
  disabled?: boolean;
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

export default function StaffManager({ staff, currentUserId }: { staff: StaffRow[]; currentUserId: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", name: "", designation: "", password: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function createStaff(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true); setError(null);
    try {
      await api("/api/backend-admin/staff", "POST", form);
      setForm({ email: "", name: "", designation: "", password: "" });
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleDisabled(userId: string, disabled: boolean) {
    setBusyId(userId);
    try {
      await api(`/api/backend-admin/staff/${userId}`, "PATCH", { disabled });
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h3 className="text-sm font-bold mb-1">Internal logins ({staff.length})</h3>
        <p className="text-[11px] text-slate-500 mb-4">
          Everyone here can sign in at <code className="font-mono">/internal/login</code> and reach every hospital's
          backend admin. Only grant this to people who actually run onboarding/ops — it's not scoped to one hospital.
        </p>

        {staff.length === 0 ? (
          <p className="text-xs text-slate-500 italic">No internal staff yet.</p>
        ) : (
          <div className="space-y-1.5">
            {staff.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 bg-slate-800 rounded px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold flex items-center gap-1.5">
                    {u.name}
                    {u.id === currentUserId && <span className="text-[9px] uppercase text-blue-400 font-semibold">you</span>}
                    {u.disabled && <span className="text-[9px] uppercase text-red-400 font-semibold">disabled</span>}
                  </div>
                  <div className="text-[11px] text-slate-400">{u.email}{u.designation ? ` · ${u.designation}` : ""}</div>
                </div>
                <button
                  onClick={() => toggleDisabled(u.id, !u.disabled)}
                  disabled={busyId === u.id || u.id === currentUserId}
                  title={u.id === currentUserId ? "You can't disable your own account" : undefined}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded shrink-0 disabled:opacity-40 ${
                    u.disabled ? "text-green-300 hover:text-green-200" : "text-red-300 hover:text-red-200"
                  }`}
                >
                  {busyId === u.id ? "…" : u.disabled ? "Enable" : "Disable"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
        <h3 className="text-sm font-bold mb-1">Add internal staff</h3>
        <p className="text-[11px] text-slate-500 mb-4">Give them the temporary password directly — it's never shown again after this.</p>
        <form onSubmit={createStaff} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-400">Full name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-semibold text-slate-400">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400">Designation</label>
            <input
              value={form.designation}
              onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
              placeholder="e.g. Onboarding Specialist"
              className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400">Temporary password (min 8 chars)</label>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={creating}
            className="text-xs font-semibold px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create internal login"}
          </button>
        </form>
      </div>
    </div>
  );
}
