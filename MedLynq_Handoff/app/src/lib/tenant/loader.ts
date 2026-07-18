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

// One config-driven document requirement — the config-not-code replacement
// for editing checklist.ts/content_classifier.py/identity_llm.py by hand
// every time a hospital's specialty needs a new document type recognized.
// `anchors` doubles as both the classifier's keyword hints (Python side,
// via tenant_config.py) and the checklist engine's matching rule (below).
export type DocumentProfile = {
  doc_type: string;               // slug, e.g. "fever_chart"
  label: string;                  // e.g. "Fever / Vitals Chart"
  specialty: string;               // plain string, not the Specialty union —
                                    // a brand-new specialty shouldn't need a
                                    // TS type change to be usable in config
  stage: "opd" | "pre_auth" | "mid_way" | "discharge";
  for_treatments?: string[];
  // Which schemes require this document, e.g. ["Ayushman", "CGHS"]. Omitted
  // or empty = universal (required regardless of scheme) — this is what
  // every profile defaulted to before schemes existed, so old data keeps
  // working unchanged. A doc_type either satisfies a scheme's requirement or
  // it doesn't — no per-scheme variants of "the same" document type.
  schemes?: string[];
  alt_group?: string;
  anchors: string[];               // keyword/phrase hints for classification
  extraction_keys?: string[];      // fields the LLM should try to pull out
};

// A document defined ONCE per hospital — label, classifier anchors, and
// extraction keys live here so "OT Notes" means the same thing everywhere
// it's required, and editing it updates every department/scheme that uses
// it. This is the generic library (Bill, OT Notes, Referral Letter, Geotag
// Photo, ...); DocumentRequirement below is what actually pins a library
// entry to a department + stage + scheme.
export type DocumentLibraryEntry = {
  doc_type: string;                // slug, unique per hospital — the join key
  label: string;
  anchors: string[];
  extraction_keys?: string[];
  // Whether this entry's label/anchors are kept in sync with the global
  // Document Catalog (db/document_catalog.json). true = a live copy: editing
  // the catalog entry re-syncs it here. Once a hospital edits the label or
  // anchors locally, it detaches (catalog_linked=false) and becomes a
  // per-hospital override that central catalog edits no longer touch.
  // Absent = a pre-catalog hospital-local definition (treated as detached).
  catalog_linked?: boolean;
};

// One "this department needs this document at this stage (for these
// schemes)" link. Many requirements can point at the same doc_type — that's
// how "OT Notes" ends up required by both General Medicine and Cardiology
// without being defined twice. Requirement identity is (doc_type, specialty,
// stage), not doc_type alone.
export type DocumentRequirement = {
  doc_type: string;                 // must match a DocumentLibraryEntry.doc_type
  specialty: string;
  stage: "opd" | "pre_auth" | "mid_way" | "discharge";
  for_treatments?: string[];
  // Omitted/empty = universal (required regardless of scheme). See
  // DocumentProfile.schemes above for the full reasoning — same semantics.
  schemes?: string[];
  alt_group?: string;
};

export type TenantConfig = {
  hospital_id: string;
  name: string;
  short_name: string;
  subdomain: string;
  logo_initial: string;
  primary_color: string;
  accent_color: string;
  state?: string;    // full state name, e.g. "Karnataka" — from india-state-district
  city: string;
  district: string;
  vocabulary: Record<string, string>;
  features: Record<string, boolean>;
  schemes_enabled: string[];
  specialties_enabled?: string[];       // which departments this hospital runs
  // Source of truth for document requirements (see DocumentLibraryEntry /
  // DocumentRequirement above). document_profiles below is a derived,
  // flattened view kept in sync purely so the Python classifier
  // (tenant_config.py / content_classifier.py / identity_llm.py), which
  // only ever reads the old flat shape, keeps working unchanged.
  document_library?: DocumentLibraryEntry[];
  document_requirements?: DocumentRequirement[];
  document_profiles?: DocumentProfile[]; // derived — do not edit directly, see above
  npi?: string;                         // NHA hospital-id for FHIR bundles (nhcx/send)
  his_webhook_secret?: string;
  tagline: string;
  latitude?: string;
  longitude?: string;
  address?: string;
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
