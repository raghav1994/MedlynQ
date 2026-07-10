// Read-only TS reader of the JSONL audit log written by python/audit.py.

import { readFile, stat } from "fs/promises";
import path from "path";

const AUDIT_FILE = path.resolve(process.cwd(), "..", "PatientLog", "_index", "audit_log.jsonl");

export type AuditEvent = {
  ts: string;
  kind: string;
  mrn: string | null;
  file: string | null;
  sha256_in?: string | null;
  sha256_out?: string | null;
  burned_count?: number;
  extra?: Record<string, any>;
};

export async function readAuditLog(mrn?: string, limit = 200): Promise<AuditEvent[]> {
  try {
    const raw = await readFile(AUDIT_FILE, "utf8");
    const out: AuditEvent[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try {
        const ev = JSON.parse(s) as AuditEvent;
        if (mrn && ev.mrn !== mrn) continue;
        out.push(ev);
      } catch {
        // skip corrupt line
      }
    }
    return out.slice(-limit).reverse();
  } catch {
    return [];
  }
}

export async function auditStats() {
  const events = await readAuditLog(undefined, 5000);
  const by_kind: Record<string, number> = {};
  let last_event_at: string | null = null;
  let last_purge_at: string | null = null;
  let purged_bytes = 0;
  for (const ev of events) {
    by_kind[ev.kind] = (by_kind[ev.kind] ?? 0) + 1;
    if (!last_event_at || ev.ts > last_event_at) last_event_at = ev.ts;
    if (ev.kind === "purge") {
      if (!last_purge_at || ev.ts > last_purge_at) last_purge_at = ev.ts;
      purged_bytes += Number(ev.extra?.size_bytes ?? 0);
    }
  }
  let file_size_bytes = 0;
  try {
    file_size_bytes = (await stat(AUDIT_FILE)).size;
  } catch {}
  return {
    by_kind,
    last_event_at,
    last_purge_at,
    purged_bytes,
    file_size_bytes,
    total_events: events.length,
    audit_file: AUDIT_FILE,
  };
}
