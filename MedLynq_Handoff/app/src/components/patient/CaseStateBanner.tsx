"use client";

// Two non-approval lifecycle banners:
//   1. auto_closed — case is dead, but reopenable
//   2. successful — case reached settled state (terminal happy)
//   3. warning — case is N days from auto-closing (≤ 3 days)

import { useState } from "react";
import type { Case } from "@/lib/types";
import { autoCloseState } from "@/lib/autoClose";

export default function CaseStateBanner({ c }: { c: Case }) {
  const s = autoCloseState(c);
  const [reopened, setReopened] = useState(false);

  if (s.isSuccessful) {
    return (
      <div className="bg-good-soft border border-good/40 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-good text-white grid place-items-center text-xs">✓</span>
          <div className="flex-1">
            <div className="text-sm font-bold text-good">Case successful — settled & closed</div>
            <div className="text-[11px] text-ink-300">All payments received. No further action needed.</div>
          </div>
        </div>
      </div>
    );
  }

  if (s.isAutoClosed) {
    return (
      <div className="bg-bone-100 border border-bone-300 rounded-lg p-3 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-ink-300 text-white grid place-items-center text-xs">📁</span>
            <div>
              <div className="text-sm font-bold text-ink-100">Case auto-closed — no activity for 45+ days</div>
              <div className="text-[11px] text-ink-300">
                Reopen the file if the patient returns. A new case will be created under the same patient and linked here.
              </div>
            </div>
          </div>
          <button
            onClick={() => setReopened(true)}
            disabled={reopened}
            className="text-xs font-semibold px-3 py-1.5 bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
          >
            {reopened ? "✓ New case created" : "🔄 Reopen / new case"}
          </button>
        </div>
        {reopened && (
          <div className="mt-2 text-[11px] text-good italic">
            Reopened. A fresh case has been created and linked to this auto-closed file. Both visible under the same patient.
          </div>
        )}
      </div>
    );
  }

  if (s.isWarning) {
    return (
      <div className="bg-warn-soft border border-warn/40 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-warn text-white grid place-items-center text-xs">⏰</span>
          <div className="flex-1">
            <div className="text-sm font-bold text-warn">
              Auto-closing in {s.daysUntilAutoClose} day{s.daysUntilAutoClose === 1 ? "" : "s"}
            </div>
            <div className="text-[11px] text-ink-300">
              No activity for {s.daysSinceActivity} days. Upload a doc, respond to a query, or change status to keep the case open.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
