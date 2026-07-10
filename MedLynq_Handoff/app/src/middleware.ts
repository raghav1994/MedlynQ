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
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/tenant",          // GET current tenant
  "/api/tenant/switch",   // dev tenant override
  "/api/his/ingest",      // HL7 webhook (auth via shared secret in handler)
  "/api/nhcx/mock",       // local NHCX simulation — server-to-server call from
                          // /api/nhcx/send carries no session cookie; auth via
                          // shared internal secret in the handler instead
  "/api/ping",
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
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  // Run on everything EXCEPT next-internal asset paths
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
