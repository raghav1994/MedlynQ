import AppShell from "@/components/AppShell";
import ActionTile from "@/components/ActionTile";
import WorkQueue from "@/components/WorkQueue";
import ActivityStream from "@/components/ActivityStream";
import LynqNudges from "@/components/LynqNudges";
import Scoreboard from "@/components/Scoreboard";
import { morningTiles, workQueueGroups, activity } from "@/lib/mockData";

export default function DashboardPage() {
  const tiles = morningTiles();
  const groups = workQueueGroups();

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Greeting + date */}
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-100">Good morning, Richa ☕</h1>
            <p className="text-sm text-ink-300 mt-1">
              Here&apos;s what needs your attention at Action Cancer Hospital today.
            </p>
          </div>
          <div className="text-xs text-ink-300">
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </div>
        </div>

        {/* Personal scoreboard */}
        <Scoreboard user="Richa" />

        {/* Lynq nudges — rule-based AI-style suggestions */}
        <LynqNudges />

        {/* Action tiles */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {tiles.map((t) => (
            <ActionTile key={t.label} tile={t} />
          ))}
        </section>

        {/* Two columns: work queue + activity */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-ink-100">Today&apos;s work queue</h2>
              <span className="text-[10px] text-ink-300 uppercase tracking-wide">sorted by ₹ × aging · highest first</span>
            </div>
            <WorkQueue groups={groups} />
          </div>
          <aside>
            <h2 className="text-sm font-bold text-ink-100 mb-2">Recent activity</h2>
            <ActivityStream events={activity} />
          </aside>
        </section>

        {/* Bottom row — compliance health + yesterday's wins */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-ink-100">Compliance Health</h3>
              <a className="text-xs text-accent hover:underline" href="/audit">Download report →</a>
            </div>
            <div className="space-y-3">
              <Compliance label="Mandatory consent forms" pct={88} />
              <Compliance label="Post-op imaging present" pct={76} />
              <Compliance label="Empanelment renewal"     pct={94} tone="good" />
              <Compliance label="Audit trail completeness" pct={97} tone="good" />
            </div>
          </div>
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-ink-100">Yesterday&apos;s wins</h3>
              <a className="text-xs text-accent hover:underline" href="/reports">Open CFO report →</a>
            </div>
            <ul className="space-y-2 text-sm text-ink-200">
              <li>✓ 3 claims settled · ₹ 1.32 L received in bank</li>
              <li>✓ 5 queries resolved · avg 4.2 min per query</li>
              <li>✓ 2 underpayment disputes filed (SHA UP · SG075B)</li>
              <li>✓ 11 docs auto-renamed + indexed by Lynq</li>
            </ul>
          </div>
        </div>

        <div className="text-xs text-ink-300 pt-2">
          MVP scaffold · mock data (PMJAY / CGHS / SHA / Railway mix) · click any case to open its full record
        </div>
      </div>
    </AppShell>
  );
}

function Compliance({ label, pct, tone = "warn" }: { label: string; pct: number; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "bg-good" : "bg-warn";
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-200">
        <span>{label}</span>
        <span className="font-semibold">{pct}%</span>
      </div>
      <div className="h-1.5 bg-bone-200 rounded-full mt-1 overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: pct + "%" }} />
      </div>
    </div>
  );
}
