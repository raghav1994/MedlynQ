"use client";

import { useEffect, useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import AddPatientModal from "@/components/AddPatientModal";
import { matchPatient } from "@/lib/patientMatch";
import { SPECIALTY_META } from "@/lib/types";
import type { Specialty, Treatment } from "@/lib/types";

// Tiny ICD-10 picker — real product loads the full master.
const ICD10: Array<{ code: string; label: string; specialty: Specialty }> = [
  { code: "C50.9", label: "Malignant neoplasm of breast, unspecified",  specialty: "oncology"  },
  { code: "C32.9", label: "Malignant neoplasm of larynx, unspecified",  specialty: "oncology"  },
  { code: "C61",   label: "Malignant neoplasm of prostate",             specialty: "oncology"  },
  { code: "I25.10", label: "Atherosclerotic heart disease",             specialty: "cardiac"   },
  { code: "I50.9",  label: "Heart failure, unspecified",                 specialty: "cardiac"   },
  { code: "M17.0", label: "Bilateral primary osteoarthritis of knee",   specialty: "ortho"     },
  { code: "S72.0", label: "Fracture of neck of femur",                  specialty: "ortho"     },
  { code: "N18.6", label: "End stage renal disease",                    specialty: "dialysis"  },
  { code: "J96.0", label: "Acute respiratory failure",                  specialty: "icu"       },
  { code: "O80",    label: "Single spontaneous delivery",                specialty: "maternity" },
];

type HandoverEntry = {
  id: string;
  pushed_at: string;
  scheme: string;
  card: string;
  aadhaar_last4?: string;
  beneficiary: { name: string; age: number; gender: "M" | "F"; state: string; district: string };
  wallet: { available_inr: number; cap_inr: number };
  status: "pending" | "consumed";
};

export default function OPDRegistrationPage() {
  const [phase, setPhase] = useState<"lookup" | "consult" | "review">("lookup");
  const [showAdd, setShowAdd] = useState(false);
  const [hasHis, setHasHis] = useState<"yes" | "no" | null>(null);

  // Lookup
  const [name, setName] = useState("");
  const [mrn, setMrn] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("M");
  const [state, setStateF] = useState("");
  const [scheme, setScheme] = useState("");
  const [wallet, setWallet] = useState<{ available: number; cap: number } | null>(null);

  // Consult
  const [specialty, setSpecialty] = useState<Specialty>("oncology");
  const [treatment, setTreatment] = useState<Treatment>("chemo");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [exam, setExam] = useState("");
  const [icd, setIcd] = useState("");
  const [doctor, setDoctor] = useState("");
  const [saved, setSaved] = useState<{ caseCode: string } | null>(null);

  // Handover queue polling
  const [queue, setQueue] = useState<HandoverEntry[]>([]);
  useEffect(() => {
    let stopped = false;
    const fetchQueue = async () => {
      try {
        const r = await fetch("/api/handover", { cache: "no-store" });
        const j = await r.json();
        if (!stopped && j.ok) setQueue(j.queue);
      } catch {}
    };
    fetchQueue();
    const id = setInterval(fetchQueue, 4000);
    return () => { stopped = true; clearInterval(id); };
  }, []);

  const loadFromHandover = async (h: HandoverEntry) => {
    setName(h.beneficiary.name);
    setAge(String(h.beneficiary.age));
    setGender(h.beneficiary.gender);
    setStateF(h.beneficiary.state);
    setScheme(h.scheme);
    setWallet({ available: h.wallet.available_inr, cap: h.wallet.cap_inr });
    setMrn(""); // hospital MRN assigned at OPD, not pulled from scheme
    await fetch(`/api/handover?id=${encodeURIComponent(h.id)}`, { method: "DELETE" });
    setQueue((q) => q.filter((x) => x.id !== h.id));
  };

  const matchResult = useMemo(() => matchPatient({ name, mrn, age, gender }), [name, mrn, age, gender]);
  const matched = matchResult.match;

  const filteredIcd = ICD10.filter((i) => i.specialty === specialty);

  const proceed = () => setPhase("consult");
  const review  = () => setPhase("review");
  const save    = () => {
    const caseCode = `OPD-${Date.now().toString().slice(-6)}`;
    setSaved({ caseCode });
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-100">OPD Registration · Doctor Consult</h1>
            <p className="text-sm text-ink-300 mt-1">
              Capture chief complaint, examination, ICD-10 diagnosis, and treatment plan. Output: a case the rest of MedLynq tracks.
            </p>
          </div>
          <PhasePill phase={phase} />
        </div>

        {/* Handover notification banner */}
        {queue.length > 0 && phase === "lookup" && (
          <div className="bg-accent-soft border border-accent/40 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-accent text-white grid place-items-center text-xs">📨</span>
              <div>
                <div className="text-sm font-bold text-ink-100">
                  {queue.length} verified patient{queue.length === 1 ? "" : "s"} pending registration
                </div>
                <div className="text-[10px] text-ink-300">Backend Panel verified the card · click to load into the form below</div>
              </div>
            </div>
            <ul className="space-y-1">
              {queue.map((h) => (
                <li key={h.id} className="bg-bone-0 border border-bone-300 rounded p-2 text-xs flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-ink-100">{h.beneficiary.name}</div>
                    <div className="text-[10px] text-ink-300">
                      {h.scheme} · {h.beneficiary.gender === "M" ? "M" : "F"} · {h.beneficiary.age}y · {h.beneficiary.district}, {h.beneficiary.state} · wallet ₹{h.wallet.available_inr.toLocaleString("en-IN")}
                    </div>
                  </div>
                  <button onClick={() => loadFromHandover(h)} className="text-xs font-semibold px-3 py-1 bg-accent text-white rounded hover:opacity-90">
                    Load into form →
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase === "lookup" && (
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-bold text-ink-100">Step 1 · Patient lookup</h2>
            <div className="grid md:grid-cols-2 gap-3">
              <Input label="Name" value={name} onChange={setName} placeholder="Full name" />
              <Input label="Assign MRN / Hospital ID" value={mrn} onChange={setMrn} placeholder="e.g. MRN12345" mono />
              <Input label="Age" value={age} onChange={setAge} placeholder="42" />
              <div>
                <Label>Gender</Label>
                <select value={gender} onChange={(e) => setGender(e.target.value)} className={selectCls}>
                  <option value="M">Male</option><option value="F">Female</option>
                </select>
              </div>
              <Input label="State" value={state} onChange={setStateF} placeholder="Karnataka" />
              <Input label="Scheme" value={scheme} onChange={setScheme} placeholder="PMJAY" mono />
            </div>

            {wallet && (
              <div className="bg-good-soft border border-good/40 rounded p-2 text-xs">
                <span className="font-bold text-good">✓ Wallet</span> available <strong>₹{wallet.available.toLocaleString("en-IN")}</strong> of ₹{wallet.cap.toLocaleString("en-IN")} cap
              </div>
            )}

            <div className={`rounded p-3 border text-sm ${
              matched ? "bg-good-soft border-good/40" : (name || mrn) ? "bg-warn-soft border-warn/40" : "bg-bone-100 border-bone-300 text-ink-300 italic"
            }`}>
              {matched ? (
                <>
                  <div className="font-bold text-good">✓ Matched existing patient</div>
                  <div className="text-ink-100">{matched.name} · MRN {matched.mrn} · age {matched.age}</div>
                </>
              ) : (name || mrn) ? (
                <>
                  <div className="font-bold text-warn">No existing patient — register new</div>
                  <button onClick={() => setShowAdd(true)} className="mt-2 text-xs font-semibold px-3 py-1.5 bg-accent text-white rounded">
                    + Register patient
                  </button>
                </>
              ) : "Type to search or load from the handover banner above."}
            </div>

            <div className="flex justify-end">
              <button
                onClick={proceed}
                disabled={!matched && !name && !mrn}
                className="text-xs font-semibold px-4 py-2 bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
              >Proceed to consult →</button>
            </div>
          </div>
        )}

        {phase === "consult" && (
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-bold text-ink-100">Step 2 · Doctor consult capture</h2>

            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <Label>Specialty</Label>
                <select value={specialty} onChange={(e) => {
                  const sp = e.target.value as Specialty;
                  setSpecialty(sp);
                  setTreatment(SPECIALTY_META[sp].treatments[0]);
                  setIcd("");
                }} className={selectCls}>
                  {(Object.keys(SPECIALTY_META) as Specialty[]).map((s) => (
                    <option key={s} value={s}>{SPECIALTY_META[s].icon} {SPECIALTY_META[s].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Treatment plan</Label>
                <select value={treatment} onChange={(e) => setTreatment(e.target.value as Treatment)} className={selectCls}>
                  {SPECIALTY_META[specialty].treatments.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <Input label="Consulting doctor" value={doctor} onChange={setDoctor} placeholder="Dr. ..." />
            </div>

            <div>
              <Label>Chief complaint</Label>
              <textarea value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)}
                placeholder="E.g. Lump in left breast, ongoing 3 months."
                rows={2} className={textAreaCls} />
            </div>
            <div>
              <Label>Examination findings</Label>
              <textarea value={exam} onChange={(e) => setExam(e.target.value)}
                placeholder="E.g. 3cm firm mass UOQ left breast, mobile, no axillary nodes."
                rows={2} className={textAreaCls} />
            </div>

            <div>
              <Label>ICD-10 (filtered to {SPECIALTY_META[specialty].label})</Label>
              <select value={icd} onChange={(e) => setIcd(e.target.value)} className={selectCls}>
                <option value="">— select —</option>
                {filteredIcd.map((i) => <option key={i.code} value={i.code}>{i.code} · {i.label}</option>)}
              </select>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setPhase("lookup")} className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">
                ← Back
              </button>
              <button onClick={review} disabled={!chiefComplaint || !icd}
                className="text-xs font-semibold px-4 py-2 bg-accent text-white rounded hover:opacity-90 disabled:opacity-40">
                Review & create case →
              </button>
            </div>
          </div>
        )}

        {phase === "review" && (
          <div className="bg-bone-0 border border-bone-300 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-bold text-ink-100">Step 3 · Review & create case</h2>

            {/* HIS decision */}
            {!saved && (
              <div className="bg-bone-100 border border-bone-300 rounded p-3 space-y-2">
                <div className="text-xs font-bold text-ink-100">Does this hospital use an HIS today?</div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setHasHis("yes")} className={`text-xs font-semibold px-3 py-1.5 rounded border ${
                    hasHis === "yes" ? "bg-accent text-white border-accent" : "bg-bone-0 text-ink-200 border-bone-300"
                  }`}>Yes · I&apos;ll copy into HIS manually</button>
                  <button onClick={() => setHasHis("no")} className={`text-xs font-semibold px-3 py-1.5 rounded border ${
                    hasHis === "no" ? "bg-accent text-white border-accent" : "bg-bone-0 text-ink-200 border-bone-300"
                  }`}>No · MedLynq is my system of record</button>
                </div>
                <div className="text-[10px] text-ink-300 italic">
                  When the hospital HIS API is granted, the &quot;Connect to HIS&quot; option auto-pushes this patient into the HIS portal.
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <Cell label="Patient" value={matched ? matched.name : name} />
              <Cell label="MRN"     value={matched ? matched.mrn  : mrn || "—"} />
              <Cell label="Age · Gender" value={`${age || "—"} · ${gender === "M" ? "Male" : "Female"}`} />
              <Cell label="Scheme" value={scheme || "—"} />
              <Cell label="Specialty + treatment" value={`${SPECIALTY_META[specialty].label} · ${treatment}`} />
              <Cell label="ICD-10" value={icd} />
              <Cell label="Doctor" value={doctor || "—"} />
              <Cell label="Chief complaint" value={chiefComplaint} multi />
              <Cell label="Examination" value={exam} multi />
              {wallet && <Cell label="Wallet" value={`₹${wallet.available.toLocaleString("en-IN")} of ₹${wallet.cap.toLocaleString("en-IN")}`} multi />}
            </div>

            {!saved ? (
              <div className="flex justify-between">
                <button onClick={() => setPhase("consult")} className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200">← Back</button>
                <button onClick={save} disabled={!hasHis}
                  className="text-xs font-semibold px-4 py-2 bg-accent text-white rounded hover:opacity-90 disabled:opacity-40">
                  ✓ Create case
                </button>
              </div>
            ) : (
              <div className={`rounded p-3 border space-y-3 ${hasHis === "yes" ? "bg-warn-soft border-warn/40" : "bg-good-soft border-good/40"}`}>
                <div className={`font-bold ${hasHis === "yes" ? "text-warn" : "text-good"}`}>
                  ✓ Case {saved.caseCode} created
                </div>

                {hasHis === "yes" ? (
                  <div className="space-y-2 text-sm">
                    <div className="text-ink-200">
                      <strong>Hospital HIS detected.</strong> Copy these fields into your HIS portal manually,
                      then come back to confirm.
                    </div>
                    <div className="bg-bone-0 border border-bone-300 rounded p-3 grid md:grid-cols-2 gap-2 text-xs">
                      <CopyRow label="Name" value={name} />
                      <CopyRow label="MRN" value={mrn} />
                      <CopyRow label="Age" value={age} />
                      <CopyRow label="Gender" value={gender} />
                      <CopyRow label="State" value={state} />
                      <CopyRow label="Scheme" value={scheme} />
                      <CopyRow label="ICD-10" value={icd} />
                      <CopyRow label="Doctor" value={doctor} />
                    </div>
                    <div className="flex items-center gap-2">
                      <button disabled className="text-xs font-semibold px-3 py-1.5 bg-ink-300 text-white rounded opacity-60">
                        🔌 Connect to HIS API (soon)
                      </button>
                      <a href="/patients" className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200 bg-bone-0">
                        Add to MedLynq Patient List
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="text-ink-200">
                      MedLynq is the system of record. The patient is in the Patient List and ready to receive documents.
                    </div>
                    <div className="flex items-center gap-2">
                      <a href="/intake" className="text-xs font-semibold px-3 py-1.5 bg-accent text-white rounded">
                        Upload documents →
                      </a>
                      <a href="/patients" className="text-xs px-3 py-1.5 border border-bone-300 rounded hover:bg-bone-200 bg-bone-0">
                        Open patient list
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <AddPatientModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        prefill={{ name, mrn, age, gender }}
        matchResult={matchResult}
        onSaved={(s) => { setName(s.name); setMrn(s.mrn); }}
      />
    </AppShell>
  );
}

const selectCls   = "w-full text-sm px-3 py-2 bg-bone-0 border border-bone-300 rounded focus:outline-none focus:border-accent";
const textAreaCls = "w-full text-sm px-3 py-2 bg-bone-0 border border-bone-300 rounded focus:outline-none focus:border-accent resize-none";

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wide text-ink-300 font-semibold mb-1">{children}</div>;
}
function Input({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={`${selectCls} ${mono ? "font-mono" : ""}`} />
    </div>
  );
}
function Cell({ label, value, multi }: { label: string; value: string; multi?: boolean }) {
  return (
    <div className={multi ? "md:col-span-2" : ""}>
      <Label>{label}</Label>
      <div className="text-ink-100">{value || "—"}</div>
    </div>
  );
}
function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-bone-200 last:border-0">
      <div>
        <div className="text-[9px] uppercase tracking-wide text-ink-300 font-semibold">{label}</div>
        <div className="text-ink-100 font-mono">{value || "—"}</div>
      </div>
      <button
        onClick={() => navigator.clipboard.writeText(value || "")}
        className="text-[10px] px-2 py-0.5 border border-bone-300 rounded hover:bg-bone-200 shrink-0"
      >Copy</button>
    </div>
  );
}
function PhasePill({ phase }: { phase: "lookup" | "consult" | "review" }) {
  const stages: Array<{ key: typeof phase; label: string }> = [
    { key: "lookup", label: "Lookup" },
    { key: "consult", label: "Consult" },
    { key: "review", label: "Review" },
  ];
  return (
    <div className="flex items-center gap-1">
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
            s.key === phase ? "bg-accent text-white border-accent" : "bg-bone-0 text-ink-300 border-bone-300"
          }`}>{i + 1}. {s.label}</span>
          {i < stages.length - 1 && <span className="text-ink-300">→</span>}
        </div>
      ))}
    </div>
  );
}
