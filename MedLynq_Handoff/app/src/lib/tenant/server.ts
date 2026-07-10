// Server-side helper: get the tenant for the current request.
//
// Looks at session.user.hospital_id first (post-login).
// Falls back to host subdomain, then ?t=, then first tenant.

import { headers, cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { resolveTenant, type TenantConfig } from "./loader";

export async function getTenant(): Promise<TenantConfig> {
  const session = await getSession();
  const h = headers();
  const host = h.get("host");
  // Read dev-override from a cookie (set by login page) so /?t=fortis sticks across requests
  const devOverride = cookies().get("medlynq_tenant_hint")?.value;
  return resolveTenant({
    session_hospital_id: session.user?.hospital_id,
    host,
    query_t: devOverride,
  });
}
