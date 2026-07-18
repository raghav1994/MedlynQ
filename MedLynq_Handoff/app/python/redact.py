"""PII redaction pipeline v2: orientation-correct → dual OCR (union of both
engines' PII hits) → OpenCV burns black rectangles.

Runs entirely local. Never sends anything outward.
Input: image or single-page PDF (rasterized).
Output: redacted image at the same dims, plus a JSON log of burned boxes.

Engine shape (each verified independently on real hospital documents,
including a real Aadhaar card and a real handwritten phone number, before
being wired in here):
  1. PP-LCNet_x1_0_doc_ori (PaddleX) — tiny orientation classifier, ~0.05-0.1s.
     Looks at the page once, outputs 0/90/180/270, nothing else. We then
     rotate with plain OpenCV (no ML) to correct it.
  2. RapidOCR — fast (~1-2s), correctly reads real Aadhaar numbers and
     printed forms, but can be confidently WRONG on handwriting (verified: a
     real handwritten phone number came back garbled with 0.80 confidence —
     high enough that no confidence threshold would have caught it).
  3. OnnxTR (det_arch=fast_base, reco_arch=crnn_vgg16_bn) — matches doctr's
     real handwriting accuracy (verified: read that same phone number
     correctly) without doctr's heavy PyTorch dependency.

Both engines run on EVERY document, unconditionally — we tried confidence-
based and keyword-triggered escalation first, and both failed real testing
(see _run_ocr's docstring for what specifically went wrong). Their lines are
unioned before PII classification, so whichever engine actually reads a
given Aadhaar/phone/PAN/DOB correctly gets burned, regardless of which one
it was. Total cost ~3-6s/document — still ~5-8x faster than the original
~25-30s PaddleOCR-only baseline.

PaddleOCR/PaddleX stays installed solely to run the tiny orientation
classifier above — it is not used for text detection or recognition anymore.

PII patterns burned:
  - 12-digit Aadhaar (with or without spaces)
  - 10-digit phone (starts with 6-9)
  - PAN (5 letters + 4 digits + letter)
  - DOB lines (DD/MM/YYYY near "DOB" / "Date of Birth" / "जन्म")
  - Address block (after "S/o", "D/o", "W/o", "Address")
  - Photo region (Haar cascade face detect)
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
except ImportError:
    pass

# Reversible test toggle — when set, skips all text-based PII detection
# entirely (Aadhaar/PAN/phone/DOB/address/geotag-stamp). Face detection
# (OpenCV Haar cascade) still runs either way. Set MEDLYNQ_SKIP_TEXT_OCR=true
# in .env.local to test Sarvam-only performance; unset (or "false") to
# restore full redaction.
SKIP_TEXT_OCR = os.getenv("MEDLYNQ_SKIP_TEXT_OCR", "").strip().lower() in ("1", "true", "yes")

# Reversible speed toggle — when set, skips OnnxTR and runs RapidOCR alone
# for PII detection (roughly halves local redaction time: one engine pass
# instead of two). Originally both engines ran unconditionally because an
# older RapidOCR was found to confidently misread a handwritten phone
# number. Re-tested 2026-07-12 across 20 real documents (3 real Aadhaar
# cards, a phone-number-heavy report, multiple prescriptions) after RapidOCR's
# underlying models were upgraded to PP-OCRv6: RapidOCR alone caught every
# Aadhaar number (3/3) and every phone number (5/5) in that set; OnnxTR
# missed all of them and consistently reported lower confidence. Default is
# RapidOCR-only; set MEDLYNQ_USE_ONNXTR=true in .env.local to bring back the
# second engine (e.g. if a future document type turns out to need it).
USE_ONNXTR = os.getenv("MEDLYNQ_USE_ONNXTR", "").strip().lower() in ("1", "true", "yes")

# Same crash we found with PaddleOCR: running Paddle-based models (this
# orientation classifier included) with mkldnn enabled across more than one
# concurrent process crashes reliably. Single warm worker is unaffected;
# multi-worker pools should set this to false.
_MKLDNN = os.getenv("MEDLYNQ_PADDLE_MKLDNN", "true").strip().lower() not in ("0", "false", "no")

# ---------- regexes ----------
AADHAAR_RE = re.compile(r"\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b")
PHONE_RE = re.compile(r"\b[6-9]\d{9}\b")
PAN_RE = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")
DOB_RE = re.compile(r"\b\d{2}[/-]\d{2}[/-]\d{4}\b")
DOB_CONTEXT = re.compile(r"(DOB|D\.O\.B|Date\s*of\s*Birth|जन्म\s*तिथि)", re.IGNORECASE)
ADDR_CONTEXT = re.compile(r"\b(S/o|D/o|W/o|Address|पता)\b", re.IGNORECASE)
# "Geotag camera" apps (used for discharge/handover photos) stamp a location
# overlay reading like "Lat 28.67° Long 77.11°" — a strong, low-false-positive
# signal that this is a PHOTO, not a scanned document, even when it has a lot
# of overlay text (which otherwise looks like "a document with text on it").
GEOTAG_RE = re.compile(r"\bLat\b.{0,20}\bLong\b", re.IGNORECASE)

# ---------- lazy-loaded engines ----------
_orientation_model = None
_rapid_engine = None
_onnxtr_engine = None


def _get_orientation_model():
    global _orientation_model
    if _orientation_model is None:
        from paddlex import create_model
        _orientation_model = create_model(model_name="PP-LCNet_x1_0_doc_ori", enable_mkldnn=_MKLDNN)
    return _orientation_model


def _get_rapid_engine():
    global _rapid_engine
    if _rapid_engine is None:
        from rapidocr import RapidOCR
        _rapid_engine = RapidOCR()
    return _rapid_engine


def _get_onnxtr_engine():
    global _onnxtr_engine
    if _onnxtr_engine is None:
        from onnxtr.models import ocr_predictor
        # fast_base is what real doctr uses by default — verified this exact
        # architecture correctly reads handwriting (a real phone number)
        # where the lighter db_resnet50 config did not.
        _onnxtr_engine = ocr_predictor(det_arch="fast_base", reco_arch="crnn_vgg16_bn")
    return _onnxtr_engine


# ---------- orientation correction ----------
def _correct_orientation(img: np.ndarray) -> tuple[np.ndarray, int]:
    """Runs the tiny orientation classifier and rotates with plain OpenCV
    (no ML) to correct it. Returns (possibly-rotated image, detected angle).
    Rotation directions below are the ones verified to actually straighten a
    real rotated document, not assumed from the model's label convention."""
    try:
        model = _get_orientation_model()
        result = list(model.predict(img))[0]
        angle = int(result["label_names"][0])
    except Exception:
        return img, 0

    if angle == 90:
        img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    elif angle == 180:
        img = cv2.rotate(img, cv2.ROTATE_180)
    elif angle == 270:
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    return img, angle


# ---------- box utilities ----------
def _quad_to_xywh(quad: list[list[float]]) -> tuple[int, int, int, int]:
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    x, y = int(min(xs)), int(min(ys))
    w = int(max(xs) - x)
    h = int(max(ys) - y)
    return x, y, w, h


def _expand(box: tuple[int, int, int, int], img_w: int, img_h: int, pad: int = 6) -> tuple[int, int, int, int]:
    x, y, w, h = box
    return (
        max(0, x - pad),
        max(0, y - pad),
        min(img_w - x, w + 2 * pad),
        min(img_h - y, h + 2 * pad),
    )


# ---------- face detection for photo region ----------
def _detect_faces(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(cascade_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.2, minNeighbors=4, minSize=(40, 40))
    img_h, img_w = img.shape[:2]
    return [_expand(tuple(map(int, f)), img_w, img_h, pad=20) for f in faces]


# ---------- OCR engines, normalized to the same [quad, (text, conf)] shape ----------
def _run_rapid(img: np.ndarray) -> list[list]:
    engine = _get_rapid_engine()
    result = engine(img)
    if not result or not result.txts:
        return []
    lines = []
    for box, text, score in zip(result.boxes, result.txts, result.scores):
        quad = box.tolist() if hasattr(box, "tolist") else list(box)
        lines.append([quad, (text, float(score))])
    return lines


def _run_onnxtr(img: np.ndarray) -> list[list]:
    from onnxtr.io import DocumentFile
    img_h, img_w = img.shape[:2]
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        return []
    engine = _get_onnxtr_engine()
    doc = DocumentFile.from_images(buf.tobytes())
    result = engine(doc)
    lines = []
    for page in result.pages:
        for block in page.blocks:
            for line in block.lines:
                if not line.words:
                    continue
                text = " ".join(w.value for w in line.words)
                conf = sum(w.confidence for w in line.words) / len(line.words)
                (xmin, ymin), (xmax, ymax) = line.geometry
                quad = [
                    [xmin * img_w, ymin * img_h],
                    [xmax * img_w, ymin * img_h],
                    [xmax * img_w, ymax * img_h],
                    [xmin * img_w, ymax * img_h],
                ]
                lines.append([quad, (text, float(conf))])
    return lines


def _run_ocr(img: np.ndarray) -> tuple[list[list], str]:
    """RapidOCR-only by default (MEDLYNQ_USE_ONNXTR unset) — see the
    USE_ONNXTR toggle above for why. Set MEDLYNQ_USE_ONNXTR=true to restore
    the original dual-engine union: both engines run, whichever actually
    reads a given Aadhaar/phone/PAN/DOB correctly, that reading gets burned,
    regardless of which engine it came from.

    History, kept for context if OnnxTR ever needs to come back: we tried
    being smarter about escalation first — only running the handwriting
    engine when the fast pass's own confidence looked low, or only on
    keyword-triggered regions. Both failed in real testing — RapidOCR (at
    the time) came back confidently WRONG on a real handwritten phone number
    (0.80 confidence on a garbled read), so no confidence threshold would
    have caught it; and cropping just the flagged region and re-reading it
    with the handwriting engine made the reading WORSE, not better. Keyword-
    triggered escalation fired on nearly every real hospital document anyway,
    saving little time. That's why both engines ran unconditionally for a
    while — until RapidOCR's underlying models were upgraded and a
    re-test (see USE_ONNXTR comment) showed the original finding no longer
    held."""
    rapid_lines = _run_rapid(img)
    if not USE_ONNXTR:
        return rapid_lines, "rapid"
    onnxtr_lines = _run_onnxtr(img)
    return rapid_lines + onnxtr_lines, "rapid+onnxtr"


# ---------- main entry ----------
def redact_image(in_path: str, out_path: str, keep_signature: bool = True) -> dict[str, Any]:
    img = cv2.imread(in_path)
    if img is None:
        raise ValueError(f"could not read image: {in_path}")

    ocr_method = "skipped"
    lines: list[list] = []
    detected_angle = 0
    if not SKIP_TEXT_OCR:
        img, detected_angle = _correct_orientation(img)
        lines, ocr_method = _run_ocr(img)
    img_h, img_w = img.shape[:2]

    burned: list[dict[str, Any]] = []

    if lines:
        for line in lines:
            quad, (text, conf) = line
            box = _quad_to_xywh(quad)
            reason = _classify_text(text)
            if reason:
                burned.append({"box": list(box), "reason": reason, "text_hash": _hash(text)})

        # Address: burn the bbox plus a small margin for wrapped continuation
        # text. Bounded tightly — real hospital forms are multi-column
        # (Name | Address | UHID | Age/Sex all on the same row), so extending
        # all the way to the page's right edge and 6 lines down blacks out
        # unrelated identity fields sitting next to or below the address
        # column, not just the address itself.
        for line in lines:
            quad, (text, conf) = line
            if ADDR_CONTEXT.search(text):
                box = _quad_to_xywh(quad)
                x, y, w, h = box
                ext = (x, y, min(w * 3, img_w - x), min(h * 2, img_h - y))
                burned.append({"box": list(ext), "reason": "address_block", "text_hash": _hash(text)})

    # Photo / face region
    faces = _detect_faces(img)
    for f in faces:
        burned.append({"box": list(f), "reason": "photo_face"})
    img_area = img_w * img_h
    max_face_area_ratio = max((w * h) / img_area for _, _, w, h in faces) if faces else 0.0

    # Geotag-camera location stamp (e.g. "Lat 28.67° Long 77.11°") — a strong
    # signal this is a photo (discharge/handover selfie), not a scanned
    # document, even when the overlay itself has plenty of text.
    all_text = " ".join(t for _, (t, _) in lines) if lines else ""
    has_geotag_stamp = bool(GEOTAG_RE.search(all_text))

    # Burn all boxes (solid black)
    for b in burned:
        x, y, w, h = b["box"]
        cv2.rectangle(img, (x, y), (x + w, y + h), (0, 0, 0), thickness=-1)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(out_path, img)

    # ---- audit ----
    try:
        from audit import append as audit_append, sha256_of
        parts = Path(out_path).parts
        mrn = next((p for p in parts if p.isupper() and len(p) >= 6), None)
        audit_append(
            kind="redact",
            mrn=mrn,
            file=Path(in_path).name,
            sha256_in=sha256_of(in_path),
            sha256_out=sha256_of(out_path),
            burned_count=len(burned),
            extra={"reasons": sorted({b["reason"] for b in burned}), "ocr_method": ocr_method},
        )
    except Exception:
        pass

    return {
        "in_path": in_path,
        "out_path": out_path,
        "burned_count": len(burned),
        "boxes": burned,
        "img_w": img_w,
        "img_h": img_h,
        "keep_signature": keep_signature,
        "text_line_count": len(lines),
        "max_face_area_ratio": round(max_face_area_ratio, 4),
        "has_geotag_stamp": has_geotag_stamp,
        "text_ocr_skipped": SKIP_TEXT_OCR,
        # The actual local OCR reading (RapidOCR, or +OnnxTR if enabled),
        # already computed here for redaction — exposed so callers can
        # cross-check it against Sarvam's returned text and catch Sarvam
        # coming back garbled despite a non-empty response (see
        # ocr_quality.py). Free: no extra OCR pass, just not discarding text
        # we already read.
        "local_ocr_text": all_text.strip(),
        # How much the page needed rotating to become upright (0/90/180/270).
        # This only ever got applied to the REDACTED copy sent to Sarvam —
        # the actual file saved in PatientLog/{mrn}/originals/ (what the
        # MEDCO opens) never received it, so any document needing rotation
        # was permanently stored sideways. land_document.py uses this value
        # to also correct the saved original, not just the OCR copy.
        "detected_angle": detected_angle,
        # Which engine actually produced the text — "rapid" (fast path),
        # "onnxtr_fallback_low_conf" (escalated due to low confidence), or
        # "onnxtr_fallback_empty" (fast path found nothing at all).
        "ocr_method": ocr_method,
    }


def _classify_text(text: str) -> str | None:
    if AADHAAR_RE.search(text):
        return "aadhaar"
    if PAN_RE.search(text):
        return "pan"
    if PHONE_RE.search(text):
        return "phone"
    if DOB_RE.search(text) and DOB_CONTEXT.search(text):
        return "dob"
    return None


def _hash(s: str) -> str:
    import hashlib
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: redact.py <in_image> <out_image>", file=sys.stderr)
        sys.exit(1)
    log = redact_image(sys.argv[1], sys.argv[2])
    print(json.dumps(log, indent=2, ensure_ascii=False))
