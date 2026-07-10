"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { ALL_SCHEMES } from "@/lib/types";

type NavItem = { label: string; href: string; soon?: boolean; roles?: string[] };

const NAV: NavItem[] = [
  { label: "Dashboard",        href: "/",         roles: ["ADMIN", "MEDCO"] },
  { label: "Backend Panel",    href: "/backend",  roles: ["ADMIN", "MEDCO"] },
  { label: "OPD Registration", href: "/opd",      roles: ["ADMIN", "MEDCO"] },
  { label: "Patient List",     href: "/patients", roles: ["ADMIN", "MEDCO"] },
  { label: "Document Intake",  href: "/intake",   roles: ["ADMIN", "MEDCO"] },
  { label: "Team Performance", href: "/team",     roles: ["ADMIN"] },
  { label: "Finance",          href: "/finance",  roles: ["ADMIN", "CFO"] },
  { label: "Other Hospitals",  href: "/benchmarks", roles: ["ADMIN", "CFO"] },
  { label: "Active Queries",   href: "/queries",  soon: true,  roles: ["ADMIN", "MEDCO"] },
  { label: "Reports",          href: "/reports",  soon: true,  roles: ["ADMIN", "MEDCO"] },
  { label: "Audit Trail",      href: "/audit",    soon: true,  roles: ["ADMIN", "MEDCO"] },
  { label: "Admin",            href: "/admin",    roles: ["ADMIN"] },
];

type SessionUser = {
  id: string; email: string; name: string; role: string;
  designation: string; hospital_name: string; bis_enabled: boolean;
};

const FILTERS = {
  "Final Status": ["Approved", "Pending", "Query", "Rejected"],
  "Scheme": ALL_SCHEMES,
  "TAT Threshold": ["< 7 days", "7–14 days", "15–21 days", "> 21 days"],
};

type TenantBrand = { name: string; short_name: string; logo_initial: string; accent_color: string };

export default function Sidebar({ tenant }: { tenant?: TenantBrand }) {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const brand: TenantBrand = tenant ?? { name: "MedLynq", short_name: "MedLynq", logo_initial: "M", accent_color: "#dc2626" };

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j) => setUser(j.user)).catch(() => {});
  }, []);

  const visibleNav = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));
  const initials = user?.name?.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() ?? "··";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside className="w-64 shrink-0 h-screen overflow-y-auto bg-bone-0 border-r border-bone-300 flex flex-col">
      <div className="px-4 py-4 border-b border-bone-300 flex items-center gap-2">
        <div
          className="w-7 h-7 rounded text-white grid place-items-center font-bold text-sm"
          style={{ backgroundColor: brand.accent_color }}
        >
          {brand.logo_initial}
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-bold text-ink-100 text-sm">{brand.short_name}</span>
          <span className="text-[9px] uppercase tracking-wider text-ink-300">on MedLynq</span>
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-2">Navigation</div>
        <nav className="space-y-0.5">
          {visibleNav.map((item) => {
            const active =
              (item.href === "/" && pathname === "/") ||
              (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.label}
                href={item.href}
                className={clsx(
                  "flex items-center justify-between px-2 py-1.5 rounded text-sm",
                  active ? "bg-accent-soft text-accent font-semibold" : "text-ink-200 hover:bg-bone-200"
                )}
              >
                <span>{item.label}</span>
                {item.soon && (
                  <span className="text-[9px] uppercase font-bold bg-bone-200 text-ink-300 px-1.5 py-0.5 rounded">
                    soon
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="px-4 py-2 border-t border-bone-300">
        <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-2 mt-2">Global Filters</div>
        {Object.entries(FILTERS).map(([title, options]) => (
          <details key={title} className="mb-2">
            <summary className="text-xs text-ink-200 cursor-pointer py-1 select-none">{title}</summary>
            <div className="pl-2 pt-1 space-y-1">
              {options.map((o) => (
                <label key={o} className="flex items-center gap-2 text-xs text-ink-200">
                  <input type="checkbox" className="accent-accent" />
                  {o}
                </label>
              ))}
            </div>
          </details>
        ))}
      </div>

      <div className="mt-auto px-3 py-3 border-t border-bone-300">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-good text-white grid place-items-center font-semibold text-sm">{initials}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink-100 truncate">{user?.name ?? "…"}</div>
            <div className="text-[10px] text-ink-300 uppercase truncate">
              {user ? `${user.role}${user.bis_enabled ? " · BIS" : ""}` : ""}
            </div>
          </div>
        </div>
        {user && (
          <button
            onClick={logout}
            className="mt-2 w-full text-[11px] py-1 border border-bone-300 rounded text-ink-300 hover:bg-bone-200"
          >
            Sign out
          </button>
        )}
      </div>
    </aside>
  );
}
