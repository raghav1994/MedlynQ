import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listCatalog } from "@/lib/catalog";
import SignOutLink from "@/components/backendAdmin/SignOutLink";
import CatalogManager from "@/components/backendAdmin/CatalogManager";

export const dynamic = "force-dynamic";

export default async function DocumentCatalogPage() {
  const session = await getSession();
  if (session.user?.role !== "SUPERADMIN") redirect("/internal/login");
  // Editing the master catalog is owner-only — same lock as Internal Staff.
  // Regular internal staff still USE the catalog (via the hospital doc
  // picker), they just can't change the master definitions here.
  if (!session.user.is_owner) redirect("/backend-admin");

  const catalog = await listCatalog();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">MedLynq Internal</div>
          <h1 className="text-lg font-bold">Document Catalog</h1>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2">
          {session.user.name} · <SignOutLink />
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <Link href="/backend-admin" className="text-xs text-slate-400 hover:text-slate-200">← Hospitals</Link>
        <CatalogManager catalog={catalog} />
      </main>
    </div>
  );
}
