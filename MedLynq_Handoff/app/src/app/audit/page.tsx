import AppShell from "@/components/AppShell";
import ComingSoon from "@/components/ComingSoon";

export default function AuditPage() {
  return (
    <AppShell>
      <ComingSoon
        title="Audit Trail"
        subtitle="Chronological FHIR AuditEvent log per case — every upload, AI step, query, response."
      />
    </AppShell>
  );
}
