// GET /api/tenant/list — every tenant's public branding info (subdomain,
// name, logo, colors). No secrets, no patient data — this is exactly what
// anyone would see just by visiting a hospital's real subdomain, so it's
// safe to expose pre-login. Powers the dev tenant switcher on /login, which
// otherwise has no way to know what hospitals exist on localhost (no real
// subdomains to read the Host header from).
//
// PUBLIC (pre-login) — listed in middleware PUBLIC_PATHS.

import { NextResponse } from "next/server";
import { listAllTenants } from "@/lib/tenant/admin";

export const runtime = "nodejs";

export async function GET() {
  const tenants = await listAllTenants();
  const list = tenants.map((t) => ({
    subdomain: t.subdomain,
    name: t.name,
    logo_initial: t.logo_initial,
    primary_color: t.primary_color,
  }));
  return NextResponse.json({ ok: true, tenants: list });
}
