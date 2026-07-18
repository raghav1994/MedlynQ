"use client";

import { useEffect, useState } from "react";

// Landing spot for a Floor Admin session (an ADMIN-role account with
// desktop_access: false — see middleware.ts, which redirects here for
// EVERY page a Floor Admin tries to load). Deliberately not wrapped in
// AppShell/Sidebar — there is genuinely nothing on desktop for this
// account to see, so there's no nav to show.
export default function NoDesktopAccessPage() {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j) => setName(j.user?.name ?? null)).catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-bone-100 flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-bone-0 border border-bone-300 grid place-items-center mx-auto text-xl">
          📱
        </div>
        <h1 className="text-lg font-bold text-ink-100">
          {name ? `Welcome, ${name}` : "Welcome"}
        </h1>
        <p className="text-sm text-ink-200 leading-relaxed">
          Your account doesn't have rights to view the desktop dashboard.
          Please use the MedLynq mobile app to onboard staff and manage
          your floor.
        </p>
        <button
          onClick={logout}
          className="mt-4 text-xs px-4 py-2 border border-bone-300 bg-bone-0 rounded hover:bg-bone-200 text-ink-200"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
