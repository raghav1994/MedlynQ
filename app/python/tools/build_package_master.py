"""Build / refresh app/data/package_master.csv.

Today: seeds with ~150 hand-curated codes across all specialties × all schemes.
Tomorrow: replace with real CSVs from
  - NHA PMJAY HBP 2.0 (1,949 codes)
  - CGHS scheme master (~2,000 codes)
  - Per-state SHA additions
  - Railway UMID master
  - ECHS master

Each row: code, name, specialty, schemes (pipe-separated), cap_inr,
length_of_stay_days, notes.

When real feeds are available, drop them into PatientLog/_index/scheme_feeds/
and re-run this script. Idempotent.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]   # MedLynq/
OUT = ROOT / "app" / "data" / "package_master.csv"

# The seed list lives in the existing CSV file — this script's job is to
# validate the format and report totals. Real feeds get merged here.

def main():
    if not OUT.exists():
        print(f"missing: {OUT}", file=sys.stderr)
        sys.exit(1)
    with open(OUT, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    by_specialty = {}
    by_scheme = {}
    for r in rows:
        by_specialty[r["specialty"]] = by_specialty.get(r["specialty"], 0) + 1
        for s in r["schemes"].split("|"):
            s = s.strip()
            if s:
                by_scheme[s] = by_scheme.get(s, 0) + 1
    print(f"package_master.csv: {len(rows)} codes")
    print("  by specialty:")
    for k, v in sorted(by_specialty.items()): print(f"    {k:>15} : {v}")
    print("  by scheme:")
    for k, v in sorted(by_scheme.items(), key=lambda x: -x[1]): print(f"    {k:>10} : {v}")

if __name__ == "__main__":
    main()
