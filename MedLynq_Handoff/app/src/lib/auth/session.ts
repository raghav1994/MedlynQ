// iron-session config + helpers
//
// Session is an httpOnly + secure + SameSite=Lax cookie sealed with AES-256.
// No server-side session store needed — the cookie IS the session.

import { getIronSession, IronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

// SUPERADMIN is MedLynq's own internal staff, not a hospital role — deliberately
// separate from the hospital-facing roles below. Same auth mechanism (session,
// hashing, rate limiting) as everyone else — see the backend-admin dashboard
// handoff discussion for why this is a role, not a second login codebase.
export type Role = "ADMIN" | "MEDCO" | "CFO" | "DOCTOR" | "SUPERADMIN";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  hospital_id: string;
  hospital_name: string;
  designation: string;
  bis_enabled: boolean;
  // Only meaningful for SUPERADMIN — the one account that can create/disable
  // other internal (SUPERADMIN) logins. Every other internal staffer runs
  // the hospitals themselves but can't touch who else has that access.
  is_owner?: boolean;
  // false for a "Floor Admin" ADMIN-role account — same role/permissions as
  // an HOD everywhere else (mobile Add-Staff QR panel, etc.), but blocked
  // from the desktop dashboard entirely (see middleware.ts). Absent/true for
  // every other account — a Floor Admin is the deliberate exception, not the
  // default, so existing users don't need a migration to keep working.
  desktop_access?: boolean;
};

export type AppSession = {
  user?: SessionUser;
};

const SECRET = process.env.IRON_SESSION_SECRET;
if (!SECRET || SECRET.length < 32) {
  // Fail loudly at boot if missing — better than a silent insecure session
  throw new Error("IRON_SESSION_SECRET is missing or too short (need ≥32 chars). Add it to .env.local");
}

export const sessionOptions: SessionOptions = {
  password: SECRET,
  cookieName: "medlynq_session",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8, // 8h working day
    path: "/",
  },
};

// Server Component / Route Handler usage (Next 14 app router)
export async function getSession(): Promise<IronSession<AppSession>> {
  return getIronSession<AppSession>(cookies(), sessionOptions);
}

// Edge middleware usage (needs explicit req/res to read/write cookie)
export async function getEdgeSession(req: NextRequest, res: NextResponse) {
  return getIronSession<AppSession>(req, res, sessionOptions);
}
