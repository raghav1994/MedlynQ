"use client";

// 5-second undo toast — shown after auto-attach / auto-create / auto-advance.
//
// Usage:
//   <UndoToast
//     message="Attached 4 docs to Chinta Devi · cycle 3"
//     detail="Status → Discharged"
//     undoUrl="/api/document/undo?token=xyz"
//     onDismiss={() => setToast(null)}
//   />

import { useEffect, useState } from "react";

export type UndoToastProps = {
  message: string;
  detail?: string;
  undoUrl?: string;       // POST here to undo; if absent, no undo button shown
  timeoutMs?: number;     // default 5000
  onDismiss: () => void;
  onUndone?: () => void;
  tone?: "good" | "warn" | "bad";
};

export default function UndoToast({
  message,
  detail,
  undoUrl,
  timeoutMs = 5000,
  onDismiss,
  onUndone,
  tone = "good",
}: UndoToastProps) {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(timeoutMs / 1000));
  const [undone, setUndone] = useState(false);

  useEffect(() => {
    if (undone) return;
    if (secondsLeft <= 0) {
      onDismiss();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, undone, onDismiss]);

  async function handleUndo() {
    if (!undoUrl) return;
    setUndone(true);
    try {
      await fetch(undoUrl, { method: "POST" });
      onUndone?.();
    } catch { /* swallow */ }
    onDismiss();
  }

  const toneClasses =
    tone === "good" ? "bg-good-soft border-good text-good" :
    tone === "warn" ? "bg-warn-soft border-warn text-warn" :
                      "bg-bad-soft  border-bad  text-bad";

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-md">
      <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg ${toneClasses}`}>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink-100">{message}</div>
          {detail && <div className="text-xs text-ink-300 mt-0.5">{detail}</div>}
        </div>
        {undoUrl && !undone && (
          <button
            onClick={handleUndo}
            className="text-xs font-bold underline hover:opacity-80 whitespace-nowrap"
          >
            Undo ({secondsLeft}s)
          </button>
        )}
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-ink-300 hover:text-ink-100 text-sm leading-none -mt-0.5"
        >
          ×
        </button>
      </div>
    </div>
  );
}
