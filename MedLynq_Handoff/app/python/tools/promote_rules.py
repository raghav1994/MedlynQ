"""Promote-to-regex-rules helper — NOT an automated ML pipeline.

This is a small, honest reporting tool, not a fake auto-tuner. It scans
every landed document manifest (PatientLog/{mrn}/extracted/*.json) and
tallies which doc types a hospital's documents are being classified into via
the slower LLM fallback (content_classifier.py had no confident regex match,
so land_document.py fell back to identity_llm.py's dynamic prompt — see
land_document.py's `need_classification` branch).

A doc_type showing up here often enough is a real signal: this hospital has
enough real document volume for someone to look at a sample, write a proper
strong_phrases/weak_phrases rule (same shape as content_classifier.py's
GLOBAL_RULES/ONCOLOGY_RULES), and add a SPECIALTY_RULES entry for that
specialty — same tuning process oncology went through against its 6,500-doc
corpus, just for the new specialty. This script's job stops at "here's what
to look at," not deciding the rule content — regex tuning from real medical
document text needs a human's judgment, same as it always has here.

Usage:
    python python/tools/promote_rules.py [hospital_id]

Without a hospital_id, reports across every hospital's landed documents.
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
PATIENT_LOG = APP_ROOT / "PatientLog"


def scan(hospital_filter: str | None = None) -> dict[str, Counter]:
    """Returns {hospital_id: Counter({doc_type: count})} for every manifest
    whose method was "llm_fallback" — i.e. no compiled regex rule matched."""
    per_hospital: dict[str, Counter] = defaultdict(Counter)
    if not PATIENT_LOG.exists():
        return per_hospital

    for manifest_path in PATIENT_LOG.glob("*/extracted/*.json"):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if manifest.get("method") != "llm_fallback":
            continue
        hid = manifest.get("hospital_id") or "unknown"
        if hospital_filter and hid != hospital_filter:
            continue
        per_hospital[hid][manifest.get("doc_type", "Unknown")] += 1

    return per_hospital


def main() -> int:
    hospital_filter = sys.argv[1] if len(sys.argv) > 1 else None
    results = scan(hospital_filter)

    if not results:
        print("No llm_fallback-classified documents found yet — nothing to promote.")
        print("(This is expected for hospitals that only use built-in oncology rules,")
        print(" or for a brand-new hospital that hasn't had real documents landed yet.)")
        return 0

    for hospital_id, counts in results.items():
        print(f"\n=== {hospital_id} — doc types classified via LLM fallback ===")
        for doc_type, n in counts.most_common():
            flag = "  <- consider promoting to a compiled regex rule" if n >= 20 else ""
            print(f"  {doc_type:30s} {n:4d} document(s){flag}")

    print(
        "\nNext step for anything flagged: pull a handful of real documents for that "
        "doc_type, find the phrases that reliably distinguish it (same process used "
        "for content_classifier.py's existing GLOBAL_RULES/ONCOLOGY_RULES), and add a "
        "SPECIALTY_RULES entry. This tool only surfaces volume — the actual rule still "
        "needs a human reading real documents, same as every existing rule in this file."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
