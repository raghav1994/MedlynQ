import AppShell from "@/components/AppShell";
import ActionTile from "@/components/ActionTile";
import WorkQueue from "@/components/WorkQueue";
import ActivityStream from "@/components/ActivityStream";
import LynqNudges from "@/components/LynqNudges";
import Scoreboard from "@/components/Scoreboard";
import { morningTiles, workQueueGroups, activity, loadDynamicData } from "@/lib/mockData";
import { getSession } from "@/lib/auth/session";
import { scopedData } from "@/lib/dataScope";
import { complianceHealth } from "@/lib/checklist";
import { docsForCase } from "@/lib/mockDocuments";
import { readEvents, eventsInRange, yesterdayRange, type AppEvent } from "@/lib/eventLog";
import type { ActivityEvent } from "@/lib/types";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function eventToActivity(e: AppEvent): ActivityEvent {
  const tsAgo = timeAgo(e.ts);
  return { id: e.id, ts: tsAgo, text: e.text, actor: e.actor_name, tone: e.tone };
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

export default async function DashboardPage() {
  const session = await getSession();
  if (session.user?.role === "CFO") redirect("/finance");
  if (session.user?.role === "ADMIN") redirect("/patients");
  loadDynamicData();
  const tiles = morningTiles();
  const groups = workQueueGroups();

  const { cases: myCases, hospital_id } = await scopedData();
  const compliance = complianceHealth(myCases, docsForCase);

  // Activity Stream: real events replace mock once they exist (per-hospital),
  // padded with mock entries only while real history is still thin.
  const realEvents = readEvents(hospital_id).map(eventToActivity);
  const activityFeed = realEvents.length >= 5
    ? realEvents.slice(0, 8)
    : [...realEvents, ...activity].slice(0, 8);

  // Yesterday's Wins: claims-approved + queries-resolved rows go real once
  // any such event exists for yesterday; the other two bullets (underpayment
  // disputes, docs auto-renamed) have no real write path anywhere in the app
  // yet, so they stay as the original illustrative mock lines.
  const { start: yStart, end: yEnd } = yesterdayRange();
  const yesterdayEvents = eventsInRange(readEvents(hospital_id), yStart, yEnd);
  const claimsApproved = yesterdayEvents.filter((e) => e.kind === "claim_approved");
  const queriesResolved = yesterdayEvents.filter((e) => e.kind === "query_resolved");
  const hasRealWins = claimsApproved.length > 0 || queriesResolved.length > 0;
  const claimsApprovedAmount = claimsApproved.reduce((s, e) => s + (e.amount ?? 0), 0);
  const avgResolveMinutes = queriesResolved.length > 0
    ? Math.round(queriesResolved.reduce((s, e) => s + (e.minutes_to_resolve ?? 0), 0) / queriesResolved.length)
    : 0;

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
            <ActivityStream events={activityFeed} />
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
              <Compliance label="Mandatory consent forms" pct={compliance.consentFormPct} />
              <Compliance label="Post-op imaging present" pct={compliance.postOpImagingPct} />
              {/* No real data source exists for these two anywhere in the app yet — stay illustrative. */}
              <Compliance label="Empanelment renewal (illustrative)" pct={94} tone="good" />
              <Compliance label="Audit trail completeness (illustrative)" pct={97} tone="good" />
            </div>
          </div>
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-ink-100">Yesterday&apos;s wins</h3>
              <a className="text-xs text-accent hover:underline" href="/reports">Open CFO report →</a>
            </div>
            <ul className="space-y-2 text-sm text-ink-200">
              {hasRealWins ? (
                <>
                  <li>✓ {claimsApproved.length} claim{claimsApproved.length === 1 ? "" : "s"} approved · ₹ {(claimsApprovedAmount / 100000).toFixed(2)} L</li>
                  <li>✓ {queriesResolved.length} quer{queriesResolved.length === 1 ? "y" : "ies"} resolved{queriesResolved.length > 0 ? ` · avg ${avgResolveMinutes < 1440 ? Math.round(avgResolveMinutes / 60) + " hr" : (avgResolveMinutes / 1440).toFixed(1) + " days"} per query` : ""}</li>
                </>
              ) : (
                <>
                  <li>✓ 3 claims settled · ₹ 1.32 L received in bank (illustrative)</li>
                  <li>✓ 5 queries resolved · avg 4.2 min per query (illustrative)</li>
                </>
              )}
              {/* No real write path exists for disputes or renamer instrumentation yet — stay illustrative. */}
              <li>✓ 2 underpayment disputes filed (SHA UP · SG075B) (illustrative)</li>
              <li>✓ 11 docs auto-renamed + indexed by Lynq (illustrative)</li>
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
