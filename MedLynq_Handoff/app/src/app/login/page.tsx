"use client";

import { useEffect, useState } from "react";

// Demo quick-login convenience for the two original seed tenants only — a
// brand-new hospital has no demo users, staff sign in with whatever they
// were actually given on the Logins tab. This list is cosmetic (autofills
// the email field); it never drives branding — see PublicTenant below for that.
type DemoUser = { email: string; label: string };
const DEMO_USERS_BY_SUBDOMAIN: Record<string, DemoUser[]> = {
  action: [
    { email: "admin@action.in",  label: "Dr. Rahul Mehta · Head of Claims (ADMIN)" },
    { email: "richa@action.in",  label: "Richa Attri · MEDCO (BIS-enabled)" },
    { email: "priya@action.in",  label: "Priya Kulkarni · MEDCO" },
    { email: "cfo@action.in",    label: "Anand Krishnan · CFO (read-only)" },
  ],
  fortis: [
    { email: "admin@fortis.in",  label: "Dr. Vikrant Bhargava · Head of Insurance (ADMIN)" },
    { email: "kavita@fortis.in", label: "Kavita Sharma · Insurance Coordinator" },
    { email: "cfo@fortis.in",    label: "Sanjay Iyer · CFO (read-only)" },
  ],
};

type PublicTenant = { subdomain: string; name: string; logo_initial: string; primary_color: string };

export default function LoginPage() {
  const [tenant, setTenant] = useState<{ name: string; subdomain: string } | null>(null);
  const [allTenants, setAllTenants] = useState<PublicTenant[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("password");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Real tenant, resolved the same way every other page resolves it (host
  // header in production, medlynq_tenant_hint cookie on localhost) — never
  // hardcoded, so a hospital created five minutes ago shows up correctly.
  async function loadCurrentTenant() {
    const r = await fetch("/api/tenant");
    const j = await r.json();
    if (j.tenant) setTenant({ name: j.tenant.name, subdomain: j.tenant.subdomain });
  }

  useEffect(() => {
    loadCurrentTenant();
    fetch("/api/tenant/list").then((r) => r.json()).then((j) => setAllTenants(j.tenants ?? []));
  }, []);

  async function switchTenant(sub: string) {
    await fetch("/api/tenant/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subdomain: sub }),
    });
    await loadCurrentTenant();
    setEmail("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error || "Login failed");
        setSubmitting(false);
        return;
      }
      // Role-based landing: CFO has no Dashboard, route them to /finance.
      // ADMIN/HOD is scoped to Patient List + Team Performance only.
      const dest = j.user?.role === "CFO" ? "/finance" : j.user?.role === "ADMIN" ? "/patients" : "/";
      // Hard-nav so middleware re-reads the cookie.
      window.location.href = dest;
    } catch (err: any) {
      setError(err?.message ?? "Network error");
      setSubmitting(false);
    }
  }

  const demoUsers = tenant ? DEMO_USERS_BY_SUBDOMAIN[tenant.subdomain] : undefined;

  return (
    <div className="min-h-screen bg-bone-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-bone-0 border border-bone-300 rounded-lg shadow-sm p-6 space-y-5">
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">MedLynq Pulse</div>
          <h1 className="text-xl font-bold text-ink-100">
            Sign in to <span className="text-accent">{tenant?.name ?? "…"}</span>
          </h1>
          <p className="text-xs text-ink-300">Claims intelligence for Indian government health schemes.</p>
        </div>

        {/* Dev-only tenant switcher. In production this doesn't exist — the
            URL itself is the tenant (action.medlynq.co.in vs birla.medlynq.co.in),
            resolved from the real subdomain, no switching needed. */}
        {allTenants.length > 0 && (
          <div className="bg-bone-100 border border-bone-300 rounded p-2">
            <div className="text-[9px] uppercase font-semibold text-ink-300 mb-1">Dev tenant switcher (localhost only)</div>
            <div className="flex flex-wrap gap-1">
              {allTenants.map((t) => (
                <button
                  key={t.subdomain}
                  type="button"
                  onClick={() => switchTenant(t.subdomain)}
                  className={`text-xs px-2 py-1 rounded border ${
                    tenant?.subdomain === t.subdomain
                      ? "bg-ink-100 text-white border-ink-100 font-semibold"
                      : "border-bone-300 text-ink-200 hover:bg-bone-200"
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-[10px] uppercase font-semibold text-ink-300">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              className="mt-1 w-full px-3 py-2 border border-bone-300 rounded text-sm bg-bone-0 focus:outline-none focus:ring-2 focus:ring-ink-100"
              placeholder="staff@yourhospital.in"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-ink-300">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-bone-300 rounded text-sm bg-bone-0 focus:outline-none focus:ring-2 focus:ring-ink-100"
            />
          </div>
          {error && (
            <div className="text-xs text-bad bg-bad-soft border border-bad rounded px-2 py-1.5">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 rounded bg-ink-100 text-white text-sm font-semibold hover:bg-ink-200 disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {demoUsers ? (
          <div className="border-t border-bone-300 pt-3">
            <div className="text-[10px] uppercase font-semibold text-ink-300 mb-1.5">Demo users (password: <code>password</code>)</div>
            <div className="space-y-1">
              {demoUsers.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => setEmail(u.email)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded border border-bone-300 hover:bg-bone-200 text-ink-200"
                >
                  <span className="font-mono">{u.email}</span> · {u.label}
                </button>
              ))}
            </div>
          </div>
        ) : tenant ? (
          <div className="border-t border-bone-300 pt-3 text-[11px] text-ink-300">
            No demo users for {tenant.name} — sign in with a login created on its Logins tab in Backend Admin.
          </div>
        ) : null}
      </div>
    </div>
  );
}
