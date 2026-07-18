"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import type { AuditEvent } from "@/lib/auditLog";
import { useRoleGate } from "@/lib/useRoleGate";

type StatsResp = {
  ok: boolean;
  events: AuditEvent[];
  stats: {
    by_kind: Record<string, number>;
    last_event_at: string | null;
    last_purge_at: string | null;
    purged_bytes: number;
    file_size_bytes: number;
    total_events: number;
    audit_file: string;
  };
};

const KIND_META: Record<string, { label: string; icon: string; tone: string }> = {
  ingest:      { label: "Document ingested", icon: "📥", tone: "bg-bone-200 text-ink-200" },
  redact:      { label: "PII redacted",       icon: "🟦", tone: "bg-accent-soft text-accent" },
  sarvam_send: { label: "Sent to Sarvam",     icon: "☁️", tone: "bg-warn-soft text-warn" },
  purge:       { label: "Redacted purged",    icon: "🗑️", tone: "bg-good-soft text-good" },
};

function fmtBytes(b: number) {
  if (!b) return "0 B";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(2) + " MB";
}
function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

export default function AdminPage() {
  useRoleGate(["ADMIN"], "/patients");
  const [data, setData] = useState<StatsResp | null>(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [purgeResult, setPurgeResult] = useState<any>(null);

  const refresh = async () => {
    const r = await fetch("/api/audit-log?limit=200", { cache: "no-store" });
    setData(await r.json());
  };
  useEffect(() => { refresh(); }, []);

  const runPurge = async (apply: boolean) => {
    setBusy(true);
    setPurgeResult(null);
    try {
      const r = await fetch("/api/admin/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply, days }),
      });
      const j = await r.json();
      setPurgeResult(j);
      if (apply) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const s = data?.stats;

  return (
    <AppShell>
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-xl font-bold text-ink-100">Admin · DPDP Audit Trail</h1>
          <p className="text-sm text-ink-300 mt-1">
            Every PII redaction, every Sarvam call, every auto-purge gets a tamper-evident SHA-256 entry in
            <code className="bg-bone-200 px-1 mx-1 rounded font-mono text-[10px]">PatientLog/_index/audit_log.jsonl</code>.
            Regulator-grade trail for DPDP / NHA inspection.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Total events" value={String(s?.total_events ?? 0)} />
          <Stat label="Redactions" value={String(s?.by_kind?.redact ?? 0)} tone="accent" />
          <Stat label="Sarvam calls" value={String(s?.by_kind?.sarvam_send ?? 0)} tone="warn" />
          <Stat label="Auto-purges" value={String(s?.by_kind?.purge ?? 0)} tone="good" />
          <Stat label="Bytes freed" value={fmtBytes(s?.purged_bytes ?? 0)} />
        </div>

        <div className="bg-bone-0 border border-bone-300 rounded-lg p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-bold text-ink-100">Redacted-copy retention</h2>
              <p className="text-xs text-ink-300 mt-1">
                Burned redacted PNGs are kept for audit, then auto-deleted. Originals stay forever. Configurable via env <code className="font-mono">MEDLYNQ_REDACTED_RETENTION_DAYS</code>.
              </p>
              <p className="text-[11px] text-ink-300 mt-1">
                Last purge: <strong>{timeAgo(s?.last_purge_at ?? null)}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-ink-200">Retention</label>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                className="text-xs px-2 py-1.5 bg-bone-100 border border-bone-300 rounded focus:outline-none focus:border-accent">
                {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
              <button onClick={() => runPurge(false)} disabled={busy}
                className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200 disabled:opacity-40">
                {busy ? "…" : "Dry run"}
              </button>
              <button onClick={() => runPurge(true)} disabled={busy}
                className="text-xs font-semibold px-3 py-1.5 bg-bad text-white rounded hover:opacity-90 disabled:opacity-40">
                {busy ? "Purging…" : "🗑️ Purge now"}
              </button>
            </div>
          </div>

          {purgeResult && (
            <div className={`rounded p-3 border text-xs ${purgeResult.ok === false ? "bg-bad-soft border-bad/40" : "bg-good-soft border-good/40"}`}>
              {purgeResult.ok === false ? (
                <div className="text-bad">✗ {purgeResult.error}</div>
              ) : (
                <div className="text-good space-y-1">
                  <div className="font-bold">
                    {purgeResult.mode === "apply" ? "✓ Purge applied" : "✓ Dry-run only — nothing deleted"}
                  </div>
                  <div className="text-ink-200 grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
                    <Mini label="Retention" value={`${purgeResult.retention_days}d`} />
                    <Mini label="Scanned" value={String(purgeResult.summary.scanned)} />
                    <Mini label={purgeResult.mode === "apply" ? "Deleted" : "Would delete"} value={String(purgeResult.summary.purged)} />
                    <Mini label="Bytes freed" value={fmtBytes(purgeResult.summary.bytes_freed)} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-bone-0 border border-bone-300 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-bone-300 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink-100">Recent audit events</h2>
            <button onClick={refresh} className="text-xs px-3 py-1 border border-bone-300 rounded hover:bg-bone-200">
              Refresh
            </button>
          </div>
          {data?.events?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-bone-100 text-ink-300">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold uppercase tracking-wide">When</th>
                    <th className="text-left px-4 py-2 font-semibold uppercase tracking-wide">Event</th>
                    <th className="text-left px-4 py-2 font-semibold uppercase tracking-wide">MRN</th>
                    <th className="text-left px-4 py-2 font-semibold uppercase tracking-wide">File</th>
                    <th className="text-left px-4 py-2 font-semibold uppercase tracking-wide">Detail</th>
                    <th className="text-left px-4 py-2 font-semibold uppercase tracking-wide">SHA-256</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bone-200">
                  {data.events.map((ev, i) => {
                    const meta = KIND_META[ev.kind] ?? { label: ev.kind, icon: "•", tone: "bg-bone-200 text-ink-200" };
                    return (
                      <tr key={i} className="hover:bg-bone-100">
                        <td className="px-4 py-2 text-ink-300 whitespace-nowrap">{timeAgo(ev.ts)}</td>
                        <td className="px-4 py-2">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.tone}`}>
                            {meta.icon} {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-ink-200">{ev.mrn ?? "—"}</td>
                        <td className="px-4 py-2 text-ink-200 max-w-[260px] truncate" title={ev.file ?? ""}>{ev.file ?? "—"}</td>
                        <td className="px-4 py-2 text-ink-300">
                          {ev.burned_count !== undefined && <span>burned {ev.burned_count}</span>}
                          {ev.extra?.doc_type && <span> · {ev.extra.doc_type}</span>}
                          {ev.extra?.age_days !== undefined && <span> · age {ev.extra.age_days}d</span>}
                          {ev.extra?.status && <span> · {ev.extra.status}</span>}
                        </td>
                        <td className="px-4 py-2 font-mono text-[10px] text-ink-300">
                          {(ev.sha256_in ?? ev.sha256_out ?? "—").slice(0, 12)}…
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-ink-300 italic">
              No audit events yet. Upload a scanned document on <code>/intake</code> to see the trail populate.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : "text-ink-100";
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
      <div className="text-ink-100 font-mono">{value}</div>
    </div>
  );
}
