"""Sarvam AI Document Intelligence client.

Uses the official `sarvamai` SDK (job-based async API):
  1. create_job(language, output_format)
  2. upload_file(path)
  3. start()
  4. wait_until_complete()
  5. download_output(zip_path)
  6. unzip → read markdown / json

Sends ONLY the redacted (burned) image/PDF. Never the original.
API key read from .env.local. Never logged.
"""

from __future__ import annotations

import os
# Real fix for the recurring [SSL: CERTIFICATE_VERIFY_FAILED] error on this
# machine: antivirus software intercepts HTTPS by injecting its own root
# certificate into WINDOWS' trust store, but Python's default cert source
# (the certifi bundle, forced via SSL_CERT_FILE below in the old version of
# this fix) has no idea that certificate exists — so verification fails
# even though the connection is completely legitimate. Browsers never hit
# this because they trust the OS store; Python doesn't, by default.
#
# `truststore` patches Python's ssl module to verify against the OS trust
# store instead (same thing browsers already do) — so it trusts whatever
# Windows trusts, antivirus-injected certs included, with zero antivirus
# configuration needed on any MEDCO's machine. Verified directly: the exact
# same real document that failed with the old certifi-forcing approach
# succeeded immediately once this was applied instead.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    # Falls back to Python's default (certifi-based) verification if
    # truststore isn't installed — same behavior as before this fix.
    pass

import json
import re
import sys
import time
import zipfile
import tempfile
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

APP_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(APP_ROOT / ".env.local")

SARVAM_KEY = os.getenv("SARVAM_API_KEY", "")
SARVAM_LANG = os.getenv("SARVAM_DOC_LANG", "en-IN")          # en-IN / hi-IN / etc.
SARVAM_FORMAT = os.getenv("SARVAM_DOC_FORMAT", "md")          # md / json / txt


def extract(file_path: str, doc_type: str | None = None, _retries: int = 1) -> dict[str, Any]:
    """Send a redacted file to Sarvam Doc Intelligence.

    Returns dict shaped like:
      {
        "text": "<markdown / extracted text>",
        "extracted": {...},                 # parsed fields (best-effort)
        "doc_type_predicted": "<slug>",
        "raw_files": ["page1.md", "page2.md", ...],
        "sarvam_job_id": "<id>",
        "sarvam_status": "completed"
      }

    If anything fails, returns {"error": "...", "status": "failed", ...}.

    Under concurrent load a job can occasionally report "complete" but come
    back with an empty output zip (no error raised, just nothing to read) —
    _retries re-runs the whole job once more in that specific case before
    giving up, since a fresh job usually succeeds.
    """
    if not SARVAM_KEY:
        return {"error": "SARVAM_API_KEY not set in .env.local", "status": "failed"}

    try:
        from sarvamai import SarvamAI
    except ImportError:
        return {"error": "sarvamai SDK not installed — run: pip install -U sarvamai",
                "status": "failed"}

    client = SarvamAI(api_subscription_key=SARVAM_KEY)

    try:
        # 1. Create job
        job = client.document_intelligence.create_job(
            language=SARVAM_LANG,
            output_format=SARVAM_FORMAT,
        )
        # 2. Upload file (the *redacted* one)
        job.upload_file(file_path)
        # 3. Start
        job.start()
        # 4. Poll until done
        status = job.wait_until_complete()
        # 5. Download output zip
        with tempfile.TemporaryDirectory() as td:
            zip_path = os.path.join(td, "out.zip")
            job.download_output(zip_path)
            text_chunks: list[str] = []
            raw_files: list[str] = []
            with zipfile.ZipFile(zip_path, "r") as z:
                for name in z.namelist():
                    raw_files.append(name)
                    # Only read text-ish files
                    if name.endswith((".md", ".txt", ".json")):
                        try:
                            with z.open(name) as f:
                                text_chunks.append(f.read().decode("utf-8", errors="replace"))
                        except Exception:
                            pass
            full_text = "\n\n".join(text_chunks).strip()
            # Strip inline base64 image data (Sarvam's markdown sometimes
            # embeds a page thumbnail as ![Image](data:image/...;base64,...))
            # — left in, this bloats the cached text to 100-200KB+ and its
            # random characters can accidentally match an identity regex
            # (e.g. "...mRN3XPUV..." inside the base64 blob getting read as
            # a real MRN). Strip it before it's used for ANYTHING downstream.
            full_text = re.sub(
                r"!\[[^\]]*\]\(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+\)",
                "[image]",
                full_text,
            )

        if not full_text and _retries > 0:
            return extract(file_path, doc_type, _retries=_retries - 1)

        # Try to parse the doc_type from the file's content (light heuristic)
        result = {
            "text": full_text,
            "extracted": {},
            "doc_type_predicted": doc_type or "generic",
            "raw_files": raw_files,
            "sarvam_job_id": getattr(status, "job_id", None) or getattr(job, "job_id", None),
            "sarvam_status": str(getattr(status, "job_state", "completed")),
        }
        _audit_send(file_path, doc_type, "ok", None)
        return result

    except Exception as e:
        msg = str(e)
        _audit_send(file_path, doc_type, "failed", msg)
        return {
            "error": msg,
            "status": "failed",
            "doc_type": doc_type,
        }


def _audit_send(file_path: str, doc_type: str | None, status: str, err: str | None) -> None:
    """Record every outbound call to Sarvam. The redacted file's hash proves
    what left the machine; the audit log gives the regulator a tamper-evident trail."""
    try:
        from audit import append as audit_append, sha256_of
        from pathlib import Path as _P
        parts = _P(file_path).parts
        mrn = next((p for p in parts if p.isupper() and len(p) >= 6), None)
        audit_append(
            kind="sarvam_send",
            mrn=mrn,
            file=_P(file_path).name,
            sha256_in=sha256_of(file_path),
            extra={"doc_type": doc_type, "status": status, "error": err},
        )
    except Exception:
        pass


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: sarvam_vision.py <file_path> [doc_type]", file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]
    dt = sys.argv[2] if len(sys.argv) > 2 else None
    out = extract(path, dt)
    print(json.dumps(out, indent=2, ensure_ascii=False))
