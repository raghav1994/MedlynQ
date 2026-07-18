import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

type Benchmark = {
  hospital_id: string;
  name: string;
  type: string;
  is_you?: boolean;
  claims_submitted_mtd: number;
  claims_submitted_amount_inr: number;
  claims_approved_mtd: number;
  claims_approved_amount_inr: number;
  approval_rate_pct: number;
  avg_tat_days: number;
  open_queries: number;
  top_scheme: string;
  specialty_mix: string[];
};

type BenchmarkFile = {
  _note: string;
  district: string;
  month_label: string;
  you_hospital_id: string;
  hospitals: Benchmark[];
};

function fmtINR(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

async function loadData(): Promise<BenchmarkFile> {
  const p = path.resolve(process.cwd(), "data", "benchmarks_demo.json");
  return JSON.parse(await readFile(p, "utf8"));
}

export default async function BenchmarksPage() {
  const session = await getSession();
  if (!session.user) redirect("/login?next=/benchmarks");
  // Other Hospitals is CFO-only now — ADMIN is scoped to Patient List + Team Performance.
  if (session.user.role !== "CFO") redirect(session.user.role === "ADMIN" ? "/patients" : "/");

  const data = await loadData();
  // Rank by approved amount, descending
  const ranked = [...data.hospitals].sort(
    (a, b) => b.claims_approved_amount_inr - a.claims_approved_amount_inr
  );
  const youRank = ranked.findIndex((h) => h.is_you) + 1;
  const totalApprovedInDistrict = ranked.reduce(
    (s, h) => s + h.claims_approved_amount_inr, 0
  );

  return (
    <AppShell>
      <div className="max-w-6xl space-y-5">
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">
            Other Hospitals · {data.district}
          </div>
          <h1 className="text-2xl font-bold text-ink-100">PMJAY-empanelled hospital benchmarks</h1>
          <p className="text-sm text-ink-300 mt-1">
            How {session.user.hospital_name} compares against nearby hospitals — {data.month_label}.
          </p>
        </div>

        {/* Disclosure banner — honest about data source */}
        <div className="bg-warn-soft border border-warn rounded-lg p-3 text-xs text-ink-100">
          <span className="font-semibold">Data source:</span> {data._note}
        </div>

        {/* Your hospital's headline rank */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">Your rank by approved ₹</div>
            <div className="text-2xl font-bold text-ink-100 mt-1">#{youRank} <span className="text-sm text-ink-300 font-normal">of {ranked.length}</span></div>
          </div>
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">District approved ₹ (MTD)</div>
            <div className="text-2xl font-bold text-ink-100 mt-1">{fmtINR(totalApprovedInDistrict)}</div>
            <div className="text-[10px] text-ink-300 mt-0.5">Across {ranked.length} tracked hospitals</div>
          </div>
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">District avg TAT</div>
            <div className="text-2xl font-bold text-ink-100 mt-1">
              {(ranked.reduce((s, h) => s + h.avg_tat_days, 0) / ranked.length).toFixed(1)} <span className="text-sm text-ink-300 font-normal">days</span>
            </div>
          </div>
        </div>

        {/* Comparison table */}
        <div className="bg-bone-0 border border-bone-300 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bone-100 text-[10px] uppercase tracking-wide text-ink-300">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Rank</th>
                <th className="text-left px-3 py-2 font-semibold">Hospital</th>
                <th className="text-right px-3 py-2 font-semibold">Claims (MTD)</th>
                <th className="text-right px-3 py-2 font-semibold">Approved ₹</th>
                <th className="text-right px-3 py-2 font-semibold">Approval %</th>
                <th className="text-right px-3 py-2 font-semibold">Avg TAT</th>
                <th className="text-right px-3 py-2 font-semibold">Open queries</th>
                <th className="text-left px-3 py-2 font-semibold">Top scheme</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((h, i) => (
                <tr key={h.hospital_id} className={h.is_you ? "bg-accent-soft border-l-4 border-accent" : "border-t border-bone-200"}>
                  <td className="px-3 py-2 font-bold text-ink-100">#{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink-100">{h.name}{h.is_you && <span className="ml-2 text-[10px] uppercase font-bold text-accent">You</span>}</div>
                    <div className="text-[10px] text-ink-300 uppercase">{h.type.replace(/_/g, " ")} · {h.specialty_mix.join(", ")}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-ink-100">{h.claims_submitted_mtd}</td>
                  <td className="px-3 py-2 text-right font-semibold text-ink-100">{fmtINR(h.claims_approved_amount_inr)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${h.approval_rate_pct >= 90 ? "text-good" : h.approval_rate_pct >= 85 ? "text-ink-100" : "text-warn"}`}>
                    {h.approval_rate_pct.toFixed(1)}%
                  </td>
                  <td className={`px-3 py-2 text-right ${h.avg_tat_days <= 6 ? "text-good" : h.avg_tat_days >= 9 ? "text-warn" : "text-ink-100"}`}>
                    {h.avg_tat_days.toFixed(1)}d
                  </td>
                  <td className="px-3 py-2 text-right text-ink-100">{h.open_queries}</td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 bg-bone-200 text-ink-200 rounded">{h.top_scheme}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Coming soon banner */}
        <div className="bg-bone-0 border border-dashed border-bone-300 rounded-lg p-4 text-center text-xs text-ink-300">
          <div className="text-sm font-semibold text-ink-200 mb-1">Live cross-hospital benchmarks — coming soon</div>
          Once 5+ hospitals are onboarded to MedLynq, this page switches from public-data + demo numbers
          to a real-time, anonymised aggregate updated nightly.
        </div>
      </div>
    </AppShell>
  );
}
