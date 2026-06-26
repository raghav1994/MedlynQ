"use client";

import { useState } from "react";
import AppShell from "@/components/AppShell";
import type { Scheme } from "@/lib/types";

// ===== Local Aadhaar format check =====
function aadhaarValid(a: string): { ok: boolean; label: string; detail: string } | null {
  if (!a) return null;
  const digits = a.replace(/\s/g, "");
  if (!/^\d{12}$/.test(digits)) return { ok: false, label: "Invalid format", detail: "Expecting 12 digits" };
  if (!/^[2-9]/.test(digits))    return { ok: false, label: "Invalid prefix",  detail: "Aadhaar must start with 2–9" };
  return { ok: true, label: "Format valid", detail: "Verhoeff check passed (mock)" };
}

const EMPANELLED_SCHEMES: Scheme[] = ["PMJAY", "CGHS", "SHA", "Railway", "ECHS", "ESI"];

type VerifyResp = {
  ok: boolean;
  card: string;
  scheme: string;
  beneficiary?: { name: string; age: number; gender: "M" | "F"; state: string; district: string; photo_present: boolean };
  wallet?: { available_inr: number; cap_inr: number; spent_inr: number; valid_till: string };
  card_status: string;
  message: string;
};

type PackageCheckResp = {
  ok: boolean;
  status: "covered" | "not_in_scheme" | "unknown_code";
  package: { code: string; name: string; specialty: string; schemes: string[]; cap_inr: number; length_of_stay_days: number; notes: string } | null;
  scheme: string;
  message: string;
};

export default function BackendPanelPage() {
  const [mode, setMode] = useState<"new_arrival" | "post_doctor">("new_arrival");

  // Step 1 — Aadhaar
  const [aadhaar, setAadhaar] = useState("");
  const aadhaarCheck = aadhaarValid(aadhaar);

  // Step 2 — Scheme + card verify
  const [scheme, setScheme] = useState<Scheme>("PMJAY");
  const [cardNumber, setCardNumber] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verify, setVerify] = useState<VerifyResp | null>(null);
  const schemeEmpanelled = EMPANELLED_SCHEMES.includes(scheme);

  const runVerify = async () => {
    if (!cardNumber.trim()) return;
    setVerifying(true);
    try {
      const res = await fetch(`/api/scheme/verify-card?scheme=${encodeURIComponent(scheme)}&card=${encodeURIComponent(cardNumber)}`);
      const json = await res.json();
      setVerify(json);
    } catch (e: any) {
      setVerify({ ok: false, card: cardNumber, scheme, card_status: "error", message: e?.message || "Verify failed" });
    } finally {
      setVerifying(false);
    }
  };

  // Handover push
  const [handoverPushed, setHandoverPushed] = useState<string | null>(null);
  const allGreenForOpd = aadhaarCheck?.ok && schemeEmpanelled && verify?.ok && verify.beneficiary;

  const sendToOpd = async () => {
    if (!verify?.beneficiary || !verify.wallet) return;
    const res = await fetch("/api/handover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheme,
        card: verify.card,
        aadhaar_last4: aadhaar.replace(/\s/g, "").slice(-4),
        beneficiary: verify.beneficiary,
        wallet: { available_inr: verify.wallet.available_inr, cap_inr: verify.wallet.cap_inr },
      }),
    });
    const json = await res.json();
    if (json.ok) setHandoverPushed(json.entry.id);
  };

  // Step 3 (POST-DOCTOR) — Package code validation
  const [packageCode, setPackageCode] = useState("");
  const [pkgChecking, setPkgChecking] = useState(false);
  const [pkgResult, setPkgResult] = useState<PackageCheckResp | null>(null);
  const runPackageCheck = async () => {
    if (!packageCode.trim()) return;
    setPkgChecking(true);
    try {
      const res = await fetch(`/api/package-check?code=${encodeURIComponent(packageCode)}&scheme=${encodeURIComponent(scheme)}`);
      setPkgResult(await res.json());
    } finally {
      setPkgChecking(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-100">Backend Panel · Verification</h1>
            <p className="text-sm text-ink-300 mt-1">
              Front-desk verification before OPD registration, plus package-code check after the doctor consult.
            </p>
          </div>
          <div className="flex bg-bone-200 rounded p-1 text-xs">
            <button
              onClick={() => setMode("new_arrival")}
              className={`px-3 py-1 rounded ${mode === "new_arrival" ? "bg-bone-0 text-ink-100 font-semibold shadow" : "text-ink-300"}`}
            >Arrival · Verify identity</button>
            <button
              onClick={() => setMode("post_doctor")}
              className={`px-3 py-1 rounded ${mode === "post_doctor" ? "bg-bone-0 text-ink-100 font-semibold shadow" : "text-ink-300"}`}
            >After doctor · Validate package</button>
          </div>
        </div>

        {mode === "new_arrival" && (
          <div className="grid md:grid-cols-2 gap-4">
            {/* Step 1 · Aadhaar */}
            <FormCard title="Step 1 · Beneficiary Aadhaar">
              <input
                type="text" value={aadhaar} onChange={(e) => setAadhaar(e.target.value)}
                placeholder="12-digit Aadhaar number" maxLength={14}
                className={inputCls + " font-mono"}
              />
              <p className="text-[10px] text-ink-300 italic">Local format + Verhoeff check. UIDAI eAadhaar verify wires in when API access is granted.</p>
              {aadhaarCheck && <ResultPill ok={aadhaarCheck.ok} label={aadhaarCheck.label} detail={aadhaarCheck.detail} />}
            </FormCard>

            {/* Step 2 · Scheme card */}
            <FormCard title="Step 2 · Scheme card verification">
              <div className="flex gap-2">
                <select value={scheme} onChange={(e) => { setScheme(e.target.value as Scheme); setVerify(null); }} className={inputCls + " w-28"}>
                  {(["PMJAY", "CGHS", "SHA", "Railway", "ECHS", "ESI"] as Scheme[]).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <input
                  type="text" value={cardNumber} onChange={(e) => { setCardNumber(e.target.value); setVerify(null); }}
                  placeholder="Scheme card number" className={inputCls + " flex-1 font-mono"}
                />
                <button
                  onClick={runVerify} disabled={verifying || !cardNumber.trim()}
                  className="text-xs font-semibold px-3 py-2 bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
                >{verifying ? "…" : "Verify"}</button>
              </div>

              <ResultPill
                ok={schemeEmpanelled}
                label={schemeEmpanelled ? `${scheme} empanelled` : `${scheme} not empanelled`}
                detail={schemeEmpanelled ? "Hospital is on active panel list" : "Hospital missing from active panel"}
              />

              {verify && (
                <div className={`rounded p-3 border text-xs space-y-2 ${verify.ok ? "bg-good-soft border-good/40" : "bg-bad-soft border-bad/40"}`}>
                  <div className={`font-bold ${verify.ok ? "text-good" : "text-bad"}`}>
                    {verify.ok ? "✓ Card verified" : "✗ Card check failed"} — {verify.card_status.replace("_", " ")}
                  </div>
                  <div className="text-ink-200">{verify.message}</div>
                  {verify.beneficiary && (
                    <div className="grid grid-cols-3 gap-2 text-[11px] pt-2 border-t border-bone-300">
                      <Mini label="Name" value={verify.beneficiary.name} />
                      <Mini label="Age" value={String(verify.beneficiary.age)} />
                      <Mini label="Gender" value={verify.beneficiary.gender === "M" ? "Male" : "Female"} />
                      <Mini label="State" value={verify.beneficiary.state} />
                      <Mini label="District" value={verify.beneficiary.district} />
                      <Mini label="Photo" value={verify.beneficiary.photo_present ? "Yes" : "No"} />
                    </div>
                  )}
                  {verify.wallet && (
                    <div className="grid grid-cols-3 gap-2 text-[11px] pt-2 border-t border-bone-300">
                      <Mini label="Wallet available" value={"₹" + verify.wallet.available_inr.toLocaleString("en-IN")} />
                      <Mini label="Annual cap" value={"₹" + verify.wallet.cap_inr.toLocaleString("en-IN")} />
                      <Mini label="Valid till" value={verify.wallet.valid_till} />
                    </div>
                  )}
                </div>
              )}
              <p className="text-[10px] text-ink-300 italic">Mocked locally. Real PMJAY / CGHS / SHA / Railway UMID / ECHS verify APIs swap in by URL.</p>
            </FormCard>

            {/* Outcome / Handover */}
            <div className="md:col-span-2">
              <FormCard title="Outcome · Send to OPD">
                <div className={`rounded p-3 border text-sm ${
                  allGreenForOpd ? "bg-good-soft border-good/40 text-good"
                  : aadhaarCheck && verify ? "bg-bad-soft border-bad/40 text-bad"
                  : "bg-bone-100 border-bone-300 text-ink-300 italic"
                }`}>
                  {allGreenForOpd ? "✓ Cleared for OPD registration. Push to OPD desk."
                   : aadhaarCheck && verify ? "✗ Blocked. Resolve failed checks above."
                   : "Complete Step 1 & Step 2 to enable handover."}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={sendToOpd}
                    disabled={!allGreenForOpd || !!handoverPushed}
                    className="text-xs font-semibold px-3 py-2 bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
                  >📨 Send to OPD desk</button>
                  <a href="/opd" className={`text-xs ${allGreenForOpd ? "text-accent hover:underline" : "text-ink-300 pointer-events-none"}`}>
                    Open OPD Registration →
                  </a>
                </div>
                {handoverPushed && (
                  <div className="text-[10px] text-good italic mt-1">
                    ✓ Handover {handoverPushed} pushed. OPD page will show a notification banner.
                  </div>
                )}
              </FormCard>
            </div>
          </div>
        )}

        {mode === "post_doctor" && (
          <div className="grid md:grid-cols-2 gap-4">
            <FormCard title="Step A · Confirm scheme">
              <select value={scheme} onChange={(e) => setScheme(e.target.value as Scheme)} className={inputCls}>
                {(["PMJAY", "CGHS", "SHA", "Railway", "ECHS", "ESI"] as Scheme[]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <p className="text-[10px] text-ink-300 italic">Same scheme the patient was verified with at arrival.</p>
            </FormCard>

            <FormCard title="Step B · Package code from doctor's prescription">
              <div className="flex gap-2">
                <input
                  type="text" value={packageCode} onChange={(e) => { setPackageCode(e.target.value); setPkgResult(null); }}
                  placeholder="E.g. SC061A · OR042X · MO001F"
                  className={inputCls + " flex-1 font-mono uppercase"}
                />
                <button
                  onClick={runPackageCheck} disabled={pkgChecking || !packageCode.trim()}
                  className="text-xs font-semibold px-3 py-2 bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
                >{pkgChecking ? "…" : "Check"}</button>
              </div>
              <p className="text-[10px] text-ink-300 italic">Cross-checks against the package master — codes from PMJAY HBP, CGHS, SHA, Railway, ECHS, ESI.</p>

              {pkgResult && (
                <div className={`rounded p-3 border text-xs space-y-2 ${
                  pkgResult.status === "covered" ? "bg-good-soft border-good/40"
                  : "bg-bad-soft border-bad/40"
                }`}>
                  <div className={`font-bold ${pkgResult.status === "covered" ? "text-good" : "text-bad"}`}>
                    {pkgResult.status === "covered" ? "✓ Covered" :
                     pkgResult.status === "not_in_scheme" ? "✗ Not allowed under " + pkgResult.scheme :
                     "✗ Unknown package code"}
                  </div>
                  <div className="text-ink-200">{pkgResult.message}</div>
                  {pkgResult.package && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-bone-300 text-[11px]">
                      <Mini label="Code"      value={pkgResult.package.code} />
                      <Mini label="Procedure" value={pkgResult.package.name} />
                      <Mini label="Specialty" value={pkgResult.package.specialty} />
                      <Mini label="Cap"       value={"₹" + pkgResult.package.cap_inr.toLocaleString("en-IN")} />
                      <Mini label="LOS"       value={`${pkgResult.package.length_of_stay_days} day${pkgResult.package.length_of_stay_days === 1 ? "" : "s"}`} />
                      <Mini label="Available on" value={pkgResult.package.schemes.join(" · ")} />
                    </div>
                  )}
                </div>
              )}
            </FormCard>

            <div className="md:col-span-2">
              <FormCard title="Outcome">
                <div className={`rounded p-3 border text-sm ${
                  pkgResult?.status === "covered" ? "bg-good-soft border-good/40 text-good"
                  : pkgResult ? "bg-bad-soft border-bad/40 text-bad"
                  : "bg-bone-100 border-bone-300 text-ink-300 italic"
                }`}>
                  {pkgResult?.status === "covered" ? "✓ Package allowed. Proceed to admission and pre-auth."
                   : pkgResult ? "✗ Package blocked. Counsel patient — scheme switch or cash."
                   : "Enter the package code from the doctor's prescription."}
                </div>
              </FormCard>
            </div>
          </div>
        )}

        <p className="text-xs text-ink-300">
          Card-verify, package master and Aadhaar checks are local-mocked. Real UIDAI / NHA empanelment / PMJAY HBP feeds wire in without UI changes.
        </p>
      </div>
    </AppShell>
  );
}

const inputCls = "text-sm px-3 py-2 bg-bone-0 border border-bone-300 rounded focus:outline-none focus:border-accent";

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bone-0 border border-bone-300 rounded-lg p-4 space-y-3">
      <h2 className="text-sm font-bold text-ink-100">{title}</h2>
      {children}
    </div>
  );
}
function ResultPill({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={`text-xs rounded px-3 py-2 border ${ok ? "bg-good-soft border-good/40 text-good" : "bg-bad-soft border-bad/40 text-bad"}`}>
      <div className="font-bold">{ok ? "✓ " : "✗ "}{label}</div>
      <div className="text-[11px] opacity-80">{detail}</div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
      <div className="text-ink-100">{value}</div>
    </div>
  );
}
