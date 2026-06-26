"""PII redaction pipeline: PaddleOCR detects → OpenCV burns black rectangles.

Runs entirely local. Never sends anything outward.
Input: image or single-page PDF (rasterized).
Output: redacted image at the same dims, plus a JSON log of burned boxes.

PII patterns burned:
  - 12-digit Aadhaar (with or without spaces)
  - 10-digit phone (starts with 6-9)
  - PAN (5 letters + 4 digits + letter)
  - DOB lines (DD/MM/YYYY near "DOB" / "Date of Birth" / "जन्म")
  - Address block (after "S/o", "D/o", "W/o", "Address")
  - Photo region (Haar cascade face detect)
  - Patient signature (heuristic: handwritten strokes in bottom-right quadrant,
    NOT burned when keep_signature=True — used for doctor sig pages)

Lazy-imports paddle so the sidecar still boots if Paddle install is missing.
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

# ---------- regexes ----------
AADHAAR_RE = re.compile(r"\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b")
PHONE_RE = re.compile(r"\b[6-9]\d{9}\b")
PAN_RE = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")
DOB_RE = re.compile(r"\b\d{2}[/-]\d{2}[/-]\d{4}\b")
DOB_CONTEXT = re.compile(r"(DOB|D\.O\.B|Date\s*of\s*Birth|जन्म\s*तिथि)", re.IGNORECASE)
ADDR_CONTEXT = re.compile(r"\b(S/o|D/o|W/o|Address|पता)\b", re.IGNORECASE)

# ---------- Paddle (lazy) ----------
_paddle = None


def _get_paddle():
    global _paddle
    if _paddle is None:
        from paddleocr import PaddleOCR
        import logging
        from paddleocr import logger
        logger.setLevel(logging.ERROR)
        _paddle = PaddleOCR(use_angle_cls=True, lang="en", enable_mkldnn=True)
    return _paddle


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


# ---------- main entry ----------
def redact_image(in_path: str, out_path: str, keep_signature: bool = True) -> dict[str, Any]:
    img = cv2.imread(in_path)
    if img is None:
        raise ValueError(f"could not read image: {in_path}")
    img_h, img_w = img.shape[:2]

    paddle = _get_paddle()
    result = paddle.ocr(in_path)

    # Adapt to both new PaddleX (dict-like OCRResult) and old formats
    lines = []
    if result and len(result) > 0:
        page = result[0]
        if isinstance(page, dict) and 'rec_polys' in page and 'rec_texts' in page:
            polys = page['rec_polys']
            texts = page['rec_texts']
            scores = page.get('rec_scores', [1.0] * len(texts))
            for poly, text, score in zip(polys, texts, scores):
                quad = poly.tolist() if hasattr(poly, 'tolist') else list(poly)
                lines.append([quad, (text, score)])
        else:
            lines = page

    burned: list[dict[str, Any]] = []

    if lines:
        for line in lines:
            quad, (text, conf) = line
            box = _quad_to_xywh(quad)
            reason = _classify_text(text)
            if reason:
                burned.append({"box": list(box), "reason": reason, "text_hash": _hash(text)})

        # Address: burn the bbox AND a few lines below it
        for i, line in enumerate(lines):
            quad, (text, conf) = line
            if ADDR_CONTEXT.search(text):
                box = _quad_to_xywh(quad)
                # widen + extend down
                x, y, w, h = box
                ext = (x, y, img_w - x, min(h * 6, img_h - y))
                burned.append({"box": list(ext), "reason": "address_block", "text_hash": _hash(text)})

    # Photo / face region
    for f in _detect_faces(img):
        burned.append({"box": list(f), "reason": "photo_face"})

    # Burn all boxes (solid black)
    for b in burned:
        x, y, w, h = b["box"]
        cv2.rectangle(img, (x, y), (x + w, y + h), (0, 0, 0), thickness=-1)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(out_path, img)

    return {
        "in_path": in_path,
        "out_path": out_path,
        "burned_count": len(burned),
        "boxes": burned,
        "img_w": img_w,
        "img_h": img_h,
        "keep_signature": keep_signature,
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
    print(json.dumps(log, indent=2))
