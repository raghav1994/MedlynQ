"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Client-side companion to the server-side role redirects on pages like
// /finance, /team, /benchmarks. Those pages are server components and can
// call getSession()+redirect() directly; these five ("use client" from the
// start, for local state/effects) can't, so this hook fetches the session
// and bounces blocked roles the same way. Blocks briefly before the session
// loads (user === undefined) rather than flashing the page first.
export function useRoleGate(blockedRoles: string[], redirectTo: string) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.user && blockedRoles.includes(j.user.role)) {
          router.replace(redirectTo);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
