// Audit trail for the backend-admin dashboard — every change a MedLynq
// employee makes to any hospital's config, documents, schemes, or logins.
// Separate from the existing redact/purge/routing audit logs (auditLog.ts,
// eventLog.ts) since this one specifically covers HIGH-privilege
// cross-tenant actions and needs to be reviewable on its own.

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const AUDIT_FILE = path.resolve(process.cwd(), "db", "backend_admin_audit.json");

export type AdminAuditEntry = {
  id: string;
  ts: string;
  actor_id: string;
  actor_name: string;
  action: string;           // e.g. "hospital_created", "document_profile_added", "user_disabled"
  hospital_id?: string;
  detail: Record<string, any>;
};

export async function appendAdminAudit(entry: Omit<AdminAuditEntry, "id" | "ts">): Promise<void> {
  try {
    await mkdir(path.dirname(AUDIT_FILE), { recursive: true });
    let all: AdminAuditEntry[] = [];
    try {
      all = JSON.parse(await readFile(AUDIT_FILE, "utf8"));
    } catch {
      // file doesn't exist yet
    }
    all.push({ ...entry, id: `AA_${Date.now()}_${Math.floor(Math.random() * 1000)}`, ts: new Date().toISOString() });
    await writeFile(AUDIT_FILE, JSON.stringify(all.slice(-2000), null, 2));
  } catch {
    // never break the calling mutation on audit-write failure
  }
}

export async function readAdminAudit(hospital_id?: string): Promise<AdminAuditEntry[]> {
  try {
    const all: AdminAuditEntry[] = JSON.parse(await readFile(AUDIT_FILE, "utf8"));
    const scoped = hospital_id ? all.filter((e) => e.hospital_id === hospital_id) : all;
    return scoped.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  } catch {
    return [];
  }
}
