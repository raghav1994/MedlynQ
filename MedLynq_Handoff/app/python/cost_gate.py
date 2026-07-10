"""Cost-control layer for the Sarvam pipeline.

Three knobs:
  1. PAGE_LIMITS per doc_type    — clip multi-page PDFs to the pages that matter
  2. SKIP_DOC_TYPES               — visual-only docs that never need OCR
  3. SHA-256 cache                — skip re-billing for duplicate uploads

Also exposes `prepare_for_sarvam()` which combines all three checks + extractability
detection, so the rest of the pipeline can ask one question and get one answer:
  "should I send this to Sarvam, and if so, with which file?"
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional, Literal

PageLimit = int  # 0 = skip entirely; n = clip to first n pages

# How many pages of each doc-type meaningfully contain structured data.
# Pages beyond this rarely yield extra fields — billed for nothing.
PAGE_LIMITS: dict[str, PageLimit] = {
    "hpe_report":              3,
    "histopathology":          3,
    "discharge_summary":       2,
    "bill":                    5,
    "hospital_bill":           5,
    "lab_report":              2,
    "feedback_form":           1,
    "clinical_vitals_log":     1,
    "chemo_chart":             2,
    "doctors_prescription":    2,
    "tumor_board_cert":        1,
    "consent_form":            1,
    "referral":                1,
    "registration_copy":       1,
    "ipd_file":                2,
    "opd_slip":                1,
    "ot_notes":                3,
    "anaesthesia_note":        1,
    "post_op_notes":           2,
    "prior_imaging":           2,
    "cbc_lft_kft":             2,
    # Default if doc_type not listed
    "_default":                3,
}

# Docs that are visually-verified by the MEDCO, never OCR'd.
SKIP_DOC_TYPES: set[str] = {
    "drug_pouch",
    "discharge_photo",
    "geotag_photo",
    "post_surgery_photo",
    "generic_photo",
    "patient_id",          # already gated as LOCAL-ONLY in batch tool
    "aadhaar_card",
    "voter_id",
    "pan_card",
    "ayushman_card",
    "ration_card",
    "family_id",
    "health_card",
}

# Cache lives next to PatientLog. One JSON per file-sha256.
def _cache_dir() -> Path:
    here = Path(__file__).resolve().parent.parent  # app/
    cache = here.parent / "PatientLog" / "_index" / "sarvam_cache"
    cache.mkdir(parents=True, exist_ok=True)
    return cache


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def cache_lookup(sha: str) -> Optional[dict]:
    p = _cache_dir() / f"{sha}.json"
    if p.exists():
        import json
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None


def cache_store(sha: str, result: dict) -> None:
    import json
    p = _cache_dir() / f"{sha}.json"
    with open(p, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)


def page_limit_for(doc_type: str | None) -> int:
    if not doc_type:
        return PAGE_LIMITS["_default"]
    return PAGE_LIMITS.get(doc_type.lower(), PAGE_LIMITS["_default"])


def should_skip(doc_type: str | None) -> bool:
    if not doc_type:
        return False
    return doc_type.lower() in SKIP_DOC_TYPES


def clip_pdf_pages(src: str, dst: str, max_pages: int) -> int:
    """Open `src`, write only first `max_pages` pages to `dst`. Returns pages written."""
    import fitz
    doc = fitz.open(src)
    total = len(doc)
    if max_pages <= 0 or max_pages >= total:
        doc.close()
        shutil.copy(src, dst)
        return total
    new = fitz.open()
    new.insert_pdf(doc, from_page=0, to_page=max_pages - 1)
    new.save(dst)
    new.close()
    doc.close()
    return max_pages


PrepareResult = tuple[
    Literal["skip", "cache_hit", "send", "extract_local"],
    Optional[str],   # path to send (clipped tempfile if applicable) OR cached dict path
    Optional[dict],  # cached result if cache_hit
    Optional[str],   # sha256 (so caller can store after Sarvam returns)
    int,             # pages_billed_estimate
]


def prepare_for_sarvam(
    file_path: str,
    doc_type: str | None,
    is_text_pdf: bool = False,
    use_cache: bool = True,
) -> PrepareResult:
    """One-stop decision for cost layer.

    Returns:
      ("skip",          None,         None,          None,    0)  → skip entirely (visual-only doc)
      ("cache_hit",     None,         <cached_dict>, sha,     0)  → reuse cached result
      ("extract_local", None,         None,          None,    0)  → text PDF, use PyMuPDF (free)
      ("send",          <path>,       None,          sha,     n)  → call Sarvam on this path
    """
    if should_skip(doc_type):
        return ("skip", None, None, None, 0)

    if is_text_pdf:
        return ("extract_local", None, None, None, 0)

    sha = file_sha256(file_path)
    if use_cache and (cached := cache_lookup(sha)):
        return ("cache_hit", None, cached, sha, 0)

    # Clip PDF pages to the doc-type's known cost ceiling
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pdf":
        limit = page_limit_for(doc_type)
        try:
            import fitz
            with fitz.open(file_path) as d:
                total = len(d)
            if limit < total and limit > 0:
                tmpdir = tempfile.mkdtemp(prefix="medlynq_clip_")
                clipped = os.path.join(tmpdir, "clipped.pdf")
                pages = clip_pdf_pages(file_path, clipped, limit)
                return ("send", clipped, None, sha, pages)
            return ("send", file_path, None, sha, total)
        except Exception:
            return ("send", file_path, None, sha, 1)

    # Image — always one page
    return ("send", file_path, None, sha, 1)
