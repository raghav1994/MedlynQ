// 45-day auto-close logic.
//
// A case auto-closes when no activity has been recorded for N days
// (default 45). "Activity" = any status change, any uploaded doc, any
// query response sent. The auto-close is non-destructive: status flips
// to `auto_closed` but everything stays on disk + reopenable.
//
// Successful state: a case that reached "paid" or "settled" without
// auto-close — terminal happy state, distinguished from auto-close.

import type { Case, ClaimStatus } from "./types";

export const AUTO_CLOSE_DAYS = 45;
export const AUTO_CLOSE_WARN_DAYS = 3;  // warn the user 3 days before auto-close

// Terminal happy states — once reached, no auto-close.
const HAPPY_TERMINAL: ClaimStatus[] = ["paid", "successful", "settled" as ClaimStatus];

function dayDiff(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

// Most recent activity timestamp for a case. Falls back to age_days when
// no explicit timestamps are present.
function lastActivityAt(c: Case): string | undefined {
  return (
    c.approval_received_at ||
    c.approval_clock_started_at ||
    c.discharge_date ||
    c.admission_date
  );
}

export type AutoCloseState = {
  daysSinceActivity: number;
  daysUntilAutoClose: number;
  shouldAutoClose: boolean;
  isWarning: boolean;
  isSuccessful: boolean;
  isAutoClosed: boolean;
};

export function autoCloseState(c: Case): AutoCloseState {
  const isSuccessful = HAPPY_TERMINAL.includes(c.status);
  const isAutoClosed = c.status === "auto_closed";
  if (isSuccessful || isAutoClosed) {
    return {
      daysSinceActivity: 0,
      daysUntilAutoClose: 0,
      shouldAutoClose: false,
      isWarning: false,
      isSuccessful,
      isAutoClosed,
    };
  }
  const daysSinceActivity = c.age_days ?? dayDiff(lastActivityAt(c));
  const daysUntilAutoClose = AUTO_CLOSE_DAYS - daysSinceActivity;
  return {
    daysSinceActivity,
    daysUntilAutoClose,
    shouldAutoClose: daysUntilAutoClose <= 0,
    isWarning: daysUntilAutoClose > 0 && daysUntilAutoClose <= AUTO_CLOSE_WARN_DAYS,
    isSuccessful: false,
    isAutoClosed: false,
  };
}

export function autoCloseQueueFromList(cases: Case[]) {
  const closingSoon: Array<{ case: Case; state: AutoCloseState }> = [];
  const overdue: Array<{ case: Case; state: AutoCloseState }> = [];
  for (const c of cases) {
    const s = autoCloseState(c);
    if (s.shouldAutoClose && !s.isAutoClosed && !s.isSuccessful) overdue.push({ case: c, state: s });
    else if (s.isWarning) closingSoon.push({ case: c, state: s });
  }
  closingSoon.sort((a, b) => a.state.daysUntilAutoClose - b.state.daysUntilAutoClose);
  return { closingSoon, overdue };
}
