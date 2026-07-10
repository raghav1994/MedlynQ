"""Append-only audit log.

Single source of truth for "what happened to every doc that touched the
pipeline" — used by the Admin page, the per-patient indicator, and any
future regulator inspection.

Format: JSONL (one event per line) at PatientLog/_index/audit_log.jsonl

Event shape:
    {
      "ts": "2026-06-25T12:34:56Z",
      "kind": "redact" | "sarvam_send" | "purge" | "ingest",
      "mrn": "MK70A6O8G",
      "file": "Vikram_HPE_2026-05-19.pdf",
      "sha256_in":  "abc...",   # original hash (if available)
      "sha256_out": "def...",   # post-step hash (if available)
      "burned_count": 3,         # for redact events
      "extra": {...}             # kind-specific
    }

Why JSONL: append-safe across processes, tail-friendly, easy to grep,
zero schema migration if we add fields later.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# PatientLog lives one level above the app/ folder
APP_ROOT = Path(__file__).resolve().parent.parent
PATIENTLOG_ROOT = APP_ROOT.parent / "PatientLog"
AUDIT_DIR = PATIENTLOG_ROOT / "_index"
AUDIT_FILE = AUDIT_DIR / "audit_log.jsonl"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_of(path: str | Path) -> str | None:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


def append(kind: str, mrn: str | None = None, file: str | None = None,
           sha256_in: str | None = None, sha256_out: str | None = None,
           burned_count: int | None = None, **extra: Any) -> dict:
    """Write one audit event. Returns the event dict for callers that want it."""
    event = {
        "ts": _now(),
        "kind": kind,
        "mrn": mrn,
        "file": file,
        "sha256_in": sha256_in,
        "sha256_out": sha256_out,
    }
    if burned_count is not None:
        event["burned_count"] = burned_count
    if extra:
        event["extra"] = extra

    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    with open(AUDIT_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event


def read(mrn: str | None = None, limit: int = 200) -> list[dict]:
    """Return the most recent N audit events. Filter by MRN if given."""
    if not AUDIT_FILE.exists():
        return []
    out: list[dict] = []
    with open(AUDIT_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if mrn and ev.get("mrn") != mrn:
                continue
            out.append(ev)
    return out[-limit:][::-1]   # newest first


def stats() -> dict:
    """Aggregate counts for the admin dashboard."""
    counts: dict[str, int] = {}
    last_event: str | None = None
    if AUDIT_FILE.exists():
        with open(AUDIT_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                k = ev.get("kind", "unknown")
                counts[k] = counts.get(k, 0) + 1
                last_event = ev.get("ts")
    return {
        "by_kind": counts,
        "last_event_at": last_event,
        "audit_file": str(AUDIT_FILE),
    }
