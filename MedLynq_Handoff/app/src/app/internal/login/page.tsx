"use client";

// Deliberately plain/neutral — NOT tenant-branded (no hospital colors/logo),
// since this login isn't for any one hospital. Different URL, different
// visual identity, and a dedicated API endpoint (/api/auth/internal-login)
// that refuses to create a session for anyone who isn't SUPERADMIN.

import { useState } from "react";

export default function InternalLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/auth/internal-login", {
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
      window.location.href = "/backend-admin";
    } catch (err: any) {
      setError(err?.message ?? "Network error");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-5">
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">MedLynq Internal</div>
          <h1 className="text-lg font-bold text-slate-100">Backend Admin</h1>
          <p className="text-xs text-slate-400">Not a hospital login — MedLynq staff only.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-slate-700 rounded text-sm bg-slate-800 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && (
            <div className="text-xs text-red-300 bg-red-950 border border-red-800 rounded px-2 py-1.5">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
