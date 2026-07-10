"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type DemoUser = { email: string; label: string };
const DEMO_USERS_BY_TENANT: Record<string, { tenantName: string; users: DemoUser[] }> = {
  action: {
    tenantName: "Action Cancer Hospital",
    users: [
      { email: "admin@action.in",  label: "Dr. Rahul Mehta · Head of Claims (ADMIN)" },
      { email: "richa@action.in",  label: "Richa Attri · MEDCO (BIS-enabled)" },
      { email: "priya@action.in",  label: "Priya Kulkarni · MEDCO" },
      { email: "cfo@action.in",    label: "Anand Krishnan · CFO (read-only)" },
    ],
  },
  fortis: {
    tenantName: "Fortis Escorts Heart Institute",
    users: [
      { email: "admin@fortis.in",  label: "Dr. Vikrant Bhargava · Head of Insurance (ADMIN)" },
      { email: "kavita@fortis.in", label: "Kavita Sharma · Insurance Coordinator" },
      { email: "cfo@fortis.in",    label: "Sanjay Iyer · CFO (read-only)" },
    ],
  },
};

export default function LoginPage() {
  const [tenantSub, setTenantSub] = useState<string>("action");
  useEffect(() => {
    const m = document.cookie.match(/medlynq_tenant_hint=([^;]+)/);
    if (m) setTenantSub(decodeURIComponent(m[1]));
  }, []);
  async function switchTenant(sub: string) {
    setTenantSub(sub);
    await fetch("/api/tenant/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subdomain: sub }),
    });
  }
  const demoSet = DEMO_USERS_BY_TENANT[tenantSub] ?? DEMO_USERS_BY_TENANT.action;
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("password");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      const dest = j.user?.role === "CFO" ? "/finance" : "/";
      // Hard-nav so middleware re-reads the cookie.
      window.location.href = dest;
    } catch (err: any) {
      setError(err?.message ?? "Network error");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-bone-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-bone-0 border border-bone-300 rounded-lg shadow-sm p-6 space-y-5">
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">MedLynq Pulse</div>
          <h1 className="text-xl font-bold text-ink-100">Sign in to <span className="text-accent">{demoSet.tenantName}</span></h1>
          <p className="text-xs text-ink-300">Claims intelligence for Indian government health schemes.</p>
        </div>

        {/* Dev-only tenant switcher. In production this is replaced by the URL: action.medlynq.co.in vs fortis.medlynq.co.in */}
        <div className="bg-bone-100 border border-bone-300 rounded p-2">
          <div className="text-[9px] uppercase font-semibold text-ink-300 mb-1">Dev tenant switcher (localhost only)</div>
          <div className="flex gap-1">
            {Object.entries(DEMO_USERS_BY_TENANT).map(([sub, t]) => (
              <button
                key={sub}
                type="button"
                onClick={() => switchTenant(sub)}
                className={`flex-1 text-xs py-1 rounded border ${
                  tenantSub === sub
                    ? "bg-ink-100 text-white border-ink-100 font-semibold"
                    : "border-bone-300 text-ink-200 hover:bg-bone-200"
                }`}
              >
                {t.tenantName.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>

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
              placeholder="richa@action.in"
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

        <div className="border-t border-bone-300 pt-3">
          <div className="text-[10px] uppercase font-semibold text-ink-300 mb-1.5">Demo users (password: <code>password</code>)</div>
          <div className="space-y-1">
            {demoSet.users.map((u) => (
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
      </div>
    </div>
  );
}
