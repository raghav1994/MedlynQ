import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const session = await getSession();
  if (!session.user) redirect("/login?next=/finance");
  // ADMIN sees finance too. MEDCO does not — block here.
  if (session.user.role !== "ADMIN" && session.user.role !== "CFO") {
    redirect("/");
  }

  return (
    <AppShell>
      <div className="max-w-4xl space-y-6">
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">
            CFO Dashboard · {session.user.hospital_name}
          </div>
          <h1 className="text-2xl font-bold text-ink-100">Claims Finance Overview</h1>
          <p className="text-sm text-ink-300 mt-1">
            Aggregate view across all schemes and MEDCOs. Read-only.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Submitted (MTD)",      value: "₹—",  hint: "claims sent via NHCX" },
            { label: "Approved (MTD)",       value: "₹—",  hint: "approval letters received" },
            { label: "In Query",             value: "₹—",  hint: "awaiting MEDCO response" },
            { label: "Rejected (MTD)",       value: "₹—",  hint: "after all appeal rounds" },
          ].map((k) => (
            <div key={k.label} className="bg-bone-0 border border-bone-300 rounded-lg p-3">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">{k.label}</div>
              <div className="text-xl font-bold text-ink-100 mt-1">{k.value}</div>
              <div className="text-[10px] text-ink-300 mt-0.5">{k.hint}</div>
            </div>
          ))}
        </div>

        <div className="bg-bone-0 border border-bone-300 rounded-lg p-6 text-center">
          <div className="text-3xl mb-2">📊</div>
          <div className="text-sm font-semibold text-ink-100">Finance analytics — coming soon</div>
          <div className="text-xs text-ink-300 mt-1">
            Once cases flow through MedLynq for a full month, this page renders MTD/YTD numbers,
            scheme-wise approval rates, ageing buckets, and a monthly PDF report.
          </div>
        </div>
      </div>
    </AppShell>
  );
}
