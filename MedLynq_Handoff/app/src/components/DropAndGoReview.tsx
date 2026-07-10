"use client";

// Review modal that opens after a Drop-and-Go batch finishes processing.
// Shows: detected patient groups · per-group stage detection · missing-critical
// docs · "create cases + attach docs" button.

import { useState, useMemo } from "react";
import type { Stage } from "@/lib/types";
import { resolveIdentity, type IdentityHints, type IdentityResolveResult } from "@/lib/identityScore";
import { detectStage, type DetectedStage } from "@/lib/stageDetector";

export type DropAndGoJob = {
  id: string;
  filename: string;
  doc_type?: string;
  extracted_fields?: Record<string, string>;
};

export type DetectedPatientGroup = {
  group_id: string;
  hints: IdentityHints;
  jobs: DropAndGoJob[];
  identity: IdentityResolveResult;
  stage: DetectedStage;
};

// Group uploaded jobs by detected patient identity.
// Today we cluster by exact (name+age) tuple; future: use identity score across docs.
export function groupJobsByPatient(jobs: DropAndGoJob[]): DetectedPatientGroup[] {
  const groups = new Map<string, DropAndGoJob[]>();
  for (const j of jobs) {
    const f = j.extracted_fields ?? {};
    const key = `${(f.patient_name ?? "unknown").toLowerCase().trim()}|${f.age ?? ""}|${f.gender ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(j);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, gjobs], idx) => {
    const f = gjobs[0].extracted_fields ?? {};
    const hints: IdentityHints = {
      name: f.patient_name,
      mrn: f.mrn,
      age: f.age,
      gender: f.gender,
      dob: f.dob,
    };
    const identity = resolveIdentity(hints);
    const stage = detectStage(gjobs.map((j) => j.doc_type ?? "").filter(Boolean));
    return {
      group_id: `group_${idx}_${Date.now().toString(36)}`,
      hints,
      jobs: gjobs,
      identity,
      stage,
    };
  });
}

const STAGE_LABEL: Record<Stage | "unknown", string> = {
  opd: "OPD only",
  pre_auth: "Pre-Auth / Approval",
  mid_way: "Mid-way (treatment)",
  discharge: "Discharge & Claim",
  unknown: "Unknown — too few docs",
};
const STAGE_TONE: Record<Stage | "unknown", string> = {
  opd: "bg-bone-200 text-ink-200",
  pre_auth: "bg-warn-soft text-warn",
  mid_way: "bg-accent-soft text-accent",
  discharge: "bg-good-soft text-good",
  unknown: "bg-bone-200 text-ink-300",
};

export default function DropAndGoReview({
  open, onClose, jobs, onCommit,
}: {
  open: boolean;
  onClose: () => void;
  jobs: DropAndGoJob[];
  onCommit?: (groups: DetectedPatientGroup[]) => void;
}) {
  const groups = useMemo(() => groupJobsByPatient(jobs), [jobs]);
  const [committed, setCommitted] = useState(false);

  if (!open) return null;
  if (jobs.length === 0) return null;

  const handleCommit = () => {
    onCommit?.(groups);
    setCommitted(true);
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink-100/50 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-bone-0 border border-bone-300 rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-ink-100">📦 Drop-and-Go review</h2>
            <p className="text-xs text-ink-300 mt-1">
              MedLynq processed {jobs.length} file{jobs.length === 1 ? "" : "s"} and detected{" "}
              <strong>{groups.length} patient{groups.length === 1 ? "" : "s"}</strong>.
              Review the groupings, then commit to create cases and attach docs.
            </p>
          </div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-100 text-xl leading-none">×</button>
        </div>

        {groups.length > 1 && (
          <div className="bg-warn-soft border border-warn/40 rounded p-3 text-xs">
            <strong className="text-warn">⚠ Multi-patient bag detected.</strong>
            <span className="text-ink-200"> MedLynq found docs for {groups.length} different patients in this upload.
              We'll split them into separate cases. Confirm the split below before committing.</span>
          </div>
        )}

        <div className="space-y-3">
          {groups.map((g, i) => (
            <div key={g.group_id} className="border border-bone-300 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-bone-100 border-b border-bone-300 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-sm font-bold text-ink-100">
                    Patient {i + 1}: {g.hints.name ?? "(name not detected)"}
                  </div>
                  <div className="text-[11px] text-ink-300">
                    {g.jobs.length} doc{g.jobs.length === 1 ? "" : "s"}
                    {g.hints.age && ` · age ${g.hints.age}`}
                    {g.hints.gender && ` · ${g.hints.gender}`}
                    {g.hints.mrn && ` · MRN ${g.hints.mrn}`}
                  </div>
                </div>
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${STAGE_TONE[g.stage.stage]}`}>
                  Stage: {STAGE_LABEL[g.stage.stage]}
                </span>
              </div>
              <div className="p-3 space-y-2 text-xs">
                {/* Identity decision */}
                <div className={`rounded p-2 border ${
                  g.identity.decision === "auto_match" ? "bg-good-soft border-good/40 text-good" :
                  g.identity.decision === "ambiguous" ? "bg-warn-soft border-warn/40 text-warn" :
                  "bg-accent-soft border-accent/40 text-accent"
                }`}>
                  {g.identity.decision === "auto_match" && g.identity.match ? (
                    <>
                      ✓ <strong>Matched existing patient</strong> {g.identity.match.name} · MRN {g.identity.match.mrn} ·
                      will attach docs here
                    </>
                  ) : g.identity.decision === "ambiguous" ? (
                    <>
                      ⚠ Only 1 field matched — please confirm. Top candidate: {g.identity.candidates[0]?.patient.name}
                    </>
                  ) : (
                    <>＋ <strong>New patient</strong> — MedLynq will create this in the Patient List</>
                  )}
                </div>

                {/* Stage detection */}
                {g.stage.stage !== "unknown" && (
                  <div className="text-[11px] text-ink-300">
                    {g.stage.present_at_stage}/{g.stage.total_required_at_stage} critical {STAGE_LABEL[g.stage.stage]} docs present
                    {g.stage.missing_critical.length > 0 && (
                      <div className="mt-1 text-bad">
                        ⚠ Missing critical: {g.stage.missing_critical.join(", ")}
                      </div>
                    )}
                  </div>
                )}

                {/* Doc list */}
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-ink-300 hover:text-ink-100 select-none">
                    Show {g.jobs.length} file{g.jobs.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-2 space-y-0.5 list-disc list-inside text-ink-200">
                    {g.jobs.map((j) => (
                      <li key={j.id}>
                        <span className="font-mono">{j.filename}</span>
                        {j.doc_type && <span className="text-ink-300"> · {j.doc_type}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-bone-300">
          <div className="text-[11px] text-ink-300 italic">
            Confirm to create cases + attach docs to detected patients.
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">
              Cancel
            </button>
            <button onClick={handleCommit} disabled={committed}
              className="text-xs font-semibold px-4 py-1.5 bg-accent text-white rounded hover:opacity-90 disabled:opacity-40">
              {committed ? "✓ Committed" : `Create ${groups.length} case${groups.length === 1 ? "" : "s"} + attach docs`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
