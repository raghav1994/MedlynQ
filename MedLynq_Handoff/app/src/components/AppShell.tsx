"use client";

import { useEffect, useState } from "react";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";

type TenantBrand = {
  name: string;
  short_name: string;
  logo_initial: string;
  primary_color: string;
  accent_color: string;
};

const FALLBACK_BRAND: TenantBrand = {
  name: "MedLynq",
  short_name: "MedLynq",
  logo_initial: "M",
  primary_color: "#0f172a",
  accent_color: "#dc2626",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<TenantBrand>(FALLBACK_BRAND);

  useEffect(() => {
    fetch("/api/tenant")
      .then((r) => r.json())
      .then((j) => {
        if (j?.tenant) {
          setBrand({
            name: j.tenant.name,
            short_name: j.tenant.short_name,
            logo_initial: j.tenant.logo_initial,
            primary_color: j.tenant.primary_color,
            accent_color: j.tenant.accent_color,
          });
        }
      })
      .catch(() => {});
  }, []);

  const styleVars = {
    ["--tenant-primary" as any]: brand.primary_color,
    ["--tenant-accent" as any]: brand.accent_color,
  } as React.CSSProperties;

  return (
    // h-screen (not min-h-screen) + overflow-hidden here, with overflow-y-auto
    // pushed down onto <main> only, is what keeps the sidebar in place while a
    // long page (Patient List, Patient Detail) scrolls — previously the whole
    // window scrolled together, so the nav disappeared upward with the content.
    <div className="h-screen flex bg-bone-100 overflow-hidden" style={styleVars}>
      <Sidebar tenant={brand} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 min-h-0 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
