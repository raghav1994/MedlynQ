// /api/scheme-rules?scheme=Ayushman&variant=SHA_UP&entry=checkup
import { NextRequest, NextResponse } from "next/server";
import { preAuthDocsFor, listSchemes, totalRules } from "@/lib/schemeRules";
import type { Scheme, SchemeVariant, EntryMode } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const scheme = req.nextUrl.searchParams.get("scheme") as Scheme | null;
  const variant = req.nextUrl.searchParams.get("variant") as SchemeVariant | null;
  const entry = (req.nextUrl.searchParams.get("entry") as EntryMode) || "checkup";

  if (!scheme) {
    const schemes = await listSchemes();
    const total = await totalRules();
    return NextResponse.json({ ok: true, schemes, total_rules: total });
  }

  const docs = await preAuthDocsFor(scheme, variant, entry);
  // Group alt-groups so the UI can render "any one of"
  const grouped: Record<string, typeof docs> = {};
  const flat: typeof docs = [];
  for (const d of docs) {
    if (d.alt_group) {
      grouped[d.alt_group] ??= [];
      grouped[d.alt_group].push(d);
    } else {
      flat.push(d);
    }
  }
  return NextResponse.json({
    ok: true,
    scheme,
    variant,
    entry_mode: entry,
    docs,
    flat,
    alt_groups: grouped,
    total: docs.length,
  });
}
