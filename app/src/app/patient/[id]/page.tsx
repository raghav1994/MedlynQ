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
import { patients, cases, loadDynamicData } from "@/lib/mockData";
import { docsForCase } from "@/lib/mockDocuments";
import { buildChecklist } from "@/lib/checklist";
import { stageOf } from "@/lib/types";
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
  loadDynamicData();
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
  const checklist = buildChecklist(docs, activeCase.treatment_type);
  const currentStage = stageOf(activeCase.status);
  // Try pipeline-extracted synopsis first; fall back to mock if empty.
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const baseUrl = `${proto}://${host}`;
  const pipeline = await fetchCaseSynopsisFromPipeline(p.mrn, baseUrl);
  const caseSyn = pipeline.case ?? caseSynopsisFor(activeCase.id);
  const synopsisSource = pipeline.source === "pipeline" ? "live" : (caseSyn ? "mock" : "none");
  const qpScore = scoreCase(activeCase, docs);

  return (
    <AppShell>
      <PatientHeader c={activeCase} patient_id={p.id} />

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
          <PatientIdentity p={p} hospital="Apollo Multispecialty Clinic" />
          <ClinicalVitals admission_date={activeCase.admission_date} />
          <ActionButtons />
          <WhatsAppShare
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
          />
          <QueryProofBadge score={qpScore} />
          <CaseTimeline c={activeCase} />
        </aside>

        <main className="space-y-4">
          {synopsisSource === "live" && (
            <div className="text-[10px] uppercase tracking-wide font-semibold text-good">● Synopsis from live pipeline</div>
          )}
          {caseSyn && <CaseSynopsis synopsis={caseSyn} />}
          <Tabs c={activeCase} docs={docs} checklist={checklist} currentStage={currentStage} />
        </main>
      </div>
    </AppShell>
  );
}
