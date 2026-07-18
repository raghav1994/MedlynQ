import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listUsersByRole } from "@/lib/auth/users";
import SignOutLink from "@/components/backendAdmin/SignOutLink";
import StaffManager from "@/components/backendAdmin/StaffManager";

export const dynamic = "force-dynamic";

export default async function InternalStaffPage() {
  const session = await getSession();
  if (session.user?.role !== "SUPERADMIN") redirect("/internal/login");
  // Being SUPERADMIN is enough to run every hospital's backend admin, but
  // only the owner account can see who else has that access, let alone
  // change it — same reasoning as requireOwner() on the API side.
  if (!session.user.is_owner) redirect("/backend-admin");

  const staff = await listUsersByRole("SUPERADMIN");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">MedLynq Internal</div>
          <h1 className="text-lg font-bold">Internal Staff</h1>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2">
          {session.user.name} · <SignOutLink />
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <Link href="/backend-admin" className="text-xs text-slate-400 hover:text-slate-200">← Hospitals</Link>
        <StaffManager staff={staff} currentUserId={session.user.id} />
      </main>
    </div>
  );
}
