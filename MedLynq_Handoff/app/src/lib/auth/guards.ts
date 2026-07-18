// Route-level guards. Use at the top of every /api route.
//
//   const guard = await requireAuth();
//   if (!guard.ok) return guard.response;
//   const session = guard.session;
//
//   const guard = await requireRole(["ADMIN", "MEDCO"]);
//
// Returns either { ok: true, session } or { ok: false, response: NextResponse } so
// the route can short-circuit without nested try/catch.

import { NextResponse } from "next/server";
import { getSession, type Role, type SessionUser } from "./session";

type GuardResult =
  | { ok: true; session: { user: SessionUser } }
  | { ok: false; response: NextResponse };

export async function requireAuth(): Promise<GuardResult> {
  const s = await getSession();
  if (!s.user) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 }) };
  }
  return { ok: true, session: { user: s.user } };
}

export async function requireRole(allowed: Role[]): Promise<GuardResult> {
  const auth = await requireAuth();
  if (!auth.ok) return auth;
  if (!allowed.includes(auth.session.user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: `Forbidden — role ${auth.session.user.role} cannot perform this action` },
        { status: 403 }
      ),
    };
  }
  return auth;
}

// Narrower than requireRole(["SUPERADMIN"]) — most internal staff can run
// every hospital's backend admin, but only the owner account can create or
// disable OTHER internal logins. Being SUPERADMIN is necessary but not
// sufficient here.
export async function requireOwner(): Promise<GuardResult> {
  const auth = await requireRole(["SUPERADMIN"]);
  if (!auth.ok) return auth;
  if (!auth.session.user.is_owner) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Only the owner account can manage internal staff logins" },
        { status: 403 }
      ),
    };
  }
  return auth;
}

// Hospital-tenancy check — call when a route receives a case_id / mrn from the client.
// For now we only have one hospital, so this is a stub that always passes for ADMIN/MEDCO/CFO
// of HOSP-BLR-49. When multi-tenancy lands (#5), this expands.
export function assertHospitalAccess(session: { user: SessionUser }, hospital_id: string): boolean {
  return session.user.hospital_id === hospital_id;
}
