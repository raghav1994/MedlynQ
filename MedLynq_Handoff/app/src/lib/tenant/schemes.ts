// Per-tenant scheme allowlist filter.
//
// Backend Panel / OPD / Pre-Auth screens should call filterSchemesForTenant()
// instead of using the global scheme master directly.

import type { TenantConfig } from "./loader";
import type { Scheme } from "@/lib/types";

const SCHEME_NORMALIZE: Record<string, Scheme> = {
  PMJAY: "PMJAY", AYUSHMAN: "PMJAY",
  CGHS: "CGHS", ECHS: "ECHS", CAPF: "CAPF",
  ESI: "ESI", RAILWAY: "Railway_UMID", UMID: "Railway_UMID",
  NDMC: "NDMC", FCI: "FCI", DU: "DU",
};

export function isSchemeEnabled(tenant: TenantConfig, scheme: string): boolean {
  const norm = SCHEME_NORMALIZE[scheme.toUpperCase()] ?? scheme;
  return tenant.schemes_enabled.some((s) => SCHEME_NORMALIZE[s.toUpperCase()] === norm || s === norm);
}

export function filterSchemesForTenant<T extends { scheme?: string | null } | string>(
  tenant: TenantConfig,
  items: T[]
): T[] {
  return items.filter((it) => {
    const scheme = typeof it === "string" ? it : it.scheme;
    if (!scheme) return true;
    return isSchemeEnabled(tenant, scheme);
  });
}
