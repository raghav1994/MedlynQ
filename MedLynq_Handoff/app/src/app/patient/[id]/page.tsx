import AppShell from "@/components/AppShell";
import ComingSoon from "@/components/ComingSoon";
import PatientHeader from "@/components/patient/PatientHeader";
import PatientIdentity from "@/components/patient/PatientIdentity";
import ClinicalVitals from "@/components/patient/ClinicalVitals";
import CaseTimeline from "@/components/patient/CaseTimeline";
import ActionButtons from "@/components/patient/ActionButtons";
import Tabs from "@/components/patient/Tabs";
import CaseSynopsis from "@/components/patient/CaseSynopsis";
import QueryProofBadge from "@/components/patient/QueryProofBadge";
import WhatsAppShare from "@/components/WhatsAppShare";
import AuditPill from "@/components/patient/AuditPill";
import ApprovalBanner from "@/components/patient/ApprovalBanner";
import CaseStateBanner from "@/components/patient/CaseStateBanner";
import DoctorsPlanCard from "@/components/patient/DoctorsPlan";
import NHCXBridge from "@/components/patient/NHCXBridge";
import IfFeature from "@/components/IfFeature";
import { getTenant } from "@/lib/tenant/server";
import { decodePrescription } from "@/lib/prescription";
import { scopedData } from "@/lib/dataScope";
import { docsForCase } from "@/lib/mockDocuments";
import { buildChecklist, summaryByStage, deriveCurrentStage } from "@/lib/checklist";
import { getSkippedDocTypes } from "@/lib/checklistSkips";
import { caseSynopsisFor, fetchCaseSynopsisFromPipeline } from "@/lib/synopsis";
import { scoreCase } from "@/lib/queryProof";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { case?: string };
}) {
  const tenant = await getTenant();
  const { patients, cases } = await scopedData();
  const p = patients.find((x) => x.id === params.id);
  if (!p) {
    return (
      <AppShell>
        <ComingSoon title="Patient not found" subtitle={`No patient with id ${params.id}.`} />
      </AppShell>
    );
  }

  const pcases = cases.filter((c) => c.patient_id === p.id);
  const activeCase = (searchParams.case && pcases.find((c) => c.id === searchParams.case)) || pcases[0];
  if (!activeCase) {
    return (
      <AppShell>
        <ComingSoon title="No cases for this patient" subtitle="Open one from the patient list once a case is created." />
      </AppShell>
    );
  }

  const docs = docsForCase(activeCase.id);
  const skippedDocTypes = await getSkippedDocTypes(activeCase.id);
  const checklist = buildChecklist(docs, activeCase.treatment_type, activeCase.specialty ?? "oncology", skippedDocTypes);
  // Derived from actual doc completion (not the raw ClaimStatus) so the
  // stage tracker auto-advances the moment a stage's checklist is done.
  const currentStage = deriveCurrentStage(summaryByStage(checklist));
  // Try pipeline-extracted synopsis first; fall back to mock if empty.
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const baseUrl = `${proto}://${host}`;
  const pipeline = await fetchCaseSynopsisFromPipeline(p.mrn, baseUrl);
  const caseSyn = pipeline.case ?? caseSynopsisFor(activeCase.id);
  const synopsisSource = pipeline.source === "pipeline" ? "live" : (caseSyn ? "mock" : "none");
  const qpScore = scoreCase(activeCase, docs);

  // Real vitals only — from a landed "Clinical Vitals Log" doc's extracted
  // fields (md_parser.py's _parse_vitals). No such doc yet → ClinicalVitals
  // renders "—" for each value instead of a placeholder.
  const vitalsDoc = docs.find((d) => d.doc_type.toLowerCase() === "clinical vitals log" && d.fields);
  const vitals = vitalsDoc?.fields as { temperature_f?: string; pulse_bpm?: number; height_cm?: number; weight_kg?: number } | undefined;

  // K2 — decode the doctor's prescription if any prescription text exists.
  // Today we use a per-case demo text; in production this comes from Sarvam OCR
  // output for the prescription doc.
  const DEMO_RX_BY_CASE: Record<string, string> = {
    "APR-2026-0301":
      "Diagnosis: Ca breast left, HER2+. Plan: package MO001F · " +
      "Trastuzumab 440mg q3w x4 cycles, Paclitaxel 175mg/m² weekly x12. " +
      "Premedication Dexamethasone 8mg BD, Ondansetron 8mg TDS. " +
      "Procedure: Modified radical mastectomy planned post-chemo.",
    "APR-2026-0290":
      "Diagnosis: Ca breast left. Plan: package SG075B · " +
      "Modified radical mastectomy + axillary clearance. " +
      "Premedication Cefoperazone 1gm BD, Pantoprazole 40mg OD.",
    "2026051410041450":
      "Plan: package SC068B · Chemo cycle 2 of 6 · " +
      "Docetaxel 75mg/m² q3w, Doxorubicin 60mg/m² q3w, " +
      "Cyclophosphamide 600mg/m² q3w. Premedication Dexamethasone 8mg HS.",
  };
  const rxText = DEMO_RX_BY_CASE[activeCase.id];
  const doctorsPlan = rxText ? await decodePrescription(rxText) : null;

  return (
    <AppShell>
      <CaseStateBanner c={activeCase} />
      <ApprovalBanner c={activeCase} patientName={p.name} />
      <PatientHeader c={activeCase} patient_id={p.id} stage={currentStage} />

      {pcases.length > 1 && (
        <div className="-mt-2 mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-xs uppercase tracking-wide text-ink-300 font-semibold">Cases:</span>
          {pcases.map((c) => (
            <a
              key={c.id}
              href={`/patient/${p.id}?case=${c.id}`}
              className={`text-xs px-2 py-1 rounded border ${
                c.id === activeCase.id ? "bg-ink-100 text-white border-ink-100" : "bg-bone-0 text-ink-200 border-bone-300 hover:bg-bone-200"
              }`}
            >
              {c.registration_id}
            </a>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <aside className="space-y-4">
          <PatientIdentity p={p} hospital={tenant.name} />
          <ClinicalVitals admission_date={activeCase.admission_date} vitals={vitals} />
          <ActionButtons />
          {/* @ts-expect-error Async Server Component */}
          <IfFeature flag="whatsapp"><WhatsAppShare
            caseCode={activeCase.registration_id}
            kind={
              activeCase.status === "query" ? "query_received" :
              activeCase.status === "discharged" ? "discharge_done" :
              activeCase.status === "submitted" ? "claim_submitted" :
              activeCase.status === "preauth_pending" ? "preauth_submitted" :
              "docs_uploaded"
            }
            detail={`Specialty: ${activeCase.treatment_type}`}
            deepLink={`${baseUrl}/patient/${p.id}?case=${activeCase.id}`}
          /></IfFeature>
          <QueryProofBadge score={qpScore} />
          <AuditPill mrn={p.mrn} />
          <CaseTimeline c={activeCase} />
        </aside>

        <main className="space-y-4">
          {synopsisSource === "live" && (
            <div className="text-[10px] uppercase tracking-wide font-semibold text-good">● Synopsis from live pipeline</div>
          )}
          {doctorsPlan && (
            <DoctorsPlanCard plan={doctorsPlan} schemeForCheck={activeCase.scheme} billTotal={activeCase.claimed_amount} />
          )}
          {caseSyn && <CaseSynopsis synopsis={caseSyn} />}
          {/* @ts-expect-error Async Server Component */}
          <IfFeature flag="nhcx_send"><NHCXBridge c={activeCase} /></IfFeature>
          <Tabs c={activeCase} docs={docs} checklist={checklist} mrn={p.mrn} />
        </main>
      </div>
    </AppShell>
  );
}
