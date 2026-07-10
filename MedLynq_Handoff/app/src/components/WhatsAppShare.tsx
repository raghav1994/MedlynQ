"use client";

// WhatsApp Layer 1 — share a non-identifying status update.
// NO patient name, NO MRN, NO diagnosis. Only case code + status + deep link.
// Deep link requires MedLynq login to open the actual case.
// DPDP-safe by construction.

import { useState } from "react";

export type WhatsAppKind =
  | "preauth_submitted"
  | "preauth_approved"
  | "preauth_rejected"
  | "query_received"
  | "discharge_done"
  | "claim_submitted"
  | "payment_received"
  | "docs_uploaded"
  | "aging_alert";

const TEMPLATES: Record<WhatsAppKind, string> = {
  preauth_submitted: "📤 Pre-auth submitted",
  preauth_approved:  "✅ Pre-auth approved",
  preauth_rejected:  "❌ Pre-auth rejected — needs review",
  query_received:    "⚠️ Query received — 15 day window started",
  discharge_done:    "🏥 Discharge completed",
  claim_submitted:   "📨 Claim submitted to payer",
  payment_received:  "💰 Payment received",
  docs_uploaded:     "📎 New documents uploaded",
  aging_alert:       "⏰ Case aging > 10 days — action needed",
};

function buildMessage(opts: {
  caseCode: string;
  kind: WhatsAppKind;
  detail?: string;
  deepLink: string;
}) {
  const status = TEMPLATES[opts.kind];
  const lines = [
    `MedLynq · Case ${opts.caseCode}`,
    status,
  ];
  if (opts.detail) lines.push(opts.detail);
  lines.push(``);
  lines.push(`Open in MedLynq:`);
  lines.push(opts.deepLink);
  lines.push(``);
  lines.push(`(No patient identifiers shared per DPDP. Login required to view case.)`);
  return lines.join("\n");
}

export default function WhatsAppShare({
  caseCode,
  kind,
  detail,
  deepLink,
  compact = false,
}: {
  caseCode: string;
  kind: WhatsAppKind;
  detail?: string;
  deepLink: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState<WhatsAppKind>(kind);

  const message = buildMessage({ caseCode, kind: selectedKind, detail, deepLink });
  const href = `https://wa.me/?text=${encodeURIComponent(message)}`;

  if (compact) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title="Share status to WhatsApp (non-identifying)"
        className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded border border-good/40 bg-good-soft text-good hover:opacity-90"
      >
        <span>💬</span>
        <span>WhatsApp</span>
      </a>
    );
  }

  return (
    <div className="border border-bone-300 rounded-lg bg-bone-0 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-good text-white grid place-items-center text-xs">💬</span>
          <div>
            <div className="text-xs font-bold text-ink-100">Share to WhatsApp</div>
            <div className="text-[10px] text-ink-300">DPDP-safe · no patient identifiers</div>
          </div>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-[10px] text-ink-300 hover:text-ink-100"
        >
          {open ? "Hide preview" : "Preview"}
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={selectedKind}
          onChange={(e) => setSelectedKind(e.target.value as WhatsAppKind)}
          className="text-xs px-2 py-1 bg-bone-100 border border-bone-300 rounded focus:outline-none focus:border-accent"
        >
          {(Object.keys(TEMPLATES) as WhatsAppKind[]).map((k) => (
            <option key={k} value={k}>{TEMPLATES[k]}</option>
          ))}
        </select>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold px-3 py-1.5 bg-good text-white rounded hover:opacity-90 flex items-center gap-1"
        >
          <span>💬</span>
          <span>Send WhatsApp update</span>
        </a>
      </div>

      {open && (
        <pre className="bg-bone-100 border border-bone-300 rounded p-2 text-[11px] font-mono text-ink-200 whitespace-pre-wrap leading-snug">
          {message}
        </pre>
      )}
    </div>
  );
}
