import AppShell from "@/components/AppShell";
import ComingSoon from "@/components/ComingSoon";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await getSession();
  if (!session.user) redirect("/login?next=/audit");
  if (session.user.role === "ADMIN") redirect("/patients");
  return (
    <AppShell>
      <ComingSoon
        title="Audit Trail"
        subtitle="Chronological FHIR AuditEvent log per case — every upload, AI step, query, response."
      />
    </AppShell>
  );
}
