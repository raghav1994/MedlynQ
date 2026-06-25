// Personal scoreboard — small habit-forming stat for the clerk.
// Numbers are mock for now; will pull from real audit log later.

export default function Scoreboard({ user = "Richa" }: { user?: string }) {
  const stats = {
    closed_yesterday: 14,
    rank_percentile: 5,    // top 5% this month
    streak_days: 9,
    money_unlocked_today: 132000,
  };

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-full bg-good text-white grid place-items-center font-bold">
        {user[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink-100">
          You closed <span className="text-good font-bold">{stats.closed_yesterday}</span> queries yesterday
        </div>
        <div className="text-xs text-ink-300">
          Top <span className="font-bold text-good">{stats.rank_percentile}%</span> this month · {stats.streak_days}-day streak 🔥
        </div>
      </div>
      <div className="text-right hidden md:block">
        <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">₹ unlocked today</div>
        <div className="text-base font-bold text-good">₹ {(stats.money_unlocked_today / 100000).toFixed(2)} L</div>
      </div>
    </div>
  );
}
