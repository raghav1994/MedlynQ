"use client";

import { useRequestMissing } from "./RequestMissingContext";

export default function ActionButtons() {
  const { active, selected, sending, activate, cancel, send } = useRequestMissing();

  return (
    <div className="space-y-2">
      {!active ? (
        <button
          onClick={activate}
          className="w-full bg-ink-100 text-white text-sm font-semibold py-2.5 rounded hover:opacity-90 flex items-center justify-center gap-2"
        >
          <span>📨</span> Request Missing Doc
        </button>
      ) : (
        <div className="space-y-1.5">
          <button
            onClick={send}
            disabled={selected.size === 0 || sending}
            className="w-full bg-accent text-white text-sm font-semibold py-2.5 rounded hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {sending ? "Sending…" : selected.size > 0 ? `Send Request (${selected.size})` : "Select documents below"}
          </button>
          <button onClick={cancel} className="w-full text-xs text-ink-300 hover:text-ink-100 hover:underline py-1">
            Cancel
          </button>
        </div>
      )}
      <button className="w-full bg-bone-0 border border-bone-300 text-ink-100 text-sm font-medium py-2 rounded hover:bg-bone-200 flex items-center justify-center gap-2">
        <span>✓</span> Mark as Reviewed
      </button>
      <button className="w-full bg-bone-0 border border-bone-300 text-ink-100 text-sm font-medium py-2 rounded hover:bg-bone-200 flex items-center justify-center gap-2">
        <span>＋</span> Add Manual Entry
      </button>
    </div>
  );
}
