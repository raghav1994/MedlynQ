"use client";

import { useEffect, useState } from "react";

type AuditResp = {
  ok: boolean;
  events: Array<{
    ts: string;
    kind: string;
    burned_count?: number;
  }>;
};

function ago(iso: string | null) {
  if (!iso) return null;
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
}

export default function AuditPill({ mrn }: { mrn: string }) {
  const [data, setData] = useState<AuditResp | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/audit-log?mrn=${encodeURIComponent(mrn)}&limit=50`, { cache: "no-store" });
        setData(await r.json());
      } catch {}
    })();
  }, [mrn]);

  const events = data?.events ?? [];
  const redacts = events.filter((e) => e.kind === "redact").length;
  const sarvam = events.filter((e) => e.kind === "sarvam_send").length;
  const purges = events.filter((e) => e.kind === "purge").length;
  const lastPurge = events.find((e) => e.kind === "purge")?.ts ?? null;
  const totalBurned = events
    .filter((e) => e.kind === "redact")
    .reduce((sum, e) => sum + (e.burned_count ?? 0), 0);

  if (events.length === 0) return null;

  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-3 text-xs space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-5 h-5 rounded-full bg-accent text-white grid place-items-center text-[10px]">🔒</span>
        <div className="font-bold text-ink-100">DPDP audit</div>
        <a href="/admin" className="ml-auto text-[10px] text-accent hover:underline">View full trail →</a>
      </div>
      <div className="grid grid-cols-2 gap-1 text-ink-300">
        <div>🟦 Redactions <span className="text-ink-100 font-semibold">{redacts}</span></div>
        <div>☁️ Sarvam calls <span className="text-ink-100 font-semibold">{sarvam}</span></div>
        <div>PII boxes burned <span className="text-ink-100 font-semibold">{totalBurned}</span></div>
        <div>🗑️ Auto-purges <span className="text-ink-100 font-semibold">{purges}</span></div>
      </div>
      {lastPurge && (
        <div className="text-[10px] text-ink-300 italic">
          Last redacted-copy purge: {ago(lastPurge)} ago
        </div>
      )}
    </div>
  );
}
