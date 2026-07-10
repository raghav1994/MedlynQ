// POST /api/tenant/switch  { subdomain }
//
// Dev helper — sets the medlynq_tenant_hint cookie which getTenant() reads as a
// fallback when there is no real subdomain (localhost). In production this is
// a no-op: the host header drives tenant resolution.
//
// PUBLIC (pre-login) — listed in middleware PUBLIC_PATHS.

import { NextRequest, NextResponse } from "next/server";
import { loadTenantBySubdomain } from "@/lib/tenant/loader";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const subdomain = String(body.subdomain ?? "").trim().toLowerCase();
  const t = subdomain ? await loadTenantBySubdomain(subdomain) : null;
  if (!t) {
    return NextResponse.json({ ok: false, error: "Unknown tenant" }, { status: 404 });
  }
  const res = NextResponse.json({ ok: true, tenant: { hospital_id: t.hospital_id, name: t.name } });
  res.cookies.set("medlynq_tenant_hint", subdomain, {
    httpOnly: false,    // readable by client for the switcher UI; non-secret
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
