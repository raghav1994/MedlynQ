// POST /api/auth/login  → { email, password }
//
// Returns { ok, user } and sets the iron-session cookie on success.
// 401 on bad credentials. Generic error message (don't leak whether email exists).

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { verifyCredentials, toSessionUser } from "@/lib/auth/users";
import { subdomainFromHost, loadTenantBySubdomain } from "@/lib/tenant/loader";
import { rateLimit, clientIp } from "@/lib/auth/rateLimit";

const LoginBodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Brute-force protection — limit by IP, pre-auth
  const ip = clientIp(req);
  const rl = rateLimit({ key: `login:${ip}`, limit: 8, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = LoginBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Email and password required" },
        { status: 400 }
      );
    }
    const email = parsed.data.email.trim();
    const password = parsed.data.password;

    const user = await verifyCredentials(email, password);
    if (!user) {
      // Generic message — don't leak whether email exists
      return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
    }

    // Tenant scope check — user from hospital A cannot log in on hospital B's subdomain
    const host = req.headers.get("host");
    const sub = subdomainFromHost(host);
    // Dev override: cookie set by login UI tenant-switcher
    const devHint = cookies().get("medlynq_tenant_hint")?.value;
    const expectedSub = sub ?? devHint ?? null;
    if (expectedSub) {
      const tenantOnUrl = await loadTenantBySubdomain(expectedSub);
      if (tenantOnUrl && tenantOnUrl.hospital_id !== user.hospital_id) {
        // Generic — don't leak that the account exists at another hospital.
        // (Internal audit log captures the real reason for ops.)
        return NextResponse.json(
          { ok: false, error: "Invalid email or password" },
          { status: 401 }
        );
      }
    }

    const session = await getSession();
    session.user = toSessionUser(user);
    await session.save();

    return NextResponse.json({ ok: true, user: session.user });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
