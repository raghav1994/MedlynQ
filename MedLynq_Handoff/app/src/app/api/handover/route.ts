// /api/handover
//   POST → Backend Panel pushes a verified patient to OPD queue
//   GET  → OPD page polls for pending handovers
//   DELETE?id=X → mark consumed
// Local JSON store at PatientLog/_index/handover_queue.json.

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireRole } from "@/lib/auth/guards";

export const runtime = "nodejs";

const STORE_DIR = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const STORE_FILE = path.join(STORE_DIR, "handover_queue.json");

export type HandoverEntry = {
  id: string;
  pushed_at: string;
  consumed_at?: string;
  scheme: string;
  card: string;
  aadhaar_last4?: string;
  beneficiary: {
    name: string;
    age: number;
    gender: "M" | "F";
    state: string;
    district: string;
  };
  wallet: { available_inr: number; cap_inr: number };
  status: "pending" | "consumed";
};

async function readStore(): Promise<HandoverEntry[]> {
  try { return JSON.parse(await readFile(STORE_FILE, "utf8")); } catch { return []; }
}
async function writeStore(list: HandoverEntry[]) {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(list, null, 2), "utf8");
}

export async function GET(req: NextRequest) {
  const all = await readStore();
  const onlyPending = req.nextUrl.searchParams.get("status") !== "all";
  return NextResponse.json({ ok: true, queue: onlyPending ? all.filter((e) => e.status === "pending") : all });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(["ADMIN", "MEDCO"]);
  if (!guard.ok) return guard.response;
  try {
    const body = await req.json();
    const entry: HandoverEntry = {
      id: `H_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      pushed_at: new Date().toISOString(),
      scheme: String(body.scheme ?? ""),
      card: String(body.card ?? ""),
      aadhaar_last4: body.aadhaar_last4 ? String(body.aadhaar_last4).slice(-4) : undefined,
      beneficiary: {
        name: String(body.beneficiary?.name ?? ""),
        age: Number(body.beneficiary?.age ?? 0),
        gender: String(body.beneficiary?.gender ?? "M").toUpperCase().startsWith("F") ? "F" : "M",
        state: String(body.beneficiary?.state ?? ""),
        district: String(body.beneficiary?.district ?? ""),
      },
      wallet: {
        available_inr: Number(body.wallet?.available_inr ?? 0),
        cap_inr: Number(body.wallet?.cap_inr ?? 0),
      },
      status: "pending",
    };
    const list = await readStore();
    list.unshift(entry);
    await writeStore(list);
    return NextResponse.json({ ok: true, entry });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  const list = await readStore();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  list[idx].status = "consumed";
  list[idx].consumed_at = new Date().toISOString();
  await writeStore(list);
  return NextResponse.json({ ok: true });
}
