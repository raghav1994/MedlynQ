"""LLM-based identity extraction — a second pass on top of md_parser.py's
regex extraction, using Sarvam's chat completion model instead of hand-written
patterns.

Why this exists: today's real bugs (a "Name;" separator with no colon, "Mrs.
POONAM" vs "POONAM", OCR-garbled "N Oresh kn" for "Naresh") are all cases
where a human reading the text would get it right instantly, but a fixed
regex needs a new rule patched in for every new variant. An LLM reasons about
the text instead of pattern-matching it, so it should absorb this whole class
of bug without us hand-patching each new OCR quirk.

Cost: measured on real documents — sarvam-30b is a reasoning model that
spends ~1000-2000 tokens "thinking" before the final JSON even on short
inputs (confirmed: it needed 525 tokens just to reply "OK" to "hi"). Real
usage was ~1000-4500 input + ~1100-2000 output tokens per document, i.e.
roughly ₹0.02-0.03 per document (₹2.5/1M in, ₹10/1M out) — still small next
to the ₹0.50/page Document Intelligence OCR call, just not as negligible as
first estimated before actually measuring it.

Falls back to None on any failure (bad JSON, API error, missing key) so
callers can fall back to the existing regex parser — this is an ADDITION,
not a replacement, until proven reliable across more real documents.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

# Same antivirus/HTTPS-interception fix as sarvam_vision.py — without this,
# every call here fails with [SSL: CERTIFICATE_VERIFY_FAILED] on this machine.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

from dotenv import load_dotenv

APP_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(APP_ROOT / ".env.local")

SARVAM_KEY = os.getenv("SARVAM_API_KEY", "")
MODEL = os.getenv("SARVAM_CHAT_MODEL", "sarvam-30b")

SYSTEM_PROMPT = """You extract patient identity fields from Indian hospital \
document text (OCR'd, so it may have typos, garbled words, or unusual \
separators like ";" instead of ":"). Read the text and use your judgment to \
recover what a human would recognize, even if a fixed keyword pattern \
wouldn't catch it — e.g. "N Oresh kn" after "Name;" is a garbled OCR reading \
of a person's name, not literally two words to leave as-is.

Rules:
- patient_name: the PATIENT's name only. NEVER the hospital's name, doctor's \
name, or lab's name. Strip courtesy titles (Mr/Mrs/Ms/Dr) but correct \
obvious OCR garbling if you can confidently tell what the real name is \
(e.g. "N Oresh kn" -> "Naresh Kn"). If genuinely unclear or absent, use null.
- mrn: the PATIENT's own hospital/lab ID (UHID, CR No, MRN, Reg No, Patient \
ID, Hospital ID when it's clearly the patient's own ID not the hospital's \
registration number). Include internal reference suffixes exactly as \
printed if present (e.g. "100096731 (25/69)") — don't invent or strip \
digits you're not sure about. If absent, use null.
- age: integer years if stated, else null.
- gender: "M" or "F" if stated, else null.
- doc_type: one of Discharge_Summary, Chemo_Chart, HPE_Report, Lab_Report, \
Hospital_Bill, Feedback_Form, Consent_Form, Prescription, Aadhaar_Card, \
Other — based on structural content (biopsy/histopathology -> HPE_Report, \
cycle/BSA/chemo drugs -> Chemo_Chart, gross/net/payer amounts -> \
Hospital_Bill, etc).

Return ONLY a JSON object, no other text:
{"patient_name": ..., "mrn": ..., "age": ..., "gender": ..., "doc_type": ...}
"""


# Sarvam's cached text is the markdown content followed by a large raw JSON
# layout blob (page_num, image_width, per-block pixel coordinates...) that's
# pure noise for identity extraction — confirmed on a real document where
# this blob was ~9000 of the text's 10600 characters. Left in, the model
# burns its whole reasoning budget "analyzing" bounding-box coordinates
# instead of answering, and never reaches the final JSON. Strip it before
# sending.
_LAYOUT_JSON_RE = re.compile(r'\{\s*"page_num":')


def _strip_layout_json(text: str) -> str:
    m = _LAYOUT_JSON_RE.search(text)
    return text[: m.start()] if m else text


def _audit_llm_call(cache_key: str, status: str, err: str | None = None) -> None:
    """Every Sarvam OCR call already gets an audit_log entry (sarvam_send in
    sarvam_vision.py) — this call ALSO sends document text to Sarvam (a
    different endpoint, chat completions), so it needs the same tamper-evident
    trail. Only called for a real network call, never for a cache hit — a
    cache hit sends nothing anywhere."""
    try:
        from audit import append as audit_append
        audit_append(
            kind="identity_llm_send",
            mrn=None,
            file=f"{cache_key}.json",
            sha256_in=cache_key,
            extra={"model": MODEL, "status": status, "error": err},
        )
    except Exception:
        pass


# land_file() (land_document.py) runs this SAME text through this SAME
# fallback at BOTH detect time (the pre-pass in detect-patients/route.ts)
# and again at commit time (land/route.ts) — the raw Sarvam OCR text is
# already SHA-cached so that step is free on the second pass, but this LLM
# call had no cache of its own, so it would otherwise get billed TWICE for
# the exact same document. Content-addressed by the cleaned text itself —
# same text in, same cached result out, regardless of which caller asks.
_CACHE_DIR = Path(__file__).resolve().parents[1] / "PatientLog" / "_index" / "identity_llm_cache"


def extract_identity_llm(text: str) -> dict[str, Any] | None:
    """Returns {"patient_name", "mrn", "age", "gender", "doc_type"} or None
    on any failure (missing key, API error, unparseable response) — callers
    should fall back to md_parser.py's regex-based _patient_identity() when
    this returns None.
    """
    if not SARVAM_KEY or not text.strip():
        return None

    cleaned = _strip_layout_json(text)[:6000]
    cache_key = hashlib.sha256(cleaned.encode("utf-8")).hexdigest()
    cache_path = _CACHE_DIR / f"{cache_key}.json"
    if cache_path.is_file():
        try:
            return json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            pass  # corrupt cache entry — fall through and re-call

    try:
        from sarvamai import SarvamAI
    except ImportError:
        return None

    try:
        client = SarvamAI(api_subscription_key=SARVAM_KEY)
        resp = client.chat.completions(
            model=MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": cleaned},
            ],
            temperature=0.0,
            max_tokens=3000,
        )
        raw = resp.choices[0].message.content or ""
        # Model sometimes wraps JSON in ```json ... ``` fences despite the
        # "ONLY a JSON object" instruction — strip those before parsing.
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
        data = json.loads(raw)
        result = {
            "patient_name": data.get("patient_name") or None,
            "mrn": str(data["mrn"]) if data.get("mrn") else None,
            "age": data.get("age") or None,
            "gender": data.get("gender") or None,
            "doc_type": data.get("doc_type") or None,
        }
        try:
            _CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass  # caching is an optimization, never block on it
        _audit_llm_call(cache_key, "ok")
        return result
    except Exception as e:
        _audit_llm_call(cache_key, "failed", str(e)[:500])
        return None


if __name__ == "__main__":
    import sys
    text = sys.stdin.read() if not sys.stdin.isatty() else " ".join(sys.argv[1:])
    print(json.dumps(extract_identity_llm(text), indent=2, ensure_ascii=False))
