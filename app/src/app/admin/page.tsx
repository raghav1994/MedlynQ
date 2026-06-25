import AppShell from "@/components/AppShell";
import ComingSoon from "@/components/ComingSoon";

export default function AdminPage() {
  return (
    <AppShell>
      <ComingSoon
        title="Admin · Integrations &amp; Mapping"
        subtitle="Connector health (HIS, NHCX FHIR, scheme portals), code mapping ICD ↔ HBP ↔ FHIR, system logs."
      />
    </AppShell>
  );
}
