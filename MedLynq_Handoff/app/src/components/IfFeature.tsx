// <IfFeature flag="whatsapp">…</IfFeature>
//
// Server component — reads tenant config and only renders children if the flag
// is true. Used to gate features per-hospital without forking code.

import { getTenant } from "@/lib/tenant/server";

export default async function IfFeature({
  flag,
  fallback,
  children,
}: {
  flag: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tenant = await getTenant();
  const on = Boolean(tenant.features?.[flag]);
  if (!on) return <>{fallback ?? null}</>;
  return <>{children}</>;
}
