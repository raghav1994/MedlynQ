import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { readApiSettings, maskForDisplay } from "@/lib/apiSettings";
import SignOutLink from "@/components/backendAdmin/SignOutLink";
import ApiSettingsManager from "@/components/backendAdmin/ApiSettingsManager";

export const dynamic = "force-dynamic";

export default async function ApiSettingsPage() {
  const session = await getSession();
  if (session.user?.role !== "SUPERADMIN") redirect("/internal/login");
  // Same lock as the Document Catalog and Internal Staff — these are live
  // API credentials, owner-only.
  if (!session.user.is_owner) redirect("/backend-admin");

  const settings = maskForDisplay(await readApiSettings());

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">MedLynq Internal</div>
          <h1 className="text-lg font-bold">API Settings</h1>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2">
          {session.user.name} · <SignOutLink />
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <Link href="/backend-admin" className="text-xs text-slate-400 hover:text-slate-200">← Hospitals</Link>
        <ApiSettingsManager settings={settings} />
      </main>
    </div>
  );
}
