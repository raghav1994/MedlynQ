"""Land a single document onto a patient's disk folder — the final step of
the intake pipeline that makes it show up correctly on the Patient page.

For each dropped file, this script:
  1. Detects extractability (text-PDF vs scanned/image)
  2. Skips OCR entirely for pure-visual docs (drug pouch, geotag, ID photos) —
     cost_gate.SKIP_DOC_TYPES
  3. For scanned PDFs / images that DO need reading: redacts PII locally
     (redact.py) then sends the redacted version to Sarvam (SHA-cached)
  4. For text-PDFs: extracts locally with PyMuPDF (free)
  5. Runs content_classifier on the extracted text to get the real doc_type
     label + confidence (overrides the filename-based guess when confident)
  6. Runs md_parser to pull structured fields (vitals, drug codes, bill total,
     diagnosis, dates, scheme card, procedure — whatever applies to this doc_type)

The core logic lives in land_file() so it can be called either:
  - as a one-shot CLI: `python land_document.py <path> <doc_type_hint>`
  - or from worker.py, a persistent process that keeps PaddleOCR's model
    loaded in memory across many files instead of reloading it every time
    (that reload was the single biggest per-file cost — several seconds of
    cold-start on top of the actual OCR work).

Returns one JSON object:
  {
    "doc_type": "Hospital Bill",       # matches checklist.ts labels
    "confidence": 0.92,
    "method": "pymupdf" | "sarvam" | "skip",
    "skipped_ocr": bool,
    "fields": { ...doc_specific fields from md_parser... },
    "identity": { "patient_name":..., "mrn":..., "age":..., "gender":... },
    "redact": { "burned_count": int, "reasons": [...] } | null,
    "text": "<first 12000 chars>"
  }
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# Windows' default stdout encoding is the legacy cp1252 codepage, not UTF-8 —
# printing any character outside it (emoji, circled numbers, etc. that
# genuinely show up in real Sarvam OCR text) crashes with UnicodeEncodeError
# and kills the whole subprocess. This affects every print() below.
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cost_gate import should_skip                      # noqa: E402
from content_classifier import classify as classify_content, detect_lab_panels  # noqa: E402
from md_parser import parse as parse_fields             # noqa: E402
from extract_hints import extract_image as _cached_extract_image  # noqa: E402 (SHA-cached redact+Sarvam)
from compressor import compress_pdf_safe, compress_standalone_image  # noqa: E402
from identity_llm import extract_identity_llm            # noqa: E402 (fallback only when regex finds nothing)

# Filename-hint doc_type slug → whether it's visual-only (matches cost_gate.SKIP_DOC_TYPES
# but expressed as the same slugs classify_by_filename uses on the Node side).
FILENAME_DOCTYPE_TO_SLUG = {
    "Drug Pouch":          "drug_pouch",
    "Discharge Photo":     "discharge_photo",
    "Aadhaar":             "aadhaar_card",
    "Insurance / Scheme Card": "ayushman_card",
}


def compress_input(path: Path) -> Path:
    """Compress every dropped file BEFORE it goes anywhere — Sarvam OCR or a
    direct landing (Aadhaar, geotag photo, drug pouch, scheme card). Uses the
    same compressor.py logic as the earlier batch pipeline. Fails open: if
    compression errors out for any reason, the original file is used as-is
    so the drop never gets blocked by a compression bug.
    """
    out_path = path.with_name(f"{path.stem}_c{path.suffix}")
    try:
        ok = (
            compress_pdf_safe(str(path), str(out_path))
            if path.suffix.lower() == ".pdf"
            else compress_standalone_image(str(path), str(out_path))
        )
        if ok and out_path.is_file() and out_path.stat().st_size > 0:
            return out_path
    except Exception:
        pass
    return path


def extract_pdf_text(path: Path) -> str:
    import fitz
    parts = []
    with fitz.open(str(path)) as doc:
        for i, page in enumerate(doc):
            if i >= 5:
                break
            parts.append(page.get_text("text") or "")
    return "\n".join(parts).strip()


def explode_pdf_pages(path: Path, max_pages: int = 20) -> list[Path]:
    """Rasterize every page of a scanned PDF to its own PNG file (200 DPI,
    same resolution the old page-1-only path used). Each returned path can be
    handed to _cached_extract_image() independently — including, notably, in
    parallel across a worker pool, since pages don't depend on each other.

    Capped at max_pages as a sanity limit (a 200+ page PDF is almost
    certainly not a real single patient document dropped by mistake).
    """
    import fitz
    out_paths: list[Path] = []
    with fitz.open(str(path)) as doc:
        n = min(len(doc), max_pages)
        for i in range(n):
            page_path = path.parent / f"{path.stem}_page{i + 1}.png"
            pix = doc[i].get_pixmap(dpi=200)
            pix.save(str(page_path))
            out_paths.append(page_path)
    return out_paths


def merge_page_results(pages: list[tuple[str, str, bool, dict]]) -> tuple[str, str, dict]:
    """Combine per-page (text, method, cached, redact_info) tuples from
    explode_pdf_pages() into one logical document result:
      - text: every page's text, in page order, separated so downstream
        parsers can still find fields regardless of which page they're on
      - method: "sarvam" if any page needed it, else whatever ran
      - redact_info: burned_count summed, reasons unioned, so the audit
        trail reflects the WHOLE document, not just page 1
    """
    texts = []
    methods = []
    total_burned = 0
    all_reasons: set[str] = set()
    for i, (text, method, _cached, redact_info) in enumerate(pages):
        if text:
            texts.append(f"--- page {i + 1} ---\n{text}")
        methods.append(method)
        if redact_info:
            total_burned += redact_info.get("burned_count", 0)
            all_reasons.update(redact_info.get("reasons", []))
    failed = [m for m in methods if m.startswith("sarvam_failed")]
    if "sarvam" in methods:
        # At least one page genuinely succeeded — still note if others
        # failed, rather than silently hiding a partial outage.
        merged_method = "sarvam" if not failed else f"sarvam (partial failure: {failed[0]})"
    else:
        merged_method = methods[0] if methods else "unsupported"
    merged_redact = {"burned_count": total_burned, "reasons": sorted(all_reasons)}
    return "\n\n".join(texts), merged_method, merged_redact


def _rotate_saved_image(image_path: Path, angle: int) -> None:
    """Rotates the ACTUAL saved file in-place to match the orientation
    correction that redact.py already applied to its OCR copy. Without this,
    the file the MEDCO opens from PatientLog/{mrn}/originals/ stays sideways
    even though Sarvam read it correctly — confirmed on a real document today.
    `angle` uses the same convention as redact.py's _correct_orientation():
    degrees to rotate counter-clockwise to reach upright.
    """
    if not angle:
        return
    from PIL import Image
    img = Image.open(image_path)
    img = img.rotate(angle, expand=True)
    img.save(image_path)


def _rotate_saved_pdf_pages(pdf_path: Path, angles: list[int]) -> None:
    """Same fix as _rotate_saved_image but for a multi-page scanned PDF —
    sets each page's /Rotate flag (a display instruction, not a pixel
    rewrite) to match that page's own detected angle. PDF /Rotate rotates
    CLOCKWISE for display, while redact.py's angle is the CCW correction
    needed, hence the (360 - angle) % 360 conversion.
    """
    if not any(angles):
        return
    import fitz
    doc = fitz.open(str(pdf_path))
    for i, angle in enumerate(angles):
        if i >= len(doc) or not angle:
            continue
        doc[i].set_rotation((360 - angle) % 360)
    doc.saveIncr()
    doc.close()


def _prepare(path: Path, filename_hint: str, force_doc_type: str | None = None) -> dict[str, Any] | tuple[Path, str, str | None]:
    """Shared front half of landing: existence check, compression, and the
    visual-only skip. Returns EITHER a finished skip-result dict (visual-only
    doc — never OCR'd) OR a (compressed_path, ext, slug_hint) tuple for the
    caller to continue with. Split out so both the normal single-shot path
    (land_file) and the pool-parallel path (explode_for_pool) do this exactly
    once instead of each re-implementing / re-running it."""
    if not path.exists():
        return {"error": "file not found"}

    # Compress FIRST — every dropped file, regardless of where it goes next
    # (Sarvam OCR or straight into PatientLog for visual-only docs).
    compressed_path = compress_input(path)
    slug_hint = FILENAME_DOCTYPE_TO_SLUG.get(filename_hint)
    ext = compressed_path.suffix.lower()

    if slug_hint and should_skip(slug_hint):
        return {
            "doc_type": force_doc_type or filename_hint,
            "confidence": 1.0,
            "method": "skip",
            "skipped_ocr": True,
            "fields": {},
            "identity": {},
            "redact": None,
            "text": "",
            "compressed_path": str(compressed_path),
        }

    return compressed_path, ext, slug_hint


def _gather_text_sequential(compressed_path: Path, ext: str) -> tuple[str, str, dict | None]:
    """Text-PDF / image / (fallback) scanned-PDF text gathering — OCRs a
    scanned PDF's pages one at a time, in-process. This is the ORIGINAL,
    unparallelized path: still used directly by land_file() (CLI / any
    single-shot caller), and as the fallback inside explode_for_pool() for
    everything that isn't a scanned multi-page PDF (single page, text-PDF,
    image) since those aren't worth splitting across the pool."""
    text = ""
    method = "unsupported"
    redact_info = None

    if ext == ".pdf":
        text = extract_pdf_text(compressed_path)
        method = "pymupdf"
        if len(text.strip()) < 40:
            # Scanned PDF (no usable text layer) — rasterize EVERY page, then
            # reuse the same redact→SHA-cache→Sarvam path as a real image for
            # each one, so a duplicate drop never re-bills Sarvam.
            #
            # This used to rasterize only doc[0] (page 1) — real multi-page
            # scans (a 7-page treatment summary, a 14-page discharge bundle)
            # were silently losing every page after the first, with no error
            # and no sign anything was missing. Processing is still
            # sequential here; explode_for_pool() below is the parallel
            # version that fans pages out across the worker pool instead —
            # this function stays as the correctness-preserving fallback.
            page_paths: list[Path] = []
            try:
                page_paths = explode_pdf_pages(compressed_path)
                page_results = [_cached_extract_image(p) for p in page_paths]
                text, method, redact_info = merge_page_results(page_results)
                angles = [(r[3] or {}).get("detected_angle", 0) for r in page_results]
                try:
                    _rotate_saved_pdf_pages(compressed_path, angles)
                except Exception:
                    pass  # never block landing on a cosmetic rotation fix
            except Exception as e:
                text = ""
                method = f"scanned_pdf_failed:{e}"
            finally:
                for p in page_paths:
                    try:
                        p.unlink(missing_ok=True)
                    except Exception:
                        pass
    else:
        # Image — redact() + Sarvam via the shared SHA-cached helper
        try:
            text, method, _cached, redact_info = _cached_extract_image(compressed_path)
            try:
                _rotate_saved_image(compressed_path, (redact_info or {}).get("detected_angle", 0))
            except Exception:
                pass  # never block landing on a cosmetic rotation fix
        except Exception as e:
            text = ""
            method = f"image_failed:{e}"

    return text, method, redact_info


def _finish(text: str, method: str, redact_info: dict | None, filename_hint: str,
            force_doc_type: str | None, hospital_id: str | None, compressed_path: Path) -> dict[str, Any]:
    """Content classification onward — everything after text is in hand,
    regardless of whether it came from the sequential path or the
    pool-parallel path. Shared so both produce identical result shapes."""
    # ---- Content-detected visual-only (a face-filled photo or an Aadhaar
    # number found in the image, regardless of filename) — never went to
    # Sarvam; land it as-is, same shape as the filename-hint skip above. ----
    if method == "skip_visual":
        label = "Aadhaar" if "aadhaar" in (redact_info or {}).get("reasons", []) else "Photo / ID (auto-detected)"
        return {
            "doc_type": force_doc_type or label,
            "confidence": 1.0,
            "method": "skip_visual",
            "skipped_ocr": True,
            "fields": {},
            "identity": {},
            "redact": redact_info,
            "text": "",
            "compressed_path": str(compressed_path),
        }

    # ---- Content classification (overrides filename hint when confident) ----
    # Threshold calibrated against content_classifier.py's own scoring formula:
    # conf = 0.6 + 0.35*strong_coverage + 0.15*weak_bonus. A rule needs at
    # least 1 strong-phrase match to fire at all, which already puts it at
    # 0.6+ — 0.75 was discarding real, correct classifications that matched
    # 2-3 specific medical-terminology phrases (verified on a real chemo
    # chart that scored 0.74 and was being thrown away as "Unknown Document").
    CONTENT_CONFIDENCE_THRESHOLD = 0.65
    content = classify_content(text, hospital_id) if text else {"doc_type": "unknown", "label": filename_hint, "confidence": 0.0}
    content_confident = content.get("confidence", 0) >= CONTENT_CONFIDENCE_THRESHOLD and content["doc_type"] != "unknown"
    # A MEDCO's explicit slot choice always wins — but keep classifying so we
    # still learn what the model would have guessed (content_guess below).
    final_label = force_doc_type or (content["label"] if content_confident else filename_hint)
    final_slug = content["doc_type"] if content_confident else None

    # ---- Rich field extraction ----
    parsed = parse_fields(text, final_slug) if text else {"patient_name": None, "mrn": None, "age": None, "gender": None, "doc_specific": {}}

    # ---- LLM fallback — identity AND, now, classification for a brand-new
    # hospital/specialty with no compiled regex rules yet ----
    # Regex (parse_fields above) is free and already correct for plenty of
    # documents (clean "Patient Name:"/"MRN:" layouts) — no reason to spend
    # on every file. But it has a real, unbounded class of failure: today
    # alone it missed a name behind "Name;" (semicolon, not colon) and wrongly
    # grabbed "Action Cancer Hospital" as a patient name off a feedback form.
    # An LLM reasons about the text instead of pattern-matching it, so it
    # catches these without us hand-patching every new OCR quirk — verified
    # directly on both real documents above before wiring this in. Costs
    # ~Rs 0.02-0.03/doc.
    #
    # Now ALSO called whenever the fast regex classifier wasn't confident —
    # this is the "day-one" path for a hospital whose specialty has no tuned
    # CLASSIFIER_RULES entry yet (see content_classifier.py's SPECIALTY_RULES
    # / _tenant_rules): the dynamic tenant-aware prompt (identity_llm.py)
    # still recognizes their document types from the hospital's config, just
    # slower/costlier per doc than a compiled regex rule. Once real volume
    # accumulates for that hospital, its doc types graduate to a hand-tuned
    # regex block and this LLM call stops firing for them (promote-to-regex
    # workflow).
    need_identity = text and not parsed.get("patient_name") and not parsed.get("mrn")
    need_classification = text and not content_confident
    if need_identity or need_classification:
        llm_result = extract_identity_llm(text, hospital_id)
        if llm_result:
            parsed["patient_name"] = parsed.get("patient_name") or llm_result["patient_name"]
            parsed["mrn"] = parsed.get("mrn") or llm_result["mrn"]
            parsed["age"] = parsed.get("age") or llm_result["age"]
            parsed["gender"] = parsed.get("gender") or llm_result["gender"]
            llm_doc_type = llm_result.get("doc_type")
            if need_classification and llm_doc_type and llm_doc_type.lower() not in ("other", "unknown"):
                final_slug = re.sub(r"[^a-z0-9]+", "_", llm_doc_type.strip().lower()).strip("_")
                final_label = force_doc_type or llm_doc_type.replace("_", " ")
                content = {**content, "doc_type": final_slug, "label": final_label, "method": "llm_fallback"}

    # Sarvam came back rubbish and we fell back to RapidOCR's own reading
    # (see extract_hints.py's quality gate) — cap confidence below the UI's
    # 0.7 low-confidence threshold (DocumentTile.tsx) so this surfaces as
    # LOW CONFIDENCE and gets a human's eyes, instead of looking identical
    # to a normal, fully-trusted Sarvam read.
    confidence = content.get("confidence", 0.9 if text else 0.0)
    if method == "rapid_fallback_sarvam_rubbish":
        confidence = min(confidence, 0.5)

    # A combined lab report (CBC + LFT + KFT all in one file) shouldn't only
    # ever satisfy ONE checklist slot just because it can only carry one
    # primary label — this tags every panel actually detected in the text so
    # checklist.ts's matchDocument can flip each one. Cheap to always run;
    # returns [] for anything that isn't a lab-panel document.
    satisfied_labels = detect_lab_panels(text) if text else []

    return {
        "doc_type": final_label,
        "confidence": confidence,
        "method": method,
        "skipped_ocr": False,
        "content_guess": content.get("label") if force_doc_type else None,
        "content_guess_confidence": content.get("confidence") if force_doc_type else None,
        "fields": parsed.get("doc_specific", {}),
        "identity": {
            "patient_name": parsed.get("patient_name"),
            "mrn": parsed.get("mrn"),
            "age": parsed.get("age"),
            "gender": parsed.get("gender"),
        },
        "redact": redact_info,
        "text": text[:12000],
        "compressed_path": str(compressed_path),
        "satisfied_labels": satisfied_labels,
    }


def land_file(path: Path, filename_hint: str, force_doc_type: str | None = None, hospital_id: str | None = None) -> dict[str, Any]:
    """Runs the full landing pipeline for one file and returns the result
    dict (not printed — callers decide how to emit it). Unchanged behavior
    from before the explode_for_pool() split — this always OCRs a scanned
    multi-page PDF's pages sequentially, in-process.

    force_doc_type: set when a MEDCO uploads directly into a specific
    checklist slot (the merged Documents & Checklist view) rather than
    dropping into the generic bulk-classify flow. Their explicit choice is
    unambiguous ground truth, so it always wins over the content classifier —
    but the classifier still runs and its guess is returned separately
    (content_guess/content_guess_confidence) so a mismatch becomes a labeled
    training signal instead of being silently discarded."""
    prepared = _prepare(path, filename_hint, force_doc_type)
    if isinstance(prepared, dict):
        return prepared  # error, or a visual-only skip result — already final
    compressed_path, ext, _slug_hint = prepared

    text, method, redact_info = _gather_text_sequential(compressed_path, ext)
    return _finish(text, method, redact_info, filename_hint, force_doc_type, hospital_id, compressed_path)


def explode_for_pool(path: Path, filename_hint: str, force_doc_type: str | None = None, hospital_id: str | None = None) -> dict[str, Any]:
    """Parallel-friendly front half: identical to land_file() for every case
    EXCEPT a scanned multi-page PDF, where it stops right before the
    expensive per-page OCR loop and hands back the rasterized page paths
    instead. The caller (Node, which owns the whole worker POOL — not just
    this one worker process) fans those pages out across the pool via
    extract_page(), then calls finish_parallel() with the results.

    Returns either:
      - a finished result dict with "parallel": False (every non-scanned-
        multipage case — just runs the normal sequential path, since
        splitting a single page/text-PDF/image isn't worth the complexity)
      - {"parallel": True, "pages": [...], "page_paths": [...], ...} for a
        scanned multi-page PDF, with NO OCR done yet.
    """
    prepared = _prepare(path, filename_hint, force_doc_type)
    if isinstance(prepared, dict):
        return {**prepared, "parallel": False}
    compressed_path, ext, _slug_hint = prepared

    if ext == ".pdf":
        text = extract_pdf_text(compressed_path)
        if len(text.strip()) < 40:
            try:
                page_paths = explode_pdf_pages(compressed_path)
            except Exception:
                page_paths = []
            if len(page_paths) > 1:
                return {
                    "parallel": True,
                    "page_paths": [str(p) for p in page_paths],
                    "compressed_path": str(compressed_path),
                    "filename_hint": filename_hint,
                    "force_doc_type": force_doc_type,
                    "hospital_id": hospital_id,
                }
            # 0 or 1 pages — not worth parallelizing; fall through to the
            # sequential path below, reusing what extract_pdf_text() already
            # did instead of recomputing it inside _gather_text_sequential.

    text, method, redact_info = _gather_text_sequential(compressed_path, ext)
    result = _finish(text, method, redact_info, filename_hint, force_doc_type, hospital_id, compressed_path)
    return {**result, "parallel": False}


def extract_page(page_path: Path) -> dict[str, Any]:
    """One page-image → (text, method, redact_info) via the same SHA-cached
    redact→Sarvam helper land_file() uses internally. Called once per page,
    dispatched to whichever pool worker is free — this IS the parallelizable
    unit of work explode_for_pool()/finish_parallel() split OCR into."""
    text, method, cached, redact_info = _cached_extract_image(page_path)
    return {"text": text, "method": method, "cached": cached, "redact_info": redact_info}


def finish_parallel(page_results: list[dict[str, Any]], page_paths: list[str], compressed_path: str,
                     filename_hint: str, force_doc_type: str | None, hospital_id: str | None) -> dict[str, Any]:
    """Reassembles per-page extract_page() results (gathered by Node across
    the worker pool, in original page order) back into one document result —
    the parallel-path equivalent of _gather_text_sequential's scanned-PDF
    branch, followed by the same _finish() every other path uses."""
    tuples = [(r.get("text", ""), r.get("method", "unsupported"), r.get("cached", False), r.get("redact_info")) for r in page_results]
    text, method, redact_info = merge_page_results(tuples)

    angles = [(r.get("redact_info") or {}).get("detected_angle", 0) for r in page_results]
    try:
        _rotate_saved_pdf_pages(Path(compressed_path), angles)
    except Exception:
        pass  # never block landing on a cosmetic rotation fix

    # Same cleanup land_file()'s finally-block does for the sequential path —
    # these _page{N}.png siblings have no manifest entry, so leaving them
    # around would show up as phantom "Consent Form" (no-manifest fallback)
    # documents on the patient page.
    for p in page_paths:
        try:
            Path(p).unlink(missing_ok=True)
        except Exception:
            pass

    result = _finish(text, method, redact_info, filename_hint, force_doc_type, hospital_id, Path(compressed_path))
    return {**result, "parallel": True}


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: land_document.py <path> <filename_doctype_hint>"}))
        return 2
    result = land_file(Path(sys.argv[1]), sys.argv[2])
    print(json.dumps(result, ensure_ascii=False))
    return 2 if "error" in result and len(result) == 1 else 0


if __name__ == "__main__":
    sys.exit(main())
