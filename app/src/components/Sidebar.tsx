"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

type NavItem = { label: string; href: string; soon?: boolean };

const NAV: NavItem[] = [
  { label: "Dashboard",       href: "/" },
  { label: "Patient List",    href: "/patients" },
  { label: "Document Intake", href: "/intake" },
  { label: "Active Queries",  href: "/queries", soon: true },
  { label: "Reports",         href: "/reports", soon: true },
  { label: "Audit Trail",     href: "/audit",   soon: true },
  { label: "Admin",           href: "/admin",   soon: true },
];

const FILTERS = {
  "Final Status": ["Approved", "Pending", "Query", "Rejected"],
  "Scheme": ["PMJAY", "CGHS", "ESI", "SHA UP", "Railway"],
  "TAT Threshold": ["< 7 days", "7–14 days", "15–21 days", "> 21 days"],
};

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-64 bg-bone-0 border-r border-bone-300 flex flex-col">
      <div className="px-4 py-4 border-b border-bone-300 flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-ink-100 text-white grid place-items-center font-bold text-sm">M</div>
        <span className="font-bold text-ink-100">MedLynq</span>
      </div>

      <div className="px-4 py-4">
        <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-2">Navigation</div>
        <nav className="space-y-0.5">
          {NAV.map((item) => {
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

      <div className="mt-auto px-3 py-3 border-t border-bone-300 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-good text-white grid place-items-center font-semibold text-sm">RA</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink-100 truncate">Richa Attri</div>
          <div className="text-[10px] text-ink-300 uppercase">MEDCO · Admin</div>
        </div>
      </div>
    </aside>
  );
}
