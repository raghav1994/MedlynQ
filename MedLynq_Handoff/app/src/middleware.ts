// Edge middleware — gatekeeper for the entire app.
//
// Rules:
//   • /login + /api/auth/* + static assets → always allowed
//   • Everything else → must have a valid session, else redirect to /login (pages)
//                       or return 401 (api).
//   • Origin check (CSRF) on any non-GET API call. SameSite=Lax already blocks most
//     cross-site requests, but the Origin header is a belt-and-braces check.

import { NextRequest, NextResponse } from "next/server";
import { getEdgeSession } from "@/lib/auth/session";

const PUBLIC_PATHS = [
  "/login",
  "/internal/login",       // MedLynq internal staff login — separate page + separate auth API
  "/api/auth/login",
  "/api/auth/internal-login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/tenant",          // GET current tenant
  "/api/tenant/switch",   // dev tenant override
  "/api/his/ingest",      // HL7 webhook (auth via shared secret in handler)
  "/api/nhcx/mock",       // local NHCX simulation — server-to-server call from
                          // /api/nhcx/send carries no session cookie; auth via
                          // shared internal secret in the handler instead
  "/api/ping",
  "/api/mobile-auth",
  "/api/mobile-upload",
  "/app-debug.apk",       // Android installer — must be downloadable by a
                          // brand-new staff phone that has no session yet
                          // (scanned from the onboarding QR in /mobile-sim)
  "/_next",
  "/favicon",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const res = NextResponse.next();
  const session = await getEdgeSession(req, res);

  // CSRF — reject cross-origin state-changing API calls
  if (pathname.startsWith("/api/") && req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return NextResponse.json({ ok: false, error: "Cross-origin request blocked" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ ok: false, error: "Invalid Origin header" }, { status: 403 });
      }
    }
  }

  if (!session.user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
    }
    // Send /backend-admin/* to the internal login, not the hospital one —
    // they're different logins for different people.
    const loginPath = pathname.startsWith("/backend-admin") ? "/internal/login" : "/login";
    const loginUrl = new URL(loginPath, req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Hard area separation by role — this is the ONLY place this is enforced
  // app-wide, deliberately, so it can never be bypassed by a page that forgot
  // its own guard. SUPERADMIN (internal MedLynq staff, not tied to any real
  // hospital) must never reach hospital-tenant routes, and a hospital user
  // must never reach /backend-admin, regardless of what session cookie they
  // happen to be carrying. A prior gap here let a SUPERADMIN session load the
  // normal tenant dashboard shell on any hospital's subdomain — this closes
  // that at the root instead of patching individual pages.
  const isBackendAdminArea = pathname.startsWith("/backend-admin") || pathname.startsWith("/api/backend-admin");
  const isSuperadmin = session.user.role === "SUPERADMIN";

  if (isSuperadmin && !isBackendAdminArea) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Forbidden — internal accounts can't access hospital routes" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/backend-admin", req.url));
  }
  if (!isSuperadmin && isBackendAdminArea) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/internal/login", req.url));
  }

  // Floor Admin — an ADMIN-role account with desktop_access: false. Same
  // role/permissions as an HOD everywhere else (mobile Add-Staff QR panel
  // included), but the desktop dashboard itself is off-limits. Enforced
  // here, once, rather than per-page, for the same reason as the
  // SUPERADMIN split above — a page that forgets its own guard can't leak
  // desktop access to a Floor Admin session.
  if (session.user.desktop_access === false && pathname !== "/no-desktop-access") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Forbidden — no desktop access" }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/no-desktop-access", req.url));
  }

  return res;
}

export const config = {
  // Run on everything EXCEPT next-internal asset paths
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
