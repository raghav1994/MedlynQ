// /api/audit-log?mrn=X&limit=200
import { NextRequest, NextResponse } from "next/server";
import { readAuditLog, auditStats } from "@/lib/auditLog";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const mrn = req.nextUrl.searchParams.get("mrn") ?? undefined;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  const events = await readAuditLog(mrn, limit);
  const stats = await auditStats();
  return NextResponse.json({ ok: true, events, stats });
}
