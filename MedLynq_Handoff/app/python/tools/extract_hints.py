"""Extract text + identity hints from a single document file.

Called by /api/document/extract. Writes ONE line of JSON to stdout:

  { "method": "pymupdf" | "sarvam" | "unsupported",
    "text": "<up to 12000 chars>",
    "hints": { "mrn": ..., "name": ..., "age": ..., "gender": ... },
    "confidence": 0..1,
    "cached": bool }

Usage:
  python extract_hints.py <path> [--kind pdf|image|auto]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

# Windows' default stdout encoding is the legacy cp1252 codepage, not UTF-8 —
# printing any character outside it (emoji, circled numbers, etc. that
# genuinely show up in real Sarvam OCR text) crashes with UnicodeEncodeError
# and kills the whole subprocess.
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ---------- Identity hint parsing --------------------------------------------

# NOTE: re.IGNORECASE is applied by _first_match() below across the whole
# pattern, which would otherwise make "[A-Z]" match lowercase too — so each
# pattern here wraps its keyword half in (?i:...) to keep ONLY the keyword
# case-insensitive; the captured name itself still has to start with a real
# capital letter. Without this, prose containing the word "patient" (e.g. a
# stray caption) could get captured as if it were the patient's name.
NAME_PATTERNS = [
    r"(?i:Patient\s*Name)\s*[:\-]?\s*([A-Z][A-Za-z\.\s]{2,60})",
    r"(?i:Beneficiary\s*Name)\s*[:\-]?\s*([A-Z][A-Za-z\.\s]{2,60})",
    r"(?i:Name\s+of\s+(?:the\s+)?Patient)\s*[:\-]?\s*([A-Z][A-Za-z\.\s]{2,60})",
    r"^\s*(?i:Name)\s*[:\-]?\s*([A-Z][A-Za-z\.\s]{2,60})",  # standalone at line start
    r"(?i:Mr\.?)\s+([A-Z][A-Za-z\.\s]{2,50})",
    r"(?i:Mrs\.?)\s+([A-Z][A-Za-z\.\s]{2,50})",
    r"(?i:Ms\.?)\s+([A-Z][A-Za-z\.\s]{2,50})",
]

AGE_PATTERNS = [
    r"(?i:Age)\s*[:\-]?\s*(\d{1,3})\s*(?i:Years?|Yrs?)?",
    r"(\d{1,3})\s*(?i:Years?|Yrs?)\s*(?i:Old)?(?:/[MFmf])?",
]

GENDER_PATTERNS = [
    r"(?i:Sex|Gender)\s*[:\-]?\s*(?i:(Male|Female|M|F))\b",
    r"(?i:Age\s*/\s*Sex)\s*[:\-]?\s*\d+\s*/\s*(?i:(M|F|Male|Female))",
    r"\d{1,3}\s*(?i:Years?|Yrs?)?\s*/\s*(?i:(M|F|Male|Female))\b",
]

MRN_PATTERNS = [
    r"(?i:MRN|UHID|Reg\.?\s*No\.?|IP\s*No\.?|Patient\s*ID)\s*[:\-]?\s*([A-Z0-9\-/]{4,20})",
    r"(?i:Beneficiary\s*ID)\s*[:\-]?\s*([A-Z0-9\-/]{4,25})",
]

# Words that can follow a name-keyword in real OCR noise but are never
# themselves a patient's name — reject these instead of showing them as if
# they were real data (e.g. a lone "Mr." with no surname after it).
_NAME_BLOCKLIST = {
    "mr", "mrs", "ms", "miss", "dr", "sir", "madam", "male", "female",
    "sex", "age", "gender", "mrn", "uhid", "id", "no", "unknown", "n a", "na",
}
# A bare 4-digit number that looks like a year is almost always a
# mis-extracted date, not an MRN — real MRNs are longer or contain letters.
_YEAR_LIKE = re.compile(r"^(19|20)\d{2}$")


def _first_match(text: str, patterns: list[str]) -> str | None:
    for pat in patterns:
        m = re.search(pat, text, re.MULTILINE)
        if m:
            v = m.group(1).strip()
            # Strip trailing noise like "\n" or extra field labels
            v = re.split(r"[\n\r]", v)[0].strip()
            # Reject if fewer than 2 alpha chars (avoids "Age: 42 Sex: M" bleeding into name)
            if len(re.sub(r"[^A-Za-z]", "", v)) >= 2 or v.isdigit():
                return v
    return None


def parse_hints(text: str) -> dict:
    hints: dict = {}
    name = _first_match(text, NAME_PATTERNS)
    if name:
        # Trim junk like "Mr." repeats or trailing labels ("... AGE")
        name = re.sub(r"\b(Age|Sex|Gender|Mrn|Uhid|Ip\s*No).*$", "", name, flags=re.IGNORECASE).strip()
        name = re.sub(r"\s{2,}", " ", name).strip(" .-,:")
        words = name.split()
        letters_only = re.sub(r"[^A-Za-z]", "", name)
        is_real_name = (
            3 <= len(name) <= 60
            and name.lower().rstrip(".") not in _NAME_BLOCKLIST
            and (len(words) >= 2 or len(letters_only) >= 4)
        )
        if is_real_name:
            hints["name"] = name
    age = _first_match(text, AGE_PATTERNS)
    if age and age.isdigit() and 0 < int(age) < 130:
        hints["age"] = int(age)
    gender = _first_match(text, GENDER_PATTERNS)
    if gender:
        g = gender.strip().upper()
        hints["gender"] = "F" if g.startswith("F") else "M"
    mrn = _first_match(text, MRN_PATTERNS)
    if mrn and not _YEAR_LIKE.match(mrn.strip()):
        hints["mrn"] = mrn.strip()
    return hints


# ---------- PDF path (PyMuPDF — local, free) ----------------------------------

def extract_pdf(path: Path) -> tuple[str, str]:
    """Returns (text, method). Falls back gracefully if PyMuPDF isn't installed."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return "", "pymupdf_missing"
    text_parts: list[str] = []
    with fitz.open(str(path)) as doc:
        # First 3 pages usually carry patient identifiers; keep it cheap
        for i, page in enumerate(doc):
            if i >= 3:
                break
            text_parts.append(page.get_text("text") or "")
    return "\n".join(text_parts).strip(), "pymupdf"


# ---------- Image path (Redact PII locally → Sarvam OCR) ---------------------

def extract_image(path: Path) -> tuple[str, str, bool, dict]:
    """Returns (text, method, cached, redact_info).

    DPDP: every image is redacted LOCALLY before Sarvam is called. The raw
    image never leaves the machine. The redacted version is cached under SHA
    so re-drops don't re-burn.

    redact_info: {'burned_count': int, 'reasons': [str], 'redacted_path': str}
    """
    raw_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    # __file__ = app/python/tools/extract_hints.py → parents[3] = repo root
    # (one level deeper than cost_gate.py, which lives directly in app/python/)
    root = Path(__file__).resolve().parents[3] / "PatientLog" / "_index"
    text_cache_dir = root / "sarvam_cache"
    text_cache_file = text_cache_dir / f"{raw_sha}.json"

    # 1) Sarvam text cache — skip both redact and Sarvam if we've done this SHA before
    if text_cache_file.exists():
        try:
            j = json.loads(text_cache_file.read_text(encoding="utf-8"))
            return j.get("text", ""), "sarvam", True, j.get("redact", {})
        except Exception:
            pass

    # 2) Redact PII locally — Aadhaar / PAN / phone / DOB / address / face
    redact_dir = root / "redacted_cache"
    redact_dir.mkdir(parents=True, exist_ok=True)
    redacted_path = redact_dir / f"{raw_sha}{path.suffix.lower()}"
    meta_path = redact_dir / f"{raw_sha}.meta.json"
    burn_info: dict = {"burned_count": 0, "reasons": [], "redacted_path": None, "skipped": False}
    if redacted_path.exists() and meta_path.exists():
        burn_info["cached"] = True
        try:
            burn_info.update(json.loads(meta_path.read_text(encoding="utf-8")))
        except Exception:
            pass
    else:
        try:
            from redact import redact_image as _redact  # type: ignore
            r = _redact(str(path), str(redacted_path))
            burn_info["burned_count"] = r.get("burned_count", 0)
            burn_info["reasons"] = sorted({b.get("reason") for b in r.get("boxes", []) if b.get("reason")})
            burn_info["face_count"] = sum(1 for b in r.get("boxes", []) if b.get("reason") == "photo_face")
            burn_info["text_line_count"] = r.get("text_line_count", 0)
            burn_info["max_face_area_ratio"] = r.get("max_face_area_ratio", 0.0)
            burn_info["has_geotag_stamp"] = r.get("has_geotag_stamp", False)
            burn_info["text_ocr_skipped"] = r.get("text_ocr_skipped", False)
            burn_info["detected_angle"] = r.get("detected_angle", 0)
            try:
                meta_path.write_text(json.dumps({
                    "burned_count": burn_info["burned_count"],
                    "reasons": burn_info["reasons"],
                    "face_count": burn_info["face_count"],
                    "text_line_count": burn_info["text_line_count"],
                    "max_face_area_ratio": burn_info["max_face_area_ratio"],
                    "has_geotag_stamp": burn_info["has_geotag_stamp"],
                    "text_ocr_skipped": burn_info["text_ocr_skipped"],
                    "detected_angle": burn_info["detected_angle"],
                }), encoding="utf-8")
            except Exception:
                pass
        except Exception as e:
            # If redact fails (missing paddleocr/opencv), refuse to send to Sarvam.
            # Better to fail closed than leak PII to a cloud endpoint.
            return "", "redact_failed", False, {"error": str(e)}
    burn_info["redacted_path"] = str(redacted_path)

    # 2b) Content-based visual-only detection — never send these to Sarvam,
    # no matter what the file is named:
    #   - an Aadhaar number found in the image (an ID card photo)
    #   - a face filling the frame with almost no surrounding text (a plain
    #     person photo)
    #   - a large face relative to the frame (a close/medium shot of a
    #     person — the overlay text on these can be dense, so line-count
    #     alone isn't a reliable signal)
    #   - a geotag-camera location stamp ("Lat ... Long ...") — these are
    #     discharge/handover photos with a lot of overlay text, which is
    #     exactly why the line-count check above misses them on its own
    # When PaddleOCR's text scan was skipped (MEDLYNQ_SKIP_TEXT_OCR), both
    # text_line_count and has_geotag_stamp are always 0/False — NOT because
    # there's no text, but because nothing looked. Falling through to the
    # face_count-only check below would then flag any real document with a
    # small photo/logo (letterhead, doctor's headshot) as "just a photo".
    # Require a much larger face-to-frame ratio instead — reliable evidence
    # of an actual portrait/ID photo — rather than "text_line_count < 6".
    text_ocr_skipped = burn_info.get("text_ocr_skipped", False)
    face_ratio_threshold = 0.15 if text_ocr_skipped else 0.03
    is_visual_only = (
        "aadhaar" in burn_info.get("reasons", [])
        or burn_info.get("has_geotag_stamp", False)
        or burn_info.get("max_face_area_ratio", 0) > face_ratio_threshold
        or (not text_ocr_skipped and burn_info.get("face_count", 0) > 0 and burn_info.get("text_line_count", 0) < 6)
    )
    if is_visual_only:
        burn_info["visual_only_detected"] = True
        return "", "skip_visual", burn_info.get("cached", False), burn_info

    # 3) Sarvam OCR on the REDACTED image only
    try:
        from sarvam_vision import extract as sarvam_extract  # type: ignore
    except ImportError:
        return "", "sarvam_missing", False, burn_info

    result = sarvam_extract(str(redacted_path), "unknown")
    if result and result.get("error"):
        # A real Sarvam failure (network/SSL/API error) used to look
        # identical to "Sarvam succeeded but found nothing" — both returned
        # empty text with method="sarvam", so a real outage looked exactly
        # like a clean document with no identity fields. Surfacing the
        # actual error in the method string makes this diagnosable from the
        # result alone, not just by re-running extract() by hand.
        return "", f"sarvam_failed:{result['error'][:200]}", False, burn_info
    text = (result or {}).get("text", "") or ""
    if text:
        try:
            text_cache_dir.mkdir(parents=True, exist_ok=True)
            text_cache_file.write_text(
                json.dumps({"text": text, "redact": burn_info}), encoding="utf-8"
            )
        except Exception:
            pass
    return text, "sarvam", False, burn_info


# ---------- Main --------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--kind", default="auto", choices=["auto", "pdf", "image"])
    args = ap.parse_args()

    p = Path(args.path)
    if not p.exists():
        print(json.dumps({"error": "file not found"}))
        return 2

    kind = args.kind
    if kind == "auto":
        ext = p.suffix.lower()
        if ext == ".pdf":
            kind = "pdf"
        elif ext in {".jpg", ".jpeg", ".png", ".webp"}:
            kind = "image"
        else:
            print(json.dumps({"method": "unsupported", "text": "", "hints": {}, "cached": False}))
            return 0

    text = ""
    method = "unsupported"
    cached = False
    redact_info: dict = {}
    if kind == "pdf":
        text, method = extract_pdf(p)
    else:
        text, method, cached, redact_info = extract_image(p)

    hints = parse_hints(text) if text else {}
    # Same LLM fallback as land_document.py, only on a genuine regex miss —
    # this free-text-PDF path has its OWN separate regex engine (parse_hints
    # above), so it needs the same safety net independently; a fix to
    # md_parser.py's _patient_identity() does NOT cover this code path.
    if text and not hints.get("name") and not hints.get("mrn"):
        from identity_llm import extract_identity_llm
        llm_result = extract_identity_llm(text)
        if llm_result:
            if llm_result.get("patient_name"): hints["name"] = llm_result["patient_name"]
            if llm_result.get("mrn"): hints["mrn"] = llm_result["mrn"]
            if not hints.get("age") and llm_result.get("age"): hints["age"] = llm_result["age"]
            if not hints.get("gender") and llm_result.get("gender"): hints["gender"] = llm_result["gender"]
    confidence = min(1.0, len(hints) / 4)  # 4 possible fields (name, age, gender, mrn)

    print(json.dumps({
        "method": method,
        "text": text[:12000],
        "hints": hints,
        "confidence": round(confidence, 2),
        "cached": cached,
        "redact": redact_info,   # {burned_count, reasons, redacted_path}
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
