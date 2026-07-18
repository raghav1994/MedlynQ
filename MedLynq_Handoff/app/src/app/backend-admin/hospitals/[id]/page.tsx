import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listAllTenants } from "@/lib/tenant/admin";
import { listUsersForHospital } from "@/lib/auth/users";
import { readAdminAudit } from "@/lib/auth/adminAudit";
import { ALL_SCHEMES } from "@/lib/types";
import HospitalEditor from "@/components/backendAdmin/HospitalEditor";

export const dynamic = "force-dynamic";

export default async function HospitalDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (session.user?.role !== "SUPERADMIN") redirect("/internal/login");

  const all = await listAllTenants();
  const hospital = all.find((h) => h.hospital_id === params.id);
  if (!hospital) notFound();

  const users = await listUsersForHospital(params.id);
  const audit = await readAdminAudit(params.id);
  const isOwner = !!session.user.is_owner;
  // his_webhook_secret is a credential — never ship the plaintext value to a
  // non-owner staff member's browser, same bar as every other secret here.
  const hospitalForClient = isOwner
    ? hospital
    : { ...hospital, his_webhook_secret: hospital.his_webhook_secret ? "••••••••" : undefined };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link href="/backend-admin" className="text-xs text-slate-400 hover:text-slate-200">← Hospitals</Link>
        <div className="flex items-center gap-3 mt-1">
          <div
            className="w-8 h-8 rounded-full grid place-items-center text-white font-bold text-sm"
            style={{ backgroundColor: hospital.primary_color }}
          >
            {hospital.logo_initial}
          </div>
          <h1 className="text-lg font-bold">{hospital.name}</h1>
          <span className="text-xs text-slate-500 font-mono">{hospital.hospital_id}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        <HospitalEditor hospital={hospitalForClient} users={users} audit={audit} allSchemes={ALL_SCHEMES} isOwner={isOwner} />
      </main>
    </div>
  );
}
