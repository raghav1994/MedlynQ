import Link from "next/link";
import { cases } from "@/lib/mockData";
import { openPostOpHPEQueries, openQueriesWithDeadline } from "@/lib/mockQueries";
import { approvalCasesFromList } from "@/lib/approval";

type Nudge = {
  id: string;
  title: string;
  body: string;
  cta: string;
  href: string;
  tone: "warn" | "accent" | "bad" | "good";
};

function generateNudges(): Nudge[] {
  const out: Nudge[] = [];

  // 0. HIGHEST: Approval validity expiring soon (Ayushman / FCI)
  const { received: receivedApprovals, awaiting: awaitingApprovals } = approvalCasesFromList(cases);
  const expiringSoon = receivedApprovals.filter((r) => {
    const remainingHours = r.state.expectedHours - r.state.hoursElapsed;
    return remainingHours < 24 * 4; // less than 4 days left
  });
  if (expiringSoon.length > 0) {
    const worst = expiringSoon[0];
    const remainingDays = Math.round((worst.state.expectedHours - worst.state.hoursElapsed) / 24);
    out.push({
      id: "n_approval_expiring",
      title: `${expiringSoon.length} approval${expiringSoon.length === 1 ? "" : "s"} expiring · oldest ${Math.max(0, remainingDays)}d left`,
      body: `Call the patient${expiringSoon.length === 1 ? "" : "s"} and get them admitted before the scheme cancels the approval. Re-applying takes another 24 hrs.`,
      cta: "Open approved-pending queue",
      href: "/patients?filter=approval_received",
      tone: remainingDays <= 1 ? "bad" : "warn",
    });
  }

  // 0b. Approval SLA overdue (awaiting > expected hours)
  const overdueAwaiting = awaitingApprovals.filter((a) => a.state.hoursElapsed > a.state.expectedHours);
  if (overdueAwaiting.length > 0) {
    out.push({
      id: "n_approval_overdue",
      title: `${overdueAwaiting.length} approval${overdueAwaiting.length === 1 ? "" : "s"} past SLA`,
      body: `Ayushman / FCI haven't responded in time. Escalate via the scheme helpdesk or follow up by phone.`,
      cta: "Open awaiting queue",
      href: "/patients?filter=awaiting_approval",
      tone: "bad",
    });
  }

  // Highest-priority: post-op HPE queries approaching their 15-day deadline
  const postopQ = openPostOpHPEQueries();
  if (postopQ.length > 0) {
    const worst = postopQ[0]; // already sorted oldest-first
    const total = worst.deadline_days_total ?? 15;
    const since = worst.days_since_raised ?? 0;
    const remaining = total - since;
    const overdue = remaining < 0;
    out.push({
      id: "n_postop_hpe",
      title: overdue
        ? `${postopQ.length} post-op HPE quer${postopQ.length === 1 ? "y is" : "ies are"} overdue`
        : `${postopQ.length} post-op HPE quer${postopQ.length === 1 ? "y" : "ies"} pending · oldest ${remaining}d left`,
      body:
        `Post-op histopathology typically takes 7–10 days. ` +
        (overdue
          ? `Submit with cover note explaining lab delay, OR escalate to lab for fast-track.`
          : `Call the pathology lab now to confirm release date and avoid the 15-day red zone.`),
      cta: "Open post-op HPE queue",
      href: "/patients?filter=postop_hpe",
      tone: overdue ? "bad" : remaining <= 3 ? "bad" : "warn",
    });
  }

  // Other open queries with deadlines (non post-op HPE)
  const otherDeadlineQ = openQueriesWithDeadline().filter((q) => q.query_type !== "post_op_hpe");
  if (otherDeadlineQ.length > 0) {
    const worst = otherDeadlineQ[0];
    const since = worst.days_since_raised ?? 0;
    out.push({
      id: "n_aging_q",
      title: `${otherDeadlineQ.length} quer${otherDeadlineQ.length === 1 ? "y" : "ies"} aging past ${since} days`,
      body:
        `Reply now to stay under the 15-day deadline. Lynq has pre-attached the most likely docs in the Packet Builder.`,
      cta: "Open work queue",
      href: "/patients?filter=query",
      tone: since >= 10 ? "bad" : "warn",
    });
  }

  // Pattern: cross-claim missing-doc cluster (chemo charts etc.)
  const queriesMissing = cases.filter((c) => c.status === "query" && c.missing_docs > 0);
  if (queriesMissing.length >= 2) {
    out.push({
      id: "n_missing_cluster",
      title: "Pre-attach chemo charts on incoming claims",
      body:
        `${queriesMissing.length} oncology cases have queries for missing chemo/pouch docs. ` +
        `Pre-attaching them to incoming pre-auths could prevent the same query.`,
      cta: "Show pre-auths",
      href: "/patients?filter=preauth",
      tone: "accent",
    });
  }

  // Pre-auths to draft
  const preauths = cases.filter((c) => c.status === "preauth_pending");
  if (preauths.length > 0 && out.length < 3) {
    out.push({
      id: "n_preauth",
      title: `${preauths.length} pre-auth${preauths.length === 1 ? "" : "s"} ready to draft`,
      body: "Lynq can auto-fill cost estimate + procedure codes from your scheme master.",
      cta: "Draft pre-auths",
      href: "/patients?filter=preauth",
      tone: "warn",
    });
  }

  return out.slice(0, 3);
}

export default function LynqNudges() {
  const nudges = generateNudges();
  if (nudges.length === 0) return null;

  return (
    <div className="bg-accent-soft border border-accent/30 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded-full bg-accent text-white grid place-items-center text-xs font-bold">L</span>
        <h3 className="text-sm font-bold text-ink-100">Lynq suggests</h3>
        <span className="text-[10px] text-ink-300">rule-based · {nudges.length} insight{nudges.length === 1 ? "" : "s"}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {nudges.map((n) => (
          <Card key={n.id} n={n} />
        ))}
      </div>
    </div>
  );
}

function Card({ n }: { n: Nudge }) {
  const accent =
    n.tone === "bad" ? "border-bad/40 bg-bad-soft" :
    n.tone === "warn" ? "border-warn/40 bg-warn-soft" :
    n.tone === "good" ? "border-good/40 bg-good-soft" :
    "border-accent/40 bg-bone-0";
  return (
    <div className={`border rounded-md p-3 flex flex-col ${accent}`}>
      <div className="text-sm font-bold text-ink-100">{n.title}</div>
      <div className="text-xs text-ink-300 mt-1 flex-1">{n.body}</div>
      <Link
        href={n.href}
        className="mt-2 text-xs font-semibold text-accent hover:underline self-start"
      >
        {n.cta} →
      </Link>
    </div>
  );
}
