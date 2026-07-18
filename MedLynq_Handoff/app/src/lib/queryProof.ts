// Query-proof score: 0-100% that a case will survive a payer query.
// Runs heuristics across docs + case state. UI uses this to gate "Submit".

import type { Case } from "./types";
import type { CaseDocument } from "./mockDocuments";
import { buildChecklist, type ChecklistRule } from "./checklist";
import { caseSynopsisFor, synopsisFor } from "./synopsis";
import { queriesForCase } from "./mockQueries";

export type QueryProofIssue = {
  id: string;
  severity: "bad" | "warn" | "info";
  message: string;
  fix?: string;
};

export type QueryProofScore = {
  pct: number;
  tone: "good" | "warn" | "bad";
  label: string;
  issues: QueryProofIssue[];
};

const TOTAL_CHECKS = 6;

export function scoreCase(c: Case, docs: CaseDocument[], extraRules: ChecklistRule[] = [], scheme?: string): QueryProofScore {
  const issues: QueryProofIssue[] = [];
  let passed = 0;

  // 1. All required docs present (stage + treatment aware)
  const checklist = buildChecklist(docs, c.treatment_type, c.specialty ?? "oncology", [], extraRules, scheme ?? c.scheme);
  const missingRequired = checklist.filter((r) => r.status === "missing");
  if (missingRequired.length === 0) {
    passed++;
  } else {
    issues.push({
      id: "missing_required",
      severity: "bad",
      message: `${missingRequired.length} required doc${missingRequired.length === 1 ? "" : "s"} missing`,
      fix: `Upload: ${missingRequired.map((r) => r.doc_type).slice(0, 3).join(", ")}`,
    });
  }

  // 2. No open queries
  const openQ = queriesForCase(c.id).filter((q) => q.status === "open");
  if (openQ.length === 0) {
    passed++;
  } else {
    const worst = openQ[0];
    const remaining = (worst.deadline_days_total ?? 15) - (worst.days_since_raised ?? 0);
    issues.push({
      id: "open_queries",
      severity: remaining <= 3 ? "bad" : "warn",
      message: `${openQ.length} open quer${openQ.length === 1 ? "y" : "ies"}`,
      fix: remaining <= 3 ? `Respond within ${remaining}d to avoid rejection` : `Respond to clear claim`,
    });
  }

  // 3. Amount alignment (bill total within scheme cap)
  const billSyn = docs.map((d) => synopsisFor(d.filename)).find((s) => s?.doc_type === "bill");
  if (billSyn) {
    const total = Number(billSyn.fields.total_amount ?? 0);
    const cap = Number(billSyn.fields.scheme_cap ?? 0);
    if (cap > 0 && total > cap) {
      issues.push({
        id: "over_cap",
        severity: "bad",
        message: `Bill ₹${total.toLocaleString("en-IN")} exceeds scheme cap ₹${cap.toLocaleString("en-IN")}`,
        fix: "Split into supplementary claim or revise line items",
      });
    } else {
      passed++;
    }
  } else if (c.status === "discharged" || c.status === "submitted") {
    issues.push({
      id: "no_bill",
      severity: "warn",
      message: "Bill not yet extracted",
      fix: "Upload + extract final bill before submission",
    });
  } else {
    passed++; // not yet expected at this stage
  }

  // 4. Date consistency: discharge_date >= admission_date
  const dsSyn = docs.map((d) => synopsisFor(d.filename)).find((s) => s?.doc_type === "discharge_summary");
  if (dsSyn) {
    const adm = String(dsSyn.fields.admission_date ?? "");
    const dis = String(dsSyn.fields.discharge_date ?? "");
    if (adm && dis && new Date(dis) < new Date(adm)) {
      issues.push({
        id: "date_inversion",
        severity: "bad",
        message: "Discharge date earlier than admission date",
        fix: "Verify discharge summary",
      });
    } else {
      passed++;
    }
  } else {
    passed++;
  }

  // 5. Case synopsis present (means OCR pipeline ran successfully)
  if (caseSynopsisFor(c.id)) {
    passed++;
  } else {
    issues.push({
      id: "no_synopsis",
      severity: "info",
      message: "Synopsis not generated yet",
      fix: "Run extraction pipeline on case docs",
    });
  }

  // 6. Stage check — submitted/discharged cases should have complete discharge bundle
  if (["preauth_pending", "pending", "submitted"].includes(c.status)) {
    passed++;
  } else if (docs.length >= 4) {
    passed++;
  } else {
    issues.push({
      id: "thin_bundle",
      severity: "warn",
      message: `Only ${docs.length} docs on a ${c.status} case`,
      fix: "Verify all clinical evidence uploaded",
    });
  }

  const pct = Math.round((passed / TOTAL_CHECKS) * 100);
  const tone: QueryProofScore["tone"] = pct >= 90 ? "good" : pct >= 70 ? "warn" : "bad";
  const label =
    pct >= 90 ? "Query-proof" : pct >= 70 ? "Mostly ready" : "Fix before submit";

  return { pct, tone, label, issues };
}
