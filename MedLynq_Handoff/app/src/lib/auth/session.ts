// iron-session config + helpers
//
// Session is an httpOnly + secure + SameSite=Lax cookie sealed with AES-256.
// No server-side session store needed — the cookie IS the session.

import { getIronSession, IronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

export type Role = "ADMIN" | "MEDCO" | "CFO" | "DOCTOR";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  hospital_id: string;
  hospital_name: string;
  designation: string;
  bis_enabled: boolean;
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
