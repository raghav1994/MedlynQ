import AppShell from "@/components/AppShell";
import ComingSoon from "@/components/ComingSoon";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function QueriesPage() {
  const session = await getSession();
  if (!session.user) redirect("/login?next=/queries");
  if (session.user.role === "ADMIN") redirect("/patients");
  return (
    <AppShell>
      <ComingSoon
        title="Active Queries"
        subtitle="Insurer query inbox with the 5-step Packet Builder workflow. Coming next sprint."
      />
    </AppShell>
  );
}
