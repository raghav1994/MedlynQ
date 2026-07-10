"""Auto-purge redacted/ folders older than the retention window.

DPDP story:
  Originals live in PatientLog/{MRN}/originals/ forever — clerk needs them.
  Redacted copies are sent to Sarvam Vision once, then have NO further value.
  We keep them 30 days for audit, then delete.

Run modes:
  python python/tools/purge_redacted.py                   # dry-run preview
  python python/tools/purge_redacted.py --apply           # actually delete
  python python/tools/purge_redacted.py --days 7 --apply  # custom retention

Each deletion writes a 'purge' audit event with sha256 + age before drop.
Designed to be cron'd nightly:
  0 3 * * *  cd /opt/medlynq/app && python python/tools/purge_redacted.py --apply
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from audit import append as audit_append, sha256_of, PATIENTLOG_ROOT  # noqa: E402


def env_retention_days(default: int = 30) -> int:
    raw = os.environ.get("MEDLYNQ_REDACTED_RETENTION_DAYS")
    if raw:
        try:
            return int(raw)
        except ValueError:
            pass
    return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=env_retention_days(),
                    help="retention window in days (env MEDLYNQ_REDACTED_RETENTION_DAYS or 30)")
    ap.add_argument("--apply", action="store_true",
                    help="actually delete (default is dry-run)")
    args = ap.parse_args()

    if not PATIENTLOG_ROOT.exists():
        print(f"PatientLog not found: {PATIENTLOG_ROOT}", file=sys.stderr)
        sys.exit(1)

    cutoff = time.time() - args.days * 86400
    summary = {"scanned": 0, "purged": 0, "kept": 0, "skipped": 0, "errors": 0, "bytes_freed": 0}
    purged_files: list[str] = []

    for mrn_dir in sorted(PATIENTLOG_ROOT.iterdir()):
        if not mrn_dir.is_dir() or mrn_dir.name.startswith("_"):
            continue
        redacted_dir = mrn_dir / "redacted"
        if not redacted_dir.is_dir():
            continue

        for f in redacted_dir.glob("*"):
            if not f.is_file():
                continue
            summary["scanned"] += 1
            try:
                mtime = f.stat().st_mtime
                size = f.stat().st_size
            except OSError:
                summary["errors"] += 1
                continue

            if mtime > cutoff:
                summary["kept"] += 1
                continue

            age_days = (time.time() - mtime) / 86400
            sha = sha256_of(f)

            if args.apply:
                try:
                    f.unlink()
                    summary["purged"] += 1
                    summary["bytes_freed"] += size
                    purged_files.append(str(f))
                    audit_append(
                        kind="purge",
                        mrn=mrn_dir.name,
                        file=f.name,
                        sha256_in=sha,
                        extra={"age_days": round(age_days, 1), "size_bytes": size, "retention_days": args.days},
                    )
                except OSError as e:
                    summary["errors"] += 1
                    print(f"  ! could not delete {f}: {e}", file=sys.stderr)
            else:
                summary["purged"] += 1
                summary["bytes_freed"] += size
                purged_files.append(str(f))

    import json
    print(json.dumps({
        "mode": "apply" if args.apply else "dry-run",
        "retention_days": args.days,
        "summary": summary,
        "purged_sample": purged_files[:20],
    }, indent=2))


if __name__ == "__main__":
    main()
