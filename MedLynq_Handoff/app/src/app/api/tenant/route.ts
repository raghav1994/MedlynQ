// GET /api/tenant — returns the current tenant config for client components
// (e.g. <WhatsAppShare> needs to know if features.whatsapp is on).
//
// Safe to expose: this is brand/feature config, not secrets.

import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant/server";

export const runtime = "nodejs";

export async function GET() {
  const t = await getTenant();
  return NextResponse.json({ tenant: t });
}
