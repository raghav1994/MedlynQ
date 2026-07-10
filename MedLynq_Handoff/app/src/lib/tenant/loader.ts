// Tenant config loader.
//
// Resolution order (highest priority first):
//   0. MEDLYNQ_TENANT_ID env var  — hard-locks a deployment to one tenant,
//      for the per-tenant-container deployment model (one Docker container
//      + one database per hospital). Set this and every other resolution
//      path below becomes unreachable dead code for that container — a
//      wrong subdomain or stale session can never leak a different
//      tenant's branding/feature flags. Leave unset for the shared/
//      multi-tenant deployment model, where resolution falls through to:
//   1. session.user.hospital_id  — once logged in, the user's hospital wins
//   2. host header subdomain      — e.g. "action.medlynq.co.in" → "action"
//   3. ?t=<subdomain> query param — dev fallback when on localhost
//   4. fallback to first tenant on disk
//
// Per-tenant JSON lives at db/tenants/{hospital_id}.json — one file per hospital,
// no DB needed. Adding a hospital = drop a JSON file.

import { readFile, readdir } from "fs/promises";
import path from "path";

export type TenantConfig = {
  hospital_id: string;
  name: string;
  short_name: string;
  subdomain: string;
  logo_initial: string;
  primary_color: string;
  accent_color: string;
  city: string;
  district: string;
  vocabulary: Record<string, string>;
  features: Record<string, boolean>;
  schemes_enabled: string[];
  his_webhook_secret?: string;
  tagline: string;
};

const TENANTS_DIR = path.resolve(process.cwd(), "db", "tenants");

let _cache: TenantConfig[] | null = null;

async function loadAll(): Promise<TenantConfig[]> {
  if (_cache) return _cache;
  try {
    const files = await readdir(TENANTS_DIR);
    const loaded: TenantConfig[] = [];
    for (const f of files.filter((x) => x.endsWith(".json"))) {
      const raw = await readFile(path.join(TENANTS_DIR, f), "utf8");
      loaded.push(JSON.parse(raw));
    }
    _cache = loaded;
    return loaded;
  } catch {
    return [];
  }
}

export async function loadTenantByHospitalId(hospital_id: string | undefined | null): Promise<TenantConfig | null> {
  if (!hospital_id) return null;
  const all = await loadAll();
  return all.find((t) => t.hospital_id === hospital_id) ?? null;
}

export async function loadTenantBySubdomain(subdomain: string | undefined | null): Promise<TenantConfig | null> {
  if (!subdomain) return null;
  const all = await loadAll();
  return all.find((t) => t.subdomain.toLowerCase() === subdomain.toLowerCase()) ?? null;
}

/** Extract subdomain from a host header like "action.medlynq.co.in" → "action".
 *  Returns null for localhost / single-label hosts. */
export function subdomainFromHost(host: string | undefined | null): string | null {
  if (!host) return null;
  const cleaned = host.split(":")[0].toLowerCase();
  if (cleaned === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(cleaned)) return null;
  const parts = cleaned.split(".");
  if (parts.length < 3) return null;
  return parts[0];
}

/** Best-effort tenant resolution. Used by middleware and server components. */
export async function resolveTenant(opts: {
  session_hospital_id?: string | null;
  host?: string | null;
  query_t?: string | null;
}): Promise<TenantConfig> {
  // 0. Hard lock for single-tenant container deployments
  const lockedId = process.env.MEDLYNQ_TENANT_ID;
  if (lockedId) {
    const t = await loadTenantByHospitalId(lockedId);
    if (t) return t;
    throw new Error(`MEDLYNQ_TENANT_ID=${lockedId} set but no matching db/tenants/${lockedId}.json found`);
  }
  // 1. Session wins
  if (opts.session_hospital_id) {
    const t = await loadTenantByHospitalId(opts.session_hospital_id);
    if (t) return t;
  }
  // 2. Subdomain
  const sub = subdomainFromHost(opts.host ?? null);
  if (sub) {
    const t = await loadTenantBySubdomain(sub);
    if (t) return t;
  }
  // 3. Query param (dev)
  if (opts.query_t) {
    const t = await loadTenantBySubdomain(opts.query_t);
    if (t) return t;
  }
  // 4. Fallback: first tenant on disk
  const all = await loadAll();
  if (all.length > 0) return all[0];
  throw new Error("No tenants configured. Add db/tenants/{hospital_id}.json");
}
