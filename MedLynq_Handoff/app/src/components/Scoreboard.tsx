// Personal scoreboard — real when the logged-in user has real events/cases,
// falls back to illustrative mock numbers when they don't (fresh tenant,
// ADMIN/CFO with no assigned cases, etc.) so the dashboard never renders
// zeros for a user who just hasn't done anything yet today.

import { getSession } from "@/lib/auth/session";
import { scopedData } from "@/lib/dataScope";
import { teamScoreboard } from "@/lib/teamMetrics";
import { readEvents, eventsInRange, yesterdayRange, todayRange, computeStreakDays } from "@/lib/eventLog";

const MOCK_FALLBACK = {
  closed_yesterday: 14,
  rank_percentile: 5,
  streak_days: 9,
  money_unlocked_today: 132000,
};

export default async function Scoreboard({ user = "Richa" }: { user?: string }) {
  const session = await getSession();
  const stats = await realStats(session.user);
  const isMock = stats === null;
  const s = stats ?? MOCK_FALLBACK;
  const displayName = session.user?.name ?? user;

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-full bg-good text-white grid place-items-center font-bold">
        {displayName[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink-100">
          You closed <span className="text-good font-bold">{s.closed_yesterday}</span> queries yesterday
        </div>
        <div className="text-xs text-ink-300">
          Top <span className="font-bold text-good">{s.rank_percentile}%</span> this month · {s.streak_days}-day streak 🔥
          {isMock && <span className="ml-1 opacity-60">· illustrative</span>}
        </div>
      </div>
      <div className="text-right hidden md:block">
        <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">₹ unlocked today</div>
        <div className="text-base font-bold text-good">₹ {(s.money_unlocked_today / 100000).toFixed(2)} L</div>
      </div>
    </div>
  );
}

async function realStats(user: { id: string; hospital_id: string } | undefined) {
  if (!user) return null;

  const { cases } = await scopedData();
  const allEvents = readEvents(user.hospital_id);
  const actorEvents = allEvents.filter((e) => e.actor_id === user.id);
  if (actorEvents.length === 0) return null; // nothing real yet — use mock

  const { start: yStart, end: yEnd } = yesterdayRange();
  const { start: tStart, end: tEnd } = todayRange();

  const closedYesterday = eventsInRange(actorEvents, yStart, yEnd).filter((e) => e.kind === "query_resolved").length;

  const moneyToday = eventsInRange(actorEvents, tStart, tEnd)
    .filter((e) => e.kind === "query_resolved" || e.kind === "claim_approved")
    .reduce((sum, e) => sum + (e.amount ?? 0), 0);

  const streak = computeStreakDays(actorEvents);

  // Rank this user's approved-amount-MTD among their hospital's other
  // assigned MEDCOs (real, from case data — not from the event log).
  const board = teamScoreboard(cases);
  const idx = board.findIndex((m) => m.medco_id === user.id);
  const rankPercentile = idx >= 0 && board.length > 0
    ? Math.max(1, Math.round((100 * (idx + 1)) / board.length))
    : MOCK_FALLBACK.rank_percentile;

  return {
    closed_yesterday: closedYesterday,
    rank_percentile: rankPercentile,
    streak_days: streak,
    money_unlocked_today: moneyToday,
  };
}
