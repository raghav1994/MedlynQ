// POST /api/query/resolve  { case_id, query_id }
//
// Marks a query round "resolved" and persists it to db/query_overrides.json
// (read back by mockQueries.ts's queriesForCase() on every load), then
// appends a real query_resolved event to db/events.json — the event that
// backs the dashboard's Scoreboard / Activity Stream / Yesterday's Wins.

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/guards";
import { rateLimit } from "@/lib/auth/rateLimit";
import { scopedCase } from "@/lib/dataScope";
import { queriesForCase } from "@/lib/mockQueries";
import { appendEvent } from "@/lib/eventLog";

export const runtime = "nodejs";

const OVERRIDE_FILE = path.resolve(process.cwd(), "db", "query_overrides.json");

const BodySchema = z.object({
  case_id: z.string().trim().min(1),
  query_id: z.string().trim().min(1),
});

async function readOverrides(): Promise<Record<string, any>> {
  try { return JSON.parse(await readFile(OVERRIDE_FILE, "utf8")); } catch { return {}; }
}
async function writeOverrides(v: Record<string, any>) {
  await mkdir(path.dirname(OVERRIDE_FILE), { recursive: true });
  await writeFile(OVERRIDE_FILE, JSON.stringify(v, null, 2));
}

// raised_on is a formatted "26 May 2026"-style date with no time component —
// resolution time is therefore only day-granular, not minute-granular.
function parseRaisedOn(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth();
  if (!guard.ok) return guard.response;

  const rl = rateLimit({ key: `query-resolve:${guard.session.user.id}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { case_id, query_id } = parsed.data;

  const c = await scopedCase(case_id);
  if (!c) {
    return NextResponse.json({ ok: false, error: "Case not found" }, { status: 404 });
  }

  const rounds = queriesForCase(case_id);
  const round = rounds.find((r) => r.id === query_id);
  if (!round) {
    return NextResponse.json({ ok: false, error: "Query round not found" }, { status: 404 });
  }
  if (round.status === "resolved") {
    return NextResponse.json({ ok: false, error: "Already resolved" }, { status: 409 });
  }

  const now = new Date();
  const overrides = await readOverrides();
  overrides[query_id] = {
    ...(overrides[query_id] ?? {}),
    status: "resolved",
    resolved_at: now.toISOString(),
    resolved_by: guard.session.user.name,
  };
  await writeOverrides(overrides);

  const raised = parseRaisedOn(round.raised_on);
  const minutesToResolve = raised ? Math.max(0, Math.round((now.getTime() - raised.getTime()) / 60000)) : undefined;

  appendEvent({
    kind: "query_resolved",
    actor_id: guard.session.user.id,
    actor_name: guard.session.user.name,
    hospital_id: guard.session.user.hospital_id,
    case_id,
    patient_id: c.patient_id,
    amount: round.amount_at_stake,
    minutes_to_resolve: minutesToResolve,
    text: `${guard.session.user.name} resolved a query on ${c.registration_id ?? c.id} · ₹${round.amount_at_stake.toLocaleString("en-IN")} unlocked`,
    tone: "good",
  });

  return NextResponse.json({ ok: true, query_id, status: "resolved" });
}
