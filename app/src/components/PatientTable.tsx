"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import AgingPill from "./AgingPill";
import type { Case } from "@/lib/types";
import { patientName, folderKey } from "@/lib/mockData";

type ResolvedCase = Case & { _patient_name?: string; _folder_key?: string };

function rupees(n: number | null) {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

export default function PatientTable({ cases }: { cases: ResolvedCase[] }) {
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg overflow-hidden">
      <div className="p-4 border-b border-bone-300 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-ink-100">Patient Admissions &amp; Claims</h2>
          <p className="text-xs text-ink-300">{cases.length} cases · pre-auth → admitted → discharged → submitted → approved → paid</p>
        </div>
        <div className="flex gap-2">
          <button className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">Export</button>
          <button className="text-xs px-3 py-1.5 bg-accent text-white rounded hover:opacity-90">+ New pre-auth</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bone-200 border-b border-bone-300">
            <tr className="text-left text-xs uppercase tracking-wide text-ink-300">
              <th className="px-4 py-2 font-semibold">Case</th>
              <th className="px-4 py-2 font-semibold">Patient_MRN</th>
              <th className="px-4 py-2 font-semibold">Scheme / Payer</th>
              <th className="px-4 py-2 font-semibold">Procedure</th>
              <th className="px-4 py-2 font-semibold">Stage</th>
              <th className="px-4 py-2 font-semibold text-right">Claimed</th>
              <th className="px-4 py-2 font-semibold text-right">Approved</th>
              <th className="px-4 py-2 font-semibold text-center">Age</th>
              <th className="px-4 py-2 font-semibold text-center">Flags</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c, idx) => (
              <tr
                key={c.id}
                className={(idx % 2 === 0 ? "bg-bone-0" : "bg-bone-100") + " hover:bg-accent-soft/50 cursor-pointer transition"}
              >
                <td className="px-4 py-3">
                  <Link href={`/patient/${c.patient_id}?case=${c.id}`} className="block">
                    <div className="font-mono text-xs text-ink-200">{c.registration_id}</div>
                    <div className="text-xs text-ink-300 font-mono">{c.id.slice(0, 12)}…</div>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/patient/${c.patient_id}?case=${c.id}`} className="block">
                    <div className="font-semibold text-ink-100">{c._patient_name ?? patientName(c.patient_id)}</div>
                    <div className="text-xs text-ink-300 font-mono">{c._folder_key ?? folderKey(c.patient_id)}</div>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="text-ink-100">{c.scheme}</div>
                  <div className="text-xs text-ink-300">{c.payer}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-ink-100">{c.procedure_code}</div>
                  <div className="text-xs text-ink-300 max-w-[18ch] truncate" title={c.procedure_name}>{c.procedure_name}</div>
                </td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3 text-right tabular-nums">{rupees(c.claimed_amount)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{rupees(c.approved_amount)}</td>
                <td className="px-4 py-3 text-center"><AgingPill days={c.age_days} /></td>
                <td className="px-4 py-3 text-center">
                  <div className="flex justify-center gap-1">
                    {c.missing_docs > 0 && (
                      <span className="bg-bad-soft text-bad text-[10px] font-semibold px-2 py-0.5 rounded-full" title="missing documents">
                        {c.missing_docs} miss
                      </span>
                    )}
                    {c.open_queries > 0 && (
                      <span className="bg-warn-soft text-warn text-[10px] font-semibold px-2 py-0.5 rounded-full" title="open queries">
                        {c.open_queries} Q
                      </span>
                    )}
                    {c.missing_docs === 0 && c.open_queries === 0 && (
                      <span className="text-good text-xs">✓ clean</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-bone-300 text-xs text-ink-300 flex items-center justify-between">
        <div>{cases.length} of {cases.length} cases</div>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 border border-bone-300 rounded disabled:opacity-50" disabled>‹</button>
          <span>Page 1</span>
          <button className="px-2 py-1 border border-bone-300 rounded disabled:opacity-50" disabled>›</button>
        </div>
      </div>
    </div>
  );
}
