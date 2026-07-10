"use client";

import { useState } from "react";
import type { Case } from "@/lib/types";

type SendResult = {
  ok: boolean;
  sent_at?: string;
  bundle_id?: string;
  bundle_entries?: number;
  audit_hash?: string;
  nhcx_endpoint?: string;
  nhcx_http?: number;
  nhcx_status?: string;
  nhcx_response?: any;
  bundle_preview?: any;
  error?: string;
};

const STATUS_COLOR: Record<string, string> = {
  approved:             "bg-good-soft text-good border-good",
  queried:              "bg-warn-soft text-warn border-warn",
  rejected:             "bg-bad-soft text-bad border-bad",
  transmission_failed:  "bg-bad-soft text-bad border-bad",
  received:             "bg-bone-200 text-ink-200 border-bone-300",
};

export default function NHCXBridge({ c }: { c: Case }) {
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<SendResult[]>([]);
  const [showBundle, setShowBundle] = useState(false);

  async function transmit() {
    setSending(true);
    try {
      const r = await fetch("/api/nhcx/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: c.id }),
      });
      const data = await r.json();
      setHistory((h) => [data, ...h].slice(0, 10));
    } catch (e: any) {
      setHistory((h) => [{ ok: false, error: e?.message ?? String(e) }, ...h]);
    } finally {
      setSending(false);
    }
  }

  const claimUse = ["preauth_pending", "awaiting_approval"].includes(c.status)
    ? "preauthorization"
    : "claim";

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">
            NHCX Bridge · National Health Claims Exchange
          </div>
          <div className="text-sm font-semibold text-ink-100">
            FHIR R4 Bundle ({claimUse}) → {c.scheme_variant || c.scheme}
          </div>
          <div className="text-xs text-ink-300 mt-0.5">
            Audit-hashed (SHA-256). DPDP-clean (ABHA-style ID hash, no raw Aadhaar).
          </div>
        </div>
        <button
          onClick={transmit}
          disabled={sending}
          className="px-3 py-2 rounded bg-ink-100 text-white text-xs font-semibold hover:bg-ink-200 disabled:opacity-50"
        >
          {sending ? "Transmitting…" : "Send via NHCX"}
        </button>
      </div>

      {history.length === 0 && (
        <div className="text-xs text-ink-300 border border-dashed border-bone-300 rounded p-3">
          No transmissions yet. Click <b>Send via NHCX</b> to package and ship this case as a signed FHIR Bundle.
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          {history.map((h, i) => (
            <div key={i} className="border border-bone-300 rounded p-2.5 bg-bone-100">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${STATUS_COLOR[h.nhcx_status ?? ""] ?? "bg-bone-200 text-ink-300 border-bone-300"}`}>
                  {h.nhcx_status ?? "error"}
                </span>
                {h.sent_at && (
                  <span className="text-[11px] text-ink-300">{new Date(h.sent_at).toLocaleString("en-IN")}</span>
                )}
                {h.bundle_entries !== undefined && (
                  <span className="text-[11px] text-ink-300">· {h.bundle_entries} FHIR resources</span>
                )}
                {h.nhcx_http !== undefined && h.nhcx_http > 0 && (
                  <span className="text-[11px] text-ink-300">· HTTP {h.nhcx_http}</span>
                )}
              </div>
              {h.audit_hash && (
                <div className="text-[10px] text-ink-300 mt-1 font-mono break-all">
                  audit-hash: {h.audit_hash}
                </div>
              )}
              {h.nhcx_response?.note?.length > 0 && (
                <ul className="mt-1 text-xs text-ink-200 list-disc list-inside space-y-0.5">
                  {h.nhcx_response.note.map((n: any, k: number) => (
                    <li key={k}>{n.text}</li>
                  ))}
                </ul>
              )}
              {h.error && (
                <div className="text-xs text-bad mt-1">Error: {h.error}</div>
              )}
              {i === 0 && h.bundle_preview && (
                <button
                  onClick={() => setShowBundle((s) => !s)}
                  className="text-[11px] text-ink-300 underline mt-1"
                >
                  {showBundle ? "Hide" : "Show"} FHIR bundle
                </button>
              )}
              {i === 0 && showBundle && h.bundle_preview && (
                <pre className="mt-2 max-h-72 overflow-auto bg-bone-0 border border-bone-300 rounded p-2 text-[10px] font-mono leading-tight whitespace-pre-wrap break-all">
                  {JSON.stringify(h.bundle_preview, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
