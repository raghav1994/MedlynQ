import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listAllTenants } from "@/lib/tenant/admin";
import SignOutLink from "@/components/backendAdmin/SignOutLink";

export const dynamic = "force-dynamic";

export default async function BackendAdminHomePage() {
  const session = await getSession();
  if (session.user?.role !== "SUPERADMIN") redirect("/internal/login");

  const hospitals = await listAllTenants();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">MedLynq Internal</div>
          <h1 className="text-lg font-bold">Backend Admin</h1>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-3">
          {session.user.is_owner && (
            <>
              <Link href="/backend-admin/settings" className="text-slate-300 hover:text-white font-semibold">API Settings</Link>
              <Link href="/backend-admin/catalog" className="text-slate-300 hover:text-white font-semibold">Document Catalog</Link>
              <Link href="/backend-admin/icd10" className="text-slate-300 hover:text-white font-semibold">ICD-10 Codes</Link>
              <Link href="/backend-admin/staff" className="text-slate-300 hover:text-white font-semibold">Internal Staff</Link>
            </>
          )}
          <span>{session.user.name} · <SignOutLink /></span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-200">Hospitals ({hospitals.length})</h2>
          <Link
            href="/backend-admin/hospitals/new"
            className="text-xs font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
          >
            + Add hospital
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {hospitals.map((h) => (
            <Link
              key={h.hospital_id}
              href={`/backend-admin/hospitals/${h.hospital_id}`}
              className="block bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-600 transition"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-sm shrink-0"
                  style={{ backgroundColor: h.primary_color }}
                >
                  {h.logo_initial}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{h.name}</div>
                  <div className="text-xs text-slate-400 font-mono truncate">{h.hospital_id} · {h.subdomain}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(h.specialties_enabled ?? []).map((s) => (
                  <span key={s} className="text-[10px] uppercase font-semibold bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
                    {s}
                  </span>
                ))}
                {(h.specialties_enabled ?? []).length === 0 && (
                  <span className="text-[10px] text-slate-500 italic">no departments configured yet</span>
                )}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                {(h.document_profiles ?? []).length} config-driven document type{(h.document_profiles ?? []).length === 1 ? "" : "s"}
                {" · "}
                {(h.schemes_enabled ?? []).length} scheme{(h.schemes_enabled ?? []).length === 1 ? "" : "s"}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
