"use client";

// Universal rejection handler — works for ANY rejection in MedLynq:
//   - Pre-auth rejection (CGHS / ECHS / Railway / TPA)
//   - Pre-approval rejection (Ayushman / FCI)
//   - Final claim rejection (any scheme)
//
// MEDCO picks one of three paths: Counsel for Cash · Switch Scheme · File Appeal.
// Each path updates the case status + appends to scheme_history.

import { useState } from "react";
import type { Scheme, SchemeVariant } from "@/lib/types";
import { SCHEME_META, VARIANT_META } from "@/lib/types";

export type RejectionOutcome =
  | { action: "cash"; counselled_by?: string }
  | { action: "switch"; new_scheme: Scheme; new_variant?: SchemeVariant; new_card_number?: string }
  | { action: "appeal"; doctor_note: string; extra_docs: string[]; appeal_to: string };

type Props = {
  open: boolean;
  onClose: () => void;
  caseCode: string;
  patientName: string;
  currentScheme: Scheme;
  currentVariant?: SchemeVariant;
  rejectionReason?: string;
  amountAtStake: number;
  // K1: rejection rounds counter. 0 or 1 = first rejection (Appeal only).
  // 2+ = all three options unlocked.
  rejectionRound?: number;
  onSubmit: (outcome: RejectionOutcome) => void;
};

export default function RejectionModal({
  open, onClose, caseCode, patientName, currentScheme, currentVariant,
  rejectionReason, amountAtStake, rejectionRound = 1, onSubmit,
}: Props) {
  // K1: on round-1 rejection only Appeal (doctor justification) is allowed.
  // Round-2+ unlocks Switch and Cash too.
  const firstRound = rejectionRound <= 1;
  const [tab, setTab] = useState<"cash" | "switch" | "appeal">("appeal");

  // Cash form
  const [counsellor, setCounsellor] = useState("");

  // Scheme switch
  const [newScheme, setNewScheme] = useState<Scheme>("TPA");
  const [newCard, setNewCard] = useState("");

  // Appeal
  const [doctorNote, setDoctorNote] = useState("");
  const [extraDocsText, setExtraDocsText] = useState("");
  const [appealTo, setAppealTo] = useState("");

  if (!open) return null;

  const handleSubmit = () => {
    if (tab === "cash") onSubmit({ action: "cash", counselled_by: counsellor });
    else if (tab === "switch") onSubmit({ action: "switch", new_scheme: newScheme, new_card_number: newCard });
    else if (tab === "appeal") onSubmit({
      action: "appeal",
      doctor_note: doctorNote,
      extra_docs: extraDocsText.split(",").map((s) => s.trim()).filter(Boolean),
      appeal_to: appealTo || defaultAppealAuthority(currentScheme),
    });
    onClose();
  };

  const variantLabel = currentVariant ? VARIANT_META[currentVariant]?.label : null;

  return (
    <div className="fixed inset-0 z-50 bg-ink-100/50 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-bone-0 border border-bone-300 rounded-lg p-6 max-w-2xl w-full space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink-100">⚠ Rejection — pick next step</h2>
            <p className="text-xs text-ink-300 mt-1">
              Case <span className="font-mono">{caseCode}</span> · <strong>{patientName}</strong> · {SCHEME_META[currentScheme]?.label}
              {variantLabel && ` (${variantLabel})`} · ₹{amountAtStake.toLocaleString("en-IN")} at stake
            </p>
            {rejectionReason && (
              <div className="mt-2 text-xs bg-bad-soft border border-bad/40 text-bad rounded p-2">
                <strong>Rejection reason:</strong> {rejectionReason}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100 text-xl leading-none">×</button>
        </div>

        {/* Tab strip */}
        {firstRound && (
          <div className="bg-accent-soft border border-accent/40 rounded text-[11px] text-accent p-2">
            <strong>First rejection:</strong> standard practice is to file an appeal with the doctor's clarification note.
            Cash and scheme-switch options unlock if the appeal is rejected too.
          </div>
        )}
        <div className="flex gap-2 border-b border-bone-300">
          <TabBtn label="⚖️ File Appeal" sub="doctor's justification" active={tab === "appeal"} onClick={() => setTab("appeal")} recommended />
          <TabBtn label="🔄 Scheme Switch" sub={firstRound ? "unlocks after appeal fails" : "patient has another card"}
            active={tab === "switch"} onClick={() => !firstRound && setTab("switch")} disabled={firstRound} />
          <TabBtn label="💵 Counsel for Cash" sub={firstRound ? "unlocks after appeal fails" : "patient pays directly"}
            active={tab === "cash"} onClick={() => !firstRound && setTab("cash")} disabled={firstRound} />
        </div>

        {/* Tab body */}
        {tab === "appeal" && (
          <div className="space-y-3">
            <Info>
              File an appeal with <strong>{defaultAppealAuthority(currentScheme)}</strong>.
              Typical turnaround: 5–10 working days. ~30–40% of appealed cases are overturned.
            </Info>
            <Field label="Doctor's clarification note">
              <textarea value={doctorNote} onChange={(e) => setDoctorNote(e.target.value)} rows={3}
                placeholder="e.g. Patient's HER2+ status confirmed by IHC report; treatment clinically necessary; histopath signed by Dr. R. Iyer attached separately."
                className={taCls} />
            </Field>
            <Field label="Extra docs to attach (comma-separated)">
              <input type="text" value={extraDocsText} onChange={(e) => setExtraDocsText(e.target.value)}
                placeholder="IHC report, pathology re-sign, hospital letterhead" className={inputCls} />
            </Field>
            <Field label="Appeal addressed to (optional override)">
              <input type="text" value={appealTo} onChange={(e) => setAppealTo(e.target.value)}
                placeholder={defaultAppealAuthority(currentScheme)} className={inputCls} />
            </Field>
          </div>
        )}

        {tab === "switch" && (
          <div className="space-y-3">
            <Info>
              Patient must have a second card. Pull it out, enter the number, MedLynq re-runs verification + pre-auth from scratch under the new scheme. Original {currentScheme} attempt is preserved in scheme history.
            </Info>
            <div className="grid grid-cols-2 gap-3">
              <Field label="New scheme">
                <select value={newScheme} onChange={(e) => setNewScheme(e.target.value as Scheme)} className={inputCls}>
                  {(Object.keys(SCHEME_META) as Scheme[]).filter((s) => s !== currentScheme && s !== "Cash").map((s) => (
                    <option key={s} value={s}>{SCHEME_META[s]?.icon} {SCHEME_META[s]?.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="New card number">
                <input type="text" value={newCard} onChange={(e) => setNewCard(e.target.value)} placeholder="enter scheme card #" className={inputCls + " font-mono"} />
              </Field>
            </div>
            <div className="text-[10px] text-ink-300 italic">
              Tip: most patients carry both a public card (Ayushman / CGHS) AND a private TPA card. If first scheme rejects, the other often clears.
            </div>
          </div>
        )}

        {tab === "cash" && (
          <div className="space-y-3">
            <Info tone="warn">
              Patient will pay directly. Case stays open in MedLynq for hospital MIS but stops moving through the claim pipeline. Receipt can still be generated for future insurance reimbursement.
            </Info>
            <Field label="Counselling done by">
              <input type="text" value={counsellor} onChange={(e) => setCounsellor(e.target.value)} placeholder="Front desk / Billing exec name" className={inputCls} />
            </Field>
            <div className="bg-bone-100 border border-bone-300 rounded p-3 text-xs">
              <div className="font-bold text-ink-100 mb-1">What MedLynq will do automatically:</div>
              <ul className="space-y-0.5 text-ink-200 list-disc list-inside">
                <li>Mark case status as <code className="font-mono">cash</code></li>
                <li>Disable scheme-side workflow (no more pre-auth submission)</li>
                <li>Keep documents + audit trail intact</li>
                <li>Generate cash receipt template at discharge</li>
              </ul>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-bone-300">
          <button onClick={onClose} className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">Cancel</button>
          <button onClick={handleSubmit}
            className={`text-xs font-semibold px-4 py-1.5 text-white rounded hover:opacity-90 ${
              tab === "appeal" ? "bg-accent" : tab === "switch" ? "bg-warn" : "bg-bad"
            }`}>
            {tab === "appeal" ? "File appeal" : tab === "switch" ? "Switch + re-run" : "Mark as cash"}
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultAppealAuthority(scheme: Scheme): string {
  switch (scheme) {
    case "PMJAY":
    case "Ayushman":     return "NHA District Grievance Committee";
    case "CGHS":         return "CGHS Appellate Authority (Additional Director)";
    case "CAPF":         return "CAPF Hospital Empanelment Cell";
    case "ECHS":         return "ECHS Regional Centre Appeal Desk";
    case "Railway_UMID": return "Railway CMS Appeal Desk";
    case "ESI":          return "ESIC Regional Office";
    case "NDMC":         return "NDMC Medical Benefits Section";
    case "FCI":          return "FCI HR Medical Cell";
    case "DU":           return "DU Health Centre Appeal";
    case "TPA":          return "TPA Escalation Desk";
    default:             return "Scheme Appeal Authority";
  }
}

const inputCls = "w-full text-sm px-3 py-2 bg-bone-0 border border-bone-300 rounded focus:outline-none focus:border-accent";
const taCls = inputCls + " resize-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold mb-1">{label}</div>
      {children}
    </div>
  );
}

function Info({ children, tone = "accent" }: { children: React.ReactNode; tone?: "accent" | "warn" }) {
  return (
    <div className={`text-xs rounded p-2 border ${tone === "warn" ? "bg-warn-soft border-warn/40 text-warn" : "bg-accent-soft border-accent/40 text-accent"}`}>
      {children}
    </div>
  );
}

function TabBtn({ label, sub, active, onClick, recommended, disabled }: {
  label: string; sub: string; active: boolean; onClick: () => void; recommended?: boolean; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex-1 py-2 px-3 text-left transition border-b-2 ${
        active ? "border-accent text-ink-100"
        : disabled ? "border-transparent text-ink-300/50 cursor-not-allowed"
        : "border-transparent text-ink-300 hover:text-ink-200"
      }`}>
      <div className="text-xs font-bold flex items-center gap-1">
        {label}
        {recommended && <span className="text-[9px] bg-accent text-white px-1 py-0.5 rounded">try first</span>}
        {disabled && <span className="text-[9px] bg-bone-200 text-ink-300 px-1 py-0.5 rounded">locked</span>}
      </div>
      <div className="text-[10px] text-ink-300">{sub}</div>
    </button>
  );
}
