import type { Case } from "@/lib/types";

function rupees(n: number | null) {
  if (n == null) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

export default function FinancialsTab({ c }: { c: Case }) {
  const claimed = c.claimed_amount;
  const approved = c.approved_amount ?? null;
  const adj = approved == null ? null : Math.round((approved / claimed) * 100);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Claimed Amount" value={rupees(claimed)} />
        <Stat label="Approved Amount" value={rupees(approved)} tone="good" />
        <Stat label="Adjustment Factor" value={adj != null ? adj + "%" : "—"} tone={adj && adj < 80 ? "warn" : "neutral"} />
        <Stat label="Balance" value={approved != null ? rupees(claimed - approved) : "—"} tone={approved && claimed - approved > 0 ? "bad" : "neutral"} />
      </div>

      <div className="bg-bone-100 border border-bone-300 rounded p-4">
        <h4 className="text-sm font-bold text-ink-100 mb-3">Procedure &amp; Codes</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Field label="ICD-10 Diagnosis" value={c.diagnosis} />
          <Field label="Procedure Code"   value={`${c.procedure_code} · ${c.procedure_name}`} />
          <Field label="Scheme" value={`${c.scheme} — ${c.payer}`} />
          <Field label="Speciality" value="Surgical Oncology" />
        </div>
      </div>

      <div className="bg-bone-100 border border-bone-300 rounded p-4 text-xs text-ink-300">
        Detailed line items, deductions, and UTR reconciliation will appear here when wired to the live claim data.
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" | "neutral" }) {
  const color =
    tone === "good" ? "text-good" :
    tone === "warn" ? "text-warn" :
    tone === "bad"  ? "text-bad"  :
                      "text-ink-100";
  return (
    <div className="bg-bone-100 border border-bone-300 rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
      <div className={`text-lg font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
      <div className="text-ink-100 mt-0.5">{value}</div>
    </div>
  );
}
