// POST /api/auth/internal-login  → { email, password }
//
// The ONLY door for SUPERADMIN — mirrors /api/auth/login but inverted:
// this endpoint refuses to create a session for anyone who ISN'T
// SUPERADMIN, same as the tenant login refuses anyone who IS. Rejecting
// server-side (before session.save()) rather than just hiding the mismatch
// in the UI, so a wrong-role login attempt never leaves behind a valid
// session for the wrong area.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { verifyCredentials, toSessionUser } from "@/lib/auth/users";
import { rateLimit, clientIp } from "@/lib/auth/rateLimit";

const LoginBodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const rl = rateLimit({ key: `internal-login:${ip}`, limit: 8, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = LoginBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Email and password required" }, { status: 400 });
    }
    const email = parsed.data.email.trim();
    const password = parsed.data.password;

    const user = await verifyCredentials(email, password);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
    }

    if (user.role !== "SUPERADMIN") {
      return NextResponse.json(
        { ok: false, error: "This login is for MedLynq internal staff only." },
        { status: 403 }
      );
    }

    const session = await getSession();
    session.user = toSessionUser(user);
    await session.save();

    return NextResponse.json({ ok: true, user: session.user });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
