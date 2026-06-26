"""End-to-end ingestion pipeline.

Inputs: raw_path, mrn
Steps:
  1. Compress original (existing compressor.py) → originals/
  2. Classify doc_type from filename + text (existing extractor.py rules)
  3. Rasterize page 1 to PNG (for OCR)
  4. PaddleOCR + OpenCV redaction → redacted/
  5. Sarvam Vision on redacted/ → extracted/
  6. Normalize via synopsis_schemas → synopsis JSON
  7. Cross-check doc_type: classifier vs Sarvam → confidence
  8. Rename + return final artifact paths

Output JSON shape:
  {
    "mrn": "...",
    "doc_type": "...",
    "rename": "MRN_snake_doc_type_YYYYMMDD.ext",
    "paths": { "original": ..., "redacted": ..., "extracted": ... },
    "synopsis": { ... },
    "confidence": 0.0-1.0,
    "burn_log": { ... },
    "flags": [ ... ]
  }

Everything except the Sarvam POST runs local. The Sarvam POST receives
ONLY the redacted PNG — never the original.
"""

from __future__ import annotations

import json
import os
import re
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synopsis_schemas import normalize, schema_for  # noqa: E402

# Doc types that must NOT go to Sarvam — pure PII, kept fully local
LOCAL_ONLY_DOC_TYPES = {
    "Patient ID Proof",
    "Aadhaar Card",
    "PAN Card",
    "Voter ID",
    "Ration Card",
    "Ayushman Card",
    "Family ID",
    "Health Card",
}


def _snake(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def _ymd(dt: datetime | None = None) -> str:
    return (dt or datetime.now()).strftime("%Y%m%d")


def _rasterize_page1(pdf_path: str, out_png: str, dpi: int = 200) -> str:
    doc = fitz.open(pdf_path)
    page = doc[0]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    Path(out_png).parent.mkdir(parents=True, exist_ok=True)
    pix.save(out_png)
    doc.close()
    return out_png


def _is_pdf(path: str) -> bool:
    return path.lower().endswith(".pdf")


def run(
    raw_path: str,
    mrn: str,
    patientlog_root: str,
    use_sarvam: bool = False,
    run_ocr: bool = False,
) -> dict[str, Any]:
    """Run the full pipeline on one document. Returns a manifest dict."""
    from compressor import compress_pdf_safe, compress_standalone_image  # local sidecar
    from extractor import classify_doc, extract_pdf_text, extract_fields, detect_extractability

    raw = Path(raw_path)
    base = Path(patientlog_root) / mrn
    originals_dir = base / "originals"
    redacted_dir = base / "redacted"
    extracted_dir = base / "extracted"
    for d in (originals_dir, redacted_dir, extracted_dir):
        d.mkdir(parents=True, exist_ok=True)

    # ---- 1. Compress original ----
    compressed_path = originals_dir / raw.name
    if _is_pdf(str(raw)):
        compress_pdf_safe(str(raw), str(compressed_path))
    else:
        compress_standalone_image(str(raw), str(compressed_path))

    # ---- 2. Classify doc_type + detect extractability ----
    text_for_class = ""
    if _is_pdf(str(compressed_path)):
        try:
            t, _ = extract_pdf_text(str(compressed_path))
            text_for_class = t or ""
        except Exception:
            text_for_class = ""
    label, conf, src = classify_doc(compressed_path.name, text_for_class)
    classification = {"doc_type": label, "confidence": conf, "source": src}
    doc_type_label = label
    doc_type_slug = _snake(doc_type_label)
    extractability = detect_extractability(str(compressed_path))
    patient_identity = extract_fields(text_for_class) if text_for_class else {}

    raster_png = redacted_dir / f"{raw.stem}_p1.png"
    redacted_png = redacted_dir / f"{raw.stem}_redacted.png"
    burn_log: dict[str, Any] = {}
    sarvam_json: dict[str, Any] = {}
    flags: list[str] = [f"extractability:{extractability}"]

    if run_ocr:
        # ---- 3. Rasterize page 1 (for OCR) ----
        if _is_pdf(str(compressed_path)):
            _rasterize_page1(str(compressed_path), str(raster_png))
        else:
            import shutil
            shutil.copy(str(compressed_path), str(raster_png))

        # ---- 4. Redaction (Paddle + OpenCV) — always runs for scanned docs ----
        if extractability == "scanned":
            try:
                from redact import redact_image
                burn_log = redact_image(str(raster_png), str(redacted_png))
            except Exception as e:
                burn_log = {"error": str(e), "burned_count": 0}

        # ---- 5. Routing ----
        if doc_type_label in LOCAL_ONLY_DOC_TYPES:
            flags.append("local_only_no_cloud")
        elif extractability == "text":
            # Stay local — PDF text is enough
            flags.append("local_text_only_no_sarvam")
            sarvam_json = {
                "text": text_for_class,
                "extracted": patient_identity,
                "doc_type_predicted": doc_type_slug,
            }
        elif use_sarvam and redacted_png.exists():
            try:
                from sarvam_vision import extract as sarvam_extract
                sarvam_json = sarvam_extract(str(redacted_png), doc_type=doc_type_slug)
                if sarvam_json.get("error"):
                    flags.append("sarvam_failed")
            except Exception as e:
                sarvam_json = {"error": str(e)}
                flags.append("sarvam_exception")

    # ---- 6. Normalize synopsis ----
    synopsis = normalize(doc_type_slug, sarvam_json) if sarvam_json else {
        "doc_type": doc_type_slug,
        "label": schema_for(doc_type_slug)["label"],
        "fields": {},
        "suggests": [],
        "raw_text": "",
        "confidence": None,
    }

    # ---- 7. Cross-check classifier vs Sarvam ----
    sarvam_doc_type = (sarvam_json.get("doc_type_predicted") or "").lower()
    confidence = float(classification.get("confidence", 0.5))
    if sarvam_doc_type and sarvam_doc_type == doc_type_slug:
        confidence = min(1.0, confidence + 0.3)
    elif sarvam_doc_type and sarvam_doc_type != doc_type_slug:
        flags.append("doc_type_mismatch")

    # ---- 8. Rename ----
    doc_date = synopsis["fields"].get("specimen_date") or synopsis["fields"].get("doc_date")
    ymd = _ymd_from_str(doc_date) or _ymd()
    ext = compressed_path.suffix
    rename = f"{mrn}_{doc_type_slug}_{ymd}{ext}"
    final_path = originals_dir / rename
    if final_path != compressed_path:
        if final_path.exists():
            final_path.unlink()
        compressed_path.rename(final_path)

    # ---- 9. Save extracted manifest ----
    manifest = {
        "mrn": mrn,
        "doc_type": doc_type_label,
        "doc_type_slug": doc_type_slug,
        "extractability": extractability,
        "patient_identity": patient_identity,
        "rename": rename,
        "paths": {
            "original": str(final_path),
            "redacted": str(redacted_png) if redacted_png.exists() else None,
            "extracted_json": str(extracted_dir / f"{rename}.json"),
        },
        "synopsis": synopsis,
        "confidence": round(confidence, 2),
        "burn_log": burn_log,
        "flags": flags,
        "processed_at": datetime.now().isoformat(),
    }
    with open(manifest["paths"]["extracted_json"], "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    return manifest


def _ymd_from_str(s: str | None) -> str | None:
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y%m%d")
        except ValueError:
            continue
    return None


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("usage: pipeline.py <raw_path> <mrn> <patientlog_root>", file=sys.stderr)
        sys.exit(1)
    try:
        m = run(sys.argv[1], sys.argv[2], sys.argv[3])
        print(json.dumps(m, indent=2, ensure_ascii=False))
    except Exception as e:
        traceback.print_exc()
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
