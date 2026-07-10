// Renders the structured "Doctor's Plan" extracted from the prescription doc.
// Shows: course summary · package codes (with scheme cover) · drugs (with MRP range).
// Lints against bill cap + scheme cover automatically.

import type { DoctorsPlan } from "@/lib/prescription";

export default function DoctorsPlanCard({
  plan, billTotal, schemeForCheck,
}: {
  plan: DoctorsPlan;
  billTotal?: number;
  schemeForCheck?: string;
}) {
  const hasAnything =
    plan.package_codes.length > 0 || plan.drugs.length > 0 ||
    plan.procedure || plan.course_summary;
  if (!hasAnything) return null;

  // Build issues array — auto-validation
  const issues: Array<{ tone: "warn" | "bad" | "good"; text: string }> = [];
  if (schemeForCheck) {
    for (const pkg of plan.packages_hydrated) {
      if (pkg.master && !pkg.master.schemes.includes(schemeForCheck)) {
        issues.push({
          tone: "bad",
          text: `Package ${pkg.code} (${pkg.master.name}) not covered under ${schemeForCheck}. Available on: ${pkg.master.schemes.join(" · ")}.`,
        });
      }
      if (!pkg.master) {
        issues.push({ tone: "warn", text: `Code ${pkg.code} not in scheme master — verify manually.` });
      }
    }
  }
  if (billTotal !== undefined) {
    const capSum = plan.packages_hydrated.reduce((s, p) => s + (p.master?.cap_inr ?? 0), 0);
    if (capSum > 0 && billTotal > capSum) {
      issues.push({
        tone: "bad",
        text: `Bill ₹${billTotal.toLocaleString("en-IN")} exceeds combined package cap ₹${capSum.toLocaleString("en-IN")}.`,
      });
    } else if (capSum > 0) {
      issues.push({ tone: "good", text: `Bill within combined cap.` });
    }
  }

  return (
    <div className="border rounded-lg bg-bone-0 border-bone-300 overflow-hidden mb-4">
      <div className="px-3 py-2 bg-accent-soft border-b border-bone-300 flex items-center gap-2">
        <span>🩺</span>
        <div className="text-xs font-bold uppercase tracking-wide text-ink-100">Doctor's Plan</div>
        <span className="text-[10px] text-ink-300">decoded from prescription</span>
      </div>

      <div className="p-3 space-y-3 text-xs">
        {plan.course_summary && (
          <p className="text-ink-200 leading-relaxed">{plan.course_summary}</p>
        )}

        {plan.packages_hydrated.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold mb-1">
              Package codes ({plan.packages_hydrated.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.packages_hydrated.map((p) => (
                <span
                  key={p.code}
                  className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                    p.master ? "bg-accent-soft text-accent border-accent/40" : "bg-warn-soft text-warn border-warn/40"
                  }`}
                  title={p.master ? `${p.master.name} · cap ₹${p.master.cap_inr.toLocaleString("en-IN")}` : "Code not found in master"}
                >
                  {p.code}
                  {p.master && <span className="ml-1 text-ink-300 font-sans">· ₹{(p.master.cap_inr / 1000).toFixed(0)}k</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {plan.drugs.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold mb-1">
              Drugs prescribed ({plan.drugs.length})
            </div>
            <ul className="space-y-1">
              {plan.drugs.map((d, i) => (
                <li key={i} className="flex items-start justify-between gap-2 bg-bone-100 border border-bone-300 rounded px-2 py-1">
                  <div>
                    <div className="text-ink-100 font-semibold">
                      {d.name} <span className="text-ink-300 font-normal">· {d.dose}</span>
                    </div>
                    {d.master_match && (
                      <div className="text-[10px] text-ink-300">
                        ✓ matched to <strong>{d.master_match.generic}</strong>
                        {d.master_match.oncology && <span className="ml-1 bg-accent-soft text-accent px-1 rounded">oncology</span>}
                        {d.master_match.mrp_min !== null && d.master_match.mrp_max !== null && (
                          <span className="ml-1">· ₹{d.master_match.mrp_min}–₹{d.master_match.mrp_max}</span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(plan.frequencies.length > 0 || plan.cycles.current || plan.cycles.total) && (
          <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-bone-300">
            {plan.frequencies.length > 0 && (
              <span className="text-[10px] text-ink-300">
                Frequency: {plan.frequencies.join(", ")}
              </span>
            )}
            {(plan.cycles.current || plan.cycles.total) && (
              <span className="text-[10px] text-ink-300">
                Cycle: {plan.cycles.current ?? "?"} of {plan.cycles.total ?? "?"}
              </span>
            )}
          </div>
        )}

        {issues.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-bone-300">
            {issues.map((iss, i) => (
              <div key={i} className={`text-[11px] flex items-start gap-1.5 ${
                iss.tone === "bad" ? "text-bad" : iss.tone === "warn" ? "text-warn" : "text-good"
              }`}>
                <span>{iss.tone === "bad" ? "✗" : iss.tone === "warn" ? "⚠" : "✓"}</span>
                <span>{iss.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
