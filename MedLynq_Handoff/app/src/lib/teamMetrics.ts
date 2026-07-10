// Per-MEDCO scoreboard.
//
// Reduces cases[] grouped by assigned_medco_id. Used by the /team page.
// All metrics derived from existing case state — no new state introduced.

import type { Case } from "@/lib/types";

export type MedcoMetrics = {
  medco_id: string;
  name: string;
  active_cases: number;
  open_queries: number;
  stuck_at_preauth: number;       // preauth_pending OR awaiting_approval, age_days > 3
  approved_mtd: number;
  approved_amount_mtd: number;
  rejected_mtd: number;
  approval_rate_pct: number;       // approved / (approved + rejected)
  avg_tat_days: number;             // across completed (approved/paid/rejected) cases
};

function isThisMonth(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
}

export function teamScoreboard(cases: Case[]): MedcoMetrics[] {
  const groups = new Map<string, { name: string; cases: Case[] }>();
  for (const c of cases) {
    if (!c.assigned_medco_id) continue;
    const entry = groups.get(c.assigned_medco_id) ?? { name: c.assigned_medco_name ?? "—", cases: [] };
    entry.cases.push(c);
    groups.set(c.assigned_medco_id, entry);
  }

  const out: MedcoMetrics[] = [];
  for (const [medco_id, { name, cases: list }] of groups) {
    const active = list.filter((c) => !["paid", "approved", "rejected"].includes(c.status));
    const openQueries = list.reduce((s, c) => s + (c.open_queries || 0), 0);
    const stuck = active.filter(
      (c) => (c.status === "preauth_pending" || c.status === "awaiting_approval") && c.age_days > 3
    );
    const approvedThisMonth = list.filter(
      (c) => (c.status === "approved" || c.status === "paid") && isThisMonth(c.discharge_date ?? c.admission_date)
    );
    const rejectedThisMonth = list.filter(
      (c) => c.status === "rejected" && isThisMonth(c.discharge_date ?? c.admission_date)
    );
    const completed = list.filter((c) => ["approved", "paid", "rejected"].includes(c.status));
    const approvalDen = approvedThisMonth.length + rejectedThisMonth.length;

    out.push({
      medco_id,
      name,
      active_cases: active.length,
      open_queries: openQueries,
      stuck_at_preauth: stuck.length,
      approved_mtd: approvedThisMonth.length,
      approved_amount_mtd: approvedThisMonth.reduce((s, c) => s + (c.approved_amount || 0), 0),
      rejected_mtd: rejectedThisMonth.length,
      approval_rate_pct: approvalDen > 0 ? (approvedThisMonth.length / approvalDen) * 100 : 0,
      avg_tat_days: completed.length > 0
        ? completed.reduce((s, c) => s + c.tat_days, 0) / completed.length
        : 0,
    });
  }

  // Sort by approved amount desc — best performer at the top
  return out.sort((a, b) => b.approved_amount_mtd - a.approved_amount_mtd);
}
