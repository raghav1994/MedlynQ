import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { scopedData } from "@/lib/dataScope";
import { teamScoreboard } from "@/lib/teamMetrics";

export const dynamic = "force-dynamic";

function fmtINR(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export default async function TeamPage() {
  const session = await getSession();
  if (!session.user) redirect("/login?next=/team");
  if (session.user.role !== "ADMIN") redirect("/");

  const { cases } = await scopedData();
  const board = teamScoreboard(cases);
  const totals = {
    active:  board.reduce((s, m) => s + m.active_cases, 0),
    queries: board.reduce((s, m) => s + m.open_queries, 0),
    stuck:   board.reduce((s, m) => s + m.stuck_at_preauth, 0),
    approved_amount: board.reduce((s, m) => s + m.approved_amount_mtd, 0),
  };

  return (
    <AppShell>
      <div className="max-w-6xl space-y-5">
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">
            Team Performance · {session.user.hospital_name}
          </div>
          <h1 className="text-2xl font-bold text-ink-100">MEDCO Scoreboard</h1>
          <p className="text-sm text-ink-300 mt-1">
            Per-MEDCO workload, throughput and bottlenecks. Use for 1:1s and workload balancing.
          </p>
        </div>

        {/* Team totals */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-3">
            <div className="text-[10px] uppercase font-semibold text-ink-300">Active cases</div>
            <div className="text-2xl font-bold text-ink-100 mt-1">{totals.active}</div>
          </div>
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-3">
            <div className="text-[10px] uppercase font-semibold text-ink-300">Open queries</div>
            <div className={`text-2xl font-bold mt-1 ${totals.queries > 10 ? "text-warn" : "text-ink-100"}`}>{totals.queries}</div>
          </div>
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-3">
            <div className="text-[10px] uppercase font-semibold text-ink-300">Stuck at pre-auth (&gt;3d)</div>
            <div className={`text-2xl font-bold mt-1 ${totals.stuck > 0 ? "text-bad" : "text-good"}`}>{totals.stuck}</div>
          </div>
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-3">
            <div className="text-[10px] uppercase font-semibold text-ink-300">Approved ₹ MTD</div>
            <div className="text-2xl font-bold text-ink-100 mt-1">{fmtINR(totals.approved_amount)}</div>
          </div>
        </div>

        {/* Per-MEDCO table */}
        <div className="bg-bone-0 border border-bone-300 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bone-100 text-[10px] uppercase tracking-wide text-ink-300">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Rank</th>
                <th className="text-left px-3 py-2 font-semibold">MEDCO</th>
                <th className="text-right px-3 py-2 font-semibold">Active</th>
                <th className="text-right px-3 py-2 font-semibold">Open queries</th>
                <th className="text-right px-3 py-2 font-semibold">Stuck pre-auth</th>
                <th className="text-right px-3 py-2 font-semibold">Approved MTD</th>
                <th className="text-right px-3 py-2 font-semibold">Approval %</th>
                <th className="text-right px-3 py-2 font-semibold">Avg TAT</th>
              </tr>
            </thead>
            <tbody>
              {board.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-xs text-ink-300 px-3 py-6">
                    No assigned cases yet. Assignments happen automatically when cases land.
                  </td>
                </tr>
              )}
              {board.map((m, i) => (
                <tr key={m.medco_id} className="border-t border-bone-200">
                  <td className="px-3 py-2 font-bold text-ink-100">#{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink-100">{m.name}</div>
                    <div className="text-[10px] text-ink-300 font-mono">{m.medco_id}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-ink-100">{m.active_cases}</td>
                  <td className={`px-3 py-2 text-right ${m.open_queries > 5 ? "text-warn font-semibold" : "text-ink-100"}`}>
                    {m.open_queries}
                  </td>
                  <td className={`px-3 py-2 text-right ${m.stuck_at_preauth > 0 ? "text-bad font-semibold" : "text-ink-100"}`}>
                    {m.stuck_at_preauth}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="font-semibold text-ink-100">{fmtINR(m.approved_amount_mtd)}</div>
                    <div className="text-[10px] text-ink-300">{m.approved_mtd} cases</div>
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${m.approval_rate_pct >= 85 ? "text-good" : m.approval_rate_pct >= 70 ? "text-ink-100" : "text-warn"}`}>
                    {m.approval_rate_pct.toFixed(0)}%
                  </td>
                  <td className="px-3 py-2 text-right text-ink-100">
                    {m.avg_tat_days > 0 ? `${m.avg_tat_days.toFixed(1)}d` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* What to do with this */}
        <div className="bg-bone-0 border border-dashed border-bone-300 rounded-lg p-3 text-xs text-ink-300">
          <div className="font-semibold text-ink-200 mb-1">How to read this scoreboard</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li><span className="text-bad font-semibold">Stuck pre-auth</span> &gt; 0 → escalate or reassign. Each day costs the hospital revenue.</li>
            <li><span className="text-warn font-semibold">Open queries</span> &gt; 5 → the MEDCO is overloaded; consider routing new cases away.</li>
            <li><span className="text-good font-semibold">Approval %</span> &lt; 70 → coaching opportunity; review their last 5 rejections.</li>
            <li>Avg TAT below 6d is excellent; above 9d signals process drag, not necessarily the MEDCO.</li>
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
