// /api/package-check?code=MO001F&scheme=PMJAY
import { NextRequest, NextResponse } from "next/server";
import { checkPackageForScheme } from "@/lib/packages";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") || "";
  const scheme = req.nextUrl.searchParams.get("scheme") || "";
  if (!code || !scheme) return NextResponse.json({ ok: false, error: "code and scheme required" }, { status: 400 });
  const result = await checkPackageForScheme(code, scheme);
  return NextResponse.json({ ok: true, ...result });
}
