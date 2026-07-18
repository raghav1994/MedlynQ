"use client";

import { useRef, useState } from "react";
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

type Icd10Code = { code: string; display: string; source: string; verified: boolean };

type PreviewData = {
  ok: boolean;
  case_id: string;
  patient_id: string;
  patient: { name: string; mrn: string; age: number; gender: string };
  hospital: { name: string };
  scheme: string;
  payer: string;
  claim_use: string;
  registration_id: string;
  diagnosis_text: string;
  icd10_codes: Icd10Code[];
  procedure_name: string;
  procedure_code: string;
  claimed_amount: number;
  doc_count: number;
  error?: string;
};

// The edit form's own copy of each code row — separate from Icd10Code
// because a freshly-added row has no source/verified yet (that's only
// assigned once it's actually saved), and each row tracks its own
// auto-fill-in-progress state for the 🔍 button, plus live type-ahead
// suggestions from WHO's own ICD-10 catalog (data/icd10_who_full.csv) as
// the MEDCO types a diagnosis word or partial code — no NIH/ICD-10-CM
// here, so every suggestion is already the correct coding system for NHCX.
type Icd10Suggestion = { code: string; display: string };
type EditableCode = {
  code: string;
  display: string;
  looking_up?: boolean;
  suggestions?: Icd10Suggestion[];
  showSuggestions?: boolean;
  searching?: boolean;
};

type EditForm = {
  icd10_codes: EditableCode[];
  procedure_name: string;
  procedure_code: string;
  claimed_amount: string;
};

function formFromReview(r: PreviewData): EditForm {
  return {
    icd10_codes: r.icd10_codes.map((i) => ({ code: i.code, display: i.display })),
    procedure_name: r.procedure_name === "(not recorded)" ? "" : r.procedure_name,
    procedure_code: r.procedure_code === "(not recorded)" ? "" : r.procedure_code,
    claimed_amount: String(r.claimed_amount ?? 0),
  };
}

export default function NHCXBridge({ c }: { c: Case }) {
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<SendResult[]>([]);
  const [showBundle, setShowBundle] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);
  const [reviewData, setReviewData] = useState<PreviewData | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const searchTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  async function loadPreview() {
    setLoadingReview(true);
    try {
      const r = await fetch(`/api/nhcx/preview?case_id=${encodeURIComponent(c.id)}`);
      const data = await r.json();
      setReviewData(data);
      if (data.ok) setEditForm(formFromReview(data));
    } catch (e: any) {
      setReviewData({ ok: false, error: e?.message ?? String(e) } as any);
    } finally {
      setLoadingReview(false);
    }
  }

  async function openReview() {
    setShowReview(true);
    setConfirmChecked(false);
    setEditing(false);
    setSaveError(null);
    await loadPreview();
  }

  function startEditing() {
    // Always start from at least one row so "+ Add code" isn't the only
    // thing on screen when the AI found nothing at all.
    if (editForm && editForm.icd10_codes.length === 0) {
      setEditForm({ ...editForm, icd10_codes: [{ code: "", display: "" }] });
    }
    setEditing(true);
  }

  // Functional updater form — required because searchSuggestions fires a
  // second updateCodeRow (the "searching" flag) in the same keystroke tick
  // as the display/code change. Reading `editForm` from closure would let
  // the second call clobber the first with pre-keystroke state, silently
  // reverting every character typed.
  function updateCodeRow(i: number, patch: Partial<EditableCode>) {
    setEditForm((prev) => {
      if (!prev) return prev;
      const rows = prev.icd10_codes.slice();
      rows[i] = { ...rows[i], ...patch };
      return { ...prev, icd10_codes: rows };
    });
  }

  function removeCodeRow(i: number) {
    setEditForm((prev) => (prev ? { ...prev, icd10_codes: prev.icd10_codes.filter((_, idx) => idx !== i) } : prev));
  }

  function addCodeRow() {
    setEditForm((prev) => (prev ? { ...prev, icd10_codes: [...prev.icd10_codes, { code: "", display: "" }] } : prev));
  }

  // Debounced live type-ahead — waits for a pause in typing before hitting
  // the local WHO-backed search endpoint.
  function searchSuggestions(i: number, query: string) {
    clearTimeout(searchTimers.current[i]);
    if (query.trim().length < 3) {
      updateCodeRow(i, { suggestions: [], searching: false });
      return;
    }
    updateCodeRow(i, { searching: true });
    searchTimers.current[i] = setTimeout(async () => {
      try {
        const r = await fetch(`/api/icd10/search?q=${encodeURIComponent(query)}`);
        const data = await r.json();
        updateCodeRow(i, { suggestions: data.suggestions || [], searching: false, showSuggestions: true });
      } catch {
        updateCodeRow(i, { searching: false });
      }
    }, 300);
  }

  function pickSuggestion(i: number, s: Icd10Suggestion) {
    updateCodeRow(i, { code: s.code, display: s.display, suggestions: [], showSuggestions: false });
  }

  // Staff often knows the code (off a discharge summary) but not the exact
  // official wording — look it up instead of making them type it out.
  async function autoFillDescription(i: number) {
    if (!editForm) return;
    const code = editForm.icd10_codes[i].code.trim();
    if (!code) return;
    updateCodeRow(i, { looking_up: true });
    try {
      const r = await fetch(`/api/icd10/lookup?code=${encodeURIComponent(code)}`);
      const data = await r.json();
      updateCodeRow(i, { display: data.display || editForm.icd10_codes[i].display, looking_up: false });
    } catch {
      updateCodeRow(i, { looking_up: false });
    }
  }

  async function saveEdits() {
    if (!editForm || !reviewData?.ok) return;
    setSaving(true);
    setSaveError(null);
    try {
      const caseRes = await fetch(`/api/cases/${encodeURIComponent(reviewData.case_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          icd10_codes: editForm.icd10_codes
            .filter((e) => e.code.trim())
            .map((e) => ({ code: e.code.trim(), display: e.display.trim() })),
          procedure_name: editForm.procedure_name,
          procedure_code: editForm.procedure_code,
          claimed_amount: editForm.claimed_amount,
        }),
      }).then((r) => r.json());
      if (!caseRes.ok) { setSaveError(caseRes.error ?? "Couldn't save changes"); return; }
      setEditing(false);
      setConfirmChecked(false);
      await loadPreview();
    } catch (e: any) {
      setSaveError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

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

  async function confirmAndSend() {
    setShowReview(false);
    await transmit();
  }

  const claimUse = ["preauth_pending", "awaiting_approval"].includes(c.status)
    ? "preauthorization"
    : "claim";

  const hasUnverifiedCode = reviewData?.ok && reviewData.icd10_codes.some((i) => !i.verified);
  const hasNoCode = reviewData?.ok && reviewData.icd10_codes.length === 0;
  const needsConfirmCheckbox = hasUnverifiedCode || hasNoCode;
  const canConfirm = reviewData?.ok && (!needsConfirmCheckbox || confirmChecked);

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
          onClick={openReview}
          disabled={sending}
          className="px-3 py-2 rounded bg-ink-100 text-white text-xs font-semibold hover:bg-ink-200 disabled:opacity-50"
        >
          {sending ? "Transmitting…" : "Send via NHCX"}
        </button>
      </div>

      {showReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-ink-100">Verify before sending to NHCX</div>
                <div className="text-xs text-ink-300 mt-0.5">
                  {editing
                    ? "Fix any mismatched field below, then save."
                    : "Please check every field below matches the real patient before this goes out to the payer."}
                </div>
              </div>
              {!loadingReview && reviewData?.ok && !editing && (
                <button
                  onClick={startEditing}
                  className="text-[11px] font-semibold text-accent hover:underline shrink-0"
                >
                  ✎ Edit
                </button>
              )}
            </div>

            {loadingReview && (
              <div className="text-xs text-ink-300">Loading…</div>
            )}

            {!loadingReview && reviewData && !reviewData.ok && (
              <div className="text-xs text-bad">Couldn't load review: {reviewData.error}</div>
            )}

            {!loadingReview && reviewData?.ok && !editing && (
              <div className="space-y-3 text-sm">
                <ReviewRow label="Patient" value={`${reviewData.patient.name} · ${reviewData.patient.gender} · ${reviewData.patient.age}y`} />
                <ReviewRow label="MRN" value={reviewData.patient.mrn} />
                <ReviewRow label="Hospital" value={reviewData.hospital.name} />
                <ReviewRow label="Scheme / Payer" value={`${reviewData.scheme} — ${reviewData.payer}`} />
                <ReviewRow label="Registration ID" value={reviewData.registration_id} />
                <ReviewRow label="Sending as" value={reviewData.claim_use === "preauthorization" ? "Pre-authorization request" : "Claim"} />

                <div className="border border-bone-300 rounded p-2.5 bg-bone-100 space-y-2">
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-300">
                    ICD-10 Diagnosis Code{reviewData.icd10_codes.length !== 1 ? "s" : ""}
                  </div>
                  {reviewData.icd10_codes.length > 0 ? (
                    reviewData.icd10_codes.map((icd10, i) => (
                      <div key={i} className={i > 0 ? "pt-2 border-t border-bone-300" : ""}>
                        <div className="text-sm font-semibold text-ink-100">
                          {icd10.code} — {icd10.display}
                        </div>
                        {icd10.verified ? (
                          <span className="inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-good-soft text-good">
                            ✓ Verified code
                          </span>
                        ) : (
                          <span className="inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-bad-soft text-bad">
                            ⚠ AI-guessed — not verified
                          </span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-bad">No ICD-10 code could be determined from the diagnosis text — this bundle will go out with no coded diagnosis.</div>
                  )}
                  <button
                    onClick={startEditing}
                    className="text-[11px] font-semibold text-accent hover:underline"
                  >
                    {reviewData.icd10_codes.length > 0 ? "+ Add another code / edit" : "+ Add diagnosis code manually"}
                  </button>
                </div>

                <ReviewRow label="Procedure" value={`${reviewData.procedure_name} (${reviewData.procedure_code})`} />
                <ReviewRow label="Claimed Amount" value={`₹${reviewData.claimed_amount.toLocaleString("en-IN")}`} />
                <ReviewRow label="Documents attached" value={String(reviewData.doc_count)} />

                {needsConfirmCheckbox && (
                  <label className="flex items-start gap-2 text-xs text-ink-200 bg-bad-soft/40 border border-bad/30 rounded p-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmChecked}
                      onChange={(e) => setConfirmChecked(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      {hasNoCode
                        ? "I understand this claim has no ICD-10 diagnosis code and want to send it anyway."
                        : "I have manually checked every unverified diagnosis code above is medically correct for this patient."}
                    </span>
                  </label>
                )}
              </div>
            )}

            {!loadingReview && reviewData?.ok && editing && editForm && (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-ink-300 font-semibold mb-1">Patient name &amp; MRN (not editable here)</div>
                  <div className="text-sm text-ink-200">{reviewData.patient.name} · {reviewData.patient.mrn}</div>
                  <div className="text-[10px] text-ink-300 mt-0.5">
                    A wrong name or MRN needs fixing at the source — the Patient List / OPD registration — not on this claim-review screen, since both are shared identifiers used everywhere else in the app (including the document folder on disk).
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-ink-300 font-semibold mb-1.5">
                    ICD-10 Diagnosis Codes
                  </div>
                  <div className="space-y-2.5">
                    {editForm.icd10_codes.map((row, i) => (
                      <div key={i} className="border border-bone-300 rounded p-2 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={row.code}
                            placeholder="Code, e.g. C61"
                            onChange={(e) => { updateCodeRow(i, { code: e.target.value }); searchSuggestions(i, e.target.value); }}
                            onFocus={() => { if (row.suggestions?.length) updateCodeRow(i, { showSuggestions: true }); }}
                            onBlur={() => setTimeout(() => updateCodeRow(i, { showSuggestions: false }), 150)}
                            className="flex-1 text-sm border border-bone-300 rounded px-2 py-1.5 bg-bone-0 text-ink-100"
                          />
                          <button
                            onClick={() => autoFillDescription(i)}
                            disabled={!row.code.trim() || row.looking_up}
                            title="Auto-fill official description for this code"
                            className="text-[11px] font-semibold text-accent hover:underline shrink-0 disabled:opacity-40 disabled:no-underline"
                          >
                            {row.looking_up ? "…" : "🔍 Fill"}
                          </button>
                          <button
                            onClick={() => removeCodeRow(i)}
                            title="Remove this code"
                            className="text-[13px] text-bad hover:opacity-70 shrink-0 px-1"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            type="text"
                            value={row.display}
                            placeholder="Or type a diagnosis word, e.g. diabetes"
                            onChange={(e) => { updateCodeRow(i, { display: e.target.value }); searchSuggestions(i, e.target.value); }}
                            onFocus={() => { if (row.suggestions?.length) updateCodeRow(i, { showSuggestions: true }); }}
                            onBlur={() => setTimeout(() => updateCodeRow(i, { showSuggestions: false }), 150)}
                            className="w-full text-sm border border-bone-300 rounded px-2 py-1.5 bg-bone-0 text-ink-100"
                          />
                          {row.searching && (
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-300">searching…</span>
                          )}
                          {row.showSuggestions && !!row.suggestions?.length && (
                            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-bone-300 rounded shadow-lg max-h-40 overflow-y-auto">
                              {row.suggestions.map((s, si) => (
                                <button
                                  key={si}
                                  type="button"
                                  onMouseDown={() => pickSuggestion(i, s)}
                                  className="block w-full text-left px-2 py-1.5 text-xs hover:bg-bone-100 border-b border-bone-100 last:border-b-0"
                                >
                                  <span className="font-semibold text-ink-100">{s.code}</span>{" "}
                                  <span className="text-ink-200">{s.display}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-[10px] text-ink-300">
                          Suggestions from WHO's official ICD-10 catalog — still needs your confirmation before sending.
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addCodeRow}
                    className="text-[11px] font-semibold text-accent hover:underline mt-2"
                  >
                    + Add another code
                  </button>
                </div>

                <EditField label="Procedure name" value={editForm.procedure_name}
                  onChange={(v) => setEditForm({ ...editForm, procedure_name: v })} />
                <EditField label="Procedure code" value={editForm.procedure_code}
                  onChange={(v) => setEditForm({ ...editForm, procedure_code: v })} />
                <EditField label="Claimed amount (₹)" value={editForm.claimed_amount} type="number"
                  onChange={(v) => setEditForm({ ...editForm, claimed_amount: v })} />

                {saveError && <div className="text-xs text-bad">{saveError}</div>}

                <div className="flex items-center gap-2 justify-end pt-1">
                  <button
                    onClick={() => { setEditing(false); setSaveError(null); }}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs font-semibold border border-bone-300 rounded hover:bg-bone-100 disabled:opacity-40"
                  >
                    Discard
                  </button>
                  <button
                    onClick={saveEdits}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs font-semibold bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>
            )}

            {!editing && (
              <div className="flex items-center gap-2 justify-end pt-2 border-t border-bone-300">
                <button
                  onClick={() => setShowReview(false)}
                  className="px-3 py-1.5 text-xs font-semibold border border-bone-300 rounded hover:bg-bone-100"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmAndSend}
                  disabled={!canConfirm}
                  className="px-3 py-1.5 text-xs font-semibold bg-ink-100 text-white rounded hover:bg-ink-200 disabled:opacity-40"
                >
                  Confirm &amp; Send to NHCX
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wide text-ink-300 font-semibold shrink-0">{label}</span>
      <span className="text-sm text-ink-100 text-right">{value}</span>
    </div>
  );
}

function EditField({
  label, value, onChange, type = "text", placeholder,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-300 font-semibold mb-1">{label}</div>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-bone-300 rounded px-2 py-1.5 bg-bone-0 text-ink-100"
      />
    </div>
  );
}
