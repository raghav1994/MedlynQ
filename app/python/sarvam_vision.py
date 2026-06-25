"""Sarvam Vision OCR client.

Sends ONLY the redacted (burned) image. Never the original.
Returns structured JSON: full text + per-doc-type synopsis fields.

API key read from .env.local (Next.js convention). Never logged.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

# Load .env.local from the app root (two dirs up from this file)
APP_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(APP_ROOT / ".env.local")

SARVAM_KEY = os.getenv("SARVAM_API_KEY", "")
SARVAM_ENDPOINT = os.getenv("SARVAM_VISION_ENDPOINT", "https://api.sarvam.ai/v1/vision/extract")
TIMEOUT_S = 60


def _b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def extract(redacted_path: str, doc_type: str | None = None) -> dict[str, Any]:
    """Send a redacted image to Sarvam Vision and return parsed JSON.

    doc_type is passed so Sarvam can use the right extraction prompt
    (HPE vs Bill vs Chemo Chart all need different fields).
    """
    if not SARVAM_KEY:
        raise RuntimeError("SARVAM_API_KEY not set in .env.local")

    payload = {
        "image_b64": _b64(redacted_path),
        "doc_type": doc_type or "generic",
        "return_synopsis": True,
    }
    headers = {
        "Authorization": f"Bearer {SARVAM_KEY}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(SARVAM_ENDPOINT, json=payload, headers=headers, timeout=TIMEOUT_S)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        return {
            "error": str(e),
            "status": "failed",
            "doc_type": doc_type,
        }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: sarvam_vision.py <redacted_image> [doc_type]", file=sys.stderr)
        sys.exit(1)
    path = sys.argv[1]
    dt = sys.argv[2] if len(sys.argv) > 2 else None
    out = extract(path, dt)
    print(json.dumps(out, indent=2, ensure_ascii=False))
