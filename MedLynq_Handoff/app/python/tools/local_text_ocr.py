"""Local-only text OCR for screenshots of already-digital text (e.g. a
payer-portal query, pasted as a screenshot into the Query Board).

Deliberately skips the whole redact.py pipeline: no PII burning, no face
detection, no Sarvam upload. A payer query screenshot isn't a patient
document — it's UI text — so there's nothing to redact and no reason to
pay for or wait on a cloud round-trip. RapidOCR alone (same engine
redact.py uses by default) reads clean, computer-rendered text well; that's
exactly what this input is.

Usage: python local_text_ocr.py <image_path>
Prints one JSON line: {"text": "...", "method": "rapid_local", "line_count": N}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from redact import _run_ocr  # type: ignore


def extract_text(image_path: str) -> dict:
    img = cv2.imread(image_path)
    if img is None:
        return {"error": f"could not read image: {image_path}"}
    lines, method = _run_ocr(img)
    text = "\n".join(t for _, (t, _) in lines).strip()
    return {"text": text, "method": f"{method}_local", "line_count": len(lines)}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: local_text_ocr.py <image_path>"}))
        sys.exit(1)
    print(json.dumps(extract_text(sys.argv[1]), ensure_ascii=False))
