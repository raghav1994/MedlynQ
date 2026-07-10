// POST /api/his/ingest
//
// Receives an HL7 v2.x ADT^A04 admission message from a hospital's HIS.
//
// Auth: header `X-MedLynq-HIS-Secret` must match the tenant's
// `his_webhook_secret`. Tenant is resolved either from:
//   - X-MedLynq-Tenant-Subdomain header (preferred), or
//   - subdomain on the host
//
// Returns an HL7 ACK^A04 (text/plain) on success, JSON error otherwise.
//
// NOT session-cookie protected (HIS systems don't manage cookies).
// Listed as PUBLIC in middleware → auth happens via shared secret here.

import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";
import { z } from "zod";
import { parseHL7, buildAck, messageType, messageControlId } from "@/lib/his/hl7Parser";
import { mapHL7ToAdmission } from "@/lib/his/hl7Mapper";
import { loadTenantBySubdomain, subdomainFromHost } from "@/lib/tenant/loader";
import { rateLimit } from "@/lib/auth/rateLimit";

export const runtime = "nodejs";

const HIS_LOG_DIR  = path.resolve(process.cwd(), "..", "PatientLog", "_index");
const HIS_LOG_FILE = path.join(HIS_LOG_DIR, "his_log.jsonl");
const HIS_QUEUE_DIR  = path.resolve(process.cwd(), "db");
const HIS_QUEUE_FILE = path.join(HIS_QUEUE_DIR, "his_admissions.json");

async function appendLog(entry: Record<string, any>) {
  try {
    await mkdir(HIS_LOG_DIR, { recursive: true });
    await writeFile(HIS_LOG_FILE, JSON.stringify(entry) + "\n", { flag: "a" });
  } catch {}
}

async function persistAdmission(record: any) {
  try {
    await mkdir(HIS_QUEUE_DIR, { recursive: true });
    let store: any[] = [];
    try { store = JSON.parse(await readFile(HIS_QUEUE_FILE, "utf8")); } catch {}
    // Idempotency — dedupe on msg_control_id within the same hospital
    const key = `${record.hospital_id}:${record.source.msg_control_id}`;
    if (store.find((r) => `${r.hospital_id}:${r.source.msg_control_id}` === key)) return false;
    store.push(record);
    await writeFile(HIS_QUEUE_FILE, JSON.stringify(store, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // IP-level rate limit (no session for HIS systems)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rl = rateLimit({ key: `his-ingest:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  // Resolve tenant
  const subdomainHeader = req.headers.get("x-medlynq-tenant-subdomain");
  const sub = subdomainHeader || subdomainFromHost(req.headers.get("host"));
  if (!sub) {
    return NextResponse.json({ ok: false, error: "Tenant not resolvable (set X-MedLynq-Tenant-Subdomain or use the hospital's subdomain)" }, { status: 400 });
  }
  const tenant = await loadTenantBySubdomain(sub);
  if (!tenant) {
    return NextResponse.json({ ok: false, error: `Unknown tenant: ${sub}` }, { status: 404 });
  }

  // Shared-secret auth (constant-time compare to dodge timing attacks)
  const secretHeader = req.headers.get("x-medlynq-his-secret") ?? "";
  const expected = tenant.his_webhook_secret ?? "";
  if (!expected || secretHeader.length !== expected.length || !timingSafeEqual(secretHeader, expected)) {
    return NextResponse.json({ ok: false, error: "Invalid HIS webhook secret" }, { status: 403 });
  }

  // Parse the HL7 body (either text/plain or {"hl7":"..."} JSON)
  let raw: string;
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.startsWith("application/json")) {
    const body = await req.json().catch(() => ({}));
    const parsed = z.object({ hl7: z.string().min(10) }).safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Expected { hl7: \"<text>\" }" }, { status: 400 });
    }
    raw = parsed.data.hl7;
  } else {
    raw = await req.text();
  }

  let msg, admission;
  try {
    msg = parseHL7(raw);
    admission = mapHL7ToAdmission(msg, tenant.hospital_id);
  } catch (e: any) {
    await appendLog({ ts: new Date().toISOString(), hospital_id: tenant.hospital_id, ok: false, error: e?.message });
    return NextResponse.json({ ok: false, error: e?.message ?? "Parse error" }, { status: 400 });
  }

  const inserted = await persistAdmission({
    received_at: new Date().toISOString(),
    hospital_id: tenant.hospital_id,
    patient: admission.patient,
    case_seed: admission.case_seed,
    source: admission.source,
  });

  await appendLog({
    ts: new Date().toISOString(),
    hospital_id: tenant.hospital_id,
    ok: true,
    inserted,
    msg_control_id: admission.source.msg_control_id,
    mrn: admission.patient.mrn,
    trigger: admission.source.trigger,
  });

  // HL7 ACK is the contract — return as text/plain
  const ack = buildAck(msg, "AA", inserted ? "Accepted" : "Already received");
  return new NextResponse(ack, {
    status: 200,
    headers: { "Content-Type": "application/hl7-v2; charset=utf-8" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
