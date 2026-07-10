// GET /api/auth/me — returns current session user or null (for client hooks)

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
  const s = await getSession();
  return NextResponse.json({ user: s.user ?? null });
}
