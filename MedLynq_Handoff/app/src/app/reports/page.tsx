import AppShell from "@/components/AppShell";
import ComingSoon from "@/components/ComingSoon";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await getSession();
  if (!session.user) redirect("/login?next=/reports");
  if (session.user.role === "ADMIN") redirect("/patients");
  return (
    <AppShell>
      <ComingSoon
        title="Reports"
        subtitle="CFO financial intelligence — revenue at risk, query trend, approval gap, cash-flow forecast."
      />
    </AppShell>
  );
}
